"""
Buzzer pasywny 23 mm (bez własnego generatora) – ton robi sprzętowe PWM.

  GPIO13 (pin 33) – 1 kΩ – baza tranzystora NPN, buzzer między +12 V (albo +5 V) a kolektorem
  PWM0 kanał 1 – wymaga w /boot/firmware/config.txt: dtoverlay=pwm-2chan,pin=12,func=4,pin2=13,func2=4

app.py woła alarm() po wykryciu napełnienia dokarmiaczki.
"""
import threading
import time

import hardware

PWM_CHANNEL = 1
TONE_HZ = 2700          # buzzery piezo 23 mm grają najgłośniej w okolicy 2–4 kHz (rezonans – dobierz na słuch)
BEEP_SECONDS = 0.15
PAUSE_SECONDS = 0.1

_lock = threading.Lock()


def beep(hz=TONE_HZ, seconds=BEEP_SECONDS):
    """Jeden dźwięk. Wypełnienie 50 % = najgłośniej."""
    if hardware.DEMO:
        return
    period = 1e9 / hz
    with _lock:
        hardware.pwm_set(PWM_CHANNEL, period, period / 2)
        try:
            time.sleep(seconds)
        finally:
            hardware.pwm_off(PWM_CHANNEL)


def alarm(count=3):
    """Krótka seria dźwięków."""
    for i in range(count):
        if i:
            time.sleep(PAUSE_SECONDS)
        beep()
