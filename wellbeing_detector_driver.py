"""
Samopoczucie pszczół: dominująca częstotliwość i natężenie dźwięku w ulu.

TO JEST SZKIELET — na razie read() zwraca dane demonstracyjne.
Zasady: patrz atmosphere_detector_driver.py (suche liczby, None = brak odczytu).
"""
import random

KEYS = ("w_frequency", "w_sound")

# Progi oceny "Stan rodziny" (Hz / dB). Używa ich app.py do wyliczenia stanu,
# a wykres w zakładce Samopoczucie rysuje na ich granicach delikatne poziome linie.
WELLBEING_OK_HZ = (80, 185)          # Dobre
WELLBEING_SENSITIVE_HZ = (185, 250)  # Niespokojne
WELLBEING_UPLIFTET_HZ = (250, 300)   # Wściekłe
WELLBEING_MAX_DB = 70


def read() -> dict:
    """
    w_frequency – dominująca częstotliwość brzęczenia   [Hz]
    w_sound     – natężenie dźwięku                     [dB]
    """
    # TODO: tu wstaw prawdziwy odczyt (mikrofon + FFT).
    return {
        "w_frequency": 100 + random.uniform(-5, 5),
        "w_sound":     41 + random.uniform(-1, 1),
    }
