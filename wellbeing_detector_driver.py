"""
Samopoczucie pszczół: dominująca częstotliwość i natężenie dźwięku w ulu.

TO JEST SZKIELET — na razie read() zwraca dane demonstracyjne.
Zasady: patrz atmosphere_detector_driver.py (suche liczby, None = brak odczytu).
"""
import random

KEYS = ("w_frequency", "w_sound")


def read() -> dict:
    """
    w_frequency – dominująca częstotliwość brzęczenia   [Hz]
    w_sound     – natężenie dźwięku                     [dB]
    """
    # TODO: tu wstaw prawdziwy odczyt (mikrofon + FFT).
    return {
        "w_frequency": 250 + random.uniform(-5, 5),
        "w_sound":     41 + random.uniform(-1, 1),
    }
