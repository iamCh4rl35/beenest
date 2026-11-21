"""
Czujniki atmosfery: temperatura, wilgotność i ciśnienie – dwa BME280 na wspólnej szynie I2C.

  w ulu:        adres 0x76 (SDO do GND)
  na zewnątrz:  adres 0x77 (SDO do 3V3)

Odczyt bez dodatkowych bibliotek (hardware.I2C + wzory kompensacji z dokumentacji Boscha, rozdz. 8.1).
Tryb „forced”: każdy odczyt robi jeden pomiar, potem czujnik śpi – mniej prądu i bez nagrzewania się.
Płytka z BMP280 (bez wilgotności, identyfikator 0x58) też zadziała – wilgotność będzie pusta.

Zasady (takie same we wszystkich *_detector_driver.py):
  * read() zwraca słownik z samymi liczbami (float), bez tekstów i jednostek,
  * brak odczytu = None (albo wyjątek – app.py sobie z nim poradzi),
  * KEYS wymienia wszystkie klucze, które read() zwraca.
"""
import random
import struct
import time

import hardware

ADDRESS_INSIDE = 0x76
ADDRESS_OUTSIDE = 0x77
KEYS = ("temp_current", "temp_outside",
        "temp_humidity", "temp_outside_humidity",
        "temp_pressure", "temp_outside_pressure")

CHIP_BME280, CHIP_BMP280 = 0x60, 0x58
_calibration = {}            # adres -> współczynniki z pamięci czujnika (czytane raz)


def _load_calibration(dev, chip):
    t1, t2, t3, p1, p2, p3, p4, p5, p6, p7, p8, p9 = struct.unpack("<HhhHhhhhhhhh", dev.read(0x88, 24))
    cal = {"T": (t1, t2, t3), "P": (p1, p2, p3, p4, p5, p6, p7, p8, p9), "H": None}
    if chip == CHIP_BME280:
        h1 = dev.read(0xA1, 1)[0]
        e = dev.read(0xE1, 7)
        h2 = struct.unpack("<h", e[0:2])[0]
        h3 = e[2]
        h4 = (e[3] << 4) | (e[4] & 0x0F)
        h5 = (e[5] << 4) | (e[4] >> 4)
        h4 -= 4096 if h4 > 2047 else 0          # liczby 12-bitowe ze znakiem
        h5 -= 4096 if h5 > 2047 else 0
        h6 = struct.unpack("<b", e[6:7])[0]
        cal["H"] = (h1, h2, h3, h4, h5, h6)
    return cal


def _read_sensor(address):
    """(temperatura °C, wilgotność %, ciśnienie hPa) z jednego czujnika."""
    with hardware.I2C(address) as dev:
        chip = dev.read(0xD0, 1)[0]
        if chip not in (CHIP_BME280, CHIP_BMP280):
            raise OSError(f"pod adresem 0x{address:02X} nie ma BME280 (identyfikator 0x{chip:02X})")
        if address not in _calibration:
            _calibration[address] = _load_calibration(dev, chip)
        cal = _calibration[address]

        if chip == CHIP_BME280:
            dev.write(0xF2, 0x01)                   # wilgotność ×1 (musi być przed 0xF4)
        dev.write(0xF5, 0x00)                       # bez filtra
        dev.write(0xF4, 0x25)                       # temperatura ×1, ciśnienie ×1, tryb forced = jeden pomiar
        for _ in range(20):                         # pomiar trwa około 10 ms
            time.sleep(0.005)
            if not dev.read(0xF3, 1)[0] & 0x08:
                break
        d = dev.read(0xF7, 8)

    adc_p = (d[0] << 12) | (d[1] << 4) | (d[2] >> 4)
    adc_t = (d[3] << 12) | (d[4] << 4) | (d[5] >> 4)
    adc_h = (d[6] << 8) | d[7]

    t1, t2, t3 = cal["T"]
    v1 = (adc_t / 16384.0 - t1 / 1024.0) * t2
    v2 = (adc_t / 131072.0 - t1 / 8192.0) ** 2 * t3
    t_fine = v1 + v2
    temperature = t_fine / 5120.0

    p1, p2, p3, p4, p5, p6, p7, p8, p9 = cal["P"]
    v1 = t_fine / 2.0 - 64000.0
    v2 = v1 * v1 * p6 / 32768.0 + v1 * p5 * 2.0
    v2 = v2 / 4.0 + p4 * 65536.0
    v1 = (p3 * v1 * v1 / 524288.0 + p2 * v1) / 524288.0
    v1 = (1.0 + v1 / 32768.0) * p1
    pressure = None
    if v1:
        p = (1048576.0 - adc_p - v2 / 4096.0) * 6250.0 / v1
        p += (p9 * p * p / 2147483648.0 + p * p8 / 32768.0 + p7) / 16.0
        pressure = p / 100.0                        # Pa -> hPa (ciśnienie w miejscu ula, nie „nad poziomem morza”)

    humidity = None
    if cal["H"]:
        h1, h2, h3, h4, h5, h6 = cal["H"]
        h = t_fine - 76800.0
        h = (adc_h - (h4 * 64.0 + h5 / 16384.0 * h)) * \
            (h2 / 65536.0 * (1.0 + h6 / 67108864.0 * h * (1.0 + h3 / 67108864.0 * h)))
        h *= 1.0 - h1 * h / 524288.0
        humidity = min(100.0, max(0.0, h))
    return temperature, humidity, pressure


def read() -> dict:
    if hardware.DEMO:
        return {
            "temp_current": 34.5 + random.uniform(-0.3, 0.3),
            "temp_humidity": 62 + random.uniform(-1, 1),
            "temp_pressure": 1012 + random.uniform(-1, 1),
            "temp_outside": 12.8 + random.uniform(-0.3, 0.3),
            "temp_outside_humidity": 78 + random.uniform(-1, 1),
            "temp_outside_pressure": 1012 + random.uniform(-1, 1),
        }
    result, errors = {k: None for k in KEYS}, []
    for address, keys in ((ADDRESS_INSIDE, ("temp_current", "temp_humidity", "temp_pressure")),
                          (ADDRESS_OUTSIDE, ("temp_outside", "temp_outside_humidity", "temp_outside_pressure"))):
        try:
            result.update(zip(keys, _read_sensor(address)))
        except OSError as e:
            _calibration.pop(address, None)         # po wymianie czujnika wczytaj współczynniki od nowa
            errors.append(f"0x{address:02X}: {e}")
    if len(errors) == 2:                            # oba milczą – niech app.py to zgłosi w konsoli
        raise OSError("; ".join(errors))
    return result
