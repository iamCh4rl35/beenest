"""
Naświetlacze podczerwieni (2 × 3 W) przy kamerze wewnętrznej – włączane MOSFET-em po stronie masy.

  GPIO23 (pin 16) – 100 Ω – bramka MOSFET-a (bramka – 10 kΩ – GND)

Razem biorą około 6 W (tyle co całe Raspberry), więc świecą tylko wtedy, gdy działa kamera wewnętrzna
(camera_detector_driver.py włącza je przy starcie kamery i gasi przy jej wyłączeniu).
"""
import hardware

PIN = 23
CAMERA = "internal"     # przy której kamerze są naświetlacze


def set_on(on):
    if not hardware.DEMO:
        hardware.gpio_output(PIN, bool(on))
