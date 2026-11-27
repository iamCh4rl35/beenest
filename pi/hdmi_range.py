#!/usr/bin/env python3
"""
BEENest – zakres kolorów na wyjściu HDMI (właściwość DRM „Broadcast RGB”).

Panel Waveshare 7" oczekuje zakresu ograniczonego 16–235, a Raspberry przy rozdzielczości 1024×600 wysyła
pełny 0–255: panel ucina wtedy ciemne tony (czerń do ~40) i jasne (biel od ~232) – plansza testowa 2026-11-20.

    python3 pi/hdmi_range.py          pokazuje obecne ustawienie
    python3 pi/hdmi_range.py limited  Limited 16:235
    python3 pi/hdmi_range.py full     Full
    python3 pi/hdmi_range.py auto     Automatic

Zmiana działa tylko wtedy, gdy nikt inny nie steruje ekranem (przed startem labwc) – dlatego woła ją
sesja kiosku (/usr/local/bin/beenest-kiosk, patrz pi/install.sh). Tylko biblioteka standardowa (ioctl DRM).
"""
import ctypes
import fcntl
import glob
import os
import sys

NAMES = {"limited": "Limited 16:235", "full": "Full", "auto": "Automatic"}
PROPERTY = b"Broadcast RGB"
CONNECTOR_TYPES = {11: "HDMI-A", 12: "HDMI-B"}
OBJECT_CONNECTOR = 0xC0C0C0C0


def _iowr(nr, size):
    return (3 << 30) | (size << 16) | (ord("d") << 8) | nr


class CardRes(ctypes.Structure):
    _fields_ = [("fb_id_ptr", ctypes.c_uint64), ("crtc_id_ptr", ctypes.c_uint64),
                ("connector_id_ptr", ctypes.c_uint64), ("encoder_id_ptr", ctypes.c_uint64),
                ("count_fbs", ctypes.c_uint32), ("count_crtcs", ctypes.c_uint32),
                ("count_connectors", ctypes.c_uint32), ("count_encoders", ctypes.c_uint32),
                ("min_width", ctypes.c_uint32), ("max_width", ctypes.c_uint32),
                ("min_height", ctypes.c_uint32), ("max_height", ctypes.c_uint32)]


class GetConnector(ctypes.Structure):
    _fields_ = [("encoders_ptr", ctypes.c_uint64), ("modes_ptr", ctypes.c_uint64),
                ("props_ptr", ctypes.c_uint64), ("prop_values_ptr", ctypes.c_uint64),
                ("count_modes", ctypes.c_uint32), ("count_props", ctypes.c_uint32),
                ("count_encoders", ctypes.c_uint32), ("encoder_id", ctypes.c_uint32),
                ("connector_id", ctypes.c_uint32), ("connector_type", ctypes.c_uint32),
                ("connector_type_id", ctypes.c_uint32), ("connection", ctypes.c_uint32),
                ("mm_width", ctypes.c_uint32), ("mm_height", ctypes.c_uint32),
                ("subpixel", ctypes.c_uint32), ("pad", ctypes.c_uint32)]


class GetProperty(ctypes.Structure):
    _fields_ = [("values_ptr", ctypes.c_uint64), ("enum_blob_ptr", ctypes.c_uint64),
                ("prop_id", ctypes.c_uint32), ("flags", ctypes.c_uint32), ("name", ctypes.c_char * 32),
                ("count_values", ctypes.c_uint32), ("count_enum_blobs", ctypes.c_uint32)]


class PropertyEnum(ctypes.Structure):
    _fields_ = [("value", ctypes.c_uint64), ("name", ctypes.c_char * 32)]


class SetProperty(ctypes.Structure):
    _fields_ = [("value", ctypes.c_uint64), ("prop_id", ctypes.c_uint32),
                ("obj_id", ctypes.c_uint32), ("obj_type", ctypes.c_uint32), ("pad", ctypes.c_uint32)]


GETRESOURCES = _iowr(0xA0, ctypes.sizeof(CardRes))
GETCONNECTOR = _iowr(0xA7, ctypes.sizeof(GetConnector))
GETPROPERTY = _iowr(0xAA, ctypes.sizeof(GetProperty))
OBJ_SETPROPERTY = _iowr(0xBA, ctypes.sizeof(SetProperty))


def _addr(array):
    return ctypes.addressof(array)


def connectors(fd):
    res = CardRes()
    fcntl.ioctl(fd, GETRESOURCES, res)
    if not res.count_connectors:
        return []
    ids = (ctypes.c_uint32 * res.count_connectors)()
    res2 = CardRes(connector_id_ptr=_addr(ids), count_connectors=res.count_connectors)
    fcntl.ioctl(fd, GETRESOURCES, res2)
    out = []
    for cid in ids:
        con = GetConnector(connector_id=cid)
        fcntl.ioctl(fd, GETCONNECTOR, con)
        props = (ctypes.c_uint32 * con.count_props)()
        values = (ctypes.c_uint64 * con.count_props)()
        con2 = GetConnector(connector_id=cid, props_ptr=_addr(props), prop_values_ptr=_addr(values),
                            count_props=con.count_props)
        fcntl.ioctl(fd, GETCONNECTOR, con2)
        name = f"{CONNECTOR_TYPES.get(con2.connector_type, 'other')}-{con2.connector_type_id}"
        out.append((cid, name, con2.connection == 1, list(zip(props, values))))
    return out


def broadcast_rgb(fd, props):
    """(id właściwości, obecna wartość, {nazwa: wartość}) albo None."""
    for prop_id, value in props:
        p = GetProperty(prop_id=prop_id)
        fcntl.ioctl(fd, GETPROPERTY, p)
        if p.name != PROPERTY:
            continue
        enums = (PropertyEnum * p.count_enum_blobs)()
        p2 = GetProperty(prop_id=prop_id, enum_blob_ptr=_addr(enums), count_enum_blobs=p.count_enum_blobs)
        fcntl.ioctl(fd, GETPROPERTY, p2)
        return prop_id, value, {e.name.decode(): e.value for e in enums}
    return None


def main():
    want = sys.argv[1] if len(sys.argv) > 1 else None
    if want and want not in NAMES:
        sys.exit("Użycie: hdmi_range.py [limited | full | auto]")
    found = False
    for card in sorted(glob.glob("/dev/dri/card*")):
        fd = os.open(card, os.O_RDWR | os.O_CLOEXEC)
        try:
            try:
                outputs = connectors(fd)
            except OSError:          # karta bez wyjść obrazu (np. v3d – sam układ 3D)
                continue
            for cid, name, connected, props in outputs:
                info = broadcast_rgb(fd, props)
                if not info or not name.startswith("HDMI"):
                    continue
                found = True
                prop_id, value, options = info
                now = next((n for n, v in options.items() if v == value), str(value))
                state = "podłączony" if connected else "niepodłączony"
                if not want:
                    print(f"{name} ({state}): {now}   [możliwe: {', '.join(options)}]")
                    continue
                target = options[NAMES[want]]
                try:
                    fcntl.ioctl(fd, OBJ_SETPROPERTY, SetProperty(value=target, prop_id=prop_id,
                                                                 obj_id=cid, obj_type=OBJECT_CONNECTOR))
                    print(f"{name}: {now} -> {NAMES[want]}")
                except PermissionError:
                    print(f"{name}: brak prawa zmiany – ekranem steruje już kompozytor (uruchom przed labwc)")
        finally:
            os.close(fd)
    if not found:
        print("Nie znalazłem wyjścia HDMI z właściwością Broadcast RGB")


if __name__ == "__main__":
    main()
