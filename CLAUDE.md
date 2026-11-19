# BEENest — notatki dla Claude

Inteligentny ul: serwer Flask + jednostronicowa strona (HTML/CSS/JS bez frameworków) sterująca ulem
na Raspberry Pi 5. Pi wystawia własny hotspot Wi-Fi, a telefon otwiera panel w przeglądarce.

## Zasady pracy (od użytkownika)

* **Odpowiadaj po polsku.** Komentarze i teksty interfejsu też po polsku.
* **Aktualizuj ten plik na żywo**. Zawieraj w nim rzeczy które mogą być przydatne dla ciebie i po przeniesienie.`
* **Prostota jest najważniejsza.** Bez frameworków, bundlerów, nowych bibliotek, gdy da się bez nich.
Zależności to tylko `flask` i `zeroconf` (`requirements.txt`).
* **Nie używaj skrótów, których użytkownik użył w prompcie** (na przykład „Temp.”, „Wilg.”, „Ciś.”,
„mies.”, „np.”), chyba że treść prompta każe inaczej. W interfejsie pisz pełne słowa.
* **Zmieniaj tylko to, o co proszono.** Gdy coś obok wygląda na błąd, zgłoś to, ale nie poprawiaj sam.
* Użytkownik często sam przenosi zmiany do swoich plików. Gdy prosi o „które linijki gdzie zamienić”,
podaj dokładne fragmenty: plik, stary tekst, nowy tekst.
* Zadania przychodzą w formacie `### ZADANIE / ### OPIS / ## DZIAŁANIE / ## ESTETYKA`.
Traktuj każdy punkt jako wymaganie i sprawdź na końcu, że wszystkie są spełnione.
* Testuje na PC (Windows / Arch Linux) bez czujników — wtedy importy `smbus2` / `bme280`
w sterownikach bywają zakomentowane. Nie odkomentowuj ich bez pytania.
* Repozytorium: https://github.com/iamCh4rl35/beenest

## Uruchomienie

```
pip install -r requirements.txt
python3 app.py                       # port 80 (działa http://beenest.local), gdy się nie da – 8000
BEENEST\_PORT=8080 python3 app.py     # własny port
BEENEST\_DEBUG=1 python3 app.py       # auto-reload, port 8000
BEENEST\_CAMERA\_DEMO=1 python3 app.py # kamera bez sprzętu
python3 app.py --ustaw-pin           # PIN administratora (6 cyfr), działa też przy uruchomionym serwerze
BEENEST\_BEZ\_ZABEZPIECZEN=1 python3 app.py  # testy: każdy jest administratorem
BEENEST\_USB=/katalog python3 app.py # testy Klucza: każdy podkatalog udaje pendrive
```

* Zmiana `app.py` lub `main.html` wymaga restartu aplikacji (szablon nie przeładowuje się sam).
Zmiany w `static/` wystarczy odświeżyć w przeglądarce (czasem Ctrl+Shift+R).
* Na Pi: hotspot NetworkManagera `Pi-hotspot`, adres 10.42.0.1, mDNS `beenest.local`.
* **Wyświetlacz przy ulu musi otwierać `http://127.0.0.1`** (tylko adres pętli zwrotnej jest
rozpoznawany jako wyświetlacz; `beenest.local` na samym Pi byłby traktowany jak telefon).
* Testy na PC bez czujników: `smbus2` / `bme280` nie są zainstalowane — nie zmieniaj sterowników,
tylko podstaw w testach zastępcze moduły (np. `PYTHONPATH=<katalog z atrapami>`).
* Aktualizacja: przycisk w „O aplikacji” **usunięty na życzenie użytkownika** (2026-11-19).
Trasa `POST /api/system/update` (`git pull`, restart tylko z `{"reboot": true}`) nadal jest w `app.py`.

## Struktura

```
app.py                          serwer: czujniki w wątku, historia w SQLite, API, ustawienia
main.html                       cała strona (w katalogu głównym, nie w templates/), strony = sekcje .page
static/app.js                   logika strony (routing po #hash, ustawienia, docki, okna, wykresy)
static/chart.js                 window.BeeChart – własny wykres SVG (bez bibliotek)
static/qr.js                    window.BeeQR – własny generator kodów QR (bajty, poziom M, wersje 1–10)
static/style.css                motywy, układ, animacje
\*\_detector\_driver.py            po jednym na czujnik: read() -> {klucz: float | None}, KEYS = krotka kluczy
buzzer\_driver.py                pusty (do zrobienia)
data/beenest.db                 powstaje sam: tabela readings(ts, key, value) + kv (stan, np. f\_last)
data/global.conf                powstaje sam: wszystkie ustawienia (patrz niżej)
data/secret.key                 powstaje sam: klucz podpisujący ciasteczka (nowy = telefony do ponownego parowania)
```

`data/` jest w `.gitignore`.

Sterowniki to na razie **szkielety z danymi demonstracyjnymi** (atmosfera, samopoczucie, dokarmiaczka,
wylotek). Kamera (`camera\_detector\_driver.py`) działa naprawdę przez picamera2 / libcamera (MJPEG),
dwie kamery: `external` (CAM0) i `internal` (CAM1).
Progi samopoczucia (`WELLBEING\_\*\_HZ`, `WELLBEING\_MAX\_DB`) są w `wellbeing\_detector\_driver.py`;
używa ich `wellbeing\_status` w `app.py` i linie stref na wykresie.

### Strony (`#hash`)

`home`, `monitoring` (kamera, klik = płynne powiększenie), `temperatura` (Atmosfera: temperatura,
wilgotność, ciśnienie, w ulu / na zewnątrz, min i maks z 24 godzin + wykres), `samopoczucie`
(kafelki + wykres częstotliwości ze strefami), `dokarmiaczka`, `wylotek`, `ustawienia`
(pionowy dock: Wygląd / Działanie / Informacje).

### API

|Trasa|Opis|
|-|-|
|`GET /`|strona; serwer wkleja ustawienia urządzenia (`window.BEENEST\_DEVICE`), stan zabezpieczeń (`window.BEENEST\_AUTH`) i CSS z `\[wyglad]`|
|`GET /api/data`|ostatni odczyt wszystkich czujników + min/max 24 h (strona pyta co 5 s)|
|`GET /api/history?keys=a,b\&range=12h`|średnie do wykresów; zakresy 12h,1d,3d,7d,14d,30d,3m,6m (`CHART\_RANGES`)|
|`GET /api/camera/<external\|internal>/stream`|MJPEG|
|`GET/POST /api/settings`|odczyt / zmiana ustawień (JSON)|
|`POST /api/history/clear`|wymazuje historię atmosfery i samopoczucia (`HISTORY\_KEYS`) + VACUUM|
|`POST /api/system/update`|`git pull`, opcjonalnie `{"reboot": true}`|
|`POST /api/system/reboot`, `/shutdown`|zasilanie|
|`GET /api/zabezpieczenia/stan`|poziom, blokada, Klucz, pendrive'y, prośba o parowanie (strona pyta co 1 s / 2 s)|
|`POST /api/zabezpieczenia/pin`, `/aktywnosc`, `/zablokuj`|wyświetlacz: odblokowanie PIN-em, dotyk przedłuża, „Zahasłuj Panel”|
|`POST /api/zabezpieczenia/zdejmij-blokade`, `/zmien-pin`|administrator; zmiana PIN-u: Klucz / telefon administratora / stary PIN|
|`GET /api/parowanie/wifi`, `POST /api/parowanie/kod`, `/anuluj`, `/decyzja`|wyświetlacz: kroki parowania|
|`POST /api/parowanie/zglos`, `GET /api/parowanie/status`|niesparowany telefon: kod + nazwa, potem czeka na decyzję|
|`GET /api/urzadzenia`, `POST /api/urzadzenia/zapomnij`, `/admin`, `/odlacz`|lista zapamiętanych; `odlacz` = telefon sam się wylogowuje|
|`POST /api/klucz/utworz`, `/uniewaznij`, `/duplikuj/start`, `/duplikuj/zapisz`, `/duplikuj/anuluj`|Klucz (tylko wyświetlacz)|

Wszystkie POST-y przyjmują tylko JSON (`json\_only()`, inaczej 415) — ochrona przed formularzem z cudzej strony.
Uprawnienia: `need(admin=True, display=False, phone=False)` w trasie (`if (bad := json_only() or need()): return bad`).
Niesparowane urządzenie: `guard()` przepuszcza tylko `OPEN_ENDPOINTS`, reszta 401 `{niesparowane: true}`.

### Ustawienia: `data/global.conf` (INI)

* `\[zapis]` — wspólne: `saveInterval` (minuty), `dataRetention` (miesiące), `feederRate`.
* `\[wyglad]` — stałe CSS dla całej strony (czasy i krzywe animacji, wykresy, hover kart).
Wartości w `:root` w `style.css` są tylko zapasem.
* `\[urzadzenie <adres IP>]` — motyw, kontrast, co pokazują karty, alarm, kamera; zapisywane tylko
wartości inne niż domyślne, plus `opis` z przeglądarki.
* `\[administrator]` — `pin` (hash werkzeug) i `klucz` (SHA-256 sekretu z `beenest.klucz`).
* `\[sparowane <id>]` — zapamiętane urządzenia: `nazwa`, `admin`, `dodano`. Niezapamiętane tylko w pamięci.
* Definicje i dozwolone wartości: `SERVER\_SETTINGS`, `DEVICE\_SETTINGS`, `LOOK\_SETTINGS` w `app.py`.
* Plik wczytuje się sam po zmianie (porównanie mtime), zapisuje się w całości od nowa z komentarzami
(atomowo przez `.tmp`). Zła wartość = domyślna + komunikat w konsoli.
* Nowe ustawienie urządzenia: dopisz do `DEVICE\_SETTINGS` w `app.py` **i** do `SELECTS` / `TOGGLES`
w `static/app.js` (z wartością domyślną).

## Konwencje frontendu

* Motyw przez zmienne CSS na `body` (`data-theme`, `data-contrast`); 4 motywy: bialy-pylek,
lekki-miodek, nocna-czern, miodna-szarosc + wysoki kontrast.
* Docki (`.camera-dock`, `initDock`) z przesuwanym wskaźnikiem `.dock-indicator`; poziome i pionowe.
* Własne listy rozwijane i okna (`confirmDialog`, `noticeDialog`, `modalBusy`) — bez natywnych
`alert/confirm`. W tekście okna `\*słowo\*` = kursywa, `\\n` = nowa linijka.
* Wykres: `new BeeChart(host)`, `show(data, mode)` z trybami `grow | domain | morph | quiet | none`;
klik = przybliżenie ×2, dwuklik (≤ 0,5 s) = reset.
* **Cała zakładka Działanie jest dla administratora** (oprócz „Odłącz od ula” na telefonie).
Alarm napełnienia to ustawienie urządzenia, ale też wymaga administratora (`ADMIN\_DEVICE\_SETTINGS`).
Na szerokich ekranach Działanie ma dwie kolumny (`.settings-cols`), inaczej nie mieści się na 1024×600.
Przyciski w Działaniu: wiersz z podpisem, opisem i przyciskiem po prawej (jak „Wymaż zapisane dane”).
* Kłódka w `.topbar` na środku (siatka: logo | kłódka | zegar, od 851 px).
* Okna (`.modal`): przezroczystość animują `.modal-backdrop` i `.modal-card`, nie całe `.modal` —
przy przezroczystym rodzicu `backdrop-filter` włącza się dopiero po animacji (rozmycie „wskakuje”).
* W CSS nie pisz `font: 800 14px/1.2 inherit` — to nieprawidłowe i przeglądarka odrzuca całą linijkę;
pisz `var(--font)`. Przyciski i pola dziedziczą czcionkę przez regułę na górze `style.css`.
* Opcje administratora w `main.html`: `data-admin` (wyświetlacz: klik prosi o PIN i potem wykonuje się
sam; telefon użytkownika: `.is-denied` + okno o braku uprawnień), `data-admin="telefon"` (PIN-u nie
wymaga wyświetlacz), `data-only="wyswietlacz|telefon"`. Serwer sprawdza uprawnienia niezależnie.
* Okna z własną treścią: `askModal({content, icon: false, wide: true})`; PIN: `pinDialog({title, text, submit})`.
* Kody QR: moduły `color-mix(var(--orange) 60%, #000)` na jasnym polu także w ciemnych motywach
(odwrócony kod źle się skanuje); w wysokim kontraście czarne. Sprawdzone `zbarimg`.
* **Układ musi mieścić się bez przewijania na 1024×600** (wyświetlacz przy Pi). Sprawdzaj też
telefon (\~390 px szerokości) i 1920×1080.

## Do zrobienia / otwarte

* Prawdziwe odczyty czujników (BME280 ×2: 0x76 w ulu, 0x77 na zewnątrz; mikrofon + FFT; tensometr; serwo).
* Sterowanie wylotkiem (na razie tylko podgląd stanu), `buzzer\_driver.py`.
* **Zasilanie solarne (planowanie, 2026-11-19):** panel → Victron SmartSolar MPPT 75/15 → akumulator 22 Ah → Pi.
Odczyt przez VE.Direct (tryb tekstowy, 19200 bodów, blok co 1 s; tylko biblioteka standardowa: `termios`),
jako nowy sterownik w stylu `*\_detector\_driver.py`. Bluetooth (Instant Readout) jest możliwy, ale wymaga
klucza z VictronConnect i nowej biblioteki. Odpowiedzi użytkownika: akumulator **żelowy MAXX 22 Ah 12 V**;
Pi zasilane przez przetwornicę step-down do 5 V (źródło przetwornicy: wyjście LOAD czy akumulator –
do ustalenia); połączenie „najdogodniej” → proponowany kabel VE.Direct–USB. Procent naładowania
liczony z napięcia tylko bez ładowania (żel w spoczynku: około 12,85 V = 100 %, 11,8 V = 0 %).
* **Zabezpieczenia — wdrożone 2026-11-19** (opis w `app.py`, sekcja „Zabezpieczenia”, i `static/app.js` sekcja 14).
  Ustalenia użytkownika, których kod nie mówi wprost:
    * Telefon administratora zmienia PIN bez starego PIN-u („brak wymogu PIN-u, zmiana hasła ula”);
wyświetlacz bez Klucza — tylko ze starym PIN-em; Klucz jest nad PIN-em.
    * Jeden port USB: duplikowanie = wpięcie oryginału (sprawdzony, sekret w pamięci na 3 min),
wyjęcie, wpięcie drugiego pendrive'a. Wszystkie kopie mają ten sam sekret (unieważnienie wyłącza wszystkie).
    * Blokada 5 minut stała; okna blokady nie da się zamknąć na wyświetlaczu i telefonie użytkownika;
telefon administratora może ją ukryć albo zdjąć. Blokada od razu zahasłowuje wyświetlacz.
    * Lista „Urządzenia” tylko z zapamiętanymi; korona = nadaj, przekreślona korona = odbierz.
  * Do sprawdzenia na Pi: automatyczne montowanie pendrive'a w `/media/<użytkownik>/<nazwa>` (w trybie
kiosku bez pulpitu może nie działać), `nmcli -s` musi mieć prawo odczytać hasło `Pi-hotspot`,
przeglądarka wyświetlacza w trybie `--kiosk` i schowane porty USB (obca klawiatura omija PIN).
  * Ustawienia urządzeń (`\[urzadzenie <adres IP>]`) nadal są przypisane do adresu IP, nie do ciasteczka.
