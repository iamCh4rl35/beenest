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
                python3 app.py                    -> port 80 (działa http://beenest.local), gdy zajęty / brak prawa – 8000
                python3 app.py --set-pin          -> ustawia PIN administratora (6 cyfr) i kończy;
                                                     działa także przy uruchomionym serwerze
Zmienne środowiskowe (można łączyć, np. BEENEST_PORT=8077 BEENEST_NO_SECURITY=1 python3 app.py):
    BEENEST_PORT=8080          własny port (bez zapasowego 8000)
    BEENEST_DEBUG=1            tryb deweloperski: auto-reload po zmianie .py, port 8000, błędy w przeglądarce
    BEENEST_NO_SECURITY=1      testy: każde urządzenie jest administratorem, bez parowania i PIN-u
    BEENEST_SENSOR_DEMO=1      czujniki z danymi przykładowymi (na komputerze bez Raspberry włącza się samo)
    BEENEST_CAMERA_DEMO=1      kamera bez sprzętu (szara klatka zamiast picamera2)
    BEENEST_USB=/katalog       testy Klucza: każdy podkatalog udaje wpięty pendrive (bez montowania udisks)
Po starcie serwer wypisuje adresy do wpisania na telefonie (http://..., bez "s").
"""
import atexit
import configparser
import contextlib
import datetime
import functools
import getpass
import glob
import hashlib
import hmac
import json
import logging
import math
import os
import re
import secrets
import shutil
import socket
import sqlite3
import subprocess
import sys
import threading
import time

import flask.cli
from flask import Flask, Response, g, jsonify, redirect, render_template, request, session
from werkzeug.security import check_password_hash, generate_password_hash
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
OUTLET_MAX_RULES = 6        # reguły otwarcia wylotka o godzinie (global.conf [outlet])

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
FEEDER_HISTORY_KEYS = ("f_level",)

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

# [storage] – dotyczą Raspberry, wspólne dla wszystkich urządzeń
SERVER_SETTINGS = {
    "saveInterval":  ("60", {"1", "5", "10", "30", "60", "180"}),   # częstotliwość zapisu - minuty
    "dataRetention": ("12", {"1", "3", "6", "12", "24"}),           # przetrzymywanie danych - miesiące
    "feederRate":    (True, None),
}

# [device <adres IP>] – osobno dla każdego telefonu / komputera / wyświetlacza
_HL, _RG = {"inside", "outside"}, {"current", "min-24h", "max-24h"}
DEVICE_SETTINGS = {
    "theme":             ("white-pollen", {"white-pollen", "light-honey", "night-black", "honey-grey"}),
    "highContrast":      (False, None),
    "atmoData":          ("temperature", {"temperature", "humidity", "pressure"}),
    "tempHighlight":     ("inside", _HL),
    "tempRange":         ("current", _RG),
    "humidityHighlight": ("inside", _HL),
    "humidityRange":     ("current", _RG),
    "pressureHighlight": ("inside", _HL),
    "pressureRange":     ("current", _RG),
    "wellbeingData":     ("status", {"status", "loudness", "frequency"}),
    "feederData":        ("level", {"level", "last-refill"}),
    "feederAlarm":       (True, None),
    "feederWords":       (True, None),      # poziom dokarmiaczki słownie (Pełny, Zapas płynu…) zamiast w %
    "camera":            ("external", {"external", "internal"}),
    # % na suwaku (1–100) – tylko wyświetlacz przy ulu; 1 % = 60 % prawdziwej jasności (niżej panel ma błędy obrazu)
    "brightness":        ("100", {str(v) for v in range(1, 101)}),
}
# Ustawienia urządzenia z zakładki Działanie – jak cała ta zakładka zmienia je tylko administrator
ADMIN_DEVICE_SETTINGS = {"feederAlarm"}

# [look] – stałe dla całej strony (zmienne CSS). Nazwa = zmienna CSS bez "--".
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

# Zabezpieczenia (opis całości: sekcja "Zabezpieczenia" niżej)
PIN_LENGTH = 6              # cyfr w PIN-ie administratora
ADMIN_IDLE = 5 * 60         # s – wyświetlacz odblokowany PIN-em wraca do poziomu użytkownika po tylu sekundach bez dotyku
LOCK_AFTER = 5              # błędnych PIN-ów pod rząd ...
LOCK_TIME = 5 * 60          # ... = blokada na tyle sekund (stała, nie rośnie)
PAIR_CODE_TIME = 2 * 60     # s – ważność kodu parowania (i czas na zatwierdzenie na wyświetlaczu)
PAIR_CODE_TRIES = 5         # błędnych prób, po których kod parowania przestaje działać
TEMP_DEVICE_TIME = 10 * 60  # s – niezapamiętane urządzenie wygasa po tylu sekundach bez zapytań (opuścił stronę / sieć)
REMEMBER_DAYS = 365         # ważność ciasteczka zapamiętanego urządzenia (odnawia się przy każdym wejściu)
KEY_FILE = "beenest.key"  # plik z sekretem na pendrivie (Klucz)
LEGACY_KEY_FILE = "beenest.klucz"   # nazwa sprzed 2026-11-21 – takie Klucze nadal działają
HOTSPOT_CONNECTION = "Pi-hotspot"   # połączenie NetworkManagera z hotspotem (nazwa sieci i hasło do kodu QR)
DISPLAY_ADDRESSES = ("127.0.0.1", "::1")   # wyświetlacz przy ulu = przeglądarka na samym Raspberry
HOTSPOT_PREFIX = "10.42.0."                # adresy telefonów w hotspocie NetworkManagera
DHCP_NAMES = "/run/beenest-dhcp"           # nazwy urządzeń z DHCP hotspotu (plik = adres IP; pi/install.sh)
NO_SECURITY = os.environ.get("BEENEST_NO_SECURITY") == "1"   # testy na PC: każdy jest administratorem

# -------------------------------------------------------------
#  Ciche logi (strona odpytuje serwer co 5 s – bez wpisu o każdym żądaniu)
# -------------------------------------------------------------
logging.getLogger("werkzeug").setLevel(logging.ERROR)
flask.cli.show_server_banner = lambda *args, **kwargs: None

app = Flask(__name__, template_folder=ROOT)   # main.html leży w katalogu głównym


def _secret_key():
    """Stały klucz podpisujący ciasteczka (data/secret.key). Nowy klucz = wszystkie telefony do ponownego parowania."""
    path = os.path.join(ROOT, "data", "secret.key")
    try:
        with open(path, encoding="ascii") as f:
            key = f.read().strip()
        if len(key) >= 32:
            return key
    except OSError:
        pass
    os.makedirs(os.path.dirname(path), exist_ok=True)
    key = secrets.token_hex(32)
    with open(path, "w", encoding="ascii") as f:
        f.write(key + "\n")
    with contextlib.suppress(OSError):
        os.chmod(path, 0o600)
    return key


app.secret_key = _secret_key()
app.config.update(
    SESSION_COOKIE_NAME="beenest",
    SESSION_COOKIE_HTTPONLY=True,           # skrypt na stronie nie odczyta ciasteczka
    # Lax, nie Strict: przy Strict przeglądarka nie wysyła ciasteczka, gdy wejście zaczyna się gdzie indziej
    # (przekierowanie 10.42.0.1 → beenest.local, kod QR, inna aplikacja) – Chrome na Androidzie pokazywał wtedy
    # parowanie zapamiętanemu telefonowi. Przed cudzymi stronami chroni to, że każda zmiana to POST z JSON-em.
    SESSION_COOKIE_SAMESITE="Lax",
    PERMANENT_SESSION_LIFETIME=datetime.timedelta(days=REMEMBER_DAYS),
)


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

_db_ready = False


@contextlib.contextmanager
def db():
    """Połączenie z bazą; schemat (tabele, indeks) zakładany raz na uruchomienie serwera."""
    global _db_ready
    if not _db_ready:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=10)
    try:
        if not _db_ready:
            con.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)")
            con.execute("CREATE TABLE IF NOT EXISTS readings (ts INTEGER, key TEXT, value REAL)")
            con.execute("CREATE INDEX IF NOT EXISTS idx_readings ON readings (key, ts)")
            _db_ready = True
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
_conf = {"mtime": None, "storage": {}, "look": {}, "devices": {}, "admin": {}, "paired": {}, "outlet": []}
DEVICE_PREFIX = "device "
PAIRED_PREFIX = "paired "
_BOOL = {"true": True, "tak": True, "1": True, "yes": True, "on": True,
         "false": False, "nie": False, "0": False, "no": False, "off": False}


def _check(spec, key, value, source):
    """Wartość z panelu (JSON) lub z pliku (tekst) -> poprawna wartość. Błąd -> ValueError."""
    _, allowed = spec[key]
    if allowed is None:
        if isinstance(value, str) and source == "file":
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
            if key != "description":
                log(f"global.conf [{where}]: nieznane ustawienie '{key}' – pomijam")
            continue
        try:
            out[key] = _check(spec, key, value, "file")
        except ValueError as e:
            log(f"global.conf [{where}]: {e} – używam domyślnej")
    return out


def _migrate_old_settings():
    """Starsze wersje trzymały [storage] w bazie (kv "settings") – przenosimy raz do global.conf."""
    if not os.path.exists(DB_PATH):
        return {}
    with db() as con:
        row = con.execute("SELECT value FROM kv WHERE key = 'settings'").fetchone()
        con.execute("DELETE FROM kv WHERE key = 'settings'")
    old = json.loads(row[0]) if row else {}
    return {k: v for k, v in old.items() if k in SERVER_SETTINGS}


_RULE_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)\s+(\d{1,3})$")


def parse_outlet_rule(text):
    """„GG:MM procent” -> {godzina, pozycja}; zły zapis = None."""
    m = _RULE_RE.match(str(text or "").strip())
    if not m or int(m[3]) > 100:
        return None
    return {"time": f"{m[1]}:{m[2]}", "position": int(m[3])}


# Dawne polskie nazwy w global.conf (do 2026-11-21) – plik z Raspberry wczytuje się i zapisuje od razu po angielsku
_OLD_SECTIONS = {"zapis": "storage", "wyglad": "look", "administrator": "admin", "wylotek": "outlet"}
_OLD_PREFIXES = {"urzadzenie ": DEVICE_PREFIX, "sparowane ": PAIRED_PREFIX}
_OLD_KEYS = {"klucz": "key", "nazwa": "name", "dodano": "added", "opis": "description"}
_OLD_VALUES = {
    "bialy-pylek": "white-pollen", "lekki-miodek": "light-honey", "nocna-czern": "night-black",
    "miodna-szarosc": "honey-grey", "temperatura": "temperature", "wilgoc": "humidity", "cisnienie": "pressure",
    "w-ulu": "inside", "na-zewnatrz": "outside", "obecna": "current", "stan": "status", "natezenie": "loudness",
    "czestotliwosci": "frequency", "poziom": "level", "ostatnie": "last-refill",
}


def _migrate_polish_conf(cp):
    """Polskie sekcje / klucze / wartości -> angielskie (w pamięci). True = coś zmieniono (plik trzeba zapisać)."""
    changed = False
    for old in cp.sections():
        new = _OLD_SECTIONS.get(old)
        for old_prefix, new_prefix in _OLD_PREFIXES.items():
            if old.startswith(old_prefix):
                new = new_prefix + old[len(old_prefix):]
        items = {}
        for key, value in cp[old].items():
            key = _OLD_KEYS.get(key, re.sub(r"^regula(\d+)$", r"rule\1", key))
            items[key] = _OLD_VALUES.get(value.strip(), value)
        if new or items != dict(cp[old]):
            target = new or old
            cp.remove_section(old)
            if not cp.has_section(target):
                cp.add_section(target)
            for key, value in items.items():
                cp[target][key] = value
            changed = True
    return changed


def _load_conf():
    """Wczytuje plik, jeśli zmienił się od ostatniego razu. Brak pliku = tworzy go z domyślnymi."""
    with _conf_lock:
        try:
            mtime = os.stat(CONF_PATH).st_mtime_ns
        except FileNotFoundError:
            _conf.update(mtime=None, storage=_migrate_old_settings(), look={}, devices={}, admin={}, paired={}, outlet=[])
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
            _conf.update(mtime=mtime, storage={}, look={}, devices={}, admin={}, paired={}, outlet=[])
            return _conf
        migrated = _migrate_polish_conf(cp)
        look = {}
        for key, value in (cp["look"].items() if cp.has_section("look") else ()):
            if key in LOOK_SETTINGS and _SAFE_CSS.match(value.strip()):
                look[key] = value.strip()
            else:
                log(f"global.conf [look]: pomijam '{key}'")
        devices = {}
        for name in cp.sections():
            if name.startswith(DEVICE_PREFIX):
                ip = name[len(DEVICE_PREFIX):].strip()
                devices[ip] = _clean_section(DEVICE_SETTINGS, dict(cp[name]), name)
                if cp[name].get("description"):
                    devices[ip]["description"] = cp[name]["description"]
        storage = _clean_section(SERVER_SETTINGS, dict(cp["storage"]), "storage") if cp.has_section("storage") else {}
        admin = {k: v.strip() for k, v in cp["admin"].items()
                 if k in ("pin", "key") and v.strip()} if cp.has_section("admin") else {}
        paired = {}
        for name in cp.sections():
            if name.startswith(PAIRED_PREFIX):
                sec = cp[name]
                paired[name[len(PAIRED_PREFIX):].strip()] = {
                    "name": clean_name(sec.get("name")) or "Urządzenie",
                    "admin": _BOOL.get(sec.get("admin", "false").strip().lower(), False),
                    "added": sec.get("added", "").strip(),
                }
        outlet = []
        for key, value in (cp["outlet"].items() if cp.has_section("outlet") else ()):
            rule = parse_outlet_rule(value)
            if rule and len(outlet) < OUTLET_MAX_RULES:
                outlet.append(rule)
            else:
                log(f"global.conf [outlet]: pomijam '{key} = {value}'")
        _conf.update(mtime=mtime, storage=storage, look=look, devices=devices, admin=admin, paired=paired,
                     outlet=outlet)
        if migrated:
            _save_conf()
            log("global.conf: przepisany na angielskie nazwy sekcji, kluczy i wartości")
        return _conf


def _fmt(value):
    return ("true" if value else "false") if isinstance(value, bool) else str(value)


def _save_conf():
    """Zapisuje cały plik od nowa (z opisami). Najpierw do pliku tymczasowego – prąd zgaśnie, plik zostaje cały."""
    with _conf_lock:
        z, w = _conf["storage"], _conf["look"]
        lines = [
            "# BEENest – ustawienia. Plik tworzy się sam; możesz go edytować ręcznie (zmiany wczytują się same).",
            "# Zła wartość = używana jest domyślna (komunikat w konsoli). Usunięcie linijki = wartość domyślna.",
            "",
            "[storage]",
            "# Wspólne dla wszystkich urządzeń (Ustawienia -> Działanie).",
            "# saveInterval: co ile minut zapisywać pomiary do historii: 1, 5, 10, 30, 60, 180",
            "# dataRetention: po ilu miesiącach usuwać najstarsze pomiary: 1, 3, 6, 12, 24",
            "# feederRate: zapisuj też tempo rozładowania dokarmiaczki: true / false",
        ]
        lines += [f"{k} = {_fmt(z.get(k, d))}" for k, (d, _) in SERVER_SETTINGS.items()]
        a = _conf["admin"]
        lines += ["", "[admin]",
                  "# Tylko skróty (hash), nigdy same wartości. PIN (6 cyfr) ustawisz w konsoli: python3 app.py --set-pin",
                  "# key = skrót sekretu z pliku beenest.key na pendrivie (Klucz). Usunięcie linijki = brak PIN-u / Klucza."]
        lines += [f"{k} = {a[k]}" for k in ("pin", "key") if a.get(k)]
        lines += ["", "[outlet]",
                  f"# Reguły otwarcia wylotka (najwyżej {OUTLET_MAX_RULES}): ruleN = GG:MM procent (0 = zablokowany,",
                  "# 100 = otwarty). O tej godzinie ul ustawia wylotek. Ustawisz je też w panelu: Stan wylotka → Sterowanie."]
        lines += [f"rule{i} = {r['time']} {r['position']}" for i, r in enumerate(_conf["outlet"], 1)]
        lines += ["", "# ---- Sparowane urządzenia (zapamiętane). admin = stałe uprawnienia administratora.",
                  "# Usuń całą sekcję, by ul zapomniał urządzenie (będzie musiało sparować się od nowa)."]
        for did, dev in _conf["paired"].items():
            lines += ["", f"[{PAIRED_PREFIX}{did}]", f"name = {dev['name']}",
                      f"admin = {_fmt(dev['admin'])}", f"added = {dev.get('added', '')}"]
        lines += ["", "[look]",
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
            if dev.get("description"):
                lines.append(f"description = {dev['description']}")
            lines += [f"{k} = {_fmt(v)}" for k, v in dev.items() if k != "description"]
        os.makedirs(os.path.dirname(CONF_PATH), exist_ok=True)
        tmp = CONF_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        os.replace(tmp, CONF_PATH)
        _conf["mtime"] = os.stat(CONF_PATH).st_mtime_ns


def get_server_settings():
    z = _load_conf()["storage"]
    return {k: z.get(k, default) for k, (default, _) in SERVER_SETTINGS.items()}


def get_device_settings(ip):
    dev = _load_conf()["devices"].get(ip, {})
    return {k: dev.get(k, default) for k, (default, _) in DEVICE_SETTINGS.items()}


def known_device(ip):
    return ip in _load_conf()["devices"]


def set_settings(changes, ip, about=""):
    """
    Zmiany z panelu. Klucze [storage] trafiają do wspólnej sekcji, reszta do sekcji tego urządzenia.
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
        conf["storage"].update(server)
        if ip is not None and (device or ip not in conf["devices"]):
            dev = conf["devices"].setdefault(ip, {"description": about} if about else {})
            for key, value in device.items():
                if value == DEVICE_SETTINGS[key][0]:
                    dev.pop(key, None)          # domyślna = nie zapisujemy (zmiana domyślnych dotrze do urządzenia)
                else:
                    dev[key] = value
        _save_conf()


def look_css():
    """[look] -> CSS wstawiany do strony zaraz po style.css (nadpisuje wartości z pliku CSS)."""
    w = _load_conf()["look"]
    root = "".join(f"--{k}:{w.get(k, d)};" for k, (d, _) in LOOK_SETTINGS.items() if k not in _LOOK_BODY)
    body = "".join(f"--{k}:{w.get(k, d)};" for k, (d, _) in LOOK_SETTINGS.items() if k in _LOOK_BODY)
    # "Ogranicz ruch" w systemie nadal wyłącza animacje
    return (f":root{{{root}}}body{{{body}}}"
            "@media (prefers-reduced-motion: reduce){:root{--anim-duration:.01s;--chart-grow-duration:.01s;--chart-zoom-duration:.01s}}")


def device_label(req):
    """Opis urządzenia z User-Agent (to, co w nawiasie, np. „Linux; Android 15; Pixel 9 Pro”)."""
    m = re.search(r"\(([^)]*)\)", req.headers.get("User-Agent", ""))
    return re.sub(r"[\r\n\[\]]", " ", m.group(1))[:60] if m else ""


def body():
    """Treść żądania JSON jako słownik (pusty, gdy brak albo to nie obiekt)."""
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def clean_name(text):
    """Nazwa urządzenia do global.conf: jedna linijka, bez nawiasów sekcji, najwyżej 40 znaków."""
    return re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\[\]=:#;]", " ", str(text or ""))).strip()[:40]


def network_name(ip):
    """
    Nazwa, pod którą urządzenie przedstawiło się w DHCP hotspotu (np. „Pixel-9-Pro-Karol” → „Pixel 9 Pro Karol”).
    Myślniki zamiast spacji to wymóg DHCP – nawiasów z nazwy telefonu nie da się odtworzyć.
    """
    if not re.fullmatch(r"[\d.]+", ip or ""):
        return ""
    try:
        with open(os.path.join(DHCP_NAMES, ip), encoding="utf-8", errors="replace") as f:
            raw = f.read().strip()
    except OSError:
        return ""
    return clean_name(re.sub(r"[-_]+", " ", raw))


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
def day_ranges(raw, now):
    """Min i max z ostatnich 24 h dla DAY_RANGES (zapisane próbki + bieżący odczyt) – jedno zapytanie do bazy."""
    marks = ",".join("?" * len(DAY_RANGES))
    with db() as con:
        stored = {key: (lo, hi) for key, lo, hi in con.execute(
            f"SELECT key, MIN(value), MAX(value) FROM readings WHERE key IN ({marks}) AND ts >= ? GROUP BY key",
            (*DAY_RANGES, int(now) - 86400))}
    out = {}
    for key, prefix in DAY_RANGES.items():
        values = [v for v in (*stored.get(key, ()), raw[key]) if v is not None]
        out[prefix + "_min"], out[prefix + "_max"] = (min(values), max(values)) if values else (None, None)
    return out


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


_state = {"feeder_low": None, "last_refill": 0.0, "last_save": None, "f_last": ...}   # ... = jeszcze nie z bazy


def last_refill_time():
    """Czas ostatniego napełnienia (kv "f_last"); z bazy tylko raz, potem z pamięci."""
    if _state["f_last"] is ...:
        _state["f_last"] = kv_get("f_last")
    return _state["f_last"]


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
            _state["f_last"] = int(now)
            kv_set("f_last", int(now))
            threading.Thread(target=ring_buzzer, daemon=True).start()


def ring_buzzer():
    try:
        buzzer.alarm()
    except Exception as e:
        log(f"buzzer: {e}")


def move_outlet(percent, who):
    """Ustawia wylotek (serwo) i od razu poprawia ostatni odczyt, żeby strona nie czekała na kolejną próbkę."""
    outlet.set_position(percent)
    if _latest:                          # przypisanie w słowniku jest atomowe – bez blokady (woła to też sample_once)
        _latest["o_position"] = float(percent)
        _latest["o_status"] = outlet_status(float(percent))
    if who:
        log(f"wylotek: {percent:g} % ({who})")


def run_outlet_rules(now):
    """Reguły z [outlet]: o podanej godzinie (co do minuty) ustawia wylotek. Każda minuta tylko raz."""
    minute = time.strftime("%H:%M", time.localtime(now))
    if minute == _state.get("outlet_minute"):
        return
    _state["outlet_minute"] = minute
    for rule in _load_conf()["outlet"]:
        if rule["time"] == minute:
            try:
                move_outlet(rule["position"], f"reguła {minute}")
            except Exception as e:
                track("outlet", e)


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
    p.update(day_ranges(raw, now))
    p["w_status"] = wellbeing_status(raw["w_frequency"], raw["w_sound"])
    p["o_status"] = outlet_status(raw["o_position"])
    p["w_updated"] = int(now)                 # sekundy od 1970 – przeglądarka sformatuje po swojemu
    p["f_last"] = last_refill_time()          # None, dopóki nie wykryto pierwszego napełnienia
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
        run_outlet_rules(now)
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
        label = device_label(request)
        log(f"pierwsze połączenie z {ip}" + (f" ({label})" if label else ""))


# -------------------------------------------------------------
#  Polecenia systemowe (zasilanie, aktualizacja)
# -------------------------------------------------------------
def run_system_command(args, timeout=60):
    """Jedyne miejsce uruchamiające polecenia systemowe (łatwo podmienić w testach)."""
    return subprocess.run(args, cwd=ROOT, capture_output=True, text=True,
                          check=True, timeout=timeout)


# ---- Logo startowe w kolorach motywu wyświetlacza: (tło, „BEE”, „NEST”) – zmierzone z CSS panelu na wyświetlaczu.
# Serwer zapisuje data/logo.png (+ logo.color = tło, logo.theme = wariant). Tło kiosku (pi/background.sh) bierze je od razu,
# Plymouth po przebudowie initramfs – robi to usługa beenest-logo (root, pi/install.sh), gdy logo.png się zmieni.
BOOT_LOGO_COLORS = {
    "white-pollen/normal": ("#FFFFFF", "#0F0F10", "#FF8A00"),
    "white-pollen/high": ("#FFFFFF", "#0F0F10", "#000000"),
    "light-honey/normal": ("#FFF8E7", "#4A2F1A", "#FF9E00"),
    "light-honey/high": ("#FFF2E0", "#1A1A1A", "#E65100"),
    "night-black/normal": ("#000000", "#FFFFFF", "#FF8A00"),
    "night-black/high": ("#000000", "#FFFFFF", "#FFFFFF"),
    "honey-grey/normal": ("#2E2410", "#FFF3DC", "#FFB800"),
    "honey-grey/high": ("#000000", "#FFFFFF", "#FFC107"),
}
_logo_lock = threading.Lock()


def update_boot_logo():
    """Przy starcie serwera i po zmianie motywu / kontrastu na wyświetlaczu. Tylko na Raspberry."""
    if not on_raspberry():
        return
    with _logo_lock:
        dev = get_device_settings(DISPLAY_ADDRESSES[0])
        key = f"{dev['theme']}/{'high' if dev['highContrast'] else 'normal'}"
        data = os.path.join(ROOT, "data")
        try:
            with open(os.path.join(data, "logo.theme"), encoding="utf-8") as f:
                if f.read().strip() == key and os.path.exists(os.path.join(data, "logo.png")):
                    return
        except OSError:
            pass
        bg, bee, nest = BOOT_LOGO_COLORS[key]
        try:
            subprocess.run([sys.executable, os.path.join(ROOT, "pi", "logo.py"), os.path.join(ROOT, "pi", "boot-logo.png"),
                            os.path.join(data, "logo.png.tmp"), bg, bee, nest], check=True, capture_output=True, timeout=120)
            for name, text in (("logo.color", bg), ("logo.theme", key)):
                with open(os.path.join(data, name), "w", encoding="utf-8") as f:
                    f.write(text + "\n")
            os.replace(os.path.join(data, "logo.png.tmp"), os.path.join(data, "logo.png"))
            log(f"logo startowe: {key}")
        except (OSError, subprocess.SubprocessError) as e:
            log(f"logo startowe: błąd: {e!r}")


@functools.lru_cache(maxsize=1)
def on_raspberry():
    try:
        with open("/proc/device-tree/model", encoding="ascii", errors="replace") as f:
            return "Raspberry Pi" in f.read()
    except OSError:
        return False


def screen_power(on, quiet=False):
    """
    Wyświetlacz przy ulu: wyłącza / włącza obraz przez wlopm (zasilanie wyjścia w labwc; panel bez sygnału
    gasi podświetlenie). Tylko na Raspberry – na komputerze z testami nie gasimy cudzego monitora.
    True = udało się; bez wlopm strona i tak zasłania ekran czernią.
    """
    if not on_raspberry() or not shutil.which("wlopm"):
        return False
    env = {**os.environ, "XDG_RUNTIME_DIR": os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}"),
           "WAYLAND_DISPLAY": os.environ.get("WAYLAND_DISPLAY", "wayland-0")}
    try:
        subprocess.run(["wlopm", "--on" if on else "--off", "*"], env=env,
                       capture_output=True, text=True, timeout=5, check=True)
        return True
    except (OSError, subprocess.SubprocessError) as e:
        if not quiet:
            log(f"wlopm: nie udało się {'włączyć' if on else 'wyłączyć'} ekranu: {error_text(e)}")
        return False


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
#  Zabezpieczenia
#  Dwa poziomy: "user" (podgląd) i "admin". Kto pyta:
#    - wyświetlacz przy ulu (przeglądarka na Raspberry, 127.0.0.1): administrator, gdy wpięty jest Klucz
#      (pendrive z plikiem beenest.key) albo przez ADMIN_IDLE s od ostatniego dotyku po wpisaniu PIN-u;
#    - telefon / komputer: musi być sparowany na wyświetlaczu (kod QR albo 6 cyfr). Dostaje ciasteczko
#      z samym identyfikatorem; rola (admin / użytkownik) jest stała, zmienia ją administrator na liście.
#      Zapamiętane urządzenia są w global.conf [paired <id>], niezapamiętane tylko w pamięci.
#    - niesparowany telefon widzi tylko ekran parowania (reszta API odpowiada 401).
#  5 błędnych PIN-ów = blokada całego ula na LOCK_TIME s; zdejmuje ją telefon administratora albo Klucz.
# -------------------------------------------------------------
ADMIN, USER, UNPAIRED = "admin", "user", "unpaired"
_sec_lock = threading.RLock()
_sec = {
    "admin_until": 0.0,     # wyświetlacz odblokowany PIN-em do (czas)
    "fails": 0,             # błędne PIN-y pod rząd
    "locked_until": 0.0,    # blokada po LOCK_AFTER błędach
    "code": None,           # kod parowania: {token, digits, until, tries}
    "request": None,        # prośba telefonu o parowanie: {id, nazwa, until, decision, device, remember}
    "temp": {},             # niezapamiętane urządzenia: id -> {nazwa, admin, last}
    "seen": {},             # zapamiętane urządzenia: id -> ostatnie zapytanie
    "dup": None,            # duplikowanie Klucza: {secret, until}
}
_usb = {"sticks": [], "key_path": None, "event": 0, "event_type": None, "tried": set(), "busy": False,
        "blocks": None}   # blocks: dyski sd* z ostatniego pełnego sprawdzenia (usb_automount)


def is_display():
    return request.remote_addr in DISPLAY_ADDRESSES


def lock_left():
    return max(0.0, _sec["locked_until"] - time.time())


def key_present():
    return _usb["key_path"] is not None


def pin_hash():
    return _load_conf()["admin"].get("pin")


def set_admin_secret(name, value):
    """Zapisuje (albo usuwa, gdy value=None) skrót PIN-u / Klucza w global.conf [admin]."""
    with _conf_lock:
        conf = _load_conf()
        if value:
            conf["admin"][name] = value
        else:
            conf["admin"].pop(name, None)
        _save_conf()


def valid_pin(pin):
    return isinstance(pin, str) and re.fullmatch(r"\d{%d}" % PIN_LENGTH, pin) is not None


def who_is_asking():
    """Kim jest ten, kto pyta: {poziom, wyswietlacz, przez, id, nazwa, zapamietane}."""
    now = time.time()
    if NO_SECURITY:
        return {"level": ADMIN, "display": is_display(), "via": "no-security", "id": None}
    if is_display():
        via = "key" if key_present() else ("pin" if now < _sec["admin_until"] else None)
        return {"level": ADMIN if via else USER, "display": True, "via": via, "id": None}
    did = session.get("device")
    if not did and session.get("urzadzenie"):         # ciasteczko sprzed 2026-11-21 (polska nazwa klucza)
        did = session["device"] = session.pop("urzadzenie")
    if did:
        with _sec_lock:
            dev = _load_conf()["paired"].get(did)
            if dev:
                _sec["seen"][did] = now
                return {"level": ADMIN if dev["admin"] else USER, "display": False, "via": "phone",
                        "id": did, "name": dev["name"], "remembered": True}
            tmp = _sec["temp"].get(did)
            if tmp and now - tmp["last"] <= TEMP_DEVICE_TIME:
                tmp["last"] = now
                return {"level": ADMIN if tmp["admin"] else USER, "display": False, "via": "phone",
                        "id": did, "name": tmp["name"], "remembered": False}
            _sec["temp"].pop(did, None)
    return {"level": UNPAIRED, "display": False, "via": None, "id": None}


def need(admin=True, display=False, phone=False):
    """None = wolno; inaczej gotowa odpowiedź z błędem. Używane jak json_only()."""
    w = g.who
    if display and not w["display"]:
        return jsonify(error="To działa tylko na wyświetlaczu ula"), 403
    if phone and w["display"]:
        return jsonify(error="To działa tylko na sparowanym telefonie"), 403
    if admin and w["level"] != ADMIN:
        return jsonify(error="Brak uprawnień administratora", forbidden=True), 403
    return None


def check_pin(pin):
    """None = PIN poprawny; inaczej odpowiedź z błędem. Liczy błędy i włącza blokadę."""
    with _sec_lock:
        if lock_left():
            return jsonify(error="Panel jest zablokowany", lockout=lock_left()), 423
        stored = pin_hash()
        if not stored:
            return jsonify(error="PIN administratora nie jest ustawiony. Ustawisz go w konsoli Raspberry Pi: "
                                 "python3 app.py --set-pin"), 409
        if valid_pin(pin) and check_password_hash(stored, pin):
            _sec["fails"] = 0
            return None
        _sec["fails"] += 1
        if _sec["fails"] >= LOCK_AFTER:
            _sec["fails"] = 0
            _sec["locked_until"] = time.time() + LOCK_TIME
            _sec["admin_until"] = 0.0              # blokada od razu zahasłowuje panel
            log(f"{LOCK_AFTER} błędnych PIN-ów pod rząd – panel zablokowany na {LOCK_TIME // 60} minut")
            return jsonify(error="Panel zablokowany", lockout=LOCK_TIME), 423
        return jsonify(error="Błędny PIN", remaining=LOCK_AFTER - _sec["fails"]), 403


# ---- Klucz: pendrive z plikiem beenest.key (losowy sekret). W global.conf jest tylko jego skrót SHA-256.
def usb_mounts():
    """Zamontowane pendrive'y. BEENEST_USB=<katalog> – do testów: każdy podkatalog udaje jeden pendrive."""
    if os.environ.get("BEENEST_USB"):
        return sorted(p for p in glob.glob(os.path.join(os.environ["BEENEST_USB"], "*")) if os.path.isdir(p))
    if sys.platform == "win32":
        import ctypes
        import string
        return [f"{d}:\\" for d in string.ascii_uppercase[2:]
                if ctypes.windll.kernel32.GetDriveTypeW(f"{d}:\\") == 2]     # 2 = dysk wymienny
    found = set()
    for pattern in ("/media/*/*", "/media/*", "/run/media/*/*"):       # Raspberry Pi OS, Arch (udisks)
        found.update(p for p in glob.glob(pattern) if os.path.ismount(p))
    return sorted(found)


def read_key_file(mount):
    for name in (KEY_FILE, LEGACY_KEY_FILE):
        try:
            with open(os.path.join(mount, name), encoding="ascii") as f:
                return f.read(200).strip() or None
        except (OSError, UnicodeDecodeError):
            continue
    return None


def key_matches(secret):
    stored = _load_conf()["admin"].get("key")
    return bool(secret and stored) and hmac.compare_digest(hashlib.sha256(secret.encode()).hexdigest(), stored)


def scan_usb(quiet=False):
    """Sprawdza pendrive'y. Wpięcie / wyjęcie Klucza = zdarzenie (powiadomienie na wyświetlaczu).
    quiet=True: bez zdarzenia i bez skutków (zmiana zrobiona przez sam panel, np. zapis nowego Klucza)."""
    sticks, key = [], None
    for mount in usb_mounts():
        secret = read_key_file(mount)
        state = None if secret is None else ("valid" if key_matches(secret) else "other")
        if state == "valid" and key is None:
            key = mount
        try:
            size = shutil.disk_usage(mount).total
        except OSError:
            size = None
        sticks.append({"path": mount, "name": os.path.basename(mount.rstrip("\\/")) or mount,
                       "size": size, "key": state})
    with _sec_lock:
        was = key_present()
        _usb["sticks"], _usb["key_path"] = sticks, key
        if (key is not None) == was or quiet:
            return
        _usb["event"] += 1
        _usb["event_type"] = "inserted" if key else "removed"
        if key:
            _sec["locked_until"], _sec["fails"] = 0.0, 0     # Klucz zdejmuje blokadę
            log("Klucz wpięty – wyświetlacz ma uprawnienia administratora")
        else:
            _sec["admin_until"] = 0.0                         # wyjęcie Klucza = od razu poziom użytkownika
            log("Klucz wyjęty")


def usb_automount():
    """
    Raspberry: sesja kiosku nie ma menedżera plików, który sam montowałby pendrive'y (/media było puste),
    więc montuje je serwer przez udisksctl → /media/<użytkownik>/<nazwa>. Prawo do tego daje usłudze reguła
    polkit z pi/install.sh. Tylko dyski USB i tylko partycje z systemem plików (np. FAT, exFAT, NTFS).
    Każdą partycję próbujemy raz – do wyjęcia pendrive'a. Po wyjęciu udisks sam sprząta punkt montowania.
    """
    if sys.platform != "linux" or os.environ.get("BEENEST_USB") or not shutil.which("udisksctl"):
        return
    names = tuple(sorted(glob.glob("/sys/class/block/sd*")))
    if not names:                                       # nic nie jest wpięte – bez uruchamiania lsblk
        _usb["tried"].clear()
        _usb["blocks"] = names
        return
    if names == _usb["blocks"]:                         # te same dyski co przy ostatnim pełnym sprawdzeniu
        return
    out = subprocess.run(["lsblk", "-J", "-l", "-p", "-o", "PATH,PKNAME,TRAN,FSTYPE,MOUNTPOINT"],
                         capture_output=True, text=True, timeout=5).stdout
    devices = json.loads(out or "{}").get("blockdevices") or []
    disks = {d["path"] for d in devices if d.get("tran") == "usb"}          # partycje mają TRAN puste
    usb = [d for d in devices if d["path"] in disks or d.get("pkname") in disks]
    todo = [d["path"] for d in usb
            if d.get("fstype") and not d.get("mountpoint") and d["path"] not in _usb["tried"]]
    _usb["tried"] &= {d["path"] for d in usb}           # wyjęty pendrive – przy następnym wpięciu znów próbujemy
    # Lista zapamiętana dopiero, gdy udev zdążył opisać systemy plików (tuż po wpięciu FSTYPE bywa jeszcze pusty)
    parts = [d for d in usb if d.get("pkname") in disks] or [d for d in usb if d["path"] in disks]
    _usb["blocks"] = names if all(d.get("fstype") for d in parts) else None
    for path in todo:
        _usb["tried"].add(path)
        r = subprocess.run(["udisksctl", "mount", "-b", path, "--no-user-interaction"],
                           capture_output=True, text=True, timeout=30)
        if r.returncode:
            # NTFS wyjęty z Windows bez „bezpiecznego usuwania” (albo przy szybkim uruchamianiu Windows) ma
            # niezamknięty dziennik – jądro odmawia zapisu („failed to replay log file”). Tylko do odczytu
            # Klucz da się sprawdzić; zapisu (nowy Klucz, kopia) nie – wtedy chkdsk w Windows albo FAT32 / exFAT.
            log(f"pendrive {path}: nie da się zamontować do zapisu, próbuję tylko do odczytu "
                f"({r.stderr.strip().splitlines()[-1] if r.stderr.strip() else r.returncode})")
            r = subprocess.run(["udisksctl", "mount", "-b", path, "-o", "ro", "--no-user-interaction"],
                               capture_output=True, text=True, timeout=30)
        log(f"pendrive {path}: " + (r.stdout.strip() or r.stderr.strip() or "zamontowany"))


def safe_eject(mount):
    """
    „Bezpieczne usuwanie” po zapisie Klucza: odmontowanie i wyłączenie pendrive'a (udisksctl power-off).
    Powód (2026-11-21): tani pendrive potwierdził zapis, ale trzymał dane we własnej pamięci podręcznej –
    wyjęty 6 s później miał plik beenest.key o dobrym rozmiarze, wypełniony bajtami 0xFF. Jądro
    zakłada „write through” i nie każe mu jej opróżnić; dopiero wyłączenie go do tego zmusza.
    True = pendrive wyłączony (można go wyjąć). False = nie wyszło – zostaje zamontowany, trzeba chwilę odczekać.
    """
    if sys.platform != "linux" or os.environ.get("BEENEST_USB") or not shutil.which("udisksctl"):
        return False
    dev = None
    with open("/proc/mounts", encoding="utf-8", errors="replace") as f:
        for line in f:
            src, target = line.split()[:2]
            if re.sub(r"\\(\d{3})", lambda m: chr(int(m[1], 8)), target) == mount:   # spacje jako \040
                dev = src
    if not dev:
        return False
    disk = subprocess.run(["lsblk", "-no", "PKNAME", dev], capture_output=True, text=True, timeout=5).stdout.strip()

    def run(*args):
        r = subprocess.run(["udisksctl", *args, "--no-user-interaction"], capture_output=True, text=True, timeout=30)
        return r.returncode == 0, (r.stderr.strip() or r.stdout.strip()).splitlines()[-1:] or [""]

    _usb["busy"] = True                  # bez tego usb_loop uznałby odmontowanie za wyjęcie Klucza
    try:
        os.sync()
        ok, msg = run("unmount", "-b", dev)
        if not ok:
            log(f"pendrive {dev}: nie da się odmontować ({msg[0]})")
            return False
        ok, msg = run("power-off", "-b", f"/dev/{disk}" if disk else dev)
        if not ok:
            log(f"pendrive {dev}: nie da się wyłączyć ({msg[0]}) – montuję ponownie")
            _usb["tried"].discard(dev)   # usb_automount zamontuje go znowu
            _usb["blocks"] = None
            return False
        log(f"pendrive {dev}: bezpiecznie odłączony")
        return True
    finally:
        _usb["busy"] = False


def usb_loop():
    while True:
        if _usb["busy"]:
            time.sleep(0.2)
            continue
        try:
            usb_automount()
        except Exception as e:
            track("usb-mount", e)
        try:
            scan_usb()
            track("usb")
        except Exception as e:
            track("usb", e)
        time.sleep(1)


def write_key(mount, secret):
    path = os.path.join(mount, KEY_FILE)
    with open(path, "w", encoding="ascii") as f:
        f.write(secret + "\n")
        f.flush()
        os.fsync(f.fileno())
    if hasattr(os, "sync"):
        os.sync()
    if read_key_file(mount) != secret:
        raise OSError("Plik na pendrivie różni się od zapisanego – spróbuj innego pendrive'a")


def find_stick(name):
    return next((s for s in _usb["sticks"] if s["name"] == name), None)


# ---- Parowanie
def hotspot_wifi():
    """Nazwa i hasło hotspotu z NetworkManagera: ({ssid, haslo}, None) albo (None, powód)."""
    values = []
    for field in ("802-11-wireless.ssid", "802-11-wireless-security.psk"):
        try:
            out = run_system_command(["nmcli", "-e", "no", "-s", "-g", field, "connection", "show",
                                      HOTSPOT_CONNECTION], timeout=10).stdout
        except FileNotFoundError:
            return None, "Brak programu nmcli (NetworkManager) – dane Wi-Fi są dostępne tylko na Raspberry Pi."
        except Exception as e:
            return None, f"Nie udało się odczytać połączenia {HOTSPOT_CONNECTION}: {error_text(e)}"
        values.append(out.strip())
    return {"ssid": values[0], "password": values[1]}, None


def pairing_address():
    """Adres, pod którym telefon w hotspocie znajdzie ul (do kodu QR)."""
    ips, main_ip = lan_addresses(), primary_address()
    if HOTSPOT_PREFIX + "1" in ips:          # hotspot na Raspberry Pi: beenest.local (DNS hotspotu i avahi)
        host = MDNS_NAME + ".local"
    elif main_ip in ips:
        host = main_ip
    else:
        host = ips[0] if ips else request.host.split(":")[0]
    return url(host)


def security_state(w):
    """Stan zabezpieczeń dla strony (wklejany do strony i odpytywany co sekundę / dwie)."""
    now = time.time()
    s = {"level": w["level"], "display": w["display"], "via": w["via"],
         "no_security": NO_SECURITY, "pin_length": PIN_LENGTH}
    if w["level"] == UNPAIRED:
        return s
    s["lockout"] = round(lock_left(), 2)
    s["pin_set"] = bool(pin_hash())
    code, req = _sec["code"], _sec["request"]
    pairing = {"code": round(code["until"] - now) if code and now < code["until"] else 0,
               "request": {"id": req["id"], "name": req["name"]}
               if req and req["decision"] is None and now < req["until"] else None,
               # jak skończyła się ostatnia prośba – pozostałe urządzenia zamykają okno z właściwym komunikatem
               "decided": {"id": done["id"], "approved": done["approved"]}
               if (done := _sec.get("decided")) and now < done["until"] else None}
    if w["display"]:
        conf = _load_conf()["admin"]
        dup = _sec["dup"]
        s.update(
            pairing,
            admin_left=round(max(0.0, _sec["admin_until"] - now)) if w["via"] == "pin" else 0,
            key={"set": bool(conf.get("key")), "inserted": key_present(),
                   "event": _usb["event"], "type": _usb["event_type"]},
            usb=[{"name": x["name"], "size": x["size"], "key": x["key"]} for x in _usb["sticks"]],
            duplicating=bool(dup and now < dup["until"]),
            sleep_request=_screen["requests"],          # zmiana licznika = telefon kazał zgasić ekran
        )
    else:
        s["device"] = {"name": w.get("name"), "remembered": w.get("remembered", False)}
        if w["level"] == ADMIN:               # telefon administratora też może parować nowe urządzenia
            s.update(pairing)
    return s


# Bez parowania dostępne są tylko te widoki (reszta: 401)
OPEN_ENDPOINTS = {"index", "static", "api_security_state", "api_pair_claim", "api_pair_status",
                  "connectivity_check"}


@app.before_request
def one_address():
    """
    Telefon w hotspocie zawsze na http://beenest.local. Ciasteczko parowania przeglądarka przypisuje do nazwy
    z paska adresu – wejście raz przez 10.42.0.1, a raz przez beenest.local „gubiło” sparowane urządzenie.
    Dotyczy tylko otwarcia strony (GET /); testy łączności telefonów i API zostają bez zmian.
    """
    if (request.method == "GET" and request.path == "/" and (request.remote_addr or "").startswith(HOTSPOT_PREFIX)
            and request.host.split(":")[0].lower() != MDNS_NAME + ".local"):
        seen = (request.remote_addr, request.host)
        if seen not in _redirected:                # jedna linia na urządzenie i nazwę – widać pętle przekierowań
            _redirected.add(seen)
            log(f"przekierowuję {request.remote_addr} z „{request.host}” na {MDNS_NAME}.local "
                f"(przez: {request.headers.get('Via', '-')}, {request.headers.get('User-Agent', '')[:80]})")
        return redirect(url(MDNS_NAME + ".local") + "/", 302)


_redirected = set()


@app.before_request
def guard():
    g.who = who_is_asking()
    if g.who["level"] == UNPAIRED and request.endpoint not in OPEN_ENDPOINTS:
        return jsonify(error="To urządzenie nie jest sparowane z ulem", unpaired=True), 401


# -------------------------------------------------------------
#  Routing
# -------------------------------------------------------------
@app.route("/")
def index():
    """Serwuje główny plik HTML (SPA z routingiem po #hashtagu)."""
    ip = request.remote_addr
    return render_template("main.html", look_css=look_css(), auth=security_state(g.who),
                           device={"settings": {**get_server_settings(), **get_device_settings(ip)},
                                   "known": known_device(ip), "network_name": network_name(ip)})


# -------------------------------------------------------------
#  Testy łączności telefonów (hotspot bez internetu)
#  Na hotspocie dnsmasq kieruje każdą nazwę na Raspberry (pi/install.sh), więc telefon pytający
#  „czy jest internet?” trafia tutaj i dostaje odpowiedź, jakiej się spodziewa.
#  Sprawdzenia przez HTTPS (Android robi je równolegle) nie da się podrobić bez certyfikatu Google.
# -------------------------------------------------------------
APPLE_SUCCESS = "<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>"
CONNECTIVITY_CHECKS = {
    "/generate_204": ("", 204),                         # Android, Chrome
    "/gen_204": ("", 204),
    "/hotspot-detect.html": (APPLE_SUCCESS, 200),       # iPhone, iPad, macOS
    "/library/test/success.html": (APPLE_SUCCESS, 200),
    "/connecttest.txt": ("Microsoft Connect Test", 200),  # Windows 10 / 11
    "/ncsi.txt": ("Microsoft NCSI", 200),
    "/success.txt": ("success\n", 200),                 # Firefox
}


def connectivity_check():
    body, status = CONNECTIVITY_CHECKS[request.path]
    return Response(body, status, mimetype="text/html" if body.startswith("<") else "text/plain")


for _path in CONNECTIVITY_CHECKS:
    app.add_url_rule(_path, "connectivity_check", connectivity_check)


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
        changes = request.get_json(silent=True)
        # Zakładkę Działanie ([storage] + alarm) zmienia tylko administrator; wygląd i karty – każdy dla siebie.
        if (isinstance(changes, dict) and any(k in SERVER_SETTINGS or k in ADMIN_DEVICE_SETTINGS for k in changes)
                and (bad := need())):
            return bad
        try:
            set_settings(changes, request.remote_addr, device_label(request))
        except ValueError as e:
            return jsonify(error=str(e)), 400
        if g.who["display"] and ("theme" in changes or "highContrast" in changes):
            threading.Thread(target=update_boot_logo, daemon=True).start()
    return jsonify({**get_server_settings(), **get_device_settings(request.remote_addr)})


@app.post("/api/system/reboot")
def api_reboot():
    if (bad := json_only() or need()):
        return bad
    try:
        power("reboot")
    except Exception as e:
        return jsonify(error=error_text(e)), 500
    return jsonify(ok=True)


@app.post("/api/system/shutdown")
def api_shutdown():
    if (bad := json_only() or need()):
        return bad
    try:
        power("shutdown")
    except Exception as e:
        return jsonify(error=error_text(e)), 500
    return jsonify(ok=True)


# ---- Uśpienie ekranu (tylko wyświetlacz; animację i zasłonę rysuje strona, tu samo zasilanie obrazu)
_screen = {"requests": 0}     # licznik próśb telefonów o zgaszenie ekranu ula (odczytuje wyświetlacz)


@app.post("/api/screen/sleep")
def api_screen_sleep():
    """Wyświetlacz: gasi obraz. Telefon (każdy sparowany): prosi wyświetlacz, żeby się uśpił – ten przy
    najbliższym odczycie stanu (co sekundę) pokazuje animację i sam gasi obraz."""
    if (bad := json_only()):
        return bad
    if not g.who["display"]:
        _screen["requests"] += 1
        log(f"{g.who.get('name') or request.remote_addr}: zgaszenie ekranu ula")
        return jsonify(ok=True, remote=True)
    _sec["admin_until"] = 0.0      # zgaszony ekran = zahasłowany panel (jak „Zahasłuj Panel”; wpięty Klucz nadal działa)
    return jsonify(ok=True, screen_off=screen_power(False))


@app.post("/api/screen/wake")
def api_screen_wake():
    if (bad := json_only() or need(admin=False, display=True)):
        return bad
    return jsonify(ok=True, screen_on=screen_power(True))


@app.post("/api/outlet")
def api_outlet_move():
    """Stan wylotka → przyciski i suwak (na żywo, strona wysyła kolejne pozycje w trakcie przesuwania)."""
    if (bad := json_only() or need()):
        return bad
    value = to_number(body().get("position"))
    if value is None or not 0 <= value <= 100:
        return jsonify(error="Pozycja wylotka musi być liczbą od 0 do 100"), 400
    try:
        move_outlet(round(value), None)
    except OSError as e:
        return jsonify(error=f"Nie udało się poruszyć wylotkiem: {e.strerror or e}"), 500
    return jsonify(ok=True, position=round(value))


@app.route("/api/outlet/rules", methods=["GET", "POST"])
def api_outlet_rules():
    """Reguły otwarcia: lista {godzina: "GG:MM", pozycja: 0–100}, najwyżej OUTLET_MAX_RULES. Zmiana: administrator."""
    if request.method == "GET":
        return jsonify(rules=_load_conf()["outlet"], max=OUTLET_MAX_RULES)
    if (bad := json_only() or need()):
        return bad
    raw = body().get("rules")
    if not isinstance(raw, list) or len(raw) > OUTLET_MAX_RULES:
        return jsonify(error=f"Najwyżej {OUTLET_MAX_RULES} reguł"), 400
    rules = []
    for item in raw:
        rule = isinstance(item, dict) and parse_outlet_rule(f"{item.get('time')} {item.get('position')}")
        if not rule:
            return jsonify(error="Zła reguła – godzina GG:MM i procent od 0 do 100"), 400
        rules.append(rule)
    with _conf_lock:
        _load_conf()["outlet"] = rules
        _save_conf()
    log(f"wylotek: reguły otwarcia ({len(rules)}) zapisane")
    return jsonify(ok=True, rules=rules)


@app.post("/api/history/clear")
def api_history_clear():
    """Ustawienia → Działanie → "Wymaż zapisane dane": usuwa historię atmosfery i samopoczucia (HISTORY_KEYS)."""
    if (bad := json_only() or need()):
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
    if (bad := json_only() or need()):
        return bad
    reboot = body().get("reboot") is True
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


# ---- Zabezpieczenia: stan, PIN, blokada
@app.route("/api/security/state")
def api_security_state():
    return jsonify(security_state(g.who))


@app.post("/api/security/pin")
def api_pin_unlock():
    """Wyświetlacz: PIN administratora odblokowuje panel na ADMIN_IDLE s od ostatniego dotyku."""
    if (bad := json_only() or need(admin=False, display=True)):
        return bad
    if (bad := check_pin(body().get("pin"))):
        return bad
    _sec["admin_until"] = time.time() + ADMIN_IDLE
    return jsonify(ok=True, admin_left=ADMIN_IDLE)


@app.post("/api/security/activity")
def api_activity():
    """Wyświetlacz: ktoś dotyka ekranu – przedłuż odblokowanie (samo odpytywanie strony go nie przedłuża)."""
    if (bad := json_only() or need(admin=False, display=True)):
        return bad
    with _sec_lock:
        if time.time() < _sec["admin_until"]:
            _sec["admin_until"] = time.time() + ADMIN_IDLE
    return jsonify(ok=True)


@app.post("/api/security/lock")
def api_lock_panel():
    """Wyświetlacz: przycisk "Zahasłuj Panel"."""
    if (bad := json_only() or need(admin=False, display=True)):
        return bad
    _sec["admin_until"] = 0.0
    return jsonify(ok=True)


@app.post("/api/security/lift-lockout")
def api_lift_lockout():
    """Telefon administratora (albo wyświetlacz z Kluczem) zdejmuje blokadę po błędnych PIN-ach."""
    if (bad := json_only() or need()):
        return bad
    with _sec_lock:
        _sec["locked_until"], _sec["fails"] = 0.0, 0
    log("blokada zdjęta przez administratora")
    return jsonify(ok=True)


@app.post("/api/security/change-pin")
def api_change_pin():
    """Nowy PIN. Wyświetlacz z Kluczem i telefon administratora – bez starego PIN-u; wyświetlacz bez Klucza – ze starym."""
    if (bad := json_only()):
        return bad
    w, data = g.who, body()
    if not w["display"] and w["level"] != ADMIN:
        return need()
    if w["display"] and not key_present() and not NO_SECURITY and (bad := check_pin(data.get("old"))):
        return bad
    if not valid_pin(data.get("new")):
        return jsonify(error=f"PIN musi mieć {PIN_LENGTH} cyfr"), 400
    set_admin_secret("pin", generate_password_hash(data["new"]))
    log("zmieniono PIN administratora")
    return jsonify(ok=True)


# ---- Parowanie: krok 1 Wi-Fi, krok 2 kod, krok 3 decyzja (wyświetlacz albo telefon administratora)
@app.route("/api/pairing/wifi")
def api_pair_wifi():
    if (bad := need()):
        return bad
    wifi, problem = hotspot_wifi()
    return jsonify(wifi=wifi, error=problem)


@app.post("/api/pairing/code")
def api_pair_code():
    """Nowy jednorazowy kod (QR z adresem + 6 cyfr), ważny PAIR_CODE_TIME s. Poprzedni przestaje działać."""
    if (bad := json_only() or need()):
        return bad
    token = secrets.token_urlsafe(16)
    digits = "".join(secrets.choice("0123456789") for _ in range(6))
    with _sec_lock:
        _sec["code"] = {"token": token, "digits": digits, "until": time.time() + PAIR_CODE_TIME, "tries": 0}
        _sec["request"] = None
    return jsonify(address=f"{pairing_address()}/#pair={token}", digits=digits, seconds=PAIR_CODE_TIME)


@app.post("/api/pairing/cancel")
def api_pair_cancel():
    if (bad := json_only() or (None if g.who["display"] else need())):
        return bad
    with _sec_lock:
        _sec["code"] = None
        if _sec["request"] and _sec["request"]["decision"] is None:
            _sec["request"]["decision"] = "no"
            note_decision(_sec["request"], False)
    return jsonify(ok=True)


def note_decision(req, agreed):
    """Zapamiętuje na 30 s, jak rozpatrzono prośbę (stan dla pozostałych urządzeń administratora)."""
    _sec["decided"] = {"id": req["id"], "approved": agreed, "until": time.time() + 30}


@app.post("/api/pairing/claim")
def api_pair_claim():
    """Telefon podaje kod (z QR albo 6 cyfr) i nazwę. Potem czeka na decyzję na wyświetlaczu."""
    if (bad := json_only()):
        return bad
    if g.who["level"] != UNPAIRED:
        return jsonify(error="To urządzenie jest już sparowane z ulem"), 409
    data = body()
    token, digits = str(data.get("token") or ""), str(data.get("code") or "")
    name = (clean_name(data.get("name")) or network_name(request.remote_addr)
            or clean_name(device_label(request)) or "Telefon")
    now = time.time()
    with _sec_lock:
        code, req = _sec["code"], _sec["request"]
        if not code or now > code["until"]:
            return jsonify(error="Brak ważnego kodu parowania. Wygeneruj nowy na wyświetlaczu ula."), 410
        if req and req["decision"] is None and now < req["until"]:
            return jsonify(error="Ul czeka już na zatwierdzenie innego urządzenia."), 409
        ok = ((re.fullmatch(r"[\w-]{10,64}", token) and hmac.compare_digest(token, code["token"]))
              or (re.fullmatch(r"\d{6}", digits) and hmac.compare_digest(digits, code["digits"])))
        if not ok:
            code["tries"] += 1
            if code["tries"] >= PAIR_CODE_TRIES:
                _sec["code"] = None
                log(f"kod parowania unieważniony po {PAIR_CODE_TRIES} błędnych próbach ({request.remote_addr})")
                return jsonify(error="Kod przestał działać po 5 błędnych próbach. Wygeneruj nowy na wyświetlaczu ula."), 410
            return jsonify(error="Błędny kod", remaining=PAIR_CODE_TRIES - code["tries"]), 403
        _sec["code"] = None                                  # kod jednorazowy
        rid = secrets.token_urlsafe(12)
        _sec["request"] = {"id": rid, "name": name, "until": now + PAIR_CODE_TIME,
                           "decision": None, "device": None, "remember": True}
    session["request"] = rid
    log(f"prośba o parowanie: {name} ({request.remote_addr})")
    return jsonify(ok=True, name=name)


@app.route("/api/pairing/status")
def api_pair_status():
    """Telefon pyta, czy wyświetlacz już zdecydował. Po zgodzie dostaje ciasteczko urządzenia."""
    rid = session.get("request")
    with _sec_lock:
        req = _sec["request"]
        if not rid or not req or req["id"] != rid:
            session.pop("request", None)
            return jsonify(status="none")
        if req["decision"] is None:
            if time.time() < req["until"]:
                return jsonify(status="waiting")
            _sec["request"] = None
            session.pop("request", None)
            return jsonify(status="expired")
        _sec["request"] = None
        session.pop("request", None)
        if req["decision"] != "yes":
            return jsonify(status="rejected")
        session["device"] = req["device"]
        session.permanent = req["remember"]     # niezapamiętane: ciasteczko do zamknięcia przeglądarki
    return jsonify(status="accepted")


@app.post("/api/pairing/decision")
def api_pair_decision():
    """Wyświetlacz albo telefon administratora: Dodaj / Odrzuć oraz przełączniki "stałe uprawnienia
    administratora" i "zapamiętaj urządzenie"."""
    if (bad := json_only() or need()):
        return bad
    data = body()
    with _sec_lock:
        req = _sec["request"]
        if not req or req["id"] != data.get("request") or req["decision"] is not None:
            return jsonify(error="Ta prośba o parowanie już wygasła."), 410
        if data.get("approved") is not True:
            req["decision"] = "no"
            note_decision(req, False)
            log(f"odrzucono prośbę o parowanie: {req['name']} ({g.who.get('name') or 'wyświetlacz'})")
            return jsonify(ok=True)
        admin, remember = data.get("admin") is True, data.get("remember") is True
        did = secrets.token_urlsafe(16)
        if remember:
            with _conf_lock:
                conf = _load_conf()
                # Ta sama nazwa = to samo urządzenie parowane ponownie (np. po wyczyszczeniu przeglądarki):
                # stary wpis znika, żeby na liście nie było dwóch „Pixel 9 Pro Karol”.
                for old in [k for k, d in conf["paired"].items() if d["name"].casefold() == req["name"].casefold()]:
                    del conf["paired"][old]
                    _sec["seen"].pop(old, None)
                    log(f"ponowne parowanie: zastępuję poprzedni wpis „{req['name']}”")
                conf["paired"][did] = {"name": req["name"], "admin": admin,
                                       "added": time.strftime("%Y-%m-%d %H:%M")}
                _save_conf()
        else:
            _sec["temp"][did] = {"name": req["name"], "admin": admin, "last": time.time()}
        req.update(decision="yes", device=did, remember=remember)
        note_decision(req, True)
    log(f"sparowano: {req['name']} (" + ("administrator" if admin else "użytkownik")
        + (", zapamiętane" if remember else ", na czas wizyty") + ")")
    return jsonify(ok=True)


# ---- Urządzenia (zapamiętane)
@app.route("/api/devices")
def api_devices():
    if (bad := need()):
        return bad
    seen = _sec["seen"]
    return jsonify(devices=[
        {"id": did, "name": d["name"], "admin": d["admin"], "added": d.get("added", ""),
         "last_seen": int(seen[did]) if did in seen else None, "this_device": did == g.who.get("id")}
        for did, d in _load_conf()["paired"].items()])


@app.post("/api/devices/forget")
def api_device_forget():
    if (bad := json_only() or need()):
        return bad
    did = body().get("id")
    with _conf_lock:
        conf = _load_conf()
        dev = conf["paired"].pop(did, None)
        if dev is None:
            return jsonify(error="Nie ma takiego urządzenia"), 404
        _save_conf()
    _sec["seen"].pop(did, None)
    log(f"zapomniano urządzenie: {dev['name']}")
    return jsonify(ok=True)


@app.post("/api/devices/admin")
def api_device_admin():
    if (bad := json_only() or need()):
        return bad
    data = body()
    with _conf_lock:
        conf = _load_conf()
        dev = conf["paired"].get(data.get("id"))
        if dev is None:
            return jsonify(error="Nie ma takiego urządzenia"), 404
        dev["admin"] = data.get("admin") is True
        _save_conf()
    log(f"{dev['name']}: " + ("nadano" if dev["admin"] else "odebrano") + " uprawnienia administratora")
    return jsonify(ok=True)


@app.post("/api/devices/leave")
def api_device_leave():
    """Telefon sam odłącza się od ula (wylogowanie)."""
    if (bad := json_only() or need(admin=False, phone=True)):
        return bad
    did = g.who.get("id")
    with _conf_lock:
        conf = _load_conf()
        if conf["paired"].pop(did, None) is not None:
            _save_conf()
    _sec["temp"].pop(did, None)
    _sec["seen"].pop(did, None)
    session.clear()
    log(f"urządzenie odłączyło się od ula: {g.who.get('name')}")
    return jsonify(ok=True)


# ---- Klucz (tylko wyświetlacz)
@app.post("/api/key/create")
def api_key_create():
    """Nowy Klucz na wpiętym pendrivie – tylko gdy żadnego nie ma (inaczej najpierw "Unieważnij")."""
    if (bad := json_only() or need(display=True)):
        return bad
    if _load_conf()["admin"].get("key"):
        return jsonify(error="Klucz już istnieje. Najpierw go unieważnij albo zduplikuj."), 409
    stick = find_stick(body().get("pendrive"))
    if not stick:
        return jsonify(error="Nie widzę tego pendrive'a. Wepnij go ponownie."), 404
    secret = secrets.token_hex(32)
    try:
        write_key(stick["path"], secret)
    except OSError as e:
        return jsonify(error=f"Nie udało się zapisać Klucza: {e.strerror or e}"), 500
    set_admin_secret("key", hashlib.sha256(secret.encode()).hexdigest())
    log(f"utworzono Klucz na pendrivie {stick['name']}")
    ejected = safe_eject(stick["path"])
    scan_usb(quiet=True)
    return jsonify(ok=True, removed=ejected)


@app.post("/api/key/duplicate/start")
def api_key_dup_start():
    """Krok 1 duplikowania: wpięty Klucz zostaje sprawdzony, a jego sekret zapamiętany na 3 minuty."""
    if (bad := json_only() or need(display=True)):
        return bad
    secret = read_key_file(_usb["key_path"]) if key_present() else None
    if not key_matches(secret):
        return jsonify(error="Wepnij oryginalny Klucz."), 409
    _sec["dup"] = {"secret": secret, "until": time.time() + 180}
    return jsonify(ok=True)


@app.post("/api/key/duplicate/write")
def api_key_dup_write():
    """Krok 2: po wyjęciu oryginału zapisuje ten sam sekret na drugi pendrive (jest tylko jeden port USB)."""
    if (bad := json_only() or need(admin=False, display=True)):
        return bad
    dup = _sec["dup"]
    if not dup or time.time() > dup["until"]:
        _sec["dup"] = None
        return jsonify(error="Minął czas na duplikowanie. Zacznij od nowa z oryginalnym Kluczem."), 410
    stick = find_stick(body().get("pendrive"))
    if not stick:
        return jsonify(error="Nie widzę tego pendrive'a. Wepnij go ponownie."), 404
    if stick["key"] == "valid":
        return jsonify(error="Ten pendrive już jest Kluczem. Wepnij inny."), 409
    try:
        write_key(stick["path"], dup["secret"])
    except OSError as e:
        return jsonify(error=f"Nie udało się zapisać kopii: {e.strerror or e}"), 500
    _sec["dup"] = None
    log(f"zduplikowano Klucz na pendrive {stick['name']}")
    ejected = safe_eject(stick["path"])
    scan_usb(quiet=True)
    return jsonify(ok=True, removed=ejected)


@app.post("/api/key/duplicate/cancel")
def api_key_dup_cancel():
    if (bad := json_only() or need(admin=False, display=True)):
        return bad
    _sec["dup"] = None
    return jsonify(ok=True)


@app.post("/api/key/revoke")
def api_key_revoke():
    """Wszystkie kopie Klucza przestają działać (Klucz albo PIN). Panel zostaje odblokowany, by od razu utworzyć nowy."""
    if (bad := json_only() or need(display=True)):
        return bad
    set_admin_secret("key", None)
    scan_usb(quiet=True)
    _sec["admin_until"] = time.time() + ADMIN_IDLE
    log("Klucz unieważniony")
    return jsonify(ok=True)


def set_pin_from_console():
    """python3 app.py --set-pin – pierwszy PIN (albo zapomniany): kto ma konsolę Raspberry, ten jest właścicielem."""
    print(f"BEENest – nowy PIN administratora ({PIN_LENGTH} cyfr).")
    first = getpass.getpass("PIN: ")
    if not valid_pin(first):
        sys.exit(f"PIN musi mieć dokładnie {PIN_LENGTH} cyfr.")
    if getpass.getpass("Powtórz PIN: ") != first:
        sys.exit("PIN-y się różnią – nic nie zmieniłem.")
    set_admin_secret("pin", generate_password_hash(first))
    print("PIN zapisany w data/global.conf (tylko skrót). Działa od razu, także przy uruchomionym serwerze.")


# -------------------------------------------------------------
#  Uruchomienie
# -------------------------------------------------------------
if __name__ == "__main__":
    if "--set-pin" in sys.argv:
        set_pin_from_console()
        sys.exit(0)
    PORT = choose_port()
    # W trybie debug Flask odpala drugi proces (reloader) – wątek i rozgłaszanie nazwy startujemy
    # tylko w tym, który faktycznie obsługuje żądania.
    if not DEBUG or os.environ.get("WERKZEUG_RUN_MAIN") == "true":
        start_sampler()
        threading.Thread(target=update_boot_logo, daemon=True).start()
        threading.Thread(target=usb_loop, name="usb", daemon=True).start()
        # Po restarcie serwera strona nie pamięta uśpienia – obraz musi być włączony, inaczej dotyk
        # klikałby w ciemno. Sesja graficzna wstaje po serwerze, więc próbujemy też chwilę później.
        screen_power(True, quiet=True)
        later = threading.Timer(30, screen_power, args=(True, True))
        later.daemon = True                 # nie wstrzymuje zamknięcia serwera
        later.start()
        if NO_SECURITY:
            log("UWAGA: BEENEST_NO_SECURITY=1 – każde urządzenie jest administratorem (tylko do testów)")
        elif not pin_hash():
            log("PIN administratora nie jest ustawiony – ustaw go: python3 app.py --set-pin")
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
