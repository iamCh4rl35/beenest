"""
Wylotek: pozycja serwomechanizmu, który otwiera albo blokuje wylot ula.

TO JEST SZKIELET — na razie read() zwraca dane demonstracyjne (wylotek otwarty).
Zasady: patrz atmosphere_detector_driver.py (suche liczby, None = brak odczytu).

Tekst "Otwarty / Zablokowany / W ruchu" układa app.py z pozycji, więc tu wystarczy sama liczba.
Strona tylko pokazuje stan wylotka – sterowania serwem (otwórz / zablokuj) jeszcze nie ma.
"""

KEYS = ("o_position",)


def read() -> dict:
    """
    o_position – pozycja serwomechanizmu jako procent otwarcia wylotka   [%]
                 0 = zablokowany, 100 = całkowicie otwarty
                 (przelicz tu kąt serwa na procent, żeby reszta nie musiała znać mechaniki)
    """
    # TODO: tu wstaw prawdziwy odczyt (np. pozycja serwa z enkodera / ostatnia komenda).
    return {"o_position": 100.0}
