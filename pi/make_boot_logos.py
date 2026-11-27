"""
Logo startowe dla każdego motywu wyświetlacza – uruchamiać na PC po zmianie static/logo.svg (wymaga rsvg-convert).

    python3 pi/make_boot_logos.py

Kolory (tło, „BEE”, „Nest”) bierze z BOOT_LOGO_COLORS w app.py, zapisuje pi/boot-logos/<motyw>-<kontrast>.png
(1024×600, logo na środku). Serwer (update_boot_logo) tylko kopiuje gotowy plik – na Raspberry nic się nie rysuje.
"""
import ast
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WIDTH, HEIGHT, LOGO_WIDTH = 1024, 600, 560

tree = ast.parse(open(os.path.join(ROOT, "app.py"), encoding="utf-8").read())
colors = next(ast.literal_eval(n.value) for n in tree.body
              if isinstance(n, ast.Assign) and getattr(n.targets[0], "id", "") == "BOOT_LOGO_COLORS")
svg = open(os.path.join(ROOT, "static", "logo.svg"), encoding="utf-8").read()
out_dir = os.path.join(ROOT, "pi", "boot-logos")
os.makedirs(out_dir, exist_ok=True)

for key, (bg, bee, nest) in colors.items():
    # zmienne CSS na stałe kolory; logo w środku planszy 1024×600
    logo = svg.replace("var(--logo-bee, #000000)", bee).replace("var(--logo-nest, #F7931E)", nest)
    vb_w, vb_h = 1521, 261
    h = LOGO_WIDTH * vb_h / vb_w
    page = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}">'
            f'<rect width="100%" height="100%" fill="{bg}"/>'
            f'<svg x="{(WIDTH - LOGO_WIDTH) / 2}" y="{(HEIGHT - h) / 2}" width="{LOGO_WIDTH}" height="{h}" '
            f'viewBox="0 0 {vb_w} {vb_h}">{logo.split(">", 1)[1].rsplit("</svg>", 1)[0]}</svg></svg>')
    path = os.path.join(out_dir, key.replace("/", "-") + ".png")
    subprocess.run(["rsvg-convert", "-o", path], input=page.encode(), check=True)
    print(path)
