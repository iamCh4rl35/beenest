#!/bin/sh
# BEENest – przeglądarka wyświetlacza przy ulu.
# Uruchamia ją labwc z ~/.config/labwc/autostart przez lwrespawn (po zamknięciu startuje od nowa).

PROFILE="$HOME/.config/chromium"
PREFS="$PROFILE/Default/Preferences"

# Blokada profilu zawiera nazwę komputera. Po odcięciu prądu albo zmianie nazwy (raspberrypi -> beenest)
# Chromium uznałby, że profil jest otwarty „na innym komputerze”, i pokazał okno błędu.
# Kiosk ma tylko jedną przeglądarkę (lwrespawn), więc stara blokada nigdy nie jest aktualna.
rm -f "$PROFILE/SingletonLock" "$PROFILE/SingletonSocket" "$PROFILE/SingletonCookie"

# Po odcięciu prądu Chromium pytałby o przywrócenie kart – zapisujemy, że zamknął się poprawnie.
[ -f "$PREFS" ] && sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[^"]*"/"exit_type":"Normal"/' "$PREFS"

# Czekamy, aż serwer ula odpowie (po starcie systemu potrzebuje kilku sekund).
until curl -s -o /dev/null http://127.0.0.1/; do sleep 1; done

# --password-store=basic: bez okna z pytaniem o hasło do pęku kluczy (gnome-keyring).
# Adres 127.0.0.1 (nie beenest.local) – tylko pętla zwrotna jest rozpoznawana jako wyświetlacz.
exec chromium \
  --kiosk \
  --ozone-platform=wayland \
  --password-store=basic \
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  --disable-session-crashed-bubble \
  --disable-features=Translate \
  --check-for-update-interval=31536000 \
  http://127.0.0.1/
