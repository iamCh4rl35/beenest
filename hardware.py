"""
Wspólne drobiazgi sprzętowe dla sterowników (*_driver.py): tryb demonstracyjny, GPIO, sprzętowe PWM i I2C.

Tylko biblioteka standardowa i narzędzie `pinctrl` z Raspberry Pi OS – bez nowych bibliotek (smbus2, gpiozero…).
Numery GPIO to numery BCM (jak w „łączenia czujników.txt”), nie numery pinów złącza.
Użytkownik beenest musi być w grupach gpio i i2c (jest – domyślnie w Raspberry Pi OS).
"""
import fcntl
import glob
import os
import subprocess
import time

# Dane demonstracyjne zamiast czujników: na komputerze z testami (nie ma /proc/device-tree)
# albo na życzenie: BEENEST_SENSOR_DEMO=1 python3 app.py
DEMO = os.environ.get("BEENEST_SENSOR_DEMO") == "1" or not os.path.exists("/proc/device-tree/model")


# -------------------------------------------------------------
#  GPIO (pinctrl zapisuje rejestry od razu – stan zostaje po zakończeniu polecenia)
# -------------------------------------------------------------
def _pinctrl(*args):
    return subprocess.run(["pinctrl", *map(str, args)], capture_output=True, text=True,
                          timeout=5, check=True).stdout


def gpio_input(pins, pull="pn"):
    """Ustawia piny jako wejścia. pull: pn = bez podciągania, pd = do masy, pu = do 3,3 V."""
    _pinctrl("set", ",".join(map(str, pins)), "ip", pull)


def gpio_read(pins) -> dict:
    """Stan pinów: {numer GPIO: True (wysoki) / False (niski)}. Czyta wszystkie jednym poleceniem."""
    levels = {}
    for line in _pinctrl("get", ",".join(map(str, pins))).splitlines():
        # np. „17: ip    pd | hi // GPIO17 = input”
        number, _, rest = line.partition(":")
        if "|" in rest:
            levels[int(number)] = rest.split("|")[1].split()[0] == "hi"
    return levels


def gpio_output(pin, on):
    """Wyjście: True = 3,3 V, False = 0 V."""
    _pinctrl("set", pin, "op", "dh" if on else "dl")


# -------------------------------------------------------------
#  Sprzętowe PWM (RP1, PWM0) przez /sys/class/pwm
#  Wymaga w /boot/firmware/config.txt: dtoverlay=pwm-2chan,pin=12,func=4,pin2=13,func2=4
#  GPIO12 = kanał 0 (serwo wylotka), GPIO13 = kanał 1 (buzzer)
# -------------------------------------------------------------
PWM_DEVICE = "1f00098000.pwm"      # PWM0 układu RP1 w Raspberry Pi 5


def _pwm_chip():
    chips = sorted(glob.glob("/sys/class/pwm/pwmchip*"))
    for chip in chips:
        if PWM_DEVICE in os.path.realpath(chip):
            return chip
    if chips:
        return chips[0]
    raise OSError("Brak sprzętowego PWM – dopisz do /boot/firmware/config.txt: "
                  "dtoverlay=pwm-2chan,pin=12,func=4,pin2=13,func2=4 i uruchom Raspberry ponownie")


def _write(path, value):
    with open(path, "w") as f:
        f.write(str(value))


def pwm_set(channel, period_ns, duty_ns):
    """Włącza PWM na kanale: okres i czas stanu wysokiego w nanosekundach."""
    chip = _pwm_chip()
    ch = f"{chip}/pwm{channel}"
    if not os.path.isdir(ch):
        _write(f"{chip}/export", channel)
        for _ in range(50):                  # udev nadaje prawa grupie gpio chwilę po eksporcie
            if os.access(f"{ch}/period", os.W_OK):
                break
            time.sleep(0.02)
    _write(f"{ch}/duty_cycle", 0)            # wypełnienie nie może być dłuższe niż okres – najpierw 0
    _write(f"{ch}/period", int(period_ns))
    _write(f"{ch}/duty_cycle", int(duty_ns))
    _write(f"{ch}/enable", 1)


def pwm_off(channel):
    ch = f"{_pwm_chip()}/pwm{channel}"
    if os.path.isdir(ch):
        _write(f"{ch}/enable", 0)


# -------------------------------------------------------------
#  I2C (szyna 1: piny 3 = SDA, 5 = SCL)
# -------------------------------------------------------------
I2C_BUS = "/dev/i2c-1"
_I2C_SLAVE = 0x0703                      # ioctl z linux/i2c-dev.h


class I2C:
    """Jedno urządzenie na szynie I2C. Rejestry czyta się jak w smbus: zapis adresu rejestru, potem odczyt."""

    def __init__(self, address, bus=I2C_BUS):
        self.fd = os.open(bus, os.O_RDWR)
        try:
            fcntl.ioctl(self.fd, _I2C_SLAVE, address)
        except OSError:
            os.close(self.fd)
            raise

    def read(self, register, length) -> bytes:
        os.write(self.fd, bytes([register]))
        data = os.read(self.fd, length)
        if len(data) != length:
            raise OSError(f"I2C: odczytano {len(data)} z {length} bajtów")
        return data

    def write(self, register, value):
        os.write(self.fd, bytes([register, value]))

    def close(self):
        os.close(self.fd)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
