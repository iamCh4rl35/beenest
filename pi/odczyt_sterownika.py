#!/usr/bin/env python3
"""Drukuje wartości ze sterownika ładowania Victron (VE.Direct, tryb tekstowy)."""
import glob
import os
import sys
import termios
import time

STAN = {0: "wyłączone", 2: "usterka", 3: "ładowanie główne", 4: "absorpcja",
        5: "podtrzymanie", 7: "wyrównywanie", 245: "uruchamianie",
        247: "automatyczne wyrównywanie", 252: "sterowanie zewnętrzne"}
MPPT = {0: "wyłączone", 1: "ograniczone", 2: "aktywne"}
POWODY = {0x1: "brak zasilania z panelu", 0x2: "wyłączony przełącznikiem",
          0x4: "wyłączony w ustawieniach", 0x8: "wejście zdalne", 0x10: "zadziałało zabezpieczenie",
          0x20: "tryb przedpłacony", 0x40: "sygnał z układu akumulatora (BMS)",
          0x80: "wykrycie wyłączenia silnika", 0x100: "sprawdzanie napięcia wejściowego"}
BLEDY = {0: "brak błędów", 2: "za wysokie napięcie akumulatora", 17: "przegrzanie sterownika",
         18: "za duży prąd", 19: "odwrócony prąd", 20: "przekroczony czas ładowania głównego",
         33: "za wysokie napięcie panelu", 34: "za duży prąd panelu"}


def liczba(v):
    return int(v, 0)


def powody(v):
    n = liczba(v)
    return ", ".join(o for bit, o in POWODY.items() if n & bit) or "brak"


# klucz: (opis, zamiana wartości na tekst)
POLA = {
    "PID": ("Kod modelu", str),
    "FW": ("Wersja oprogramowania", lambda v: f"{liczba(v.lstrip('0') or '0') / 100:.2f}"),
    "SER#": ("Numer seryjny", str),
    "V": ("Napięcie akumulatora", lambda v: f"{int(v) / 1000:.2f} V"),
    "I": ("Prąd akumulatora", lambda v: f"{int(v) / 1000:.2f} A"),
    "VPV": ("Napięcie panelu", lambda v: f"{int(v) / 1000:.2f} V"),
    "PPV": ("Moc panelu", lambda v: f"{v} W"),
    "CS": ("Stan ładowania", lambda v: STAN.get(int(v), "nieznany")),
    "MPPT": ("Śledzenie punktu mocy", lambda v: MPPT.get(int(v), "nieznane")),
    "OR": ("Powód wyłączenia", powody),
    "ERR": ("Błąd", lambda v: BLEDY.get(int(v), "nieznany")),
    "LOAD": ("Wyjście LOAD", lambda v: "włączone" if v == "ON" else "wyłączone"),
    "IL": ("Prąd wyjścia LOAD", lambda v: f"{int(v) / 1000:.2f} A"),
    "H19": ("Uzysk całkowity", lambda v: f"{int(v) / 100:.2f} kWh"),
    "H20": ("Uzysk dzisiaj", lambda v: f"{int(v) / 100:.2f} kWh"),
    "H21": ("Największa moc dzisiaj", lambda v: f"{v} W"),
    "H22": ("Uzysk wczoraj", lambda v: f"{int(v) / 100:.2f} kWh"),
    "H23": ("Największa moc wczoraj", lambda v: f"{v} W"),
    "HSDS": ("Numer dnia w historii", str),
}


def czytaj(port, sekundy=3):
    fd = os.open(port, os.O_RDONLY | os.O_NOCTTY)
    a = termios.tcgetattr(fd)
    a[0] = a[1] = a[3] = 0
    a[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
    a[4] = a[5] = termios.B19200
    a[6][termios.VMIN] = 0
    a[6][termios.VTIME] = 10
    termios.tcsetattr(fd, termios.TCSANOW, a)
    termios.tcflush(fd, termios.TCIFLUSH)
    bufor = b""
    koniec = time.time() + sekundy
    while time.time() < koniec:
        bufor += os.read(fd, 4096)
    os.close(fd)
    return bufor


def main():
    porty = glob.glob("/dev/serial/by-id/usb-VictronEnergy*")
    if not porty:
        sys.exit("Nie widzę kabla VE.Direct w porcie USB.")
    wartosci = {}
    # pierwszy i ostatni kawałek mogą być urwane w połowie
    for linia in czytaj(porty[0]).split(b"\r\n")[1:-1]:
        klucz, tab, wartosc = linia.decode("latin-1").partition("\t")
        if tab and klucz in POLA:
            wartosci[klucz] = wartosc
    if not wartosci:
        sys.exit("Sterownik milczy – sprawdź akumulator i wtyczkę VE.Direct.")
    for klucz, (opis, tekst) in POLA.items():
        if klucz not in wartosci:
            continue
        surowo = wartosci[klucz]
        try:
            wynik = tekst(surowo)
        except ValueError:
            wynik = "?"
        print(f"{klucz:<6}{surowo:<14}{opis + ':':<26}{wynik}")


if __name__ == "__main__":
    main()
