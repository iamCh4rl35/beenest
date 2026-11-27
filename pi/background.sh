#!/bin/sh
# BEENest – tło sesji kiosku: logo startowe, zanim Chromium narysuje panel (od ok. 7 s do ok. 13 s po starcie).
# Logo w kolorach motywu wyświetlacza zapisuje serwer (app.py, update_boot_logo): data/logo.png + data/logo.color.
# Uruchamia go autostart kiosku (/etc/beenest/labwc/autostart, pi/install.sh).

DATA="$(dirname "$0")/../data"
if [ -s "$DATA/logo.png" ]; then
    exec /usr/bin/swaybg -c "$(head -n 1 "$DATA/logo.color" 2>/dev/null || echo '#000000')" -m fit -i "$DATA/logo.png"
fi
exec /usr/bin/swaybg -c '#000000' -m fit -i /usr/share/plymouth/themes/beenest/splash.png
