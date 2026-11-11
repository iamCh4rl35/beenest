"""
Kamera:

CAM0 - zewnątrz

CAM1 - wewnątrz
"""
import base64
import io
import os
import threading
import time
from collections import deque

KEYS = ("m_signal", "m_updated")
CAMERAS = ("external", "internal")

# ---- ustawienia (do zmiany) ------------------------------------------------------------------
# Numer kamery w libcamera. Przy obu kamerach: CAM0 -> 0, CAM1 -> 1. Jeśli podgląd jest
# zamieniony, zamień liczby miejscami. Przy JEDNEJ podłączonej kamerze libcamera zawsze
# nazywa ją 0, więc pokaże się jako "zewnętrzna" bez względu na złącze.
CAMERA_NUM = {"external": 0, "internal": 1}
FRAME_SIZE = (1280, 720)      # rozmiar obrazu w podglądzie
FPS = 25                     # klatek na sekundę (mniej = lżejsza transmisja po Wi-Fi)
IDLE_STOP_S = 10              # po tylu sekundach bez widzów kamera się wyłącza
SIGNAL_WINDOW_S = 5           # z ilu ostatnich sekund liczona jest jakość sygnału
FRAME_TIMEOUT_S = 5           # tyle czekamy na klatkę, potem uznajemy, że kamera stanęła
DEMO = os.environ.get("BEENEST_CAMERA_DEMO") == "1"

# Mała szara klatka dla trybu demo (16x9 px, JPEG).
_DEMO_JPEG = base64.b64decode(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxO"
    "UlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09P"
    "T09PT09PT09PT09PT0//wAARCAAJABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgED"
    "AwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdI"
    "SUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW"
    "19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQA"
    "AQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldY"
    "WVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk"
    "5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDiaKKKYH//2Q=="
)


class _Sink(io.BufferedIOBase):
    """Odbiera gotowe klatki JPEG od kodera Picamera2 (tak robi oficjalny przykład mjpeg_server)."""

    def __init__(self, callback):
        self._callback = callback

    def write(self, buf):
        self._callback(bytes(buf))
        return len(buf)


class _Camera:
    """Jedna kamera: start/stop na żądanie, ostatnia klatka i statystyki dostarczania klatek."""

    def __init__(self, name):
        self.name = name
        self._lock = threading.Lock()          # start/stop i licznik widzów
        self._cond = threading.Condition()     # nowa klatka -> budzi widzów
        self._viewers = 0
        self._timer = None                     # odliczanie do wyłączenia po ostatnim widzu
        self._cam = None                       # obiekt Picamera2 (albo wątek demo), gdy działa
        self._stop_demo = threading.Event()
        self._frame = None
        self._seq = 0                          # numer ostatniej klatki (rośnie z każdą nową)
        self._times = deque()                  # kiedy przyszły ostatnie klatki (monotonic)
        self._started = 0.0

    # ---- klatki ----
    def _on_frame(self, jpeg):
        now = time.monotonic()
        with self._cond:
            self._frame = jpeg
            self._seq += 1
            self._times.append(now)
            while self._times and now - self._times[0] > SIGNAL_WINDOW_S:
                self._times.popleft()
            self._cond.notify_all()

    def wait_frame(self, last_seq, timeout):
        """Czeka na klatkę nowszą niż numer 'last_seq'. Zwraca (numer, jpeg) albo None po 'timeout'."""
        with self._cond:
            ok = self._cond.wait_for(lambda: self._frame is not None and self._seq != last_seq, timeout)
            return (self._seq, self._frame) if ok else None

    def stats(self):
        now = time.monotonic()
        with self._cond:
            if not self._times:
                return {"m_signal": None, "m_updated": None}
            age = now - self._times[-1]
            recent = sum(1 for t in self._times if now - t <= SIGNAL_WINDOW_S)
            span = min(SIGNAL_WINDOW_S, now - self._started)
        # Jakość sygnału = ile klatek przyszło w stosunku do tego, ile powinno przy zadanym FPS.
        signal = None if span < 1 else min(100.0, 100.0 * recent / (FPS * span))
        return {"m_signal": signal, "m_updated": age}

    # ---- włączanie i wyłączanie (zawsze pod self._lock) ----
    def _start(self):
        self._started = time.monotonic()
        if DEMO:
            self._stop_demo.clear()
            threading.Thread(target=self._demo_loop, daemon=True).start()
            self._cam = "demo"
            return
        from picamera2 import Picamera2                       # import dopiero tu: aplikacja startuje
        from picamera2.encoders import MJPEGEncoder           # także na komputerze bez Picamera2
        from picamera2.outputs import FileOutput

        cam = Picamera2(CAMERA_NUM[self.name])
        try:
            cam.configure(cam.create_video_configuration(
                main={"size": FRAME_SIZE}, controls={"FrameRate": FPS}))
            cam.start_recording(MJPEGEncoder(), FileOutput(_Sink(self._on_frame)))
            try:                                              # Camera Module 3 ma autofokus
                from libcamera import controls
                cam.set_controls({"AfMode": controls.AfModeEnum.Continuous})
            except Exception:
                pass                                          # kamera bez autofokusu – bez problemu
        except Exception:
            try:
                cam.close()
            finally:
                self._cam = None
            raise
        self._cam = cam

    def _stop(self):
        cam, self._cam = self._cam, None
        if cam == "demo":
            self._stop_demo.set()
        elif cam is not None:
            for action in (cam.stop_recording, cam.close):
                try:
                    action()
                except Exception:
                    pass
        with self._cond:
            self._frame = None
            self._times.clear()

    def _demo_loop(self):
        while not self._stop_demo.wait(1 / FPS):
            self._on_frame(_DEMO_JPEG)

    # ---- widzowie ----
    def acquire(self):
        """Zgłasza widza i w razie potrzeby włącza kamerę. Wyjątek = kamera niedostępna."""
        with self._lock:
            if self._timer:
                self._timer.cancel()
                self._timer = None
            if self._cam is None:
                self._start()
            self._viewers += 1

    def release(self):
        with self._lock:
            self._viewers = max(0, self._viewers - 1)
            if self._viewers == 0 and self._cam is not None:
                self._timer = threading.Timer(IDLE_STOP_S, self._stop_if_idle)
                self._timer.daemon = True
                self._timer.start()

    def _stop_if_idle(self):
        with self._lock:
            if self._viewers == 0:
                self._stop()


class _Stream:
    """Iterator kolejnych klatek JPEG. close() zwalnia kamerę (wołane też przez serwer WWW)."""

    def __init__(self, cam):
        self._cam, self._last_seq, self._closed = cam, None, False

    def __iter__(self):
        return self

    def __next__(self):
        if self._closed:
            raise StopIteration
        got = self._cam.wait_frame(self._last_seq, FRAME_TIMEOUT_S)
        if got is None:                        # kamera stanęła – kończymy strumień, strona go ponowi
            self.close()
            raise StopIteration
        self._last_seq, frame = got
        return frame

    def close(self):
        if not self._closed:
            self._closed = True
            self._cam.release()

    def __del__(self):
        self.close()


_cameras = {name: _Camera(name) for name in CAMERAS}


def read(camera: str = "external") -> dict:
    """
    camera – "external" albo "internal"

    m_signal  – jakość sygnału = dostarczone klatki / oczekiwane przy zadanym FPS   [%]
    m_updated – ile sekund temu przyszła ostatnia klatka                           [s]
    None, gdy kamera nie działa (nikt nie ogląda podglądu) albo jej nie ma.
    Nie włącza kamery.
    """
    return _cameras[camera].stats()


def frames(camera: str = "external"):
    """
    Podgląd na żywo: iterator klatek JPEG (bytes). Włącza kamerę; po zamknięciu iteratora
    (close) i IDLE_STOP_S sekundach bez innych widzów kamera się wyłącza.
    Gdy kamery nie da się uruchomić (brak, zajęta, brak Picamera2) – rzuca wyjątek od razu.
    """
    cam = _cameras[camera]
    cam.acquire()
    return _Stream(cam)


if __name__ == "__main__":
    # Samotest sprzętu:  python3 camera_detector_driver.py
    # Pokazuje wykryte kamery, próbuje uruchomić każdą i zapisuje po jednym zdjęciu (kamera_*.jpg).
    try:
        from picamera2 import Picamera2
        print("Wykryte kamery (Num = numer do CAMERA_NUM):")
        for c in Picamera2.global_camera_info():
            print(f"  Num={c.get('Num')}  model={c.get('Model')}  id={c.get('Id')}")
    except Exception as e:
        print("Picamera2 niedostępne:", e)
    for name in CAMERAS:
        print(f"\n[{name}] kamera numer {CAMERA_NUM[name]}")
        try:
            stream = frames(name)
        except Exception as e:
            print("  NIE DZIAŁA:", e)
            continue
        try:
            first = None
            for i, jpeg in enumerate(stream):
                first = first or jpeg
                if i >= FPS * 2:                       # ~2 s klatek, żeby statystyki się ustabilizowały
                    break
            print("  odczyt:", read(name))
            if first:
                path = f"kamera_{name}.jpg"
                with open(path, "wb") as f:
                    f.write(first)
                print("  zapisano zdjęcie:", path)
            else:
                print("  brak klatek")
        finally:
            stream.close()