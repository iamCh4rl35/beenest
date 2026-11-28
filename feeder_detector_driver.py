"""
Dokarmiaczka: poziom syropu z trzech bezdotykowych czujników cieczy XKC-Y25-V na ściance zbiornika.

  GPIO17 (pin 11) – czujnik nr 1 (dół)
  GPIO27 (pin 13) – czujnik nr 2 (środek)
  GPIO22 (pin 15) – czujnik nr 3 (góra)

Wyjście czujnika (5 V) idzie przez dzielnik 1 kΩ / 2 kΩ, więc na GPIO jest 3,3 V. Dzielnik ściąga też
pin do masy, gdy czujnik milczy; wewnętrzne ściąganie do masy (pd) dodatkowo pilnuje odłączonego przewodu.
Czarny przewód czujnika decyduje, czy wyjście jest wysokie przy cieczy, czy bez niej → LIQUID_IS_HIGH.

Czujniki widzą tylko ciecz (syrop). Ciasta / fondantu przez ściankę nie wykryją.

Data ostatniego napełnienia NIE pochodzi z czujnika: app.py sam ją wykrywa
(gdy poziom nagle wzrośnie) i zapisuje w bazie.
"""

import hardware

KEYS = ("f_level",)

SENSOR_PINS = (17, 27, 22)          # od dołu do góry
LIQUID_IS_HIGH = False              # wyjście odwrócone czarnym przewodem (2026-11-27): wysoki = brak cieczy
LEVEL_PERCENT = (15, 40, 80, 100)   # poziom w %, gdy ciecz widzi: żaden, dolny, środkowy, górny czujnik
# Słownie (strona, ustawienie „Słowny stan dokarmiaczki”): Wymaga napełnienia, Połowa zbiornika, Zapas płynu, Pełny

_ready = False


def read() -> dict:
    """
    f_level  – poziom pokarmu w zbiorniku   [%]  (15 / 40 / 80 / 100 – trzy progi, patrz LEVEL_PERCENT)
    """
    global _ready
    if hardware.DEMO:
        return {"f_level": 80.0}
    if not _ready:
        hardware.gpio_input(SENSOR_PINS, "pd")
        _ready = True
    levels = hardware.gpio_read(SENSOR_PINS)
    wet = [levels[p] == LIQUID_IS_HIGH for p in SENSOR_PINS]
    # Najwyższy czujnik, który widzi ciecz, wyznacza poziom. Gdy wyższy widzi, a niższy nie,
    # to raczej niższy jest zepsuty / źle przyklejony niż syrop wisi w powietrzu.
    highest = max((i + 1 for i, w in enumerate(wet) if w), default=0)
    return {"f_level": float(LEVEL_PERCENT[highest])}
