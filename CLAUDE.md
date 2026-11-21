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
* **Nazwy w kodzie po angielsku** (zmienne, funkcje, klasy CSS, id, atrybuty `data-*`, trasy API, klucze JSON,
sekcje i klucze `global.conf`, nazwy plików, flagi, zmienne środowiskowe, adresy stron `#…`) – decyzja użytkownika
2026-11-21. **Po polsku zostają: teksty interfejsu, komentarze w kodzie, CLAUDE.md i `łączenia czujników.txt`** (notatka).
* **Commity: bez dopisku `Co-Authored-By: Claude…` ani innego podpisu Claude** – użytkownik nie chce Claude
w „Contributors” na GitHubie (2026-11-20). Autor i push jako użytkownik (`iamCh4rl35`, git config na PC).

## Miejsca operacji

* PC (Arch Linux): `/home/karolkubik/Dokumenty/Projekty/BEENest` — główny katalog projektu.
* Raspberry Pi 5 8 GB (Raspberry Pi OS na Debianie 13 trixie, hostname `raspberrypi`):
`ssh beenest@192.168.1.219`, katalog **`/home/beenest/BEENest`** (tak jak na PC; nie „BEEnest”) — kopia na właściwej maszynie.
Na Pi jest też `~/bme-env` (prawdopodobnie środowisko Pythona do BME280).
* SSH: klucz PC `~/.ssh/id_ed25519` dodany na Pi (`ssh-copy-id`, 2026-11-20). Claude łączy się z `-o BatchMode=yes`.
* Pulpit Pi: Wayland, kompozytor **labwc**, gniazdo `wayland-0`. Program graficzny przez SSH:
`export WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/$(id -u); nohup chromium --ozone-platform=wayland >/tmp/chromium-ssh.log 2>&1 &`
— bez `--ozone-platform=wayland` Chromium szuka X-serwera i kończy się błędem „Missing X server or $DISPLAY”.
* Powłoka użytkownika na Pi to **fish** — dłuższe polecenia przez `ssh ... bash -s <<'EOF' ... EOF`.
* **sudo na Pi wymaga hasła** — Claude nie robi zmian systemowych sam; daje użytkownikowi komendę
`ssh -t beenest@192.168.1.219 sudo bash BEENest/pi/install.sh` do uruchomienia w terminalu.
* Commit 6efef22 (2026-11-20) wypchnięty na GitHub; repozytorium na Pi wyrównane do niego (`git merge --ff-only`),
na Pi `core.fileMode=false`. Skrypty w `pi/` są w gicie jako 644 – `kiosk.sh` musi mieć +x (lwrespawn uruchamia
go wprost); `install.sh` robi `chmod +x`, ale `git pull` zmieniający ten plik może zdjąć +x.
* Synchronizacja PC → Pi: `scp` zmienionych plików (Pi ma też repozytorium git; przed `git pull` na Pi
może być potrzebne `git checkout -- <file>`). Sprawdzanie zgodności: `md5sum`.
* LAN (eth0) to połączenie do zarządzania. Użytkownik wyłączał Wi-Fi, bo połączenie klienckie
„Pixel 9 Pro (Karol)” psuło LAN; hotspot (tryb `shared`) nie daje trasy domyślnej, więc LAN-u nie rusza.
* Wyświetlacz: HDMI-A-2, 1024×600, dotyk „WaveShare WS170120” (wpis `<touch>` w `~/.config/labwc/rc.xml`).

## Konfiguracja Raspberry (`pi/`)

* `pi/install.sh` (sudo, wielokrotnie): Wi-Fi włączone, hotspot `Pi-hotspot` (SSID „BEENest Access Web”,
autostart, priorytet 100, 10.42.0.1), DNS hotspotu `address=/#/10.42.0.1` w
`/etc/NetworkManager/dnsmasq-shared.d/beenest.conf`, usługa `beenest.service` (użytkownik beenest,
`CAP_NET_BIND_SERVICE` na port 80, `/etc/sudoers.d/beenest` pozwala na `shutdown`), motyw Plymouth
`beenest` z `pi/boot-logo.png` (+ `logo.nologo`, `vt.global_cursor_default=0`, `disable_splash=1`).
Kopie oryginałów: `*.before-beenest`.
* **Kiosk = osobna sesja lightdm `beenest-kiosk`** (`autologin-session` w `/etc/lightdm/lightdm.conf`):
`/usr/local/bin/beenest-kiosk` → `labwc -C /etc/beenest/labwc` (autostart: kanshi + `lwrespawn pi/kiosk.sh`).
Powód: sesja pulpitu `labwc-pi` uruchamia labwc z `-m` (łączy konfigurację użytkownika z `/etc/xdg/labwc`),
więc wpis w `~/.config/labwc/autostart` dokładał kiosk do pulpitu, a skrótów systemowych nie dało się usunąć.
`--desktop` przełącza autologowanie z powrotem na `rpd-labwc` (pulpit użytkownika nietknięty).
* `--lock`: brak getty (logind `NAutoVTs=0`, maska getty@tty1 i serial-getty@ttyAMA10, bez `console=tty1`),
w `/etc/beenest/labwc`: `XKB_DEFAULT_OPTIONS=srvrkeys:none` (Ctrl+Alt+Fn nic nie robi) i rc.xml bez skrótów
i menu; zasady Chromium (`/etc/chromium/policies/managed/beenest.json`: tylko http://127.0.0.1, bez narzędzi
programisty, plików, pobierania), `kernel.sysrq=0`. **SSH zostaje z hasłem użytkownika beenest**
(życzenie użytkownika, 2026-11-20 — nie wyłączać `PasswordAuthentication`). `--unlock` cofa blokadę.
* Kursor ukryty (ekran dotykowy): motyw `/usr/share/icons/beenest-no-cursor` — jeden przezroczysty plik
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
* Stan 2026-11-20: `install.sh` uruchomiony raz (bez blokady). Hotspot wstał (wlan0 = Pi-hotspot, LAN
dalej trasą domyślną), DNS hotspotu odpowiada 10.42.0.1 na każdą nazwę, kiosk i logo ustawione.
Usługa padała: `data/global.conf` i `data/secret.key` należały do roota (wcześniej `sudo python3 app.py`)
→ skrypt robi teraz `chown -R` katalogu aplikacji. Po `chown` serwer działa (index 200, generate_204 → 204,
hotspot-detect.html → Success, `/api/data` z hotspotu → 401), kiosk widoczny na ekranie (zrzut: `grim`).
Pod kioskiem działał jeszcze pulpit → przepisane na osobną sesję. Po restarcie (20:20) działa tylko
`labwc -C /etc/beenest/labwc` + Chromium, bez wf-panel-pi i pcmanfm; panel ula na całym ekranie.
Logo startowe potwierdzone przez użytkownika. **Blokada włączona 2026-11-20 20:40** (`--lock`):
getty zamaskowane, `console=tty1` usunięte, `srvrkeys:none`, rc.xml kiosku bez skrótów, zasady Chromium,
sysrq=0, EEPROM `NET_INSTALL_AT_POWER_ON=0`, kursor przezroczysty; SSH nadal przyjmuje hasło i klucz.
* Oś startu (2026-11-20): Plymouth 3,2–6,7 s → lightdm/labwc ~7 s → Chromium ~10 s → panel ~13–14 s.
Przy zimnym starcie użytkownik widział tylko czarny ekran ~10 s (logo tylko przy restarcie — monitor
budzi się za późno na krótkie okno Plymoutha). Rozwiązanie: `swaybg -m fit -i .../beenest/splash.png`
jako tło w autostarcie kiosku (swaybg jest w systemie). Wdrożone i po zimnym starcie swaybg działa od
startu sesji (Plymouth 3,4–6,8 s, Chromium 12,8 s); użytkownik potwierdził: logo widać aż do panelu.
* **Biały błysk po logo (2026-11-21, naprawione):** dwie przyczyny, zmierzone zrzutami `grim -t ppm -s 0.05` co 0,1 s
podczas `pkill -x chromium` (skrypt w stylu: średnia jasność klatek). 1) `<body data-theme="white-pollen">` na sztywno
w `main.html`, ciemny motyw nakładał dopiero app.js + przejście `background .3s` → ~0,6 s bieli. Teraz serwer wpisuje
`data-theme`, `data-contrast`, `data-device` w szablonie. 2) Puste okno Chromium przed pierwszą klatką (~0,1–0,2 s)
ma kolor motywu GTK (PiXflat = biały); `--force-dark-mode` i `--default-background-color` NIE pomagają.
`kiosk.sh` czyta `theme` z `[device 127.0.0.1]` i ustawia `GTK_THEME=Adwaita:dark` (ciemne motywy) / `Adwaita`.
Motyw GTK obowiązuje od następnego startu Chromium. Chromium nadpisuje `/proc/<pid>/environ` – zmiennych tak nie sprawdzisz.
* **Logo startowe w kolorach motywu wyświetlacza** (2026-11-21): `BOOT_LOGO_COLORS` w `app.py` (tło, „BEE”, „NEST” –
zmierzone z CSS wyświetlacza, 4 motywy × kontrast). `update_boot_logo()` (start serwera + zmiana `theme`/`highContrast`
z wyświetlacza) woła `pi/logo.py` (przekolorowanie `pi/boot-logo.png`, sama biblioteka standardowa; piksel =
mieszanka czerni, bieli i pomarańczu → udziały z kanałów B i R−B; wariant czarny = oryginał co do bajtu)
→ `data/logo.png` + `logo.color` + `logo.theme`. Tło kiosku: `pi/background.sh` (swaybg z `data/logo.png`).
Plymouth czyta logo z **initramfs** → `beenest-logo.path` (PathChanged na `data/logo.png`) uruchamia
`/usr/local/bin/beenest-logo` (root): kopiuje do motywu i `update-initramfs -u`; `.in-initramfs` = co jest w initramfs.
Wymaga `install.sh` (autostart kiosku, jednostki systemd). Ekranu firmware/EEPROM przed Plymouthem nie da się zmienić.
* **Zgaszenie ekranu zahasłowuje panel** (2026-11-21): `POST /api/screen/sleep` z wyświetlacza zeruje `admin_until`
(każde uśpienie: ręczne, po 10 min, na prośbę telefonu, przy blokadzie). Wpięty Klucz dalej daje administratora.
* Uwaga (niepoprawione): serwer startuje przed hotspotem, więc w logu „nie znalazłem adresu IP”
i `beenest.local` nie jest rozgłaszane przez zeroconf; na hotspocie nazwę i tak rozwiązuje dnsmasq.
* **Parowanie i adresy (2026-11-20):**
    * Ciasteczko parowania przeglądarka wiąże z nazwą z paska adresu → wejście przez 10.42.0.1 i przez
beenest.local to dla niej dwa różne miejsca („gubienie” urządzenia). Dlatego `one_address()` w `app.py`:
GET `/` z hotspotu (`HOTSPOT_PREFIX`) pod inną nazwą niż beenest.local → 302 na `http://beenest.local/`.
Kod QR (`pairing_address`) przy hotspocie daje beenest.local.
    * Nazwa komputera Pi ma być **`beenest`** (avahi rozgłasza beenest.local na każdym interfejsie; zeroconf
w app.py nie widział hotspotu, bo ten wstaje po serwerze). Ustawia ją `install.sh`.
    * Hasło hotspotu było puste w QR: usługa bez sesji nie miała prawa `nmcli -s` → reguła polkit
`/etc/polkit-1/rules.d/50-beenest.rules` (NetworkManager.settings.modify.system dla beenest).
    * Nazwa urządzenia z DHCP: dnsmasq `dhcp-script=/usr/local/bin/beenest-dhcp` zapisuje nazwy do
`/run/beenest-dhcp/<IP>`; `network_name()` zamienia myślniki na spacje („Pixel-9-Pro-Karol” → „Pixel 9 Pro Karol”,
nawiasów z nazwy telefonu nie da się odtworzyć). Strona dostaje ją w `BEENEST_DEVICE.network_name`.
    * Ponowne parowanie pod tą samą nazwą (bez wielkości liter) zastępuje stary zapamiętany wpis.
    * Pierwsze wejście urządzenia (`!device.known`): motyw z systemu (`systemLook()`: ciemny → nocna-czern,
`prefers-contrast: more` → wysoki kontrast) i zapis od razu (zakłada sekcję `[device <IP>]`).
    * Szybki konfigurator (`openSetup()`, sekcja 16 `app.js`; `#setup` w `main.html`; `.setup*` w CSS):
po sparowaniu (flaga `sessionStorage['beenest-setup']`). Karta 1 = prawdziwy `#settings-appearance`
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
bez sensu). `pi/install.sh` NIE ma tej zmiany: jego uruchomienie przywraca „fałszywy internet” (przywrócone 21:50).
**Wynik próby:** panel działa, ale Android po „pozostań w sieci” robi z Wi-Fi ula sieć domyślną
dla całego ruchu – danych komórkowych nie używa. Bez tej zgody domyślne są dane, a Chrome wysyła
tamtędy także panel (nie działa). Android nie dzieli ruchu przeglądarki według celu (iOS tak).
Wniosek: samym ustawieniem hotspotu się nie da. Rozważane dalej: opcja 2 = prawdziwe łącze w ulu (modem LTE na USB albo druga karta Wi-Fi) – shared
udostępni je telefonom; opcja 3 = Pi jako klient hotspotu telefonu.
    * Serwer można zrestartować bez sudo: `pkill -f "[B]EENest/app.py"` (systemd `Restart=always` go podnosi).
**Nawiasy `[B]` są ważne** – bez nich `pkill -f` w poleceniu `ssh ... '...'` zabija też własną powłokę SSH (kod 255).
To samo na PC: lokalny serwer testowy zatrzymuj po numerze procesu z `ss -ltnp 'sport = :8077'`, nie `pkill -f app.py`.
**Heredoki:** tekst wklejany przez `python3 - <<'EOF'` nie może zawierać linijki `EOF` (bash kończy wtedy skrypt
i resztę wykonuje sam – tak próbował uruchomić na PC fragment `install.sh`). Dłuższe zmiany: skrypt do pliku w scratchpadzie.
Testy na PC zapisują `data/global.conf` – kopia przed testem i przywrócenie po nim.
    * Zgłoszonego błędu „trzeba podać inną nazwę, żeby sparować ponownie” nie odtworzyłem (dziennik na Pi
nie jest trwały – tylko bieżące uruchomienie); w kodzie nie było sprawdzania unikalności nazw.
* **Energooszczędność i kafelki (2026-11-20):**
    * Karta Ustawienia na stronie głównej = 4 kafelki `.dash-card.quad` (2×2, na telefonie w rzędzie):
Ustawienia (link), Parowanie (`#tile-pair`, `data-admin data-only="display"`, klika `#btn-pair`),
Zasilanie (`#tile-power`: okno z Wyłącz / Uruchom ponownie – klikają `#btn-shutdown` / `#btn-reboot`, więc
uprawnienia jak w Działaniu – oraz Uśpij ekran tylko na wyświetlaczu), Szybkie ustawienia (`#tile-quick`:
jasność – tylko wyświetlacz, motyw jako 4 kafelki z próbką koloru, kontrast, Zamknij / Przejdź do ustawień).
Wiersze siatki `minmax(0, 1fr)` – inaczej kafelki rozpychały stronę na 1024×600.
    * Jasność: ustawienie urządzenia `brightness` ("1"…"100", domyślnie "100"), suwak w Wyglądzie
(`data-only="display"`). Wyświetlacz HDMI (Waveshare, EDID „Lenovo”) nie ma `/sys/class/backlight`
ani DDC → jasność programowo: czarna warstwa `#dim`. **1 % na suwaku = 60 % prawdziwej jasności**
(`DIM_FLOOR`; poniżej 60 % panel ma błędy obrazu – zgłoszenie użytkownika), 100 % = 100 %.
Animacja usypiania może ściemniać głębiej (do 0,6 krycia warstwy).
    * Animacja usypiania przyspieszona 2× na życzenie użytkownika: 375 ms (`CRT_TIME` w app.js = `.crt-off` w CSS).
Budzenie dotykiem przy wyłączonym HDMI potwierdzone przez użytkownika na wyświetlaczu.
    * Uśpienie (sekcja 14 `app.js`): animacja `html.crt-off` (body → jasny pas → punkt), zasłona `#sleep`,
serwer `POST /api/screen/sleep|wake` → `screen_power()` = `wlopm --off|--on '*'` (tylko na Raspberry, env
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
    * Telefon (`body[data-device="phone"]`): kafelki jako osobne karty (Ustawienia, Zasilanie, Estetyka).
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
    * Zgaś ekran ula z telefonu: `POST /api/screen/sleep` od telefonu zwiększa `_screen["requests"]`, wyświetlacz
widzi zmianę `sleep_request` w stanie i sam robi animację + wlopm.
    * Parowanie: kod, Wi-Fi i decyzję może obsłużyć **każde urządzenie administratora** (`need()` zamiast
`need(display=True)`). Prośba trafia naraz na wyświetlacz i telefony administratorów (watcher w sekcji 15e);
decyzja gdziekolwiek zamyka okno wszędzie (`request` znika, `decided` = {id, zgoda} przez 30 s).
Wyświetlacz bez uprawnień: decyzja prosi o PIN. Zamknięcie tłem/Escape = tylko na tym urządzeniu.
    * Kiosk: autostart `lwrespawn /bin/sh pi/kiosk.sh` (niezależnie od prawa wykonywania); skrypty w gicie 100755.
Zmiana autostartu wymaga ponownego `sudo bash pi/install.sh --lock`.
* **Kolory wyświetlacza Waveshare 7" (2026-11-20):**
    * Plansza testowa (szarości 0–80 i 160–255): ciemne zlewają się z czernią do ~40 (48 wyraźne), jasne od 232
w górę zlewają się w biel → niezgodny zakres HDMI: Pi przy 1024×600 wysyła pełny 0–255 („Broadcast RGB” =
Automatic), panel oczekuje 16–235. Zrzut `grim` pokazuje kolory poprawnie (problem jest za kartą graficzną).
    * `pi/hdmi_range.py` (ioctl DRM, tylko biblioteka standardowa): pokazuje / ustawia „Broadcast RGB”
(`limited | full | auto`). Działa tylko bez kompozytora → woła go `/usr/local/bin/beenest-kiosk`
przed `exec labwc` (`HDMI_RANGE=limited` na górze `install.sh`, wynik w dzienniku: `journalctl -t beenest-hdmi`).
    * Dodatkowo CSS tylko dla wyświetlacza (`body[data-device="display"]`) w ciemnych motywach:
rozjaśnione `--card-background`, `--line`, `--orange-soft`, `--dock-bg` (Nocna Czerń #38312F / #554B48 /
#5C3A00; Miodna Szarość #463820 / #66542F / #5E4818, tło #2E2410). Użytkownik ocenił nowe tła „spoko”.
Neutralne szarości (#333333) panel pokazuje zielonkawo → karta lekko ciepła #38312F (wybór z planszy, wariant 4).
**Korekta ma działać wyłącznie na wyświetlaczu – telefony i komputery mają oryginalne kolory** (wymóg).
    * Po włączeniu zakresu ograniczonego (wdrożone 23:03): ciemne widać od 32 (ledwo) / 40 (wyraźnie), jasne
prawie w pełnej skali (3 ostatnie trudno odróżnić) – lepiej o jeden stopień, zakres zostaje „ograniczony”.
Plansza testowa: tylko tymczasowo w `static/test-kolorow.html` na Pi (usunięta, nie w repozytorium).
* Użytkownik ma wyświetlacz Pi obok siebie i widzi go na żywo — można go prosić o sprawdzenie ekranu.

## Uruchomienie

```
pip install -r requirements.txt      # raz: flask, zeroconf
python3 app.py                       # serwer; port 80, gdy zajęty / brak prawa – 8000
python3 app.py --set-pin             # PIN administratora i koniec (bez uruchamiania serwera)
BEENEST_PORT=8077 BEENEST_NO_SECURITY=1 python3 app.py   # zmienne można łączyć
```

### Parametry `app.py` (wszystkie, 2026-11-21)

**Flaga w wierszu poleceń** – jedyna:

|Flaga|Działanie|
|-|-|
|`--set-pin`|Pyta dwa razy o PIN administratora (6 cyfr, bez echa – `getpass`), zapisuje skrót werkzeug w `data/global.conf` `[admin] pin` i kończy (`sys.exit(0)`), serwera nie uruchamia. Działa także przy uruchomionym serwerze – ten wczytuje plik sam po zmianie daty. To jedyny sposób na pierwszy albo zapomniany PIN („kto ma konsolę Raspberry, ten jest właścicielem”).|

**Zmienne środowiskowe** – włączane wartością `1` (inna wartość albo brak = wyłączone), o ile nie napisano inaczej:

|Zmienna|Domyślnie|Działanie|
|-|-|-|
|`BEENEST_PORT=<numer>`|brak|Serwer słucha tylko na tym porcie (bez zapasowego). Bez zmiennej: port 80 (wtedy `http://beenest.local` bez numeru), a gdy 80 jest zajęty albo brak prawa (`CAP_NET_BIND_SERVICE` daje je usłudze) – 8000. Żaden wolny = komunikat i wyjście. Nie-liczba = błąd przy starcie.|
|`BEENEST_DEBUG=1`|wyłączone|Tryb deweloperski Flaska: auto-reload po zmianie plików `.py`, błędy z pełnym śladem w przeglądarce, port 8000 (jeśli nie ma `BEENEST_PORT`). Reloader uruchamia drugi proces – wątki (czujniki, USB, logo) i rozgłaszanie nazwy startują tylko w tym, który obsługuje żądania (`WERKZEUG_RUN_MAIN`). Nie sprawdza wolności portu. `main.html` i tak wymaga restartu.|
|`BEENEST_NO_SECURITY=1`|wyłączone|**Tylko testy**: każde urządzenie jest administratorem (`level = admin`, `via = no-security`), bez parowania, PIN-u, blokady i Klucza; na wyświetlaczu nie ma kłódki ani grupy Bezpieczeństwo. Przy starcie ostrzeżenie w konsoli.|
|`BEENEST_SENSOR_DEMO=1`|samo na PC|Sterowniki czujników (`hardware.DEMO`) podają dane przykładowe zamiast czytać I2C / GPIO / mikrofon / PWM. Włącza się samo, gdy nie ma `/proc/device-tree/model` (komputer zamiast Raspberry). Na Pi wymusza dane przykładowe.|
|`BEENEST_CAMERA_DEMO=1`|wyłączone|Kamera (`camera_detector_driver`) bez picamera2: strumień szarej klatki 16×9 z prędkością `FPS`. Bez tego na PC podgląd kamery jest „Offline”.|
|`BEENEST_USB=<katalog>`|brak|Testy Klucza: każdy podkatalog tego katalogu udaje jeden wpięty pendrive (plik `beenest.key` w środku = Klucz). Wyłącza automontowanie (`usb_automount`) i bezpieczne odłączanie (`safe_eject`).|

Zmienne czytane pośrednio: `XDG_RUNTIME_DIR` i `WAYLAND_DISPLAY` (domyślnie `/run/user/<uid>` i `wayland-0`) dla `wlopm` przy gaszeniu ekranu; usługa systemd ustawia `PYTHONUNBUFFERED=1`. Pozostałe skrypty: `pi/install.sh [--lock | --unlock | --desktop]`, `pi/hdmi_range.py [limited | full | auto]`, `pi/logo.py <źródło> <wynik> <tło> <BEE> <NEST>`.

* Zmiana `app.py` lub `main.html` wymaga restartu aplikacji (szablon nie przeładowuje się sam).
Zmiany w `static/` wystarczy odświeżyć w przeglądarce (czasem Ctrl+Shift+R).
* Na Pi: hotspot NetworkManagera `Pi-hotspot`, adres 10.42.0.1, mDNS `beenest.local`.
* **Wyświetlacz przy ulu musi otwierać `http://127.0.0.1`** (tylko adres pętli zwrotnej jest
rozpoznawany jako wyświetlacz; `beenest.local` na samym Pi byłby traktowany jak telefon).
* Testy na PC bez czujników: sterowniki same przechodzą w tryb demonstracyjny (patrz `BEENEST_SENSOR_DEMO`);
`smbus2` / `bme280` nie są już potrzebne (I2C przez `hardware.I2C`, sama biblioteka standardowa).
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
hardware.py                     wspólne dla sterowników: DEMO, GPIO (pinctrl), PWM (/sys/class/pwm), I2C (/dev/i2c-1)
buzzer\_driver.py                alarm() / beep() – buzzer pasywny, PWM0 kanał 1 (GPIO13)
ir\_driver.py                    naświetlacze IR (GPIO23), włącza je camera\_detector\_driver przy kamerze internal
data/beenest.db                 powstaje sam: tabela readings(ts, key, value) + kv (stan, np. f\_last)
data/global.conf                powstaje sam: wszystkie ustawienia (patrz niżej)
data/secret.key                 powstaje sam: klucz podpisujący ciasteczka (nowy = telefony do ponownego parowania)
data/outlet                     ostatnia zadana pozycja wylotka (%)
data/logo.png, logo.color, logo.theme   logo startowe w kolorach motywu wyświetlacza (update_boot_logo)
pi/install.sh                   konfiguracja Raspberry (sudo; --lock, --unlock, --desktop)
pi/kiosk.sh, pi/background.sh   przeglądarka kiosku i tło z logo (uruchamia je autostart labwc)
pi/hdmi_range.py                zakres kolorów HDMI (limited | full | auto)
pi/logo.py, pi/boot-logo.png    przekolorowanie logo startowego / oryginał
```

**Ściąga dawnych nazw (do 2026-11-21 po polsku)** – starsze notatki niżej mogą jeszcze ich używać:
`instaluj.sh`→`install.sh` (`--blokada/--odblokuj/--pulpit` → `--lock/--unlock/--desktop`), `tlo.sh`→`background.sh`,
`hdmi_zakres.py`→`hdmi_range.py` (`ograniczony/pelny`→`limited/full`), `logo-startowe.png`→`boot-logo.png`;
`/api/zabezpieczenia|parowanie|urzadzenia|klucz|ekran|wylotek` → `/api/security|pairing|devices|key|screen|outlet`;
sekcje `[zapis] [wyglad] [administrator] [wylotek] [urzadzenie IP] [sparowane id]` → `[storage] [look] [admin] [outlet]
[device IP] [paired id]` (migracja `_migrate_polish_conf` przepisuje stary plik sama); motywy `bialy-pylek, lekki-miodek,
nocna-czern, miodna-szarosc` → `white-pollen, light-honey, night-black, honey-grey`; strony `#temperatura #samopoczucie
#dokarmiaczka #wylotek #ustawienia` → `#atmosphere #wellbeing #feeder #outlet #settings`; `data-urzadzenie="wyswietlacz|telefon"`
→ `data-device="display|phone"`; klucze JSON np. `poziom/wyswietlacz/przez/klucz/nazwa` → `level/display/via/key/name`;
Klucz `beenest.klucz`→`beenest.key` (stary plik nadal czytany); ciasteczko `urzadzenie`→`device` (stare przepisywane);
`BEENEST_BEZ_ZABEZPIECZEN/CZUJNIKI_DEMO` → `BEENEST_NO_SECURITY/SENSOR_DEMO`; `--ustaw-pin`→`--set-pin`.

`data/` jest w `.gitignore`.

**Sterowniki (2026-11-21) czytają prawdziwy sprzęt** według „łączenia czujników.txt”, tylko biblioteką standardową
(bez smbus2 / bme280 / gpiozero – zakomentowane importy zniknęły): atmosfera = 2 × BME280 przez `hardware.I2C`
(tryb forced, wzory Boscha; BMP280 też, bez wilgotności; jeden brakujący czujnik = None w jego polach, oba = wyjątek),
dokarmiaczka = 3 × XKC-Y25-V (`pinctrl`, `LIQUID_IS_HIGH`),
samopoczucie = ICS43434 przez `arecord` (48 kHz S32 stereo, lewy kanał, 1 s; dB = dBFS + 120; FFT w Pythonie po
uśrednieniu do 8 kHz, szczyt 50–1000 Hz), wylotek = serwo MG-996R (`set_position(%)`, pozycja zapisana w
`data/outlet`, impulsy gasną po ruchu – `HOLD`; kalibracja `PULSE_BLOCKED_US` / `PULSE_OPEN_US`; strona nie ma jeszcze
przycisków). Sprawdzone na danych wzorcowych (Bosch: 25,08 °C / 100 653 Pa; ton 240 Hz) i na Pi bez czujników.
**Tryb demonstracyjny:** sam na komputerze (brak `/proc/device-tree`) albo `BEENEST_SENSOR_DEMO=1`.
Na Pi do podłączenia potrzebne w `/boot/firmware/config.txt` (sudo, jeszcze NIE dopisane):
`dtoverlay=pwm-2chan,pin=12,func=4,pin2=13,func2=4` (serwo + buzzer) i `dtoverlay=adau7002-simple` (mikrofon).
Bez nich sterowniki zgłaszają w dzienniku, co dopisać. Na Pi brak `i2c-tools` (`i2cdetect`).
Kamera (`camera\_detector\_driver.py`) działa naprawdę przez picamera2 / libcamera (MJPEG),
dwie kamery: `external` (CAM0) i `internal` (CAM1).
Progi samopoczucia (`WELLBEING\_\*\_HZ`, `WELLBEING\_MAX\_DB`) są w `wellbeing\_detector\_driver.py`;
używa ich `wellbeing\_status` w `app.py` i linie stref na wykresie.

### Dokarmiaczka (2026-11-21)

* Poziom z 3 czujników cieczy: wszystkie widzą ciecz = 100 %, dwa = 80 %, jeden = 40 %, żaden = 15 %
(`LEVEL_PERCENT` w `feeder_detector_driver.py`). **Masa pokarmu usunięta z programu** (`f_weight` nie istnieje –
polecenie użytkownika; w bazie na Pi mogą zostać stare wiersze `f_weight` z danych demonstracyjnych).
* Ustawienie urządzenia `feederWords` (domyślnie tak, Wygląd → „Słowny stan dokarmiaczki”): słowa zamiast %:
Pełny / Zapas płynu / Połowa zbiornika / Wymaga napełnienia (`FEEDER_WORDS`, `feederSensors()` w app.js – progi 90/60/28).
* Strona Dokarmiaczka: model zbiornika `#feeder-tank` (opis po lewej, pionowy prostokąt 140×176 px z 4 częściami,
bez „czubka” baterii – poprawka użytkownika). Zapalone części = czujniki + 1. Przy wejściu na stronę części
zapalają się od dołu w 0,5 s (`fillTank`, `TANK_FILL_MS`). Poprzedni pasek `#feeder-bar` usunięty.
* Kafelek na stronie głównej: napis dłuższy niż 12 znaków dostaje `.card-status.is-long` (mniejsza czcionka, jedna
linijka) – „Wymaga napełnienia” w dwóch linijkach rozpychał menu główne na 1024×600 (pasek przewijania na Pi).

### Wylotek (2026-11-21)

* Strona: model zasuwy `#outlet-door` (SVG: otwór = koło r=44, zasuwa = kwadrat 88 przesuwany `translateX(-88·p/100)`;
100 % = kwadrat dotyka koła jednym punktem, 0 % = zakrywa; obrys koła ciągłą linią nad zasuwą). Otwór
`color-mix(var(--black) 82%, karta)` = ciemny w jasnych motywach, jasny w ciemnych. Pasek procentowy usunięty.
Przyciski w lewym dolnym rogu panelu (`.door-actions`, `data-admin`): Otwórz (100), Zablokuj (0), Sterowanie.
* Okno „Sterowanie wylotkiem” (`openOutlet()`, sekcja 13 `app.js`): suwak 0–100 na żywo (wysyła najwyżej co
`OUTLET_SEND_EVERY` = 150 ms + na koniec), reguły „Ustaw na x % o GG:MM / Kasuj warunek”, najwyżej 6 (`OUTLET_MAX_RULES`).
Klik w wartość = klawiatura numeryczna `numpad()` w osobnej warstwie `.numpad-layer` (z-index 205: nad oknem 200,
pod PIN-em 210; w karcie okna `backdrop-filter` więziłby `position: fixed`), wyrasta z klikniętej wartości.
* Ustawienia: Działanie → grupa „Ul” → „Sterowanie wylotkiem” (wiersz ze strzałką `#btn-outlet-settings`).
* Serwer: `POST /api/outlet {position}` (administrator) → `move_outlet()`; `GET/POST /api/outlet/rules`;
reguły w `global.conf` `[outlet]` (`regulaN = GG:MM procent`); `run_outlet_rules()` w `sample_once` (co 5 s,
każda minuta raz). Sterownik: `set_position()` nie czeka – impulsy gasną `MOVE_SECONDS` po ostatniej komendzie.
* Panel zbiornika (Dokarmiaczka) i panel zasuwy zajmują resztę ekranu (`flex: 1`); zbiornik rośnie z panelem
(`aspect-ratio 140/176`, 176–420 px wysokości).

### Panele ustawień (2026-11-21)

* **Wszystkie okna ustawień (poza parowaniem, Kluczem i zasilaniem) = panel od prawej jak Urządzenia**:
`#sheet-panel` (klasy `.side-panel/.side-card/.side-head`, treść `.sheet-body` przewija się sama), `openSheet({title,
desc, content, onClose})` → Promise po zamknięciu; `closeSheet()`; krzyżyk, tło, Escape (nie gdy Escape zamknął listę
rozwijaną – `e.defaultPrevented` – ani gdy jest okno / PIN / klawiatura numeryczna). Korzystają: Estetyka (kafelek
i Wygląd), Sterowanie wylotkiem, Zapisy i odczyty.
* Działanie → „Zapisy i odczyty” to jeden wiersz `#btn-saving`; prawdziwe wiersze (interwał, długość, tempo,
wymazywanie) leżą w ukrytym `#saving-source` i na czas otwarcia są **przenoszone** do panelu (`openSaving`,
zostaje cała ich obsługa), po animacji zamykania wracają (`savingBox` pilnuje szybkiego ponownego otwarcia).
* Listy rozwijane (`.dd-menu`, z-index 150, na końcu `<body>`) rysują się nad panelem (też 150, wcześniej w DOM).
`modalClose()` / `pinClose()` nie odblokowują strony, gdy otwarty jest jakikolwiek `.side-panel`.
* **Działanie = jedna kolumna jak Wygląd** (decyzja użytkownika z ankiety, 2026-11-21; dawne `.settings-cols` nieużywane):
dwie grupy – „Ul” (Zapisy i odczyty →, Alarm napełnienia, Sterowanie wylotkiem →, Zasilanie ula = jeden wiersz
z dwoma przyciskami `#btn-reboot` / `#btn-shutdown` w `.power-buttons`) i „Bezpieczeństwo”. Bez osobnej grupy
„Informowanie” (jedna pozycja – życzenie użytkownika). Mieści się na 1024×600 **dokładnie** (539 = 539) dzięki
`#settings-operation .setting-row { padding: 7px 0 }` w regule `max-height: 720px` – nowy wiersz w Działaniu już się nie zmieści.
* Klawiatura numeryczna: `.numpad .numpad-ok { align-self: center }` – sama `.numpad-ok` przegrywała z `.back-btn`
(ta sama szczegółowość, `.back-btn` niżej w pliku, `align-self: flex-start`).
* Dokarmiaczka i Wylotek: nagłówek w `.page-head` obok „← Wróć do panelu” (jak Atmosfera i Samopoczucie), bez podpisu.
* Kafelek Monitoring = `.panel-card` jak sąsiednie: ikona kamery filmowej, `#dash-camera-compact` = Zewnętrzna /
Wewnętrzna (wybrana kamera), podpis „Wybrana kamera”. Stary styl `.dash-card.monitoring` usunięty.

### Nazwy po angielsku, optymalizacja i porządek (2026-11-21)

* Tłumaczenie nazw zrobione skryptem z jawną mapą (reguły tylko w kontekście kodu: klucze w cudzysłowach,
`.właściwość`, klucze obiektów, kwargs, atrybuty HTML, selektory CSS), potem przegląd `git diff --word-diff`.
Sprawdzone: migracja prawdziwego `global.conf` z Pi (PIN, Klucz, sparowane, motywy zachowane), parowanie
klientem testowym Flaska (kod → zgłoszenie → zgoda → ciasteczko → odłączenie), stare ciasteczko, wszystkie strony.
* **Na Pi zostały stare pliki `pi/instaluj.sh`, `pi/tlo.sh`, `pi/hdmi_zakres.py`, `pi/logo-startowe.png`** (aktualna
sesja kiosku i `/usr/local/bin/beenest-kiosk` jeszcze z nich korzystają) – usunąć po `sudo bash pi/install.sh --lock`.
Kopia `global.conf` sprzed migracji: `~/global.conf.przed-tlumaczeniem` na Pi.
* Optymalizacje serwera: schemat bazy zakładany raz (wcześniej 3× `CREATE` przy każdym połączeniu); min/max z 24 h
jednym zapytaniem `day_ranges()` (było 6 połączeń co 5 s; na PC 0,6 → 0,1 ms); czas napełnienia `f_last` w pamięci
(`last_refill_time()`); `lsblk` tylko po zmianie listy `/sys/class/block/sd*` (`_usb["blocks"]`, było co sekundę przy
wpiętym pendrivie); `on_raspberry()` z `lru_cache`. Strona: `applySecurity` przestawia `[data-only]` / `[data-admin]`
tylko po zmianie poziomu / urządzenia (stan przychodzi co 1–2 s).
* Porządek: `body()` = treść JSON żądania (zamiast 11× `request.get_json(silent=True) or {}`), `device_label()` także
w logu pierwszego połączenia, usunięte martwe `set_server_settings`, `.btn-row`, `.settings-cols`, `.single`;
sekcje `app.js` ponumerowane po kolei (0–17; 12a kafelki, 12b panel ustawień, 13 wylotek, 14 ekran, 15 zabezpieczenia,
16 konfigurator, 17 start) – kod nie był przenoszony (kolejność deklaracji `const`/`let`).

### Strony (`#hash`)

`home`, `monitoring` (kamera, klik = płynne powiększenie), `atmosphere` (Atmosfera: temperatura,
wilgotność, ciśnienie, w ulu / na zewnątrz, min i maks z 24 godzin + wykres), `wellbeing`
(kafelki + wykres częstotliwości ze strefami), `feeder`, `outlet`, `settings`
(pionowy dock: Wygląd / Działanie / Informacje).

### API

|Trasa|Opis|
|-|-|
|`GET /`|strona; serwer wkleja ustawienia urządzenia (`window.BEENEST\_DEVICE`), stan zabezpieczeń (`window.BEENEST\_AUTH`) i CSS z `\[look]`|
|`GET /api/data`|ostatni odczyt wszystkich czujników + min/max 24 h (strona pyta co 5 s)|
|`GET /api/history?keys=a,b\&range=12h`|średnie do wykresów; zakresy 12h,1d,3d,7d,14d,30d,3m,6m (`CHART\_RANGES`)|
|`GET /api/camera/<external\|internal>/stream`|MJPEG|
|`GET/POST /api/settings`|odczyt / zmiana ustawień (JSON)|
|`POST /api/outlet`, `GET/POST /api/outlet/rules`|ruch zasuwy (0–100) i reguły otwarcia o godzinie (administrator)|
|`POST /api/history/clear`|wymazuje historię atmosfery i samopoczucia (`HISTORY\_KEYS`) + VACUUM|
|`POST /api/system/update`|`git pull`, opcjonalnie `{"reboot": true}`|
|`POST /api/system/reboot`, `/shutdown`|zasilanie|
|`GET /api/security/state`|poziom, blokada, Klucz, pendrive'y, prośba o parowanie (strona pyta co 1 s / 2 s)|
|`POST /api/security/pin`, `/activity`, `/lock`|wyświetlacz: odblokowanie PIN-em, dotyk przedłuża, „Zahasłuj Panel”|
|`POST /api/security/lift-lockout`, `/change-pin`|administrator; zmiana PIN-u: Klucz / telefon administratora / stary PIN|
|`GET /api/pairing/wifi`, `POST /api/pairing/code`, `/cancel`, `/decision`|wyświetlacz: kroki parowania|
|`POST /api/pairing/claim`, `GET /api/pairing/status`|niesparowany telefon: kod + nazwa, potem czeka na decyzję|
|`GET /api/devices`, `POST /api/devices/forget`, `/admin`, `/leave`|lista zapamiętanych; `leave` = telefon sam się wylogowuje|
|`POST /api/key/create`, `/revoke`, `/duplicate/start`, `/duplicate/write`, `/duplicate/cancel`|Klucz (tylko wyświetlacz)|

Wszystkie POST-y przyjmują tylko JSON (`json\_only()`, inaczej 415) — ochrona przed formularzem z cudzej strony.
Uprawnienia: `need(admin=True, display=False, phone=False)` w trasie (`if (bad := json_only() or need()): return bad`).
Niesparowane urządzenie: `guard()` przepuszcza tylko `OPEN_ENDPOINTS`, reszta 401 `{unpaired: true}`.

### Ustawienia: `data/global.conf` (INI)

* `\[storage]` — wspólne: `saveInterval` (minuty), `dataRetention` (miesiące), `feederRate`.
* `\[look]` — stałe CSS dla całej strony (czasy i krzywe animacji, wykresy, hover kart).
Wartości w `:root` w `style.css` są tylko zapasem.
* `\[device <adres IP>]` — motyw, kontrast, co pokazują karty, alarm, kamera; zapisywane tylko
wartości inne niż domyślne, plus `description` z przeglądarki.
* `\[admin]` — `pin` (hash werkzeug) i `key` (SHA-256 sekretu z `beenest.key`).
* `\[paired <id>]` — zapamiętane urządzenia: `name`, `admin`, `added`. Niezapamiętane tylko w pamięci.
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
sam; telefon użytkownika: `.is-denied` + okno o braku uprawnień), `data-admin="phone"` (PIN-u nie
wymaga wyświetlacz), `data-only="display|phone"`. Serwer sprawdza uprawnienia niezależnie.
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

## Do zrobienia / otwarte

* Sterowniki napisane (2026-11-21) – do sprawdzenia po podłączeniu: kalibracja serwa, `LIQUID_IS_HIGH`,
`TONE_HZ` buzzera, czy `pwm-2chan` na Pi 5 daje pwmchip `1f00098000.pwm`, nazwa karty mikrofonu (`arecord -l`).
* Przyciski otwórz / zablokuj wylotek na stronie (sterownik ma już `set_position`).
* SmartSolar: **na razie tylko sugestie, nie wdrażać** (polecenie użytkownika 2026-11-21).
* **Zasilanie solarne (planowanie, 2026-11-19):** panel → Victron SmartSolar MPPT 75/15 → akumulator 22 Ah → Pi.
Odczyt przez VE.Direct (tryb tekstowy, 19200 bodów, blok co 1 s; tylko biblioteka standardowa: `termios`),
jako nowy sterownik w stylu `*\_detector\_driver.py`. Bluetooth (Instant Readout) jest możliwy, ale wymaga
klucza z VictronConnect i nowej biblioteki. Odpowiedzi użytkownika: akumulator **żelowy MAXX 22 Ah 12 V**;
Pi zasilane przez przetwornicę step-down do 5 V (źródło przetwornicy: wyjście LOAD czy akumulator –
do ustalenia); połączenie „najdogodniej” → proponowany kabel VE.Direct–USB. Procent naładowania
liczony z napięcia tylko bez ładowania (żel w spoczynku: około 12,85 V = 100 %, 11,8 V = 0 %).
* **Zabezpieczenia — wdrożone 2026-11-19** (opis w `app.py`, sekcja „Zabezpieczenia”, i `static/app.js` sekcja 15).
  Ustalenia użytkownika, których kod nie mówi wprost:
    * Telefon administratora zmienia PIN bez starego PIN-u („brak wymogu PIN-u, zmiana hasła ula”);
wyświetlacz bez Klucza — tylko ze starym PIN-em; Klucz jest nad PIN-em.
    * Jeden port USB: duplikowanie = wpięcie oryginału (sprawdzony, sekret w pamięci na 3 min),
wyjęcie, wpięcie drugiego pendrive'a. Wszystkie kopie mają ten sam sekret (unieważnienie wyłącza wszystkie).
    * Blokada 5 minut stała; okna blokady nie da się zamknąć na wyświetlaczu i telefonie użytkownika;
telefon administratora może ją ukryć albo zdjąć. Blokada od razu zahasłowuje wyświetlacz.
    * Lista „Urządzenia” tylko z zapamiętanymi; korona = nadaj, przekreślona korona = odbierz.
  * **Pendrive'y montuje serwer** (2026-11-21): sesja kiosku nie ma automontowania (`/media` puste, konfigurator
nie widział Klucza). `usb_automount()` w `usb_loop` co 1 s: `lsblk -J -l` (ta wersja zwraca płaską listę – dysk
po `TRAN=usb`, partycje po `PKNAME`) → `udisksctl mount -b` → `/media/beenest/<name>`; każda partycja raz do wyjęcia.
Wymaga reguły polkit `org.freedesktop.udisks2.filesystem-mount*` (w `50-beenest.rules`, `install.sh`).
Testowy pendrive 64 GB (USB 2.0, NTFS na `sda2` + 200 MB bez systemu plików) w górnym USB3 = `xhci-hcd.1` port 1
(magistrala 3, bo urządzenie USB 2.0). Akceptowany jest każdy port USB.
Reguła polkit wgrana (użytkownik uruchomił `install.sh`, 2026-11-21). **Testowy pendrive ma uszkodzony NTFS**:
`ntfs3: failed to replay log file. Can't mount rw!` i przy `-o ro`: `$AttrDef is corrupted` → nie montuje się wcale.
Serwer po nieudanym montowaniu próbuje jeszcze tylko do odczytu (wystarcza przy samym „brudnym” dzienniku NTFS).
Na Klucz zalecany FAT32 / exFAT. Dziennik jądra czytelny bez sudo: `journalctl -k` (beenest jest w grupie adm).
  * **Klucz „znikał” po wyjęciu** (2026-11-21): drugi pendrive (GPARTED-LIV, FAT, 8 GB) – Klucz zapisany, wyjęty po 6 s,
po ponownym wpięciu nierozpoznany: plik `beenest.key` miał dobry rozmiar (65 B), ale treść = bajty 0xFF. Jądro zakłada
„write through” (brak SYNCHRONIZE CACHE), a tani pendrive trzymał dane we własnej pamięci podręcznej. Naprawa:
`safe_eject()` po zapisie Klucza / kopii = `udisksctl unmount` + `power-off` (wyłączenie zmusza pendrive do zapisu);
`_usb["busy"]` wstrzymuje `usb_loop`, żeby odmontowanie nie wyglądało na wyjęcie (odebrałoby wyświetlaczowi PIN).
Okno po zapisie: „Pendrive został bezpiecznie odłączony – wyjmij go”. Wymaga reguły polkit `power-off-drive*`
(`install.sh`); bez niej: montuje z powrotem i prosi o odczekanie. **Klucza z GPARTED-LIV trzeba utworzyć od nowa**
(unieważnij + utwórz), bo zapisany skrót pasuje do sekretu, którego na pendrivie nie ma. Treści Klucza nie wypisuj.
    * Druga próba (2026-11-21, po `install.sh`): „bezpiecznie odłączony” w dzienniku, a plik znowu same 0xFF i FAT znowu
„not properly unmounted” → pendrive gubi zapisy nawet przy czystym odmontowaniu + power-off (prawdopodobnie zużyty
albo podróbka). Test bez sekretu: `test-zapisu.bin` (64 KB losowych) zapisany, odczyt `O_DIRECT` zgodny, skrót
(16 znaków) w `/tmp/test-zapisu.sha` na Pi, pendrive wyłączony. **Wynik po ponownym włożeniu: plik ma 64 KB, ale same
0xFF (skrót inny)** → pendrive GPARTED-LIV (USB 1221:3234, 8 GB) jest wadliwy: potwierdza zapisy i traci je przy
odłączeniu. Do Klucza potrzebny inny pendrive. Kod (automontowanie, safe_eject) działa – nie szukać w nim błędu.
  * `nmcli -s` musi mieć prawo odczytać hasło `Pi-hotspot`,
przeglądarka wyświetlacza w trybie `--kiosk` i schowane porty USB (obca klawiatura omija PIN).
  * Ustawienia urządzeń (`\[device <adres IP>]`) nadal są przypisane do adresu IP, nie do ciasteczka.
