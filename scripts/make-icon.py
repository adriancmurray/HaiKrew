"""Draw assets/icon.png: one big crew lead with three small crew members below it.

Drawn on a 32x32 pixel grid and scaled with nearest-neighbour so pixels stay crisp. The small critters get a
one-pixel outline in the background colour so they stand out where they overlap the lead and each other.
Run: python3 scripts/make-icon.py   (needs Pillow)
"""
from PIL import Image

NAVY, ORANGE, SHADE, EYE, STAR = (15, 27, 51), (217, 119, 87), (176, 90, 60), (26, 20, 24), (230, 236, 255)
GRID, SCALE = 32, 32


def critter(w, h):
    """Pixel map for a critter of body size w x h: rounded body, two eyes, two legs. Returns {(x, y): colour}."""
    px = {}
    for y in range(h):
        for x in range(w):
            if (x in (0, w - 1)) and (y in (0, h - 1)):
                continue  # rounded corners
            px[(x, y)] = ORANGE
    for x in range(w):
        px[(x, h - 1)] = SHADE if (x, h - 1) in px else px.get((x, h - 1))
    px = {k: v for k, v in px.items() if v}
    ey = max(1, h // 3)
    for ex in (w // 3 - (1 if w > 6 else 0), w - 1 - w // 3):
        px[(ex, ey)] = EYE
        if w > 10:
            px[(ex, ey + 1)] = EYE
    for lx in (w // 4, w - 1 - w // 4):
        px[(lx, h)] = SHADE
        if w > 10:
            px[(lx, h + 1)] = SHADE
    return px


def stamp(img, sprite, ox, oy, outline=False):
    """Draw a sprite at (ox, oy); with outline, first paint its 1-pixel ring in the background colour."""
    if outline:
        for (x, y) in sprite:
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    if (x + dx, y + dy) not in sprite:
                        img.putpixel((ox + x + dx, oy + y + dy), NAVY)
    for (x, y), c in sprite.items():
        img.putpixel((ox + x, oy + y), c)


img = Image.new("RGB", (GRID, GRID), NAVY)
for (x, y) in [(2, 2), (28, 3), (3, 10), (29, 12), (16, 1), (9, 28), (24, 29)]:
    img.putpixel((x, y), STAR)
stamp(img, critter(20, 12), 6, 4)
small = critter(9, 6)
for ox in (2, 11, 20):
    stamp(img, small, ox, 15, outline=True)
img.resize((GRID * SCALE, GRID * SCALE), Image.NEAREST).save("assets/icon.png")
img.resize((256, 256), Image.NEAREST).save("assets/icon-256.png")
print("assets/icon.png", GRID * SCALE)
