"""
Kamery (zewnętrzna / wewnętrzna): jakość sygnału i wiek ostatniej klatki.

TO JEST SZKIELET — na razie read() zwraca dane demonstracyjne.
Zasady: patrz atmosphere_detector_driver.py (suche liczby, None = brak odczytu).
Sam obraz wideo nie jest tu obsługiwany — to tylko dane do kafelków.
"""
import random

KEYS = ("m_signal", "m_updated")
CAMERAS = ("external", "internal")


def read(camera: str = "external") -> dict:
    """
    camera – "external" albo "internal"

    m_signal  – jakość sygnału                       [%]
    m_updated – ile sekund temu przyszła ostatnia klatka   [s]
    """
    # TODO: tu wstaw prawdziwy odczyt (np. czas ostatniej klatki ze strumienia).
    return {
        "m_signal":  94 + random.uniform(-2, 2) if camera == "external" else 88 + random.uniform(-2, 2),
        "m_updated": random.uniform(0.5, 3),
    }
