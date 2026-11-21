#!/bin/bash
# =============================================================
#  BEENest – konfiguracja Raspberry Pi (można uruchamiać wielokrotnie)
#
#    sudo bash pi/instaluj.sh              serwer jako usługa, hotspot, kiosk, logo startowe
#    sudo bash pi/instaluj.sh --blokada    do tego: brak terminala z klawiatury, zarządzanie tylko po SSH
#    sudo bash pi/instaluj.sh --odblokuj   cofa blokadę (kiosk, hotspot i logo zostają)
#    sudo bash pi/instaluj.sh --pulpit     zamiast kiosku zwykły pulpit Raspberry (do prac przy Pi)
#
#  Oryginały zmienianych plików systemowych są zapisywane obok z końcówką .przed-beenest
# =============================================================
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "Uruchom przez sudo: sudo bash $0 $*"; exit 1; }

USER_NAME=${SUDO_USER:-beenest}
HOME_DIR=$(getent passwd "$USER_NAME" | cut -d: -f6)
APP_DIR=$(cd "$(dirname "$0")/.." && pwd)
PI_DIR="$APP_DIR/pi"
HOTSPOT=Pi-hotspot
HOTSPOT_SSID="BEENest Access Web"
CMDLINE=/boot/firmware/cmdline.txt
CONFIG=/boot/firmware/config.txt
LIGHTDM=/etc/lightdm/lightdm.conf
KIOSK_CONF=/etc/beenest/labwc   # konfiguracja labwc sesji kiosku (root – użytkownik jej nie zmieni)
USER_LABWC="$HOME_DIR/.config/labwc"
CURSOR_THEME=beenest-bez-kursora   # /usr/share/icons/<nazwa>: same przezroczyste kursory
# Zakres kolorów HDMI (pi/hdmi_zakres.py): ograniczony = 16–235 (Waveshare 7" ucina oba końce pełnego
# zakresu), pelny = 0–255, auto = jak sterownik. Inny monitor: zmień i uruchom skrypt ponownie.
HDMI_RANGE=ograniczony
MODE=${1:-}

say() { echo; echo "== $*"; }

backup() {   # kopia oryginału tylko za pierwszym razem
    [ -e "$1" ] && [ ! -e "$1.przed-beenest" ] && cp -a "$1" "$1.przed-beenest" || true
}

cmdline_add() { grep -qw -- "$1" "$CMDLINE" || sed -i "1 s|\$| $1|" "$CMDLINE"; }
cmdline_del() { sed -i "1 s| $1||g" "$CMDLINE"; }

autologin_session() {   # którą sesję lightdm uruchamia sam po starcie
    backup "$LIGHTDM"
    sed -i "s/^autologin-session=.*/autologin-session=$1/" "$LIGHTDM"
}

# Konfiguracja labwc sesji kiosku. Sesja startuje z `labwc -C $KIOSK_CONF` (bez -m), więc nic
# z pulpitu (/etc/xdg/labwc, ~/.config/labwc) się nie dolicza: brak paska, ikon i ich skrótów.
#   kiosk_config 0 – zwykłe skróty labwc (do prac serwisowych)
#   kiosk_config 1 – blokada: żadnych skrótów ani menu, Ctrl+Alt+Fn nie przełącza konsol
kiosk_config() {
    mkdir -p "$KIOSK_CONF"
    cat > "$KIOSK_CONF/autostart" <<EOF
# BEENest – sesja kiosku: tylko przeglądarka z panelem ula
/usr/bin/kanshi &
# Logo jako tło, zanim Chromium wczyta panel (Plymouth znika już ok. 7 s po starcie, panel jest ok. 14 s);
# pi/tlo.sh bierze logo w kolorach motywu wyświetlacza (data/logo.png od serwera)
/bin/sh $PI_DIR/tlo.sh &
/usr/bin/lwrespawn /bin/sh $PI_DIR/kiosk.sh &   # przez sh – działa bez prawa wykonywania pliku
EOF
    local layout options keys mouse
    layout=$(grep -h "^XKB_DEFAULT_LAYOUT=" "$USER_LABWC/environment" 2>/dev/null | tail -1 | cut -d= -f2)
    if [ "$1" = 1 ]; then
        options=srvrkeys:none
        # Pusta sekcja wczytałaby domyślne skróty, dlatego po jednym, który nic nie robi
        keys='<keybind key="W-F12"/>'
        mouse='<context name="Root"><mousebind button="Middle" action="Press"/></context>'
    else
        options=
        keys='<default/>'
        mouse='<default/>'
    fi
    cat > "$KIOSK_CONF/environment" <<EOF
XKB_DEFAULT_MODEL=pc105
XKB_DEFAULT_LAYOUT=${layout:-pl}
XKB_DEFAULT_OPTIONS=$options
# Ekran dotykowy – kursor niewidoczny (motyw z przezroczystymi kursorami, patrz niżej)
XCURSOR_THEME=$CURSOR_THEME
XCURSOR_SIZE=24
EOF
    # Dotyk wyświetlacza (mapowanie na ekran) przepisujemy z konfiguracji pulpitu
    local touch
    touch=$(grep -ho '<touch [^>]*/>' "$USER_LABWC/rc.xml" 2>/dev/null | head -1 || true)
    cat > "$KIOSK_CONF/rc.xml" <<EOF
<?xml version="1.0"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  $touch
  <keyboard>
    $keys
  </keyboard>
  <mouse>
    $mouse
  </mouse>
</openbox_config>
EOF
}

# -------------------------------------------------------------
#  Zwykły pulpit zamiast kiosku
# -------------------------------------------------------------
if [ "$MODE" = "--pulpit" ]; then
    autologin_session rpd-labwc
    echo "Po restarcie uruchomi się pulpit. Powrót do kiosku: sudo bash $0"
    exit 0
fi

# -------------------------------------------------------------
#  Cofnięcie blokady
# -------------------------------------------------------------
if [ "$MODE" = "--odblokuj" ]; then
    say "Cofam blokadę"
    rm -f /etc/systemd/logind.conf.d/90-beenest.conf /etc/sysctl.d/90-beenest.conf \
          /etc/ssh/sshd_config.d/90-beenest.conf /etc/chromium/policies/managed/beenest.json
    systemctl unmask getty@tty1.service serial-getty@ttyAMA10.service
    systemctl enable getty@tty1.service
    cmdline_add console=tty1
    kiosk_config 0
    sysctl -q kernel.sysrq=438 || true
    systemctl reload ssh
    echo "Gotowe. Uruchom ponownie: sudo reboot"
    exit 0
fi

# -------------------------------------------------------------
#  1. Hotspot: włącza się sam przy starcie
# -------------------------------------------------------------
say "Hotspot $HOTSPOT"
nmcli radio wifi on
if ! nmcli -t -f NAME con show | grep -qx "$HOTSPOT"; then
    read -rsp "Hotspotu nie ma – podaj hasło nowej sieci (co najmniej 8 znaków): " PSK; echo
    nmcli con add type wifi ifname wlan0 con-name "$HOTSPOT" ssid "$HOTSPOT_SSID" \
        802-11-wireless.mode ap ipv4.method shared \
        wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$PSK"
fi
# Priorytet 100: wygrywa z zapisanymi sieciami klienckimi na wlan0. Hotspot nie daje trasy
# domyślnej, więc LAN (eth0) dalej działa i SSH po kablu się nie zrywa.
nmcli con modify "$HOTSPOT" connection.autoconnect yes connection.autoconnect-priority 100 \
    ipv4.addresses 10.42.0.1/24

# -------------------------------------------------------------
#  2. „Fałszywy internet”: każda nazwa prowadzi do Raspberry, app.py odpowiada na testy łączności
# -------------------------------------------------------------
say "DNS hotspotu"
mkdir -p /etc/NetworkManager/dnsmasq-shared.d
cat > /etc/NetworkManager/dnsmasq-shared.d/beenest.conf <<'EOF'
# BEENest – DNS hotspotu (dnsmasq NetworkManagera dla połączeń typu "shared")
address=/beenest.local/10.42.0.1
local=/beenest.local/
# Każda inna nazwa też prowadzi do Raspberry: telefon sprawdzający „czy jest internet”
# (connectivitycheck.gstatic.com, captive.apple.com, msftconnecttest.com…) dostaje odpowiedź z app.py.
address=/#/10.42.0.1
# Nazwy urządzeń z DHCP (np. Pixel-9-Pro-Karol) dla app.py – podpowiedź nazwy przy parowaniu
dhcp-script=/usr/local/bin/beenest-dhcp
EOF
cat > /usr/local/bin/beenest-dhcp <<'EOF'
#!/bin/sh
# BEENest – wołany przez dnsmasq hotspotu: $1 = add|old|del, $2 = MAC, $3 = adres IP, $4 = nazwa urządzenia.
# Zapisuje nazwę w /run/beenest-dhcp/<adres IP> (czyta ją app.py -> network_name).
DIR=/run/beenest-dhcp
mkdir -p "$DIR" && chmod 755 "$DIR"
case "$1" in
    add|old) if [ -n "$4" ]; then printf '%s\n' "$4" > "$DIR/$3"; else rm -f "$DIR/$3"; fi ;;
    del) rm -f "$DIR/$3" ;;
esac
exit 0
EOF
chmod 755 /usr/local/bin/beenest-dhcp
nmcli con down "$HOTSPOT" >/dev/null 2>&1 || true   # dnsmasq wczytuje konfigurację tylko przy starcie
nmcli con up "$HOTSPOT" || echo "UWAGA: hotspot nie wstał – sprawdź: nmcli dev"

# -------------------------------------------------------------
#  2a. Nazwa beenest.local i hasło hotspotu w kodzie QR
# -------------------------------------------------------------
say "Nazwa beenest.local i hasło hotspotu"
# Nazwa komputera „beenest” = avahi sam rozgłasza beenest.local na każdym interfejsie (też na hotspocie,
# który wstaje po serwerze – zeroconf w app.py go wtedy nie widział).
if [ "$(hostname)" != beenest ]; then
    OLD_HOST=$(hostname)
    hostnamectl set-hostname beenest
    sed -i "s/^127\.0\.1\.1.*/127.0.1.1\t\tbeenest/" /etc/hosts
    echo "Nazwa komputera: $OLD_HOST -> beenest"
fi
# Usługa działa bez sesji graficznej, więc polkit nie pozwalał jej odczytać hasła hotspotu (nmcli -s)
# – w kodzie QR i w oknie Wi-Fi hasło było puste. NetworkManager wymaga do tego prawa modify.system.
cat > /etc/polkit-1/rules.d/50-beenest.rules <<EOF
// BEENest: serwer ula ($USER_NAME, usługa systemd) odczytuje hasło hotspotu do kodu QR (nmcli -s)
polkit.addRule(function(action, subject) {
    if (action.id == "org.freedesktop.NetworkManager.settings.modify.system" && subject.user == "$USER_NAME") {
        return polkit.Result.YES;
    }
    // Klucz: sesja kiosku nie montuje pendrive'ów sama – serwer robi to przez udisksctl (app.py, usb_automount),
    // a po zapisie Klucza bezpiecznie go odłącza (safe_eject: power-off – inaczej pendrive gubił zapis)
    if ((action.id.indexOf("org.freedesktop.udisks2.filesystem-mount") == 0 ||
         action.id.indexOf("org.freedesktop.udisks2.power-off-drive") == 0) && subject.user == "$USER_NAME") {
        return polkit.Result.YES;
    }
});
EOF

# -------------------------------------------------------------
#  3. Serwer ula jako usługa systemd
# -------------------------------------------------------------
say "Usługa beenest.service"
# Usługa działa jako $USER_NAME – pliki po wcześniejszym `sudo python3 app.py` należałyby do roota
chown -R "$USER_NAME:$USER_NAME" "$APP_DIR"
cat > /etc/systemd/system/beenest.service <<EOF
[Unit]
Description=BEENest – serwer ula
After=network.target NetworkManager.service

[Service]
User=$USER_NAME
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/python3 $APP_DIR/app.py
# port 80 bez uruchamiania jako root
AmbientCapabilities=CAP_NET_BIND_SERVICE
Environment=PYTHONUNBUFFERED=1
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
# Przyciski „Uruchom ponownie” / „Wyłącz” w panelu wołają: sudo -n shutdown
echo "$USER_NAME ALL=(root) NOPASSWD: /usr/sbin/shutdown" > /etc/sudoers.d/beenest
chmod 440 /etc/sudoers.d/beenest
visudo -cf /etc/sudoers.d/beenest >/dev/null
systemctl daemon-reload
systemctl enable beenest.service
systemctl restart beenest.service

# -------------------------------------------------------------
#  4. Kiosk: osobna sesja – tylko Chromium z panelem ula, bez pulpitu
# -------------------------------------------------------------
say "Kiosk"
chmod +x "$PI_DIR/kiosk.sh" "$PI_DIR/tlo.sh"
# Pierwsza wersja tego skryptu dopisywała kiosk do autostartu pulpitu – sprzątamy
grep -qs "BEENest" "$USER_LABWC/autostart" && rm -f "$USER_LABWC/autostart"
cat > /usr/local/bin/beenest-kiosk <<EOF
#!/bin/sh
# BEENest – sesja kiosku (jak /usr/bin/labwc-pi, ale z własną konfiguracją i bez pulpitu)
if raspi-config nonint is_pi; then
    export WLR_DRM_FORCE_LIBLIFTOFF=1
    raspi-config nonint gpu_has_mmu || export WLR_RENDERER=pixman
fi
# Zakres kolorów HDMI – da się go zmienić tylko teraz, zanim labwc przejmie ekran (wynik w dzienniku)
python3 $PI_DIR/hdmi_zakres.py $HDMI_RANGE 2>&1 | logger -t beenest-hdmi
exec /usr/bin/labwc -C $KIOSK_CONF
EOF
chmod 755 /usr/local/bin/beenest-kiosk
cat > /usr/share/wayland-sessions/beenest-kiosk.desktop <<'EOF'
[Desktop Entry]
Name=BEENest – kiosk
Comment=Panel ula na całym ekranie
Exec=/usr/local/bin/beenest-kiosk
Type=Application
EOF
# Niewidoczny kursor: jeden przezroczysty obrazek Xcursor (24×24) pod nazwami wszystkich kursorów
# z motywów systemowych – żadna nazwa nie spada do widocznego motywu zapasowego.
CURSORS=/usr/share/icons/$CURSOR_THEME/cursors
mkdir -p "$CURSORS"
printf '[Icon Theme]\nName=%s\nComment=BEENest – niewidoczny kursor (ekran dotykowy)\n' "$CURSOR_THEME" \
    > "/usr/share/icons/$CURSOR_THEME/index.theme"
python3 - "$CURSORS/niewidoczny" <<'EOF'
import struct, sys
size = 24
image = struct.pack("<9I", 36, 0xFFFD0002, size, 1, size, size, 0, 0, 0) + bytes(4 * size * size)
toc = struct.pack("<3I", 0xFFFD0002, size, 28)            # jeden obrazek, zaczyna się po 28 bajtach
with open(sys.argv[1], "wb") as f:
    f.write(b"Xcur" + struct.pack("<3I", 16, 0x10000, 1) + toc + image)
EOF
for name in /usr/share/icons/{PiXtrix,Adwaita,default}/cursors/*; do
    if [ -e "$name" ]; then ln -sfn niewidoczny "$CURSORS/$(basename "$name")"; fi
done
# Blokada zostaje, jeśli była włączona wcześniej
if [ "$MODE" = "--blokada" ] || [ -e /etc/systemd/logind.conf.d/90-beenest.conf ]; then
    kiosk_config 1
else
    kiosk_config 0
fi
autologin_session beenest-kiosk

# -------------------------------------------------------------
#  5. Logo startowe zamiast malinek
# -------------------------------------------------------------
say "Logo startowe"
THEME=/usr/share/plymouth/themes/beenest
mkdir -p "$THEME"
cp /usr/share/plymouth/themes/pix/pix.script "$THEME/beenest.script"
# Logo w kolorach motywu wyświetlacza, jeśli serwer już je przygotował (data/logo.png), inaczej oryginał
if [ -s "$APP_DIR/data/logo.png" ]; then cp "$APP_DIR/data/logo.png" "$THEME/splash.png"
else cp "$PI_DIR/logo-startowe.png" "$THEME/splash.png"; fi
cat > "$THEME/beenest.plymouth" <<EOF
[Plymouth Theme]
Name=beenest
Description=BEENest
ModuleName=script

[script]
ImageDir=$THEME
ScriptFile=$THEME/beenest.script
EOF
backup "$CMDLINE"
backup "$CONFIG"
cmdline_add logo.nologo                  # bez malinek w lewym górnym rogu
cmdline_add vt.global_cursor_default=0   # bez migającego kursora
grep -q "^disable_splash=1" "$CONFIG" || echo "disable_splash=1" >> "$CONFIG"   # bez tęczowego ekranu
# Ekran bootloadera Pi 5 przed logo („Configuring this Raspberry Pi 5…”) pokazuje instalator sieciowy
# włączany przy każdym podłączeniu zasilania. Wyłączamy go w EEPROM (zmiana wchodzi przy restarcie).
if command -v rpi-eeprom-config >/dev/null && rpi-eeprom-config | grep -q "^NET_INSTALL_AT_POWER_ON=1"; then
    rpi-eeprom-config | sed 's/^NET_INSTALL_AT_POWER_ON=1/NET_INSTALL_AT_POWER_ON=0/' > /tmp/beenest-eeprom.conf
    rpi-eeprom-config --apply /tmp/beenest-eeprom.conf
fi
if [ "$(plymouth-set-default-theme)" != beenest ]; then
    plymouth-set-default-theme -R beenest    # przebudowuje initramfs (chwilę trwa)
elif ! cmp -s "$THEME/splash.png" /usr/share/plymouth/themes/beenest/.w-initramfs 2>/dev/null; then
    update-initramfs -u                      # Plymouth czyta logo z initramfs – nowe logo wchodzi po przebudowie
fi
cp "$THEME/splash.png" "$THEME/.w-initramfs"  # co jest teraz w initramfs (żeby nie przebudowywać bez potrzeby)
# Zmiana motywu na wyświetlaczu = nowe data/logo.png (serwer, update_boot_logo). Usługa beenest-logo (root)
# kopiuje je do motywu Plymouth i przebudowuje initramfs (około minuty, w tle). Tło kiosku (pi/tlo.sh) bierze je od razu.
cat > /usr/local/bin/beenest-logo <<SKRYPT
#!/bin/sh
SRC="$APP_DIR/data/logo.png"
DST="$THEME/splash.png"
[ -s "\$SRC" ] || exit 0
cmp -s "\$SRC" "$THEME/.w-initramfs" && exit 0       # to logo już jest w initramfs – bez przebudowy
head -c 8 "\$SRC" | grep -q PNG || exit 1            # tylko prawdziwy PNG
cp "\$SRC" "\$DST.tmp" && mv "\$DST.tmp" "\$DST"
update-initramfs -u && cp "\$DST" "$THEME/.w-initramfs"
SKRYPT
chmod 755 /usr/local/bin/beenest-logo
cat > /etc/systemd/system/beenest-logo.service <<SKRYPT
[Unit]
Description=BEENest – logo startowe w kolorach motywu wyświetlacza
[Service]
Type=oneshot
ExecStart=/usr/local/bin/beenest-logo
SKRYPT
cat > /etc/systemd/system/beenest-logo.path <<SKRYPT
[Unit]
Description=BEENest – czeka na nowe logo startowe od serwera
[Path]
PathChanged=$APP_DIR/data/logo.png
[Install]
WantedBy=multi-user.target
SKRYPT
systemctl daemon-reload
systemctl enable --now beenest-logo.path

# -------------------------------------------------------------
#  6. Blokada (tylko z --blokada): klawiatura przy ulu nie da terminala ani pulpitu
# -------------------------------------------------------------
if [ "$MODE" = "--blokada" ]; then
    say "Blokada"
    # SSH zostaje bez zmian: klucz albo hasło użytkownika $USER_NAME.
    rm -f /etc/ssh/sshd_config.d/90-beenest.conf

    # Brak konsol tekstowych: Ctrl+Alt+F1…F6 nie ma czego pokazać
    mkdir -p /etc/systemd/logind.conf.d
    printf '[Login]\nNAutoVTs=0\nReserveVT=0\n' > /etc/systemd/logind.conf.d/90-beenest.conf
    systemctl disable getty@tty1.service 2>/dev/null || true   # po masce systemd tylko ostrzega
    systemctl mask getty@tty1.service serial-getty@ttyAMA10.service
    cmdline_del console=tty1

    # Chromium: tylko panel ula, bez narzędzi programisty, plików, pobierania i drukowania
    mkdir -p /etc/chromium/policies/managed
    cat > /etc/chromium/policies/managed/beenest.json <<'EOF'
{
  "URLBlocklist": ["*"],
  "URLAllowlist": ["http://127.0.0.1"],
  "DeveloperToolsAvailability": 2,
  "AllowFileSelectionDialogs": false,
  "DownloadRestrictions": 3,
  "PrintingEnabled": false,
  "IncognitoModeAvailability": 1,
  "BrowserGuestModeEnabled": false,
  "BrowserAddPersonEnabled": false,
  "PasswordManagerEnabled": false,
  "TranslateEnabled": false
}
EOF

    # Bez magicznych klawiszy SysRq
    echo "kernel.sysrq=0" > /etc/sysctl.d/90-beenest.conf
    sysctl -q kernel.sysrq=0
fi

say "Gotowe. Uruchom ponownie: sudo reboot"
