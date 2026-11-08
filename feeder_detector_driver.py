"""
Dokarmiaczka: poziom i masa pokarmu.

TO JEST SZKIELET — na razie read() zwraca dane demonstracyjne.
Zasady: patrz atmosphere_detector_driver.py (suche liczby, None = brak odczytu).

Data ostatniego napełnienia NIE pochodzi z czujnika: app.py sam ją wykrywa
(gdy poziom nagle wzrośnie) i zapisuje w bazie.
"""
import random

KEYS = ("f_level", "f_weight")


def read() -> dict:
    """
    f_level  – poziom pokarmu w zbiorniku   [%]  (0–100)
    f_weight – masa pokarmu                 [kg]
    """
    # TODO: tu wstaw prawdziwy odczyt (np. tensometr HX711).
    return {
        "f_level":  68 + random.uniform(-0.3, 0.3),
        "f_weight": 9.4 + random.uniform(-0.05, 0.05),
    }
