"""
BEENest — serwer Flask dla Raspberry Pi.

Pliki projektu:
    app.py                    <- ten plik
    main.html                 <- strona (w katalogu głównym, nie w templates/)
    static/app.js, style.css
    *_detector_driver.py      <- po jednym na czujnik, każdy ma read() -> słownik liczb
    data/beenest.db           <- powstaje sam (historia pomiarów)
    data/global.conf          <- powstaje sam: ustawienia (zapis danych, wygląd, osobno każde urządzenie)

Jak to działa:
  1. Wątek w tle co SAMPLE_EVERY sekund czyta czujniki (nawet gdy nikt nie ma otwartej strony),
     wykrywa napełnienie dokarmiaczki i zapisuje historię według ustawień z panelu.
  2. Przeglądarka co 5 s pyta /api/data i dostaje ostatni odczyt. Nie dotyka czujników,
     więc kilka telefonów naraz nie obciąża magistrali I2C.

Uruchomienie:   pip install -r requirements.txt     (raz)
                python3 app.py
                  - port: domyślnie 80 (wtedy działa samo http://beenest.local), a gdy się nie da – 8000;
                    własny port: BEENEST_PORT=8080 python3 app.py
                  - BEENEST_DEBUG=1 python3 app.py  -> tryb deweloperski (auto-reload, port 8000)
Po starcie serwer wypisuje adresy do wpisania na telefonie (http://..., bez "s").
"""
import atexit
import configparser
import contextlib
import json
import logging
import math
import os
import re
import shutil
import socket
import sqlite3
import subprocess
import sys
import threading
import time

import flask.cli
from flask import Flask, Response, jsonify, render_template, request
from werkzeug.serving import WSGIRequestHandler
from werkzeug.wsgi import ClosingIterator

import atmosphere_detector_driver as atmosphere
import camera_detector_driver as camera
import feeder_detector_driver as feeder
import outlet_detector_driver as outlet
import wellbeing_detector_driver as wellbeing
import buzzer_driver as buzzer

# -------------------------------------------------------------
#  Konfiguracja
# -------------------------------------------------------------
ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT, "data", "beenest.db")
DEBUG = os.environ.get("BEENEST_DEBUG") == "1"
PORTS = (int(os.environ["BEENEST_PORT"]),) if os.environ.get("BEENEST_PORT") else ((8000,) if DEBUG else (80, 8000))
PORT = PORTS[0]             # po starcie: port, na którym serwer naprawdę działa
MDNS_NAME = "beenest"       # adres w sieci lokalnej: http://beenest.local

SAMPLE_EVERY = 5            # s    – jak często czytamy czujniki
CAMERA_OFFLINE_AFTER = 10   # s    – brak klatki dłużej niż tyle = kamera offline
REFILL_JUMP = 10            # pkt% – o tyle musi wzrosnąć poziom, by uznać napełnienie
REFILL_COOLDOWN = 60        # s    – kolejne napełnienie liczymy najwcześniej po tylu sekundach

# Progi oceny "Stan rodziny" są w wellbeing_detector_driver.py (tam je zmieniaj)
from wellbeing_detector_driver import WELLBEING_OK_HZ, WELLBEING_SENSITIVE_HZ, WELLBEING_UPLIFTET_HZ, WELLBEING_MAX_DB

# Wylotek: pozycja serwa w %. Poniżej/powyżej progów = zablokowany/otwarty, pomiędzy = w ruchu.
OUTLET_BLOCKED_BELOW = 5
OUTLET_OPEN_ABOVE = 95

SENSORS = (atmosphere, wellbeing, feeder, outlet)

# Co trafia do historii. Dane dokarmiaczki tylko, gdy włączone "Zapisuj tempo rozładowania".
HISTORY_KEYS = ("temp_current", "temp_outside",
                "temp_humidity", "temp_outside_humidity",
                "temp_pressure", "temp_outside_pressure",
                "w_frequency", "w_sound")

# Odczyt -> przedrostek pól z minimum i maksimum z 24 h (np. "temp_humidity" -> temp_humidity_min / temp_humidity_max)
DAY_RANGES = {
    "temp_current": "temp", "temp_outside": "temp_outside",
    "temp_humidity": "temp_humidity", "temp_outside_humidity": "temp_outside_humidity",
    "temp_pressure": "temp_pressure", "temp_outside_pressure": "temp_outside_pressure",
}
FEEDER_HISTORY_KEYS = ("f_level", "f_weight")

# Wykresy: zakres -> (ile sekund wstecz od teraz, szerokość przedziału, z którego liczymy średnią)
_H, _D = 3600, 86400
CHART_RANGES = {
    "12h": (12 * _H, 15 * 60),
    "1d":  (1 * _D, 30 * 60),
    "3d":  (3 * _D, 1 * _H),
    "7d":  (7 * _D, 1 * _D),
    "14d": (14 * _D, 1 * _D),
    "30d": (30 * _D, 3 * _D),
    "3m":  (90 * _D, 7 * _D),
    "6m":  (180 * _D, 14 * _D),
}

# Wszystkie ustawienia są w data/global.conf (patrz sekcja "Ustawienia" niżej).
# klucz: (wartość domyślna, dozwolone wartości; None = tak/nie)
CONF_PATH = os.path.join(ROOT, "data", "global.conf")

# [zapis] – dotyczą Raspberry, wspólne dla wszystkich urządzeń
SERVER_SETTINGS = {
    "saveInterval":  ("60", {"1", "5", "10", "30", "60", "180"}),   # częstotliwość zapisu - minuty
    "dataRetention": ("12", {"1", "3", "6", "12", "24"}),           # przetrzymywanie danych - miesiące
    "feederRate":    (True, None),
}

# [urzadzenie <adres IP>] – osobno dla każdego telefonu / komputera / wyświetlacza
_HL, _RG = {"w-ulu", "na-zewnatrz"}, {"obecna", "min-24h", "max-24h"}
DEVICE_SETTINGS = {
    "theme":             ("bialy-pylek", {"bialy-pylek", "lekki-miodek", "nocna-czern", "miodna-szarosc"}),
    "highContrast":      (False, None),
    "atmoData":          ("temperatura", {"temperatura", "wilgoc", "cisnienie"}),
    "tempHighlight":     ("w-ulu", _HL),
    "tempRange":         ("obecna", _RG),
    "humidityHighlight": ("w-ulu", _HL),
    "humidityRange":     ("obecna", _RG),
    "pressureHighlight": ("w-ulu", _HL),
    "pressureRange":     ("obecna", _RG),
    "wellbeingData":     ("stan", {"stan", "natezenie", "czestotliwosci"}),
    "feederData":        ("poziom", {"poziom", "ostatnie"}),
    "feederAlarm":       (True, None),
    "camera":            ("external", {"external", "internal"}),
}

# [wyglad] – stałe dla całej strony (zmienne CSS). Nazwa = zmienna CSS bez "--".
LOOK_SETTINGS = {
    "anim-duration":       (".4s", "czas animacji: przełącznik kamer/kategorii, listy, okna (większy = wolniej)"),
    "anim-ease":           ("cubic-bezier(.32, .72, 0, 1)", "krzywa animacji; inne: ease-in-out | cubic-bezier(.34, 1.56, .64, 1) = sprężyna"),
    "chart-grow-duration": ("1.2s", "wykres: wejście linii z osi X przy otwarciu zakładki"),
    "chart-zoom-duration": (".65s", "wykres: zmiana zakresu, przybliżenie, zmiana parametru"),
    "chart-ease":          ("cubic-bezier(.45, 0, .2, 1)", "krzywa wykresów; var(--anim-ease) = taka sama jak reszta strony"),
    "chart-grid-size":     ("24px", "oczko kratki w tle wykresu"),
    "hover-lift":          ("-4px", "karty Menu Głównego: o ile unoszą się po najechaniu (0 = wcale)"),
    "hover-glow":          ("0 14px 36px color-mix(in srgb, var(--orange) 32%, transparent)", "poświata pod kartą: 3. liczba = rozmycie, % = siła"),
    "hover-ring":          ("color-mix(in srgb, var(--orange) 45%, transparent)", "pierścień wokół karty (siła w %)"),
    "hover-tint":          ("color-mix(in srgb, var(--orange) 8%, transparent)", "podbarwienie wnętrza karty"),
}
_LOOK_BODY = {"hover-lift", "hover-glow", "hover-ring", "hover-tint"}   # zależą od koloru motywu -> na <body>
_SAFE_CSS = re.compile(r"^[\w\s.,%()#+-]+$")                            # bez ; { } < > – nic nie wyjdzie poza wartość

# -------------------------------------------------------------
#  Ciche logi (strona odpytuje serwer co 5 s – bez wpisu o każdym żądaniu)
# -------------------------------------------------------------
logging.getLogger("werkzeug").setLevel(logging.ERROR)
flask.cli.show_server_banner = lambda *args, **kwargs: None

app = Flask(__name__, template_folder=ROOT)   # main.html leży w katalogu głównym


def log(msg):
    print(f"[BEENest] {msg}", flush=True)


_failing = set()


def track(name, error=None):
    """Wypisuje komunikat tylko przy zmianie stanu (działa <-> błąd), nie co 5 s."""
    if error is not None and name not in _failing:
        _failing.add(name)
        log(f"{name}: błąd: {error!r}")
    elif error is None and name in _failing:
        _failing.discard(name)
        log(f"{name}: znowu działa")


def to_number(v):
    """Liczba albo None (teksty i NaN/inf zepsułyby JSON, który czyta przeglądarka)."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


# -------------------------------------------------------------
#  Baza (SQLite): ustawienia serwera + historia
# -------------------------------------------------------------

@contextlib.contextmanager
def db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=10)
    try:
        con.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)")
        con.execute("CREATE TABLE IF NOT EXISTS readings (ts INTEGER, key TEXT, value REAL)")
        con.execute("CREATE INDEX IF NOT EXISTS idx_readings ON readings (key, ts)")
        yield con
        con.commit()
    finally:
        con.close()


def kv_get(key, default=None):
    with db() as con:
        row = con.execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone()
    return json.loads(row[0]) if row else default


def kv_set(key, value):
    with db() as con:
        con.execute("INSERT OR REPLACE INTO kv VALUES (?, ?)", (key, json.dumps(value)))


# -------------------------------------------------------------
#  Ustawienia: data/global.conf
#  Zwykły plik tekstowy (INI). Tworzy się sam; można go edytować ręcznie także przy działającej
#  aplikacji – zmiana daty pliku = wczytanie od nowa. Zła wartość = wartość domyślna + komunikat.
# -------------------------------------------------------------
_conf_lock = threading.RLock()
_conf = {"mtime": None, "zapis": {}, "wyglad": {}, "devices": {}}
DEVICE_PREFIX = "urzadzenie "
_BOOL = {"true": True, "tak": True, "1": True, "yes": True, "on": True,
         "false": False, "nie": False, "0": False, "no": False, "off": False}


def _check(spec, key, value, source):
    """Wartość z panelu (JSON) lub z pliku (tekst) -> poprawna wartość. Błąd -> ValueError."""
    _, allowed = spec[key]
    if allowed is None:
        if isinstance(value, str) and source == "plik":
            value = _BOOL.get(value.strip().lower(), value)
        if not isinstance(value, bool):
            raise ValueError(f"{key}: oczekiwano true/false")
        return value
    value = str(value).strip()
    if value not in allowed:
        raise ValueError(f"{key}: niedozwolona wartość {value}")
    return value


def _clean_section(spec, raw, where):
    out = {}
    for key, value in raw.items():
        if key not in spec:
            if key != "opis":
                log(f"global.conf [{where}]: nieznane ustawienie '{key}' – pomijam")
            continue
        try:
            out[key] = _check(spec, key, value, "plik")
        except ValueError as e:
            log(f"global.conf [{where}]: {e} – używam domyślnej")
    return out


def _migrate_old_settings():
    """Starsze wersje trzymały [zapis] w bazie (kv "settings") – przenosimy raz do global.conf."""
    if not os.path.exists(DB_PATH):
        return {}
    with db() as con:
        row = con.execute("SELECT value FROM kv WHERE key = 'settings'").fetchone()
        con.execute("DELETE FROM kv WHERE key = 'settings'")
    old = json.loads(row[0]) if row else {}
    return {k: v for k, v in old.items() if k in SERVER_SETTINGS}


def _load_conf():
    """Wczytuje plik, jeśli zmienił się od ostatniego razu. Brak pliku = tworzy go z domyślnymi."""
    with _conf_lock:
        try:
            mtime = os.stat(CONF_PATH).st_mtime_ns
        except FileNotFoundError:
            _conf.update(mtime=None, zapis=_migrate_old_settings(), wyglad={}, devices={})
            _save_conf()
            return _conf
        if mtime == _conf["mtime"]:
            return _conf
        cp = configparser.ConfigParser(interpolation=None)   # bez %-podstawień (w CSS bywa "32%")
        cp.optionxform = str                                  # wielkość liter w nazwach ma znaczenie
        try:
            cp.read(CONF_PATH, encoding="utf-8")
        except configparser.Error as e:
            log(f"global.conf jest uszkodzony ({e}) – używam domyślnych, plik zostawiam bez zmian")
            _conf.update(mtime=mtime, zapis={}, wyglad={}, devices={})
            return _conf
        wyglad = {}
        for key, value in (cp["wyglad"].items() if cp.has_section("wyglad") else ()):
            if key in LOOK_SETTINGS and _SAFE_CSS.match(value.strip()):
                wyglad[key] = value.strip()
            else:
                log(f"global.conf [wyglad]: pomijam '{key}'")
        devices = {}
        for name in cp.sections():
            if name.startswith(DEVICE_PREFIX):
                ip = name[len(DEVICE_PREFIX):].strip()
                devices[ip] = _clean_section(DEVICE_SETTINGS, dict(cp[name]), name)
                if cp[name].get("opis"):
                    devices[ip]["opis"] = cp[name]["opis"]
        zapis = _clean_section(SERVER_SETTINGS, dict(cp["zapis"]), "zapis") if cp.has_section("zapis") else {}
        _conf.update(mtime=mtime, zapis=zapis, wyglad=wyglad, devices=devices)
        return _conf


def _fmt(value):
    return ("true" if value else "false") if isinstance(value, bool) else str(value)


def _save_conf():
    """Zapisuje cały plik od nowa (z opisami). Najpierw do pliku tymczasowego – prąd zgaśnie, plik zostaje cały."""
    with _conf_lock:
        z, w = _conf["zapis"], _conf["wyglad"]
        lines = [
            "# BEENest – ustawienia. Plik tworzy się sam; możesz go edytować ręcznie (zmiany wczytują się same).",
            "# Zła wartość = używana jest domyślna (komunikat w konsoli). Usunięcie linijki = wartość domyślna.",
            "",
            "[zapis]",
            "# Wspólne dla wszystkich urządzeń (Ustawienia -> Działanie).",
            "# saveInterval: co ile minut zapisywać pomiary do historii: 1, 5, 10, 30, 60, 180",
            "# dataRetention: po ilu miesiącach usuwać najstarsze pomiary: 1, 3, 6, 12, 24",
            "# feederRate: zapisuj też tempo rozładowania dokarmiaczki: true / false",
        ]
        lines += [f"{k} = {_fmt(z.get(k, d))}" for k, (d, _) in SERVER_SETTINGS.items()]
        lines += ["", "[wyglad]",
                  "# Stałe dla całej strony (wartości zmiennych CSS). Po zmianie odśwież stronę."]
        for k, (d, desc) in LOOK_SETTINGS.items():
            lines += [f"# {desc}", f"{k} = {w.get(k, d)}"]
        lines += ["", "# ---- Urządzenia: osobne ustawienia (motyw, kamera, co pokazują karty...) dla każdego adresu IP.",
                  "# Zapisane są tylko wartości inne niż domyślne. Usuń całą sekcję, by urządzenie wróciło do domyślnych.",
                  "# Dozwolone wartości:"] + [
                  f"#   {k}: " + ("true / false" if a is None else " / ".join(sorted(a))) + f"   (domyślnie {_fmt(d)})"
                  for k, (d, a) in DEVICE_SETTINGS.items()]
        for ip, dev in _conf["devices"].items():
            lines += ["", f"[{DEVICE_PREFIX}{ip}]"]
            if dev.get("opis"):
                lines.append(f"opis = {dev['opis']}")
            lines += [f"{k} = {_fmt(v)}" for k, v in dev.items() if k != "opis"]
        os.makedirs(os.path.dirname(CONF_PATH), exist_ok=True)
        tmp = CONF_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        os.replace(tmp, CONF_PATH)
        _conf["mtime"] = os.stat(CONF_PATH).st_mtime_ns


def get_server_settings():
    z = _load_conf()["zapis"]
    return {k: z.get(k, default) for k, (default, _) in SERVER_SETTINGS.items()}


def get_device_settings(ip):
    dev = _load_conf()["devices"].get(ip, {})
    return {k: dev.get(k, default) for k, (default, _) in DEVICE_SETTINGS.items()}


def known_device(ip):
    return ip in _load_conf()["devices"]


def set_settings(changes, ip, about=""):
    """
    Zmiany z panelu. Klucze [zapis] trafiają do wspólnej sekcji, reszta do sekcji tego urządzenia.
    Sprawdza wszystko, zanim cokolwiek zapisze. Błąd -> ValueError.
    """
    if not isinstance(changes, dict):
        raise ValueError("Oczekiwano obiektu JSON")
    server, device = {}, {}
    for key, value in changes.items():
        if key in SERVER_SETTINGS:
            server[key] = _check(SERVER_SETTINGS, key, value, "panel")
        elif key in DEVICE_SETTINGS:
            device[key] = _check(DEVICE_SETTINGS, key, value, "panel")
        else:
            raise ValueError(f"Nieznane ustawienie: {key}")
    with _conf_lock:
        conf = _load_conf()
        conf["zapis"].update(server)
        if ip is not None and (device or ip not in conf["devices"]):
            dev = conf["devices"].setdefault(ip, {"opis": about} if about else {})
            for key, value in device.items():
                if value == DEVICE_SETTINGS[key][0]:
                    dev.pop(key, None)          # domyślna = nie zapisujemy (zmiana domyślnych dotrze do urządzenia)
                else:
                    dev[key] = value
        _save_conf()


def set_server_settings(changes):
    """Tylko [zapis] (zostawione dla zgodności i testów)."""
    if isinstance(changes, dict) and any(k not in SERVER_SETTINGS for k in changes):
        raise ValueError("Nieznane ustawienie: " + next(k for k in changes if k not in SERVER_SETTINGS))
    set_settings(changes, None)


def look_css():
    """[wyglad] -> CSS wstawiany do strony zaraz po style.css (nadpisuje wartości z pliku CSS)."""
    w = _load_conf()["wyglad"]
    root = "".join(f"--{k}:{w.get(k, d)};" for k, (d, _) in LOOK_SETTINGS.items() if k not in _LOOK_BODY)
    body = "".join(f"--{k}:{w.get(k, d)};" for k, (d, _) in LOOK_SETTINGS.items() if k in _LOOK_BODY)
    # "Ogranicz ruch" w systemie nadal wyłącza animacje
    return (f":root{{{root}}}body{{{body}}}"
            "@media (prefers-reduced-motion: reduce){:root{--anim-duration:.01s;--chart-grow-duration:.01s;--chart-zoom-duration:.01s}}")


def device_label(req):
    m = re.search(r"\(([^)]*)\)", req.headers.get("User-Agent", ""))
    return re.sub(r"[\r\n\[\]]", " ", m.group(1))[:60] if m else ""


# -------------------------------------------------------------
#  Czujniki
# -------------------------------------------------------------
def read_sensors() -> dict:
    """
    Zbiera suche liczby ze wszystkich sterowników (*_detector_driver.py).
    Zepsuty czujnik daje None w swoich polach – reszta działa dalej.
    """
    raw = {}
    for drv in SENSORS:
        try:
            data = drv.read()
            values = {k: to_number(data.get(k)) for k in drv.KEYS}
            track(drv.__name__)
        except Exception as e:
            values = {k: None for k in drv.KEYS}
            track(drv.__name__, e)
        raw.update(values)
    return raw


def camera_info(name):
    """Dane kamery. Zależą od wybranej kamery, więc czytane przy każdym żądaniu."""
    try:
        data = camera.read(name)
        signal, age = to_number(data.get("m_signal")), to_number(data.get("m_updated"))
        track("camera")
    except Exception as e:
        signal = age = None
        track("camera", e)
    online = age is not None and age <= CAMERA_OFFLINE_AFTER
    return {"m_status": "Online" if online else "Offline", "m_signal": signal, "m_updated": age}


def disk_info():
    usage = shutil.disk_usage(ROOT)
    return {"sys_free_gb": usage.free / 1e9, "sys_total_gb": usage.total / 1e9}


# -------------------------------------------------------------
#  Wartości wyliczane (min/max z 24 h, stan rodziny, napełnienie)
# -------------------------------------------------------------
def day_range(key, current, now):
    """Min i max z ostatnich 24 h (zapisane próbki + bieżący odczyt)."""
    with db() as con:
        lo, hi = con.execute(
            "SELECT MIN(value), MAX(value) FROM readings WHERE key = ? AND ts >= ?",
            (key, int(now) - 86400)).fetchone()
    values = [v for v in (lo, hi, current) if v is not None]
    return (min(values), max(values)) if values else (None, None)


def wellbeing_status(frequency, sound):
    """
    Stan rodziny z częstotliwości (progi: wellbeing_detector_driver.py) i głośności.
    Do WELLBEING_OK_HZ[1] = Dobre, potem Niespokojne, od WELLBEING_UPLIFTET_HZ[0] w górę = Wściekłe.
    Głośność powyżej WELLBEING_MAX_DB podnosi "Dobre" do "Niespokojne".
    """
    if frequency is None or sound is None:
        return "Brak danych"
    if frequency > WELLBEING_UPLIFTET_HZ[0]:
        return "Wściekłe"
    if frequency > WELLBEING_OK_HZ[1] or sound > WELLBEING_MAX_DB:
        return "Niespokojne"
    return "Dobre"


def outlet_status(position):
    if position is None:
        return "Brak danych"
    if position <= OUTLET_BLOCKED_BELOW:
        return "Zablokowany"
    if position >= OUTLET_OPEN_ABOVE:
        return "Otwarty"
    return "W ruchu"


_state = {"feeder_low": None, "last_refill": 0.0, "last_save": None}


def detect_refill(level, now):
    """
    Napełnienie = poziom wzrósł o REFILL_JUMP punktów względem najniższego ostatnio widzianego.
    Dzięki temu działa też przy powolnym nalewaniu (kilka małych skoków pod rząd).
    """
    if level is None:
        return
    low = _state["feeder_low"]
    if low is None or level < low:
        _state["feeder_low"] = level
    elif level - low >= REFILL_JUMP:
        _state["feeder_low"] = level
        if now - _state["last_refill"] >= REFILL_COOLDOWN:
            _state["last_refill"] = now
            kv_set("f_last", int(now))
            threading.Thread(target=ring_buzzer, daemon=True).start()
            
def ring_buzzer():
    try:
        buzzer.alarm()
    except Exception as e:
        log(f"buzzer: {e}")

def save_history(raw, settings, now):
    """Zapis do historii co 'Interwał zapisu danych' + usuwanie starszych niż 'Długość przetrzymywania'."""
    if _state["last_save"] is None:      # po restarcie nie dubluj zapisu
        with db() as con:
            _state["last_save"] = con.execute("SELECT MAX(ts) FROM readings").fetchone()[0] or 0
    if now - _state["last_save"] < int(settings["saveInterval"]) * 60:
        return
    keys = HISTORY_KEYS + (FEEDER_HISTORY_KEYS if settings["feederRate"] else ())
    rows = [(int(now), k, raw[k]) for k in keys if raw.get(k) is not None]
    cutoff = int(now) - int(settings["dataRetention"]) * 30 * 86400
    with db() as con:
        con.executemany("INSERT INTO readings VALUES (?, ?, ?)", rows)
        con.execute("DELETE FROM readings WHERE ts < ?", (cutoff,))
    _state["last_save"] = int(now)


def history_series(key, rng, now):
    """
    Średnie z zapisanej historii dla wykresu: [[czas, wartość], ...] od najstarszego.
    Przedziały są wyrównane do lokalnej północy; czas punktu = średni czas próbek w przedziale.
    """
    span, step = CHART_RANGES[rng]
    off = time.localtime(now).tm_gmtoff
    with db() as con:
        rows = con.execute(
            "SELECT AVG(ts), AVG(value) FROM readings WHERE key = ? AND ts > ? AND ts <= ? "
            "GROUP BY CAST((ts + ?) / ? AS INTEGER) ORDER BY 1",
            (key, int(now) - span, int(now), off, step)).fetchall()
    return [[round(t), round(v, 3)] for t, v in rows]


def wellbeing_bands():
    """Zakresy stanów samopoczucia (z wellbeing_detector_driver.py) – linie na wykresie częstotliwości."""
    return [
        {"from": WELLBEING_OK_HZ[0], "to": WELLBEING_OK_HZ[1], "label": "Dobre"},
        {"from": WELLBEING_SENSITIVE_HZ[0], "to": WELLBEING_SENSITIVE_HZ[1], "label": "Niespokojne"},
        {"from": WELLBEING_UPLIFTET_HZ[0], "to": WELLBEING_UPLIFTET_HZ[1], "label": "Wściekłe"},
    ]


def build_payload(raw, now):
    p = dict(raw)
    for key, prefix in DAY_RANGES.items():
        p[prefix + "_min"], p[prefix + "_max"] = day_range(key, raw[key], now)
    p["w_status"] = wellbeing_status(raw["w_frequency"], raw["w_sound"])
    p["o_status"] = outlet_status(raw["o_position"])
    p["w_updated"] = int(now)                 # sekundy od 1970 – przeglądarka sformatuje po swojemu
    p["f_last"] = kv_get("f_last")            # None, dopóki nie wykryto pierwszego napełnienia
    return p


# -------------------------------------------------------------
#  Wątek próbkujący
# -------------------------------------------------------------
_latest = {}
_sample_lock = threading.Lock()


def sample_once():
    global _latest
    with _sample_lock:
        now = time.time()
        raw = read_sensors()
        detect_refill(raw["f_level"], now)
        save_history(raw, get_server_settings(), now)
        _latest = build_payload(raw, now)


def get_latest():
    if not _latest:          # np. pierwsze żądanie, zanim wątek zdążył cokolwiek odczytać
        sample_once()
    return _latest


def sampler_loop():
    while True:
        try:
            sample_once()
            track("sampler")
        except Exception as e:
            track("sampler", e)
        time.sleep(SAMPLE_EVERY)


def start_sampler():
    threading.Thread(target=sampler_loop, name="sampler", daemon=True).start()


# -------------------------------------------------------------
#  Sieć: adresy, diagnostyka połączeń
# -------------------------------------------------------------
def lan_addresses():
    """Adresy IPv4 tego urządzenia w sieciach (Wi-Fi, hotspot, Ethernet) – bez loopbacka."""
    found = set()
    # a) adresy przypisane do nazwy komputera (Windows, część Linuksów)
    try:
        found.update(i[4][0] for i in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET))
    except OSError:
        pass
    # b) interfejs, którym wychodzi ruch (macOS, Linux z internetem). UDP connect niczego nie wysyła.
    for target in ("8.8.8.8", "10.255.255.255", "192.168.255.255"):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
                sock.connect((target, 1))
                found.add(sock.getsockname()[0])
        except OSError:
            pass
    # c) Linux / Raspberry Pi: wszystkie adresy, także hotspotu bez internetu (brak trasy domyślnej)
    if sys.platform.startswith("linux"):
        try:
            found.update(subprocess.run(["hostname", "-I"], capture_output=True, text=True,
                                        timeout=3).stdout.split())
        except (OSError, subprocess.SubprocessError):
            pass
    return sorted(ip for ip in found if "." in ip and not ip.startswith(("127.", "169.254.", "0.")))


def url(host):
    return f"http://{host}" + ("" if PORT == 80 else f":{PORT}")


def primary_address():
    """Adres interfejsu, którym urządzenie wychodzi do sieci (tego zwykle używa komputer z internetem)."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 1))
            return sock.getsockname()[0]
    except OSError:
        return None


def port_problem(port):
    """None, jeśli da się zająć port; w przeciwnym razie powód (np. 'brak uprawnień')."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        if sys.platform != "win32":        # na Windows SO_REUSEADDR pozwalałby zająć cudzy port
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("0.0.0.0", port))
        except OSError as e:
            return e.strerror or str(e)
    return None


def choose_port():
    """Pierwszy wolny port z PORTS. W trybie debug (reloader trzyma port) nie sprawdzamy."""
    if DEBUG or len(PORTS) == 1:
        return PORTS[0]
    for port in PORTS:
        problem = port_problem(port)
        if problem is None:
            return port
        log(f"port {port} niedostępny ({problem})")
    log("żaden port nie jest dostępny – ustaw własny: BEENEST_PORT=8080 python3 app.py")
    sys.exit(1)


_zeroconf = None


def announce_name(port, addresses):
    """
    Rozgłasza http://beenest.local w sieci lokalnej (mDNS), żeby nie trzeba było znać adresu IP.
    Zwraca True, jeśli adres powinien działać. Działa tylko z biblioteką `zeroconf`.
    """
    global _zeroconf
    if socket.gethostname().split(".")[0].lower() == MDNS_NAME:
        return True            # nazwa komputera to już 'beenest' – rozgłasza ją system (avahi / Bonjour)
    if not addresses:
        return False
    try:
        from zeroconf import ServiceInfo, Zeroconf
    except ImportError:
        log("  beenest.local: brak biblioteki 'zeroconf' – zainstaluj: pip install zeroconf")
        return False
    try:
        _zeroconf = Zeroconf()
        _zeroconf.register_service(ServiceInfo(
            "_http._tcp.local.", "BEENest._http._tcp.local.",
            addresses=[socket.inet_aton(ip) for ip in addresses], port=port,
            server=f"{MDNS_NAME}.local.", properties={"path": "/"}), allow_name_change=True)
    except Exception as e:     # np. brak multicastu w sieci, nazwa zajęta przez inne urządzenie
        log(f"  beenest.local: nie udało się rozgłosić nazwy: {e!r}")
        _zeroconf = None
        return False
    atexit.register(_zeroconf.close)   # przy zamknięciu wyślij "żegnaj", żeby nazwa nie wisiała w sieci
    return True


_https_warned = {}


class BeenestRequestHandler(WSGIRequestHandler):
    def parse_request(self):
        # Bajty 0x16 0x03 na początku = uzgadnianie TLS: przeglądarka łączy się przez https://,
        # a BEENest mówi zwykłym http://. Zamiast kryptycznego "Bad request version (...)"
        # piszemy, co zrobić (maks. raz na 30 s dla jednego urządzenia).
        if self.raw_requestline[:2] == b"\x16\x03":
            self.close_connection = True
            ip, now = self.client_address[0], time.time()
            if now - _https_warned.get(ip, 0) > 30:
                _https_warned[ip] = now
                log(f"{ip} łączy się przez HTTPS, a BEENest działa na zwykłym HTTP. "
                    f"Wpisz adres z http:// (nie https://), np. {url('127.0.0.1')} "
                    f"– liczbowy adres zamiast 'localhost' omija wymuszanie https przez przeglądarkę.")
            return False
        return super().parse_request()


_seen_clients = set()


@app.before_request
def note_new_client():
    """Jedna linia przy pierwszym połączeniu z danego urządzenia – widać, czy telefon dotarł do serwera."""
    ip = request.remote_addr
    if ip not in _seen_clients:
        _seen_clients.add(ip)
        m = re.search(r"\(([^)]*)\)", request.headers.get("User-Agent", ""))
        log(f"pierwsze połączenie z {ip}" + (f" ({m.group(1)[:60]})" if m else ""))


# -------------------------------------------------------------
#  Polecenia systemowe (zasilanie, aktualizacja)
# -------------------------------------------------------------
def run_system_command(args, timeout=60):
    """Jedyne miejsce uruchamiające polecenia systemowe (łatwo podmienić w testach)."""
    return subprocess.run(args, cwd=ROOT, capture_output=True, text=True,
                          check=True, timeout=timeout)


def power(action):
    if not sys.platform.startswith("linux"):
        raise OSError("Zasilanie można sterować tylko na Raspberry Pi (Linux)")
    cmd = ["shutdown", "-r" if action == "reboot" else "-h", "now"]
    if os.geteuid() != 0:
        cmd = ["sudo", "-n"] + cmd
    run_system_command(cmd, timeout=30)


def error_text(e):
    return (getattr(e, "stderr", "") or "").strip() or str(e)


def json_only():
    """Odrzuca żądania, które nie są JSON-em – blokuje wysłanie formularza z cudzej strony."""
    if not request.is_json:
        return jsonify(error="Wymagany nagłówek Content-Type: application/json"), 415


# -------------------------------------------------------------
#  Routing
# -------------------------------------------------------------
@app.route("/")
def index():
    """Serwuje główny plik HTML (SPA z routingiem po #hashtagu)."""
    ip = request.remote_addr
    return render_template("main.html", look_css=look_css(),
                           device={"settings": {**get_server_settings(), **get_device_settings(ip)},
                                   "known": known_device(ip)})


@app.route("/api/data")
def api_data():
    """JSON odpytywany co 5 s przez przeglądarkę. ?camera=external|internal"""
    cam = request.args.get("camera")
    if cam not in camera.CAMERAS:
        cam = camera.CAMERAS[0]
    return jsonify({**get_latest(), **camera_info(cam), **disk_info()})


@app.route("/api/history")
def api_history():
    """
    Dane do wykresów: /api/history?keys=temp_current,temp_outside&range=1d
    Zakresy: 12h, 1d, 3d, 7d, 14d, 30d, 3m, 6m (patrz CHART_RANGES).
    """
    rng = request.args.get("range", "1d")
    if rng not in CHART_RANGES:
        return jsonify(error="Nieznany zakres"), 400
    keys = [k for k in request.args.get("keys", "").split(",") if k]
    allowed = set(HISTORY_KEYS) | set(FEEDER_HISTORY_KEYS)
    if not keys or len(keys) > 4 or any(k not in allowed for k in keys):
        return jsonify(error="Nieznany parametr"), 400
    now = int(time.time())
    span, step = CHART_RANGES[rng]
    out = {
        "range": rng, "from": now - span, "to": now, "step": step,
        "save_interval": int(get_server_settings()["saveInterval"]) * 60,
        "series": {k: history_series(k, rng, now) for k in keys},
    }
    if "w_frequency" in keys:
        out["bands"] = wellbeing_bands()
    return jsonify(out)


@app.route("/api/camera/<name>/stream")
def camera_stream(name):
    """Podgląd na żywo (MJPEG) – <img src="/api/camera/external/stream">. Kamera działa, dopóki ktoś ogląda."""
    if name not in camera.CAMERAS:
        return jsonify(error="Nieznana kamera"), 404
    try:
        stream = camera.frames(name)
        track("camera-" + name)
    except Exception as e:
        track("camera-" + name, e)
        return jsonify(error=error_text(e)), 503

    def multipart():
        for jpeg in stream:
            yield (b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                   + str(len(jpeg)).encode() + b"\r\n\r\n" + jpeg + b"\r\n")

    # ClosingIterator woła stream.close() także wtedy, gdy przeglądarka zerwie połączenie
    # – dzięki temu kamera na pewno zostaje zwolniona.
    resp = Response(ClosingIterator(multipart(), stream.close),
                    mimetype="multipart/x-mixed-replace; boundary=frame")
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.route("/api/settings", methods=["GET", "POST"])
def api_settings():
    if request.method == "POST":
        if (bad := json_only()):
            return bad
        try:
            set_settings(request.get_json(silent=True), request.remote_addr, device_label(request))
        except ValueError as e:
            return jsonify(error=str(e)), 400
    return jsonify({**get_server_settings(), **get_device_settings(request.remote_addr)})


@app.post("/api/system/reboot")
def api_reboot():
    if (bad := json_only()):
        return bad
    try:
        power("reboot")
    except Exception as e:
        return jsonify(error=error_text(e)), 500
    return jsonify(ok=True)


@app.post("/api/system/shutdown")
def api_shutdown():
    if (bad := json_only()):
        return bad
    try:
        power("shutdown")
    except Exception as e:
        return jsonify(error=error_text(e)), 500
    return jsonify(ok=True)


@app.post("/api/history/clear")
def api_history_clear():
    """Ustawienia → Działanie → "Wymaż zapisane dane": usuwa historię atmosfery i samopoczucia (HISTORY_KEYS)."""
    if (bad := json_only()):
        return bad
    try:
        marks = ",".join("?" * len(HISTORY_KEYS))
        with db() as con:
            deleted = con.execute(f"DELETE FROM readings WHERE key IN ({marks})", HISTORY_KEYS).rowcount
        con = sqlite3.connect(DB_PATH, timeout=10, isolation_level=None)
        try:
            con.execute("VACUUM")          # wymazane rekordy znikają też z samego pliku bazy
        finally:
            con.close()
    except Exception as e:
        return jsonify(error=error_text(e)), 500
    return jsonify(ok=True, deleted=deleted)


@app.post("/api/system/update")
def api_update():
    """
    git pull. Ul NIE restartuje się sam: restart tylko gdy żądanie ma {"reboot": true}
    (okienko "Uruchom ponownie po sprawdzeniu") i faktycznie przyszły zmiany.
    Odpowiedź: {updated: bool, rebooting: bool}
    """
    if (bad := json_only()):
        return bad
    reboot = (request.get_json(silent=True) or {}).get("reboot") is True
    try:
        before = run_system_command(["git", "rev-parse", "HEAD"]).stdout.strip()
        run_system_command(["git", "pull", "--ff-only"], timeout=120)
        after = run_system_command(["git", "rev-parse", "HEAD"]).stdout.strip()
    except Exception as e:
        return jsonify(error=error_text(e)), 500
    if before == after:
        return jsonify(updated=False, rebooting=False)
    if not reboot:
        return jsonify(updated=True, rebooting=False)
    try:
        power("reboot")
    except Exception as e:
        return jsonify(updated=True, error="Pobrano aktualizację, ale restart się nie udał: "
                       + error_text(e)), 500
    return jsonify(updated=True, rebooting=True)



# -------------------------------------------------------------
#  Uruchomienie
# -------------------------------------------------------------
if __name__ == "__main__":
    PORT = choose_port()
    # W trybie debug Flask odpala drugi proces (reloader) – wątek i rozgłaszanie nazwy startujemy
    # tylko w tym, który faktycznie obsługuje żądania.
    if not DEBUG or os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        start_sampler()
        addresses = lan_addresses()
        # Nazwa wskazuje na adres, którym komputer wychodzi do sieci; bez trasy domyślnej (hotspot
        # offline) – na wszystkie adresy. Na Raspberry z hotspotem lepiej: hostnamectl set-hostname beenest.
        main_ip = primary_address()
        by_name = announce_name(PORT, [main_ip] if main_ip in addresses else addresses)
        log(f"uruchamiam serwer na porcie {PORT}")
        log(f"  na tym urządzeniu:  {url('127.0.0.1')}")
        if by_name:
            log(f"  po nazwie:          {url(MDNS_NAME + '.local')}")
        for ip in addresses:
            log(f"  w sieci (telefon):  {url(ip)}")
        if not addresses:
            log("  w sieci: nie znalazłem adresu IP – połącz urządzenie z Wi-Fi albo hotspotem")
    # host="0.0.0.0" -> nasłuchuj na wszystkich interfejsach (także na hotspocie Raspberry Pi).
    app.run(host="0.0.0.0", port=PORT, debug=DEBUG, request_handler=BeenestRequestHandler)
