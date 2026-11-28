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
* **Commity: bez dopisku `Co-Authored-By: Claude…` ani innego podpisu Claude** – użytkownik nie chce Claude
w „Contributors” na GitHubie (2026-11-20). Autor i push jako użytkownik (`iamCh4rl35`, git config na PC).

## Miejsca operacji

* PC (Arch Linux): `/home/karolkubik/Dokumenty/Projekty/BEENest` — główny katalog projektu.
* Raspberry Pi 5 8 GB (Raspberry Pi OS na Debianie 13 trixie, hostname `raspberrypi`):
`ssh beenest@192.168.1.219`, katalog **`/home/beenest/BEENest`** (tak jak na PC; nie „BEEnest”) — kopia na właściwej maszynie.
Na Pi jest też `~/bme-env` (prawdopodobnie środowisko Pythona do BME280).
* Laptop `archlaptop-kubik` w terenie (2026-11-27): internet z hotspotu iPhone'a (Wi-Fi), do Pi kabel Ethernet
`enp0s31f6`, profil NM `do-ula` (shared 10.43.0.1/24 + IPv6 link-local). DHCP do Pi nie dochodzi (na laptopie
aktywny ufw), ale działa IPv6 link-local: `ssh beenest@fe80::c186:8f1d:77b1:707%enp0s31f6` (klucz laptopa już
jest na Pi). Adres Pi znaleziony przez `ping -6 ff02::1%enp0s31f6` + `ip -6 neigh`.
* SSH: klucz PC `~/.ssh/id_ed25519` dodany na Pi (`ssh-copy-id`, 2026-11-20). Claude łączy się z `-o BatchMode=yes`.
* Pulpit Pi: Wayland, kompozytor **labwc**, gniazdo `wayland-0`. Program graficzny przez SSH:
`export WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/$(id -u); nohup chromium --ozone-platform=wayland >/tmp/chromium-ssh.log 2>&1 &`
— bez `--ozone-platform=wayland` Chromium szuka X-serwera i kończy się błędem „Missing X server or $DISPLAY”.
* Powłoka użytkownika na Pi to **fish** — dłuższe polecenia przez `ssh ... bash -s <<'EOF' ... EOF`.
* **sudo na Pi wymaga hasła** — Claude nie robi zmian systemowych sam; daje użytkownikowi komendę
`ssh -t beenest@192.168.1.219 sudo bash BEENest/pi/instaluj.sh` do uruchomienia w terminalu.
* Commit 6efef22 (2026-11-20) wypchnięty na GitHub; repozytorium na Pi wyrównane do niego (`git merge --ff-only`),
na Pi `core.fileMode=false`. Skrypty w `pi/` są w gicie jako 644 – `kiosk.sh` musi mieć +x (lwrespawn uruchamia
go wprost); `instaluj.sh` robi `chmod +x`, ale `git pull` zmieniający ten plik może zdjąć +x.
* Synchronizacja PC → Pi: `scp` zmienionych plików (Pi ma też repozytorium git; przed `git pull` na Pi
może być potrzebne `git checkout -- <plik>`). Sprawdzanie zgodności: `md5sum`.
* LAN (eth0) to połączenie do zarządzania. Użytkownik wyłączał Wi-Fi, bo połączenie klienckie
„Pixel 9 Pro (Karol)” psuło LAN; hotspot (tryb `shared`) nie daje trasy domyślnej, więc LAN-u nie rusza.
* Wyświetlacz: HDMI-A-2, 1024×600, dotyk „WaveShare WS170120” (wpis `<touch>` w `~/.config/labwc/rc.xml`).

## Konfiguracja Raspberry (`pi/`)

* `pi/instaluj.sh` (sudo, wielokrotnie): Wi-Fi włączone, hotspot `Pi-hotspot` (SSID „BEENest Access Web”,
autostart, priorytet 100, 10.42.0.1), DNS hotspotu `address=/#/10.42.0.1` w
`/etc/NetworkManager/dnsmasq-shared.d/beenest.conf`, usługa `beenest.service` (użytkownik beenest,
`CAP_NET_BIND_SERVICE` na port 80, `/etc/sudoers.d/beenest` pozwala na `shutdown`), motyw Plymouth
`beenest` z `pi/logo-startowe.png` (+ `logo.nologo`, `vt.global_cursor_default=0`, `disable_splash=1`).
Kopie oryginałów: `*.przed-beenest`.
* **Kiosk = osobna sesja lightdm `beenest-kiosk`** (`autologin-session` w `/etc/lightdm/lightdm.conf`):
`/usr/local/bin/beenest-kiosk` → `labwc -C /etc/beenest/labwc` (autostart: kanshi + `lwrespawn pi/kiosk.sh`).
Powód: sesja pulpitu `labwc-pi` uruchamia labwc z `-m` (łączy konfigurację użytkownika z `/etc/xdg/labwc`),
więc wpis w `~/.config/labwc/autostart` dokładał kiosk do pulpitu, a skrótów systemowych nie dało się usunąć.
`--pulpit` przełącza autologowanie z powrotem na `rpd-labwc` (pulpit użytkownika nietknięty).
* `--blokada`: brak getty (logind `NAutoVTs=0`, maska getty@tty1 i serial-getty@ttyAMA10, bez `console=tty1`),
w `/etc/beenest/labwc`: `XKB_DEFAULT_OPTIONS=srvrkeys:none` (Ctrl+Alt+Fn nic nie robi) i rc.xml bez skrótów
i menu; zasady Chromium (`/etc/chromium/policies/managed/beenest.json`: tylko http://127.0.0.1, bez narzędzi
programisty, plików, pobierania), `kernel.sysrq=0`. **SSH zostaje z hasłem użytkownika beenest**
(życzenie użytkownika, 2026-11-20 — nie wyłączać `PasswordAuthentication`). `--odblokuj` cofa blokadę.
* Kursor ukryty (ekran dotykowy): motyw `/usr/share/icons/beenest-bez-kursora` — jeden przezroczysty plik
Xcursor 24×24 (generowany w Pythonie w skrypcie) podlinkowany pod nazwami wszystkich kursorów z PiXtrix,
Adwaita i default; `XCURSOR_THEME` w `/etc/beenest/labwc/environment`. Sprawdzanie: `grim -c` (z kursorem).
* Ekran „Configuring this Raspberry Pi 5…” przed logo = instalator sieciowy bootloadera
(`NET_INSTALL_AT_POWER_ON=1` w EEPROM). Skrypt ustawia 0 przez `rpi-eeprom-config --apply` (wchodzi po restarcie).
Firmware Pi 5 jest w EEPROM, nie w `/boot/firmware` — tego napisu nie ma na dysku.
* `pi/kiosk.sh`: Chromium `--kiosk --password-store=basic` (bez pytania o pęk kluczy), czeka na serwer,
kasuje „przywróć karty” po odcięciu prądu i usuwa `~/.config/chromium/Singleton*` przed startem
(blokada zawiera nazwę komputera — po zmianie raspberrypi → beenest Chromium pokazał „profil używany
przez inny proces na innym komputerze”). `kiosk.sh` należy do beenest, więc wdrożenie = `scp` + `pkill chromium`.
* „Fałszywy internet”: `CONNECTIVITY_CHECKS` w `app.py` (generate_204, hotspot-detect.html, connecttest.txt,
ncsi.txt, success.txt; w `OPEN_ENDPOINTS`). iPhone / Windows / Firefox uznają sieć za internetową;
Android robi też sprawdzenie HTTPS, którego nie da się podrobić → najwyżej „ograniczone połączenie”.
* Stan 2026-11-20: `instaluj.sh` uruchomiony raz (bez blokady). Hotspot wstał (wlan0 = Pi-hotspot, LAN
dalej trasą domyślną), DNS hotspotu odpowiada 10.42.0.1 na każdą nazwę, kiosk i logo ustawione.
Usługa padała: `data/global.conf` i `data/secret.key` należały do roota (wcześniej `sudo python3 app.py`)
→ skrypt robi teraz `chown -R` katalogu aplikacji. Po `chown` serwer działa (index 200, generate_204 → 204,
hotspot-detect.html → Success, `/api/data` z hotspotu → 401), kiosk widoczny na ekranie (zrzut: `grim`).
Pod kioskiem działał jeszcze pulpit → przepisane na osobną sesję. Po restarcie (20:20) działa tylko
`labwc -C /etc/beenest/labwc` + Chromium, bez wf-panel-pi i pcmanfm; panel ula na całym ekranie.
Logo startowe potwierdzone przez użytkownika. **Blokada włączona 2026-11-20 20:40** (`--blokada`):
getty zamaskowane, `console=tty1` usunięte, `srvrkeys:none`, rc.xml kiosku bez skrótów, zasady Chromium,
sysrq=0, EEPROM `NET_INSTALL_AT_POWER_ON=0`, kursor przezroczysty; SSH nadal przyjmuje hasło i klucz.
* Oś startu (2026-11-20): Plymouth 3,2–6,7 s → lightdm/labwc ~7 s → Chromium ~10 s → panel ~13–14 s.
Przy zimnym starcie użytkownik widział tylko czarny ekran ~10 s (logo tylko przy restarcie — monitor
budzi się za późno na krótkie okno Plymoutha). Rozwiązanie: `swaybg -m fit -i .../beenest/splash.png`
jako tło w autostarcie kiosku (swaybg jest w systemie). Wdrożone i po zimnym starcie swaybg działa od
startu sesji (Plymouth 3,4–6,8 s, Chromium 12,8 s); użytkownik potwierdził: logo widać aż do panelu.
* Uwaga (niepoprawione): serwer startuje przed hotspotem, więc w logu „nie znalazłem adresu IP”
i `beenest.local` nie jest rozgłaszane przez zeroconf; na hotspocie nazwę i tak rozwiązuje dnsmasq.
* **Parowanie i adresy (2026-11-20):**
    * Ciasteczko parowania przeglądarka wiąże z nazwą z paska adresu → wejście przez 10.42.0.1 i przez
beenest.local to dla niej dwa różne miejsca („gubienie” urządzenia). Dlatego `one_address()` w `app.py`:
GET `/` z hotspotu (`HOTSPOT_PREFIX`) pod inną nazwą niż beenest.local → 302 na `http://beenest.local/`.
Kod QR (`pairing_address`) przy hotspocie daje beenest.local.
    * Nazwa komputera Pi ma być **`beenest`** (avahi rozgłasza beenest.local na każdym interfejsie; zeroconf
w app.py nie widział hotspotu, bo ten wstaje po serwerze). Ustawia ją `instaluj.sh`.
    * Hasło hotspotu było puste w QR: usługa bez sesji nie miała prawa `nmcli -s` → reguła polkit
`/etc/polkit-1/rules.d/50-beenest.rules` (NetworkManager.settings.modify.system dla beenest).
    * Nazwa urządzenia z DHCP: dnsmasq `dhcp-script=/usr/local/bin/beenest-dhcp` zapisuje nazwy do
`/run/beenest-dhcp/<IP>`; `network_name()` zamienia myślniki na spacje („Pixel-9-Pro-Karol” → „Pixel 9 Pro Karol”,
nawiasów z nazwy telefonu nie da się odtworzyć). Strona dostaje ją w `BEENEST_DEVICE.nazwa_sieciowa`.
    * Ponowne parowanie pod tą samą nazwą (bez wielkości liter) zastępuje stary zapamiętany wpis.
    * Pierwsze wejście urządzenia (`!device.known`): motyw z systemu (`systemLook()`: ciemny → nocna-czern,
`prefers-contrast: more` → wysoki kontrast) i zapis od razu (zakłada sekcję `[urzadzenie <IP>]`).
    * Szybki konfigurator (`openSetup()`, sekcja 12a `app.js`; `#setup` w `main.html`; `.setup*` w CSS):
po sparowaniu (flaga `sessionStorage['beenest-konfigurator']`). Karta 1 = prawdziwy `#settings-appearance`
przeniesiony na czas konfiguratora i oddany potem na miejsce; karta 2 = ptaszek w zaokrąglonym kwadracie.
Przesuwanie kart: `.is-next` (100vw) / `.is-past` (-30vw), czas `--setup-duration` = 1,5 × `--anim-duration`.
    * Wdrożone 21:13: hostname `beenest`, hasło hotspotu czytelne dla usługi, 302 z 10.42.0.1 na beenest.local,
`/run/beenest-dhcp/10.42.0.238` = Pixel-9-Pro-Karol. PC użytkownika (Arch) nie rozwiązuje `.local`
(brak avahi/nss-mdns) — to sprawa PC, nie Pi; z PC używaj adresu IP.
    * Sprawdzone 21:40: Pixel 9 Pro i iPad Pro (przedstawia się jako „Macintosh”, bez nazwy w DHCP) parują się
i działają na beenest.local, ciasteczko przeżywa restart serwera. `one_address()` loguje raz każde przekierowanie.
    * **Otwarte, odłożone przez użytkownika:** Pixel 8 Pro („Pixel-8-Pro-Danka”) — Chrome: ERR_TOO_MANY_REDIRECTS
także na http://10.42.0.1, w incognito i po wyczyszczeniu danych witryny. Do ula dochodzą z niego tylko systemowe
testy łączności (generate_204 co kilkanaście sekund — Android nie waliduje sieci), żądań strony z Chrome brak
(ani IPv4, ani IPv6). Dane komórkowe wyłączone, brak VPN, prywatny DNS „automatyczny”. Przyczyna nieznana.
    * **Dane komórkowe przy połączeniu z ulem (21:45, próba opcji 1 – „uczciwy hotspot”):** w
`/etc/NetworkManager/dnsmasq-shared.d/beenest.conf` na Pi ręcznie zakomentowane `address=/#/10.42.0.1`
i dopisane `no-resolv` (w domu Pi ma internet z LAN-u, a tryb shared by go udostępnił – próba byłaby
bez sensu). `pi/instaluj.sh` NIE ma tej zmiany: jego uruchomienie przywraca „fałszywy internet” (przywrócone 21:50).
**Wynik próby:** panel działa, ale Android po „pozostań w sieci” robi z Wi-Fi ula sieć domyślną
dla całego ruchu – danych komórkowych nie używa. Bez tej zgody domyślne są dane, a Chrome wysyła
tamtędy także panel (nie działa). Android nie dzieli ruchu przeglądarki według celu (iOS tak).
Wniosek: samym ustawieniem hotspotu się nie da. Rozważane dalej: opcja 2 = prawdziwe łącze w ulu (modem LTE na USB albo druga karta Wi-Fi) – shared
udostępni je telefonom; opcja 3 = Pi jako klient hotspotu telefonu.
    * Serwer można zrestartować bez sudo: `pkill -f BEENest/app.py` (systemd `Restart=always` go podnosi).
    * Zgłoszonego błędu „trzeba podać inną nazwę, żeby sparować ponownie” nie odtworzyłem (dziennik na Pi
nie jest trwały – tylko bieżące uruchomienie); w kodzie nie było sprawdzania unikalności nazw.
* **Energooszczędność i kafelki (2026-11-20):**
    * Karta Ustawienia na stronie głównej = 4 kafelki `.dash-card.quad` (2×2, na telefonie w rzędzie):
Ustawienia (link), Parowanie (`#tile-pair`, `data-admin data-only="wyswietlacz"`, klika `#btn-pair`),
Zasilanie (`#tile-power`: okno z Wyłącz / Uruchom ponownie – klikają `#btn-shutdown` / `#btn-reboot`, więc
uprawnienia jak w Działaniu – oraz Uśpij ekran tylko na wyświetlaczu), Szybkie ustawienia (`#tile-quick`:
jasność – tylko wyświetlacz, motyw jako 4 kafelki z próbką koloru, kontrast, Zamknij / Przejdź do ustawień).
Wiersze siatki `minmax(0, 1fr)` – inaczej kafelki rozpychały stronę na 1024×600.
    * Jasność: ustawienie urządzenia `brightness` ("1"…"100", domyślnie "100"), suwak w Wyglądzie
(`data-only="wyswietlacz"`). Wyświetlacz HDMI (Waveshare, EDID „Lenovo”) nie ma `/sys/class/backlight`
ani DDC → jasność programowo: czarna warstwa `#dim`. **1 % na suwaku = 60 % prawdziwej jasności**
(`DIM_FLOOR`; poniżej 60 % panel ma błędy obrazu – zgłoszenie użytkownika), 100 % = 100 %.
Animacja usypiania może ściemniać głębiej (do 0,6 krycia warstwy).
    * Animacja usypiania przyspieszona 2× na życzenie użytkownika: 375 ms (`CRT_TIME` w app.js = `.crt-off` w CSS).
Budzenie dotykiem przy wyłączonym HDMI potwierdzone przez użytkownika na wyświetlaczu.
    * Uśpienie (sekcja 15 `app.js`): animacja `html.crt-off` (body → jasny pas → punkt), zasłona `#sleep`,
serwer `POST /api/ekran/uspij|obudz` → `screen_power()` = `wlopm --off|--on '*'` (tylko na Raspberry, env
`XDG_RUNTIME_DIR`, `WAYLAND_DISPLAY=wayland-0`). Dotyk zasłony tylko budzi (nie klika pod spodem).
Samo po `SLEEP_AFTER` = 10 min bez dotyku, nie gdy Klucz jest w porcie. Start serwera włącza obraz
(teraz i po 30 s), bo strona po przeładowaniu nie pamięta uśpienia. Sprawdzone na Pi: HDMI-A-2 off/on.
    * Blokada po błędnych PIN-ach na wyświetlaczu (`.lockout.is-display`): gradient #000 → #383838, bordowe
akcenty (#9E1B32 ikona, #C8283F licznik), po `LOCKOUT_SHOW` = 10 s ekran gaśnie, dotyk budzi na kolejne 10 s.
Telefony: wygląd blokady w swoim motywie, bez zmian.
* **Poprawki estetyczne (2026-11-20):**
    * **CAŁY interfejs ma się mieścić na wyświetlaczu 1024×600 bez przewijania** (wymóg użytkownika, powtórzony).
Sprawdzanie: w każdej zakładce Ustawień i na stronie głównej `scrollHeight == clientHeight` dla `main`
i `.settings-content` (skrypt w przeglądarce, viewport 1024×600, adres 127.0.0.1 = wyświetlacz).
    * Czcionka: **Lexend** (zmienna 100–900, OFL) z `static/fonts/Lexend.ttf` przez `@font-face` – ul nie ma
internetu, więc żadnych Google Fonts. Domyślna grubość `body` = 700 („domyślnie pogrubiona”).
    * Kafelek „Szybkie ustawienia” → **„Estetyka”** z ikoną palety. Panel `openAesthetics(withLink)`: jasność
(wyświetlacz), motyw, kontrast; „Przejdź do ustawień” = podkreślony wyśrodkowany link pod kontrastem
(tylko z menu głównego); przycisk „Zamknij” w kolorach przycisku głównego.
    * Wygląd: grupa „Kolorystyka” → „Estetyka” z jednym wierszem i okrągłą strzałką (`#btn-aesthetics`)
otwierającą ten sam panel bez linku. Motyw / kontrast / jasność są już tylko w panelu (zwolnione miejsce).
    * Telefon (`body[data-urzadzenie="telefon"]`): kafelki jako osobne karty (Ustawienia, Zasilanie, Estetyka).
Telefon: 4 karty – Ustawienia, Zasilanie, Estetyka, **Parowanie** (kafelek `#tile-pair` widoczny wszędzie,
na telefonie `order: 4` = obok Estetyki; `data-admin` – telefon bez uprawnień dostaje okno o braku uprawnień).
Parowanie ma być kartą obok Estetyki, NIE opcją w Zasilaniu (poprawka użytkownika).
Zasilanie: Wyłącz, Uruchom ponownie, Uśpij ekran / Zgaś ekran ula; **tylko na telefonie** „Usuń z pamięci ula”
= `#btn-leave` (odłącza sam siebie). Na wyświetlaczu tej opcji nie ma (decyzja użytkownika; lista urządzeń
zostaje w Działaniu → Urządzenia).
    * Ciasteczko urządzenia (`beenest`, sesja Flaska z id urządzenia, rok ważności, odnawiane przy każdym wejściu):
**`SameSite=Lax`, nie Strict** – przy Strict Chrome na Androidzie nie wysyłał go przy wejściu przez przekierowanie
10.42.0.1 → beenest.local, z kodu QR albo z innej aplikacji i zapamiętany Pixel widział ekran parowania
(Safari na iPadzie był łagodniejszy). Ochrona przed cudzymi stronami: wszystkie zmiany to POST z JSON-em.
    * Zgaś ekran ula z telefonu: `POST /api/ekran/uspij` od telefonu zwiększa `_screen["zadanie"]`, wyświetlacz
widzi zmianę `uspij` w stanie i sam robi animację + wlopm.
    * Parowanie: kod, Wi-Fi i decyzję może obsłużyć **każde urządzenie administratora** (`need()` zamiast
`need(display=True)`). Prośba trafia naraz na wyświetlacz i telefony administratorów (watcher w sekcji 14e);
decyzja gdziekolwiek zamyka okno wszędzie (`prosba` znika, `rozpatrzona` = {id, zgoda} przez 30 s).
Wyświetlacz bez uprawnień: decyzja prosi o PIN. Zamknięcie tłem/Escape = tylko na tym urządzeniu.
    * Kiosk: autostart `lwrespawn /bin/sh pi/kiosk.sh` (niezależnie od prawa wykonywania); skrypty w gicie 100755.
Zmiana autostartu wymaga ponownego `sudo bash pi/instaluj.sh --blokada`.
* **Kolory wyświetlacza Waveshare 7" (2026-11-20):**
    * Plansza testowa (szarości 0–80 i 160–255): ciemne zlewają się z czernią do ~40 (48 wyraźne), jasne od 232
w górę zlewają się w biel → niezgodny zakres HDMI: Pi przy 1024×600 wysyła pełny 0–255 („Broadcast RGB” =
Automatic), panel oczekuje 16–235. Zrzut `grim` pokazuje kolory poprawnie (problem jest za kartą graficzną).
    * `pi/hdmi_zakres.py` (ioctl DRM, tylko biblioteka standardowa): pokazuje / ustawia „Broadcast RGB”
(`ograniczony | pelny | auto`). Działa tylko bez kompozytora → woła go `/usr/local/bin/beenest-kiosk`
przed `exec labwc` (`HDMI_RANGE=ograniczony` na górze `instaluj.sh`, wynik w dzienniku: `journalctl -t beenest-hdmi`).
    * Dodatkowo CSS tylko dla wyświetlacza (`body[data-urzadzenie="wyswietlacz"]`) w ciemnych motywach:
rozjaśnione `--card-background`, `--line`, `--orange-soft`, `--dock-bg` (Nocna Czerń #38312F / #554B48 /
#5C3A00; Miodna Szarość #463820 / #66542F / #5E4818, tło #2E2410). Użytkownik ocenił nowe tła „spoko”.
Neutralne szarości (#333333) panel pokazuje zielonkawo → karta lekko ciepła #38312F (wybór z planszy, wariant 4).
**Korekta ma działać wyłącznie na wyświetlaczu – telefony i komputery mają oryginalne kolory** (wymóg).
    * Po włączeniu zakresu ograniczonego (wdrożone 23:03): ciemne widać od 32 (ledwo) / 40 (wyraźnie), jasne
prawie w pełnej skali (3 ostatnie trudno odróżnić) – lepiej o jeden stopień, zakres zostaje „ograniczony”.
Plansza testowa: tylko tymczasowo w `static/test-kolorow.html` na Pi (usunięta, nie w repozytorium).
* Użytkownik ma wyświetlacz Pi obok siebie i widzi go na żywo — można go prosić o sprawdzenie ekranu.

* **Zegar i wylogowania (2026-11-27):** Pi 5 ma RTC bez baterii (RTC = 1970), fake-hwclock nie ma, systemd-timesyncd
po starcie ustawia czas z mtime `/var/lib/systemd/timesync/clock` → po nagłym odcięciu prądu zegar się cofa
(w terenie Pi pokazywało 22 listopada zamiast 27). Ciasteczko urządzenia ma znacznik czasu z ostatniego wejścia,
więc itsdangerous odrzucał je („Signature age < 0”) = urządzenie „zapomniane” (wpisy w global.conf zostawały,
ponowne parowanie dopisywało nowe). Poprawka: `ClockSafeSessionInterface` w app.py przyjmuje ciasteczko
z przyszłości (podpis nadal sprawdzany, za stare dalej odrzucane). Sprawdzone na Pi (200 zamiast 401).
* Czas z internetu: `sync_clock_loop()` przy starcie serwera (tylko Raspberry) – SNTP (pool.ntp.org, time.google.com,
tempus1.gum.gov.pl), zapas: nagłówek Date z http://www.google.com/; próby co 30 s przez 10 min, różnica > 2 s →
`time.clock_settime`. Wymaga `CAP_SYS_TIME` w beenest.service (dopisane w `pi/install.sh`, AmbientCapabilities) –
**po wdrożeniu trzeba ponownie uruchomić `sudo bash pi/install.sh --lock`** (bez tego w dzienniku tylko komunikat).
Użytkownik ma baterię RTC (2026-11-27, jeszcze niepodłączona); po podłączeniu: `dtparam=rtc_bbat_vchg=3000000`.
* Model akumulatora w Safari: wersja `height: 100%` + aspect-ratio rozjeżdżała się (pudełko 183 px, model 415 px).
Teraz `.battery-box` ma szerokość `min(40vw, (100vh − 300px)·220/180, 420px)`, SVG `width: 100%`. Sprawdzane
w WebKitGTK (skrypt z `gi` WebKit2 4.1 + `Gtk.OffscreenWindow`; potrzebne `GDK_BACKEND=x11
WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_COMPOSITING_MODE=1`).
* Czujniki cieczy XKC-Y25-V: zasilanie 5 V z Pi wystarcza (przetwornica Pololu niepotrzebna). Przy zasilaniu 12 V
dzielnik 1k/2k dałby ~8 V na GPIO – trzeba by 10k/3,3k. Pi w terenie chwilowo zasilane z gniazdka (2026-11-27),
dlatego IL (pobór z LOAD) = 0.

* **Dokarmiaczka (2026-11-27):** czujniki cieczy odwrócone przez użytkownika czarnym przewodem → `LIQUID_IS_HIGH = False`
(wysoki = brak cieczy). Skutek: odłączony / niezasilony czujnik (dzielnik 2 kΩ ściąga do masy) czyta się jako „ciecz”.
Po wdrożeniu na Pi: GPIO17 hi, GPIO27 lo, GPIO22 lo → 100 % (czujniki 2 i 3 prawdopodobnie niepodłączone).
Czujniki czyta osobny wątek `feeder_loop()` co `FEEDER_EVERY` = 1 s (dokarmiaczka wyjęta z `SENSORS`, sampler bierze
`f_level` z `_latest`); strona `#feeder` odpytuje `/api/data` co 1 s, reszta co 5 s. Brzęczyk / alarm napełnienia
(`detect_refill`): tylko gdy poziom dojdzie do pełna (`LEVEL_PERCENT[-1]`), a od ostatniego razu był niżej
(wcześniej skok o 10 pkt → piszczało już przy 15 → 40 %). Zbiornik `.tank-body` też liczony szerokością (Safari).

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
battery\_detector\_driver.py      akumulator: Victron VE.Direct (wątek czyta port w tle), pola b_*
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

`home`, `battery` (akumulator), `monitoring` (kamera, klik = płynne powiększenie), `temperatura` (Atmosfera: temperatura,
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
* Pasek `.topbar` (2026-11-27): telefon (< 851 px, też aplikacja na Androida) = logo po lewej, `.topbar-side`
(kłódka + akumulator) w prawym rogu, zegar zawija się pod spód (`order`); od 851 px siatka
`.topbar-side` | logo na środku | zegar (każdy element `grid-row: 1`, inaczej `order` psuje układ).
* Akumulator: `#battery-btn` w pasku (ikona akumulatora + procent, styl jak `.lock-btn`) → strona `#battery`
(karta jak dokarmiaczka: parametry po lewej, model SVG po prawej w `.tank.battery-box`). Płyn = `--battery-y`
na `#battery-model` (viewBox: 30 pełny, 166 – p·1,26, 170 pusty), fala = animacja właściwości `translate`,
poziom = `transform` (składają się niezależnie). **Wspólny mechanizm płynu (2026-11-27):** klasy `.liquid-model`
(na svg), `.liquid-wave` + `.liquid` (ścieżka fali), zmienna `--liquid-y`, funkcja `setLiquid(model, y, emptyY, full, rise)`
w app.js. Używa go też zbiornik dokarmiaczki `#feeder-model` (viewBox 140×176: wnętrze 6–170, 176 pusty, 0 pełny;
segmenty `.tank-seg` usunięte, ramka `--line` jak dawniej).
Obrys, bieguny oraz znaki + i − modelu w `--black` (życzenie użytkownika: „czarna na bokach”, znaki jak ramka). Dane: `b_percent`
(z napięcia tylko w spoczynku = CS 0/2 albo prąd ładowania I < 0,1 A: 11,8 V = 0 %, 12,85 V = 100 %;
podtrzymanie = 100 %; przy ładowaniu ostatni procent ze spoczynku, po starcie serwera w trakcie ładowania „--”).
Sterownik potrafi zgłaszać CS = 3 przy 0 A (wieczorem) – dlatego sam CS nie wystarcza. Wdrożone na Pi 2026-11-27
(wskaźnik 93 % przy 12,78 V; zrzut `grim` z Pi miał wtedy 1024×768 – w terenie inny monitor?), `b_voltage`, `b_current` (= IL, prąd wyjścia LOAD),
`b_panel` / `b_panel_percent` (100 % = `PANEL_MAX_W` 30 W), `b_state` (CS), `b_error`, `b_updated`.
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

## Plan podłączeń czujników (2026-11-20, jeszcze niepodłączone)

Nakładka: DFRobot IO Expansion HAT for Raspberry Pi V1.0 (opis pinów BCM + WiringPi; „SDA1 9 / SCL1 8” na
nakładce to numery WiringPi – fizycznie SDA = pin 3, SCL = pin 5). **Pełna rozpiska dla użytkownika:
`łączenia czujników.txt`** (w katalogu projektu na PC i na Pi, poza gitem; na Pi kopia pierwotnej notatki
`łączenia czujników.txt.poprzednia`). Kamera zewnętrzna CAM0, wewnętrzna CAM1.

|Pin|BCM|Nakładka|Podłączenie|
|-|-|-|-|
|1, 17|3V3|3V3|BME280 ×2 VCC, mikrofon VDD|
|2, 4|5V|5V|zasilanie Pi z przetwornicy (jeśli nie USB-C), XKC ×3 VCC|
|3 / 5|GPIO2 / 3|SDA1 / SCL1|BME280 ×2 (I2C1): 0x76 w ulu (SDO→GND), 0x77 na zewnątrz (SDO→3V3)|
|11, 13, 15|GPIO17, 27, 22|IO0, IO2, IO3|XKC-Y25-V nr 1 (dół), 2, 3 (góra) przez dzielnik 1 kΩ / 2 kΩ|
|12, 35, 38|GPIO18, 19, 20|IO1, IO24, IO28|ICS43434 (I2S): SCK, WS, SD; L/R → GND|
|32|GPIO12|IO26|serwo MG-996R – sygnał (sprzętowe PWM0 kanał 0)|
|33|GPIO13|IO23|buzzer pasywny przez tranzystor NPN (PWM0 kanał 1)|
|16|GPIO23|IO4|MOSFET naświetlaczy IR (włącz / wyłącz)|
|10|GPIO15|RXD|SmartSolar VE.Direct TX – tylko gdy bez kabla VE.Direct–USB|
|6, 9, 14, 20, 25, 30, 34, 39|GND|GND|wspólna masa wszystkiego|

* XKC-Y25-V: zasilanie 5–24 V, wyjście ≈ napięcie zasilania → dzielnik 1 kΩ (od czujnika) / 2 kΩ (do GND)
= 3,33 V na GPIO. Czarny przewód = tryb (do VCC albo GND odwraca wyjście). Poziom dokarmiaczki: 3 progi.
* Serwo: osobna przetwornica 5–6 V ≥ 3 A (prąd zablokowania ~2,5 A – nie z pinu 5 V Pi), kondensator
470–1000 µF przy serwie, masa wspólna z Pi.
* Buzzer pasywny: GPIO13 → 1 kΩ → baza NPN (BC547 / 2N2222), buzzer między +12 V (albo 5 V) a kolektorem,
1–2,2 kΩ równolegle do buzzera; ton z PWM ~2–4 kHz.
* Mikrofon I2S: krótkie przewody (do ~20–30 cm). Nakładka systemowa do sprawdzenia przy wdrażaniu
(`adau7002-simple` albo `googlevoicehat-soundcard`), nagrywanie `arecord` w podprocesie (bez nowych bibliotek).
* SmartSolar: zalecany izolowany kabel VE.Direct–USB (`/dev/ttyUSB0`); alternatywa GPIO15 + `dtparam=uart0=on`
(→ /dev/ttyAMA0), poziom TX sprawdzić miernikiem na pinie +V portu (5 V → dzielnik 1k/2k, 3,3 V → wprost).
* Naświetlacze IR 3 W ×2 (płytki do kamery z fotorezystorem, zwykle zasilane 3,3 V przez otwory montażowe –
przy oryginalnej kamerze dolutować przewody do pól + / − płytek): osobna przetwornica 3,3 V ≥ 2 A
(pin 3V3 Pi tego nie uciągnie), sterowanie MOSFET logiczny po stronie masy z GPIO23 (100 Ω do bramki,
10 kΩ bramka–GND). Napięcie zasilania sprawdzić na opisie płytek.
* Zasilanie Pi: akumulator → bezpiecznik → przetwornica 5,1 V ≥ 5 A → USB-C (zalecane) albo piny 2/4 + GND.
Bez USB-PD Pi 5 ogranicza USB do 600 mA – po upewnieniu się, że przetwornica daje 5 A: EEPROM `PSU_MAX_CURRENT=5000`.
* PWM na Pi 5 (do sprawdzenia przy wdrażaniu): `dtoverlay=pwm-2chan,pin=12,func=4,pin2=13,func2=4`,
sterowanie przez `/sys/class/pwm` (biblioteka standardowa).
* **Serwo wylotka (debug 2026-11-27):** nakładka PWM działa (pwmchip0 = 1f00098000.pwm). Pomiar szybkim
odczytem rejestru RP1 (`/dev/gpiomem0`, SYS_RIO0 SYNC_IN = offset 0x10008, bit 12): impulsy dokładne
(1,00 / 2,00 ms co 20 ms), po `enable=0` linia trwale niska. Mimo to serwo ~1,5 s po komendzie samo wracało
do 0 % (gaszenie impulsów po `MOVE_SECONDS`) → ten egzemplarz MG-996R bez sygnału jedzie do końca zakresu.
Łatka: `HOLD = True` + odtworzenie zapisanej pozycji przy pierwszym `read()` po starcie, impulsy 500–2500 µs
(było 1000–2000 = ~90°). `hardware.pwm_set` zerował `duty_cycle` przy każdej zmianie → gubił 1–2 impulsy
(przerwy 60 ms); teraz zeruje tylko przy zmianie okresu. Wdrożone na Pi (scp + restart).
Uwaga: `pkill -f BEENest/app.py` w poleceniu SSH zabija też własną powłokę (ten sam napis) – restartuj osobnym
`ssh ... 'pkill -f [B]EENest/app.py'`.

* **Przetwornica dla Pi (2026-11-28):** użytkownik chce zasilać Pi przez piny z Pololu D24V50F5 (#2851:
wejście 6–38 V, 5 V ±4 %, typowo 5 A; pady co 2,54 mm VIN / GND ×2 / VOUT / EN, bez PG; EN i tak włączone).
Propozycja: SmartSolar LOAD → bezpiecznik 4–5 A → VIN; VOUT → piny 2 i 4, GND → piny 6 i 9. Nigdy z panelu wprost,
nie razem z USB-C. Jeszcze niepodłączone.

* **Naświetlacze IR (2026-11-28):** sterowanie już jest w kodzie (`ir_driver.py`, GPIO23; `_ir()` w
`camera_detector_driver.py` – świecą tylko z kamerą wewnętrzną, gasną z nią po `IDLE_STOP_S` = 10 s).
Brakuje tylko układu. Uwaga (niepoprawione): `pinctrl` trzyma stan, więc restart / awaria serwera przy włączonej
kamerze zostawia je zapalone do następnego wyłączenia kamery wewnętrznej.

* Model naświetlaczy: Botland 4520 (OdSeven ODS-04520), 2 płytki 850 nm, 3,3 V, fotorezystor + potencjometr progu.
Poboru producent nie podaje; opinia kupującego: ~0,4 A na płytkę (razem ~0,8 A, nie ~1,8 A) – zmierzyć.

## Do zrobienia / otwarte

* Prawdziwe odczyty czujników (BME280 ×2: 0x76 w ulu, 0x77 na zewnątrz; mikrofon + FFT; tensometr; serwo).
* Sterowanie wylotkiem (na razie tylko podgląd stanu), `buzzer\_driver.py`.
* **Zasilanie solarne (planowanie, 2026-11-19):** panel → Victron SmartSolar MPPT 75/15 → akumulator 22 Ah → Pi.
Odczyt przez VE.Direct (tryb tekstowy, 19200 bodów, blok co 1 s; tylko biblioteka standardowa: `termios`),
jako nowy sterownik w stylu `*\_detector\_driver.py`. **Sprawdzone 2026-11-27:** kabel VE.Direct–USB = FTDI 0403:6015, `/dev/serial/by-id/usb-VictronEnergy_BV_VE_Direct_cable_*`
→ `/dev/ttyUSB0` (grupa plugdev, beenest ma dostęp bez sudo); odczyt `termios` 19200 8N1 działa, pola: PID 0xA075, FW 166,
V, I, VPV, PPV, CS, MPPT, OR, ERR, LOAD, IL, H19–H23, HSDS (mV / mA / W, H19–H22 w 0,01 kWh). Bez akumulatora sterownik milczy.
Bluetooth (Instant Readout) jest możliwy, ale wymaga
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
