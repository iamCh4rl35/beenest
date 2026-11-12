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
import smbus2
import bme280


ADDRESS = 0x76   # zmień na 0x77, jeśli i2cdetect pokazał 77
KEYS = ("temp_current", "temp_outside", "temp_humidity", "temp_pressure")


def read() -> dict:
    
    bus = smbus2.SMBus(1)
    calibration = bme280.load_calibration_params(bus, ADDRESS)
    d = bme280.sample(bus, ADDRESS, calibration)
    # TODO: tu wstaw prawdziwy odczyt (np. dwa BME280 po I2C).
    return {
        "temp_current":  d.temperature,
        "temp_outside":  12.8 + random.uniform(-0.3, 0.3),
        "temp_humidity": d.humidity,
        "temp_pressure": d.pressure,
    }
