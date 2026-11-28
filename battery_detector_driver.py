"""
Akumulator i panel słoneczny: sterownik ładowania Victron SmartSolar przez kabel VE.Direct–USB.

Kabel (FTDI) pojawia się jako /dev/serial/by-id/usb-VictronEnergy_BV_VE_Direct_cable_*-port0 (= /dev/ttyUSB0).
Sterownik w trybie tekstowym sam wysyła co sekundę blok „KLUCZ<tab>wartość” zakończony linijką Checksum
(suma wszystkich bajtów bloku = 0 modulo 256). Port: 19200 bodów, 8N1. Tylko biblioteka standardowa (termios).
Użytkownik beenest ma dostęp do portu przez grupę plugdev. Bez podłączonego akumulatora sterownik milczy.

Wątek w tle czyta port bez przerwy, a read() oddaje ostatni poprawny blok (czytanie w read() blokowałoby
wątek próbkujący app.py na sekundę i dłużej).

Procent naładowania liczymy z napięcia, ale tylko w spoczynku: sterownik nie ładuje albo prąd ładowania
(pole I) jest prawie zerowy – przy ładowaniu napięcie jest zawyżone. Wtedy zostaje ostatni procent
ze spoczynku (podtrzymanie = akumulator pełny). Uwaga: sterownik potrafi zgłaszać „ładowanie główne”
(CS = 3) przy 0 A, np. wieczorem – dlatego sam stan CS nie wystarcza.
Akumulator żelowy 12 V w spoczynku: około 12,85 V = 100 %, 11,8 V = 0 % (liniowo pomiędzy).
"""
import glob
import os
import termios
import threading
import time

import hardware

KEYS = ("b_percent", "b_voltage", "b_current", "b_panel", "b_panel_percent", "b_state", "b_error", "b_updated")

PORT_GLOB = "/dev/serial/by-id/usb-VictronEnergy*"
VOLT_EMPTY = 11.8          # V – 0 % (żel, spoczynek)
VOLT_FULL = 12.85          # V – 100 %
PANEL_MAX_W = 30           # W – moc panelu odpowiadająca 100 % na stronie
STALE_AFTER = 10           # s – starszy blok = brak odczytu (sterownik odłączony)

# Stany ładowania (pole CS), przy których sterownik nie ładuje – napięcie mówi wtedy o naładowaniu
NOT_CHARGING = (0, 2)      # wyłączone, usterka
FLOAT = 5                  # podtrzymanie – akumulator naładowany
REST_CURRENT = 0.1         # A – mniejszy prąd ładowania = spoczynek

_block = {}                # ostatni poprawny blok: {klucz: tekst}
_block_time = 0.0
_rest_percent = None
_lock = threading.Lock()
_thread = None


def _open(port):
    fd = os.open(port, os.O_RDONLY | os.O_NOCTTY)
    a = termios.tcgetattr(fd)
    a[0] = a[1] = a[3] = 0
    a[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
    a[4] = a[5] = termios.B19200
    a[6][termios.VMIN] = 0
    a[6][termios.VTIME] = 10           # read() wraca najpóźniej po sekundzie
    termios.tcsetattr(fd, termios.TCSANOW, a)
    return fd


def _parse(block):
    fields = {}
    for line in block.split(b"\r\n"):
        key, tab, value = line.partition(b"\t")
        if tab and key != b"Checksum":
            fields[key.decode("latin-1")] = value.decode("latin-1")
    return fields


def _reader():
    global _block, _block_time
    while True:
        ports = glob.glob(PORT_GLOB)
        if not ports:
            time.sleep(5)
            continue
        try:
            fd = _open(ports[0])
        except OSError:
            time.sleep(5)
            continue
        buf = b""
        try:
            while True:
                buf += os.read(fd, 1024)
                while True:
                    i = buf.find(b"Checksum\t")
                    if i < 0 or len(buf) < i + 10:
                        break
                    block, buf = buf[:i + 10], buf[i + 10:]
                    if sum(block) % 256 == 0:          # pierwszy, urwany blok tu odpada
                        fields = _parse(block)
                        with _lock:
                            _block, _block_time = fields, time.time()
                buf = buf[-2048:]
        except OSError:                                # kabel wyjęty
            pass
        finally:
            os.close(fd)
        time.sleep(2)


def _percent(volts):
    return max(0.0, min(100.0, (volts - VOLT_EMPTY) / (VOLT_FULL - VOLT_EMPTY) * 100))


def read() -> dict:
    """
    b_percent        – naładowanie akumulatora              [%]  (z napięcia w spoczynku)
    b_voltage        – napięcie akumulatora                  [V]
    b_current        – pobór prądu z wyjścia LOAD            [A]
    b_panel          – moc z panelu słonecznego              [W]
    b_panel_percent  – moc panelu względem PANEL_MAX_W       [%]
    b_state          – stan ładowania (pole CS: 0 wyłączone, 3 ładowanie główne, 4 absorpcja, 5 podtrzymanie…)
    b_error          – kod błędu sterownika (0 = brak)
    b_updated        – czas ostatniego bloku                 [s od 1970]
    """
    global _thread, _rest_percent
    if hardware.DEMO:
        return {"b_percent": 72.0, "b_voltage": 12.56, "b_current": 0.42, "b_panel": 18.0,
                "b_panel_percent": 60.0, "b_state": 3, "b_error": 0, "b_updated": time.time()}
    if _thread is None:
        _thread = threading.Thread(target=_reader, name="ve-direct", daemon=True)
        _thread.start()
    with _lock:
        block, age = dict(_block), time.time() - _block_time
    if not block or age > STALE_AFTER:
        return {}
    volts = int(block["V"]) / 1000
    state = int(block.get("CS", "0"))
    panel = float(block.get("PPV", "0"))
    charging = abs(int(block.get("I", "0")) / 1000)
    if state == FLOAT:
        _rest_percent = 100.0
    elif state in NOT_CHARGING or charging < REST_CURRENT:
        _rest_percent = _percent(volts)
    return {
        "b_percent": _rest_percent,
        "b_voltage": volts,
        "b_current": int(block["IL"]) / 1000 if "IL" in block else None,
        "b_panel": panel,
        "b_panel_percent": min(100.0, panel / PANEL_MAX_W * 100),
        "b_state": state,
        "b_error": int(block.get("ERR", "0")),
        "b_updated": _block_time,
    }
