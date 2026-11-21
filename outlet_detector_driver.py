"""
Wylotek: serwomechanizm MG-996R, który otwiera albo blokuje wylot ula.

  sygnał – GPIO12 (pin 32), sprzętowe PWM0 kanał 0
  zasilanie – osobna przetwornica 5–6 V ≥ 3 A, masa wspólna z Raspberry

Wymaga w /boot/firmware/config.txt: dtoverlay=pwm-2chan,pin=12,func=4,pin2=13,func2=4 (kanał 1 = buzzer).

Serwo nie mówi, gdzie jest – read() zwraca ostatnią pozycję, którą mu zadaliśmy (zapisaną w data/outlet,
więc przeżywa restart). Zmiana pozycji: set_position(procent) – od razu i bez czekania, więc suwak na stronie
może wysyłać kolejne pozycje w trakcie przesuwania. Impulsy gasną MOVE_SECONDS po ostatniej komendzie.
Steruje app.py (POST /api/outlet i reguły godzinowe).

Kalibracja: PULSE_BLOCKED_US i PULSE_OPEN_US to długości impulsu dla „zablokowany” i „otwarty”.
MG-996R 180° rozumie około 500–2500 µs (0–180°). Zacznij od wartości poniżej i poprawiaj po kawałku,
patrząc na zasuwę – przy oparciu o ogranicznik serwo buczy i bierze dużo prądu.
"""
import os
import threading

import hardware

KEYS = ("o_position",)

PWM_CHANNEL = 0
PERIOD_NS = 20_000_000          # 50 Hz – standard serw
PULSE_BLOCKED_US = 1000         # impuls dla 0 % (zablokowany)
PULSE_OPEN_US = 2000            # impuls dla 100 % (otwarty)
MOVE_SECONDS = 1.5              # tyle po ostatniej komendzie trwa ruch, potem impulsy gasną
HOLD = False                    # True = serwo trzyma pozycję cały czas (prąd i buczenie); zasuwa zwykle nie musi

STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "outlet")
_lock = threading.Lock()
_off_timer = None
_demo_position = 100.0


def _saved():
    for path in (STATE_FILE, os.path.join(os.path.dirname(STATE_FILE), "wylotek")):   # druga: nazwa sprzed 2026-11-21
        try:
            with open(path, encoding="ascii") as f:
                return float(f.read().strip())
        except (OSError, ValueError):
            continue
    return None


def _release():
    with _lock:
        try:
            hardware.pwm_off(PWM_CHANNEL)
        except OSError:
            pass


def set_position(percent):
    """Ustawia wylotek: 0 = zablokowany, 100 = całkowicie otwarty. Nie czeka na koniec ruchu."""
    global _demo_position, _off_timer
    percent = min(100.0, max(0.0, float(percent)))
    if hardware.DEMO:
        _demo_position = percent
        return
    pulse_us = PULSE_BLOCKED_US + (PULSE_OPEN_US - PULSE_BLOCKED_US) * percent / 100
    with _lock:
        hardware.pwm_set(PWM_CHANNEL, PERIOD_NS, pulse_us * 1000)
        if _off_timer:
            _off_timer.cancel()
        if not HOLD:
            _off_timer = threading.Timer(MOVE_SECONDS, _release)
            _off_timer.daemon = True
            _off_timer.start()
        os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
        with open(STATE_FILE + ".tmp", "w", encoding="ascii") as f:
            f.write(f"{percent:g}\n")
        os.replace(STATE_FILE + ".tmp", STATE_FILE)


def read() -> dict:
    """
    o_position – pozycja wylotka jako procent otwarcia   [%]
                 0 = zablokowany, 100 = całkowicie otwarty, None = jeszcze nigdy nie ustawiany
    """
    return {"o_position": _demo_position if hardware.DEMO else _saved()}
