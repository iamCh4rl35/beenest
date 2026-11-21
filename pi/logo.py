"""
Logo startowe w kolorach motywu wyświetlacza (tylko biblioteka standardowa).

    python3 pi/logo.py <źródło.png> <wynik.png> <tło> <kolor „BEE”> <kolor „NEST”>
    python3 pi/logo.py pi/logo-startowe.png /tmp/logo.png '#FFFFFF' '#0F0F10' '#FF8A00'

Źródło (pi/logo-startowe.png): czarne tło, białe „BEE”, pomarańczowe (#FF8A00) „NEST”, z wygładzonymi
krawędziami. Każdy piksel to mieszanka czerni, bieli i pomarańczu: niebieski kanał pochodzi tylko od bieli,
a czerwony od bieli i pomarańczu – z tego wychodzą udziały obu kolorów i piksel składa się od nowa
z kolorów motywu (krawędzie zostają gładkie). Woła go app.py (update_boot_logo) po zmianie motywu wyświetlacza.
"""
import struct
import sys
import zlib


def _read_png(path):
    """(szerokość, wysokość, wiersze RGB jako bytearray). Obsługuje 8-bitowe RGB bez przeplotu."""
    data = open(path, "rb").read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("to nie jest plik PNG")
    pos, idat = 8, b""
    while pos < len(data):
        length, kind = struct.unpack(">I4s", data[pos:pos + 8])
        chunk = data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            width, height, depth, color, _, _, interlace = struct.unpack(">IIBBBBB", chunk)
            if depth != 8 or color != 2 or interlace:
                raise ValueError("obsługiwane jest tylko 8-bitowe RGB bez przeplotu")
        elif kind == b"IDAT":
            idat += chunk
        pos += 12 + length
    raw, stride, rows, prev = zlib.decompress(idat), width * 3, [], bytearray(width * 3)
    for y in range(height):
        start = y * (stride + 1)
        kind, row = raw[start], bytearray(raw[start + 1:start + 1 + stride])
        for i in range(stride):                 # odwrócenie filtrów PNG (0 brak, 1 Sub, 2 Up, 3 Average, 4 Paeth)
            a = row[i - 3] if i >= 3 else 0
            b = prev[i]
            if kind == 1:
                row[i] = (row[i] + a) & 255
            elif kind == 2:
                row[i] = (row[i] + b) & 255
            elif kind == 3:
                row[i] = (row[i] + (a + b) // 2) & 255
            elif kind == 4:
                c = prev[i - 3] if i >= 3 else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                row[i] = (row[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(row)
        prev = row
    return width, height, rows


def _write_png(path, width, height, rows):
    raw = b"".join(b"\x00" + bytes(r) for r in rows)

    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def _rgb(text):
    text = text.strip().lstrip("#")
    if len(text) != 6:
        raise ValueError(f"kolor ma być w postaci #RRGGBB, jest: {text}")
    return tuple(int(text[i:i + 2], 16) for i in (0, 2, 4))


def make_logo(src, dst, background, bee, nest):
    width, height, rows = _read_png(src)
    bg, w, o = _rgb(background), _rgb(bee), _rgb(nest)
    empty = bytes(bg) * width
    for y, row in enumerate(rows):
        if not any(row):
            rows[y] = bytearray(empty)
            continue
        out = bytearray(empty)
        for x in range(0, width * 3, 3):
            r, b = row[x], row[x + 2]
            if not r:
                continue
            white = b / 255                      # biel ma niebieski, pomarańcz nie
            orange = max(0.0, (r - b) / 255)     # reszta czerwonego to pomarańcz
            rest = max(0.0, 1 - white - orange)
            for k in range(3):
                out[x + k] = min(255, round(bg[k] * rest + w[k] * white + o[k] * orange))
        rows[y] = out
    _write_png(dst, width, height, rows)


if __name__ == "__main__":
    if len(sys.argv) != 6:
        sys.exit(__doc__)
    make_logo(*sys.argv[1:])
