"""
Czujniki atmosfery: temperatura, wilgotność i ciśnienie (w ulu i na zewnątrz).

TO JEST SZKIELET — nie ma tu jeszcze prawdziwego odczytu z czujników.
Na razie read() zwraca dane demonstracyjne, żeby strona miała co wyświetlać.
Kiedy podepniesz czujniki, podmień ciało read() — reszta aplikacji się nie zmienia.

Zasady (takie same we wszystkich *_detector_driver.py):
  * read() zwraca słownik z samymi liczbami (float), bez tekstów i jednostek,
  * brak odczytu = None (albo po prostu wyjątek — app.py sobie z nim poradzi),
  * KEYS wymienia wszystkie klucze, które read() zwraca.
"""
import random

KEYS = ("temp_current", "temp_outside", "temp_humidity", "temp_pressure")


def read() -> dict:
    """
    temp_current  – temperatura w ulu          [°C]
    temp_outside  – temperatura na zewnątrz    [°C]
    temp_humidity – wilgotność w ulu           [%]
    temp_pressure – ciśnienie atmosferyczne    [hPa]
    """
    # TODO: tu wstaw prawdziwy odczyt (np. dwa BME280 po I2C).
    return {
        "temp_current":  34.2 + random.uniform(-0.3, 0.3),
        "temp_outside":  12.8 + random.uniform(-0.3, 0.3),
        "temp_humidity": 61 + random.uniform(-1, 1),
        "temp_pressure": 1013 + random.uniform(-1, 1),
    }
