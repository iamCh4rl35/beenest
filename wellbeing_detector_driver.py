"""
Samopoczucie pszczół: dominująca częstotliwość i natężenie dźwięku w ulu – mikrofon ICS43434 (I2S).

  SCK – GPIO18 (pin 12), WS – GPIO19 (pin 35), SD – GPIO20 (pin 38), L/R do GND = lewy kanał

Wymaga w /boot/firmware/config.txt: dtoverlay=adau7002-simple (zwykła karta dźwiękowa „adau7002” w ALSA;
sprawdzenie: arecord -l). Nagrywanie przez arecord (alsa-utils jest w systemie), analiza w czystym Pythonie:
  * natężenie – wartość skuteczna sygnału w dBFS + DB_OFFSET (ICS43434: −26 dBFS przy 94 dB SPL → 120),
  * częstotliwość – szczyt widma (FFT z oknem Hanna) w zakresie FREQ_RANGE.
Jeden odczyt nagrywa RECORD_SECONDS sekund (wątek czujników czeka ten czas).
"""
import array
import cmath
import math
import random
import re
import subprocess

import hardware

KEYS = ("w_frequency", "w_sound")

# Progi oceny "Stan rodziny" (Hz / dB). Używa ich app.py do wyliczenia stanu,
# a wykres w zakładce Samopoczucie rysuje na ich granicach delikatne poziome linie.
WELLBEING_OK_HZ = (80, 185)          # Dobre
WELLBEING_SENSITIVE_HZ = (185, 250)  # Niespokojne
WELLBEING_UPLIFTET_HZ = (250, 300)   # Wściekłe
WELLBEING_MAX_DB = 70

ALSA_DEVICE = None          # None = pierwsza karta z wejściem (mikrofon jest jedyną); można wpisać np. "plughw:CARD=adau7002"
RATE = 48000                # próbkowanie mikrofonu
DECIMATE = 6                # do analizy widma: 48 000 / 6 = 8000 próbek na sekundę (pasmo do 4 kHz)
RECORD_SECONDS = 1
FREQ_RANGE = (50, 1000)     # Hz – w tym zakresie szukamy brzęczenia
DB_OFFSET = 120             # dBFS -> dB SPL dla ICS43434
MIC_CHANNEL = 0             # 0 = lewy (L/R do GND), 1 = prawy (L/R do 3V3)


def _capture_device():
    if ALSA_DEVICE:
        return ALSA_DEVICE
    try:
        with open("/proc/asound/pcm", encoding="ascii", errors="replace") as f:
            for line in f:                     # np. „01-00: adau7002 ... : capture 1”
                m = re.match(r"(\d+)-(\d+):.*capture", line)
                if m:
                    return f"plughw:{int(m[1])},{int(m[2])}"
    except OSError:
        pass
    raise OSError("Brak mikrofonu w ALSA – dopisz do /boot/firmware/config.txt: dtoverlay=adau7002-simple")


def _fft(x):
    """Szybka transformata Fouriera (radix-2, długość = potęga 2)."""
    n = len(x)
    x = list(x)
    j = 0
    for i in range(1, n):                      # przestawienie bitowe
        bit = n >> 1
        while j & bit:
            j ^= bit
            bit >>= 1
        j |= bit
        if i < j:
            x[i], x[j] = x[j], x[i]
    size = 2
    while size <= n:
        step = cmath.exp(-2j * math.pi / size)
        half = size // 2
        for start in range(0, n, size):
            w = 1
            for k in range(start, start + half):
                t = w * x[k + half]
                x[k + half] = x[k] - t
                x[k] += t
                w *= step
        size *= 2
    return x


def read() -> dict:
    """
    w_frequency – dominująca częstotliwość brzęczenia   [Hz]
    w_sound     – natężenie dźwięku                     [dB]
    """
    if hardware.DEMO:
        return {"w_frequency": 100 + random.uniform(-5, 5), "w_sound": 41 + random.uniform(-1, 1)}

    raw = subprocess.run(
        ["arecord", "-q", "-D", _capture_device(), "-f", "S32_LE", "-c", "2", "-r", str(RATE),
         "-d", str(RECORD_SECONDS), "-t", "raw"],
        capture_output=True, timeout=RECORD_SECONDS + 10, check=True).stdout
    frames = array.array("i", raw[:len(raw) // 8 * 8])
    if len(frames) < RATE:                      # mniej niż pół sekundy dźwięku (2 kanały)
        raise OSError(f"arecord zwrócił za mało danych ({len(raw)} B)")
    signal = [v / 2147483648.0 for v in frames[MIC_CHANNEL::2]]
    mean = sum(signal) / len(signal)
    signal = [v - mean for v in signal]         # bez składowej stałej

    rms = math.sqrt(sum(v * v for v in signal) / len(signal))
    sound = 20 * math.log10(rms) + DB_OFFSET if rms > 0 else None

    # Średnia z DECIMATE próbek = prosty filtr dolnoprzepustowy i 8000 próbek/s – FFT w Pythonie jest wtedy szybka
    low = [sum(signal[i:i + DECIMATE]) / DECIMATE for i in range(0, len(signal) - DECIMATE + 1, DECIMATE)]
    rate = RATE / DECIMATE
    n = 1 << (len(low) - 1).bit_length()       # dopełnienie zerami do potęgi 2
    count = len(low)
    windowed = [v * (0.5 - 0.5 * math.cos(2 * math.pi * i / (count - 1))) for i, v in enumerate(low)]
    spectrum = _fft(windowed + [0.0] * (n - count))
    lo, hi = int(FREQ_RANGE[0] * n / rate), int(FREQ_RANGE[1] * n / rate)
    peak = max(range(lo, hi + 1), key=lambda k: abs(spectrum[k]))
    frequency = peak * rate / n if abs(spectrum[peak]) > 0 else None
    return {"w_frequency": frequency, "w_sound": sound}
