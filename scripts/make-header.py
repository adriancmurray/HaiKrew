#!/usr/bin/env python3
"""Draw assets/header.gif, the README banner.

The art is drawn at 240x80 in palette indices and scaled 4x with nearest-neighbour to 960x320, so
pixels stay square. The loop is 12 frames at 120 ms. Every motion is periodic in the frame count
(bobbing, star twinkle) and the blink happens on one frame, so the last frame flows into the first.

Run: /opt/homebrew/bin/python3 scripts/make-header.py
"""
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw

W, H, SCALE = 240, 80, 4
FRAMES, FRAME_MS, BLINK_FRAME = 12, 120, 10
OUT = Path(__file__).resolve().parent.parent / "assets" / "header.gif"

# Palette indices. Kept to eight colours so the GIF stays small.
PALETTE = [
    (15, 27, 51),    # navy background
    (38, 56, 94),    # dim star
    (90, 110, 150),  # mid star
    (223, 230, 245), # bright star
    (255, 233, 199), # cream title
    (217, 119, 87),  # orange body
    (168, 82, 58),   # shadow orange: bottom edge, legs, arm nubs
    (27, 20, 32),    # eyes
]
NAVY, DIM, MID, BRIGHT, CREAM, ORANGE, SHADE, EYE = range(8)

# 5x7 bitmap glyphs for the title. "1" is a lit pixel.
GLYPHS = {
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "a": ["00000", "00000", "01110", "00001", "01111", "10001", "01111"],
    "i": ["00100", "00000", "01100", "00100", "00100", "00100", "01110"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "r": ["00000", "00000", "10110", "11001", "10000", "10000", "10000"],
    "e": ["00000", "00000", "01110", "10001", "11111", "10000", "01110"],
    "w": ["00000", "00000", "10001", "10001", "10101", "10101", "01010"],
}

LEAD = (105, 30, 30, 20)  # x, y, width, height of the crew lead body
SMALL_X = [12, 48, 84, 144, 180, 216]  # bottom row, mirrored around the centre
SMALL_Y, SMALL_W, SMALL_H = 58, 12, 9

_rng = random.Random(7)
STARS = [(_rng.randrange(W), _rng.randrange(H), _rng.uniform(0, 2 * math.pi)) for _ in range(18)]


def phase(t: int, offset: float = 0.0) -> float:
    """Angle for frame t; advancing one full loop returns to the same angle."""
    return 2 * math.pi * t / FRAMES + offset


def draw_title(d: ImageDraw.ImageDraw, text: str, y: int, scale: int = 2, gap: int = 1) -> None:
    """Draw text centred horizontally at row y using GLYPHS."""
    width = len(text) * (5 + gap) * scale - gap * scale
    x = (W - width) // 2
    for ch in text:
        for gy, row in enumerate(GLYPHS[ch]):
            for gx, bit in enumerate(row):
                if bit == "1":
                    px, py = x + gx * scale, y + gy * scale
                    d.rectangle([px, py, px + scale - 1, py + scale - 1], fill=CREAM)
        x += (5 + gap) * scale


def draw_robot(d: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int, leg: int, blink: bool) -> None:
    """One orange critter: rounded body, two eyes (or a blink line), two legs, shaded bottom edge."""
    d.rectangle([x, y, x + w - 1, y + h - 1], fill=ORANGE)
    d.rectangle([x, y + h - 1, x + w - 1, y + h - 1], fill=SHADE)
    for cx, cy in [(x, y), (x + w - 1, y)]:
        d.point((cx, cy), fill=NAVY)  # rounded top corners
    lead = w >= 24
    e = 3 if lead else 2
    ey = y + h // 3
    for ex in (x + w // 4, x + w - w // 4 - e):
        if blink:
            d.rectangle([ex, ey + e // 2, ex + e - 1, ey + e // 2], fill=EYE)
        else:
            d.rectangle([ex, ey, ex + e - 1, ey + e - 1], fill=EYE)
    for lx in (x + w // 4, x + w - w // 4 - 2):
        d.rectangle([lx, y + h, lx + 1, y + h + leg - 1], fill=SHADE)
    if lead:
        for nx in (x - 2, x + w):
            d.rectangle([nx, y + h // 2, nx + 1, y + h // 2 + 1], fill=SHADE)


def draw_frame(t: int) -> Image.Image:
    """Compose frame t as a palette-mode image at the low resolution."""
    img = Image.new("P", (W, H), NAVY)
    d = ImageDraw.Draw(img)
    for sx, sy, ph in STARS:
        level = round((math.sin(phase(t, ph)) + 1) * 1.5)  # 0..3
        d.point((sx, sy), fill=[DIM, DIM, MID, BRIGHT][level])
    draw_title(d, "HaiKrew", y=6)
    blink = t == BLINK_FRAME
    draw_robot(d, *LEAD, leg=3, blink=blink)
    for i, x in enumerate(SMALL_X):
        bob = round(math.sin(phase(t, i * 1.1)))  # -1, 0 or 1 low-res pixel
        draw_robot(d, x, SMALL_Y + bob, SMALL_W, SMALL_H, leg=2, blink=blink)
    return img


def main() -> None:
    flat = [c for rgb in PALETTE for c in rgb]
    frames = []
    for t in range(FRAMES):
        big = draw_frame(t).resize((W * SCALE, H * SCALE), Image.NEAREST)
        big.putpalette(flat)
        frames.append(big)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(OUT, save_all=True, append_images=frames[1:], duration=FRAME_MS, loop=0, optimize=False)
    print(f"wrote {OUT} ({FRAMES} frames, {W * SCALE}x{H * SCALE})")


if __name__ == "__main__":
    main()
