"""
BEENest — serwer Flask dla Raspberry Pi.

Pliki projektu:
    app.py                    <- ten plik
    main.html                 <- strona (w katalogu głównym, nie w templates/)
    static/app.js, style.css
    *_detector_driver.py      <- po jednym na czujnik, każdy ma read() -> słownik liczb
    data/beenest.db           <- powstaje sam (historia pomiarów + ustawienia zapisane na urządzeniu)

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
from flask import Flask, jsonify, render_template, request
from werkzeug.serving import WSGIRequestHandler

import atmosphere_detector_driver as atmosphere
import camera_detector_driver as camera
import feeder_detector_driver as feeder
import outlet_detector_driver as outlet
import wellbeing_detector_driver as wellbeing

# -------------------------------------------------------------
#  Konfiguracja
# -------------------------------------------------------------
ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(ROOT, "data", "beenest.db")
DEBUG = os.environ.get("BEENEST_DEBUG") == "1"
# Port 80 pozwala wejść na samo http://beenest.local. Jeśli jest zajęty albo brak uprawnień
# (zwykły użytkownik na Linuksie), serwer użyje 8000. Własny port: BEENEST_PORT=8080 python3 app.py
PORTS = (int(os.environ["BEENEST_PORT"]),) if os.environ.get("BEENEST_PORT") else ((8000,) if DEBUG else (80, 8000))
PORT = PORTS[0]             # po starcie: port, na którym serwer naprawdę działa
MDNS_NAME = "beenest"       # adres w sieci lokalnej: http://beenest.local

SAMPLE_EVERY = 5            # s    – jak często czytamy czujniki
CAMERA_OFFLINE_AFTER = 10   # s    – brak klatki dłużej niż tyle = kamera offline
REFILL_JUMP = 10            # pkt% – o tyle musi wzrosnąć poziom, by uznać napełnienie
REFILL_COOLDOWN = 60        # s    – kolejne napełnienie liczymy najwcześniej po tylu sekundach

# Progi oceny "Stan rodziny" – WARTOŚCI ORIENTACYJNE, skalibruj na własnym ulu.
WELLBEING_OK_HZ = (180, 350)
WELLBEING_MAX_DB = 70

# Wylotek: pozycja serwa w %. Poniżej/powyżej progów = zablokowany/otwarty, pomiędzy = w ruchu.
OUTLET_BLOCKED_BELOW = 5
OUTLET_OPEN_ABOVE = 95

SENSORS = (atmosphere, wellbeing, feeder, outlet)

# Co trafia do historii. Dane dokarmiaczki tylko, gdy włączone "Zapisuj tempo rozładowania".
HISTORY_KEYS = ("temp_current", "temp_outside", "temp_humidity", "temp_pressure",
                "w_frequency", "w_sound")
FEEDER_HISTORY_KEYS = ("f_level", "f_weight")

# Ustawienia z panelu, które dotyczą Raspberry (reszta – wygląd, alarm – żyje w przeglądarce).
# klucz: (wartość domyślna, dozwolone wartości; None = tak/nie)
SERVER_SETTINGS = {
    "saveInterval":  ("60", {"1", "5", "10", "30", "60", "180"}),   # minuty
    "dataRetention": ("12", {"1", "3", "6", "12", "24"}),           # miesiące
    "feederRate":    (True, None),
}

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


def get_server_settings():
    saved = kv_get("settings", {})
    return {k: saved.get(k, default) for k, (default, _) in SERVER_SETTINGS.items()}


def set_server_settings(changes):
    """Sprawdza wszystko, zanim cokolwiek zapisze. Błąd -> ValueError."""
    if not isinstance(changes, dict):
        raise ValueError("Oczekiwano obiektu JSON")
    clean = {}
    for key, value in changes.items():
        if key not in SERVER_SETTINGS:
            raise ValueError(f"Nieznane ustawienie: {key}")
        _, allowed = SERVER_SETTINGS[key]
        if allowed is None:
            if not isinstance(value, bool):
                raise ValueError(f"{key}: oczekiwano true/false")
        else:
            value = str(value)
            if value not in allowed:
                raise ValueError(f"{key}: niedozwolona wartość {value}")
        clean[key] = value
    kv_set("settings", {**get_server_settings(), **clean})


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
    if frequency is None and sound is None:
        return "Brak danych"
    lo, hi = WELLBEING_OK_HZ
    if frequency is not None and not lo <= frequency <= hi:
        return "Niespokojne"
    if sound is not None and sound > WELLBEING_MAX_DB:
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


def build_payload(raw, now):
    p = dict(raw)
    p["temp_min"], p["temp_max"] = day_range("temp_current", raw["temp_current"], now)
    p["temp_outside_min"], p["temp_outside_max"] = day_range("temp_outside", raw["temp_outside"], now)
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
    return render_template("main.html")


@app.route("/api/data")
def api_data():
    """JSON odpytywany co 5 s przez przeglądarkę. ?camera=external|internal"""
    cam = request.args.get("camera")
    if cam not in camera.CAMERAS:
        cam = camera.CAMERAS[0]
    return jsonify({**get_latest(), **camera_info(cam), **disk_info()})


@app.route("/api/settings", methods=["GET", "POST"])
def api_settings():
    if request.method == "POST":
        if (bad := json_only()):
            return bad
        try:
            set_server_settings(request.get_json(silent=True))
        except ValueError as e:
            return jsonify(error=str(e)), 400
    return jsonify(get_server_settings())


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


@app.post("/api/system/update")
def api_update():
    """git pull; jeśli przyszły zmiany -> restart (tak jak ręczne 'git pull && reboot now')."""
    if (bad := json_only()):
        return bad
    try:
        before = run_system_command(["git", "rev-parse", "HEAD"]).stdout.strip()
        run_system_command(["git", "pull", "--ff-only"], timeout=120)
        after = run_system_command(["git", "rev-parse", "HEAD"]).stdout.strip()
    except Exception as e:
        return jsonify(error=error_text(e)), 500
    if before == after:
        return jsonify(updated=False)
    try:
        power("reboot")
    except Exception as e:
        return jsonify(updated=True, error="Pobrano aktualizację, ale restart się nie udał: "
                       + error_text(e)), 500
    return jsonify(updated=True)


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
