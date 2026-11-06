from flask import Flask, jsonify, render_template
import datetime

app = Flask(__name__)


def read_sensors() -> dict:
    """
    Zwraca słownik z aktualnymi danymi.

    KLUCZE muszą odpowiadać tym, które obsługuje JS w `BEENest.data()`:
      temp_current, temp_outside, temp_humidity,
      temp_min, temp_max,
      w_status, w_activity, w_sound, w_weight, w_updated,
      f_level, f_weight, f_last,
      m_status, m_signal, m_updated

    W tej chwili zwracam dane demonstracyjne — podmień na prawdziwe.
    """
    return {
        # Temperatury
        "temp_current":   "34.2",
        "temp_outside":   "12.8",
        "temp_humidity":  "61",
        "temp_min":       "31.1",
        "temp_max":       "35.4",

        # Samopoczucie / waga
        "w_status":       "Dobre",
        "w_activity":     "72",
        "w_sound":        "41",
        "w_weight":       "48.6",
        "w_updated":      datetime.datetime.now().strftime("%H:%M:%S"),

        # Dokarmiaczka
        "f_level":        "68",
        "f_weight":       "9.4",
        "f_last":         "2026-11-03",

        # Kamera
        "m_status":       "Online",
        "m_signal":       "94",
        "m_updated":      "5 s temu",
    }


# -------------------------------------------------------------
#  Routing
# -------------------------------------------------------------
@app.route("/")
def index():
    """Serwuje główny plik HTML (SPA z routingiem po #hashtagu)."""
    return render_template("main.html")


@app.route("/api/data")
def api_data():
    """Endpoint JSON odpytywany co 5 s przez przeglądarkę."""
    return jsonify(read_sensors())


# -------------------------------------------------------------
#  Uruchomienie
# -------------------------------------------------------------
if __name__ == "__main__":
    # host="0.0.0.0" → nasłuchuj na wszystkich interfejsach sieciowych,
    #                  czyli także na adresie LAN Raspberry Pi.
    # debug=True     → auto-reload przy edycji plików (tylko do developmentu!)
    app.run(host="0.0.0.0", port=5000, debug=True)