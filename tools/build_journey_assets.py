"""Build the layered assets for web/journey from the source station/track images.

Usage: python3 tools/build_journey_assets.py <source_image_dir>

Expected files in <source_image_dir>:
  7.webp   station, train with doors closed
  8.webp   station, train with doors open (pixel-aligned with 7.webp)
  10.webp  sunset tracks with the switch
  11.webp  station without a train
All coordinates below are in the 1448x1086 space of 7.webp.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = Path(sys.argv[1])
OUT = Path(__file__).resolve().parent.parent / "web" / "journey" / "assets"
OUT.mkdir(parents=True, exist_ok=True)

W, H = 1448, 1086
TRAIN_TOP, TRAIN_BOTTOM = 296, 890        # rows covered by the train strip
SEG_X0, SEG_X1 = 130, 1355                # one car section between the two pillars


def load(name):
    return Image.open(SRC / name).convert("RGB")


st_closed, st_open, empty, tracks = load("7.webp"), load("8.webp"), load("11.webp"), load("10.webp")


def mask_from_polys(polys, blur=1.2):
    m = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(m)
    for p in polys:
        d.polygon(p, fill=255)
    return m.filter(ImageFilter.GaussianBlur(blur))


# --- foreground (canopy, pillars, sign, platform) cut from the train image so it lines up with it
fg_polys = [
    [(0, 0), (W, 0), (W, 142), (0, 142)],                                   # canopy
    [(100, 142), (160, 142), (122, 175), (100, 175)],                       # left brace foot
    [(1290, 142), (1360, 142), (1360, 232)],                                # right brace
    [(1106, 70), (1332, 70), (1332, 180), (1106, 180)],                     # platform sign
    [(0, 0), (124, 0), (124, 948), (14, 948), (14, 900), (27, 900), (27, 262), (0, 240)],  # left pillar + down-pipe
    [(106, 552), (152, 552), (152, 630), (106, 630)],                       # junction box
    [(1357, 0), (W, 0), (W, 240), (1430, 262), (1431, 948), (1355, 948)],   # right pillar
    [(0, 888), (W, 888), (W, H), (0, H)],                                   # platform
]
fg = st_closed.copy()
alpha = np.asarray(mask_from_polys(fg_polys), np.float32)
# columns inside the pillars where the train's blue stripe shows through are gaps: make them see-through
px = np.asarray(st_closed, np.float32)
stripe = px[672:726]
blue = ((stripe[..., 2] - stripe[..., 0] > 25) | (stripe.mean(-1) < 45)).mean(0) > 0.6
gap_cols = np.convolve(blue.astype(float), np.ones(5), "same") > 0
alpha[296:889, gap_cols] = 0
fg.putalpha(Image.fromarray(alpha.astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8)))
fg.save(OUT / "station_fg.png", optimize=True)

# --- empty-station background: sky from the train image, sea and rails from the empty-station image
a = np.asarray(st_closed, np.float32)
b = np.asarray(empty, np.float32)
rows = np.arange(H)[:, None, None]
t = np.clip((rows - 262) / 32.0, 0, 1)
bg = a * (1 - t) + b * t
# the empty-station photo has its right pillar ~15px further left; cover that edge with sea/rails
# taken from just left of it so no ghost pillar shows next to the real one
bg[262:890, 1316:1356] = b[262:890, 1276:1316]
Image.fromarray(bg.astype(np.uint8)).save(OUT / "station_bg.webp", quality=90)

# --- train strip: one car section with transparent sky around the roof
strip = st_closed.crop((SEG_X0, TRAIN_TOP, SEG_X1, TRAIN_BOTTOM))
sw, sh = strip.size
sm = Image.new("L", (sw, sh), 0)
d = ImageDraw.Draw(sm)
body_top = 342 - TRAIN_TOP
d.rectangle([0, body_top, sw, sh], fill=255)
d.rectangle([878 - SEG_X0, 298 - TRAIN_TOP, sw, body_top], fill=255)       # roof A/C unit
d.rectangle([186 - SEG_X0, 327 - TRAIN_TOP, 202 - SEG_X0, body_top], fill=255)  # roof vent
strip.putalpha(sm.filter(ImageFilter.GaussianBlur(1.0)))
strip.save(OUT / "train_strip.png", optimize=True)

# --- door leaves (cut from the closed-door image)
for name, box in (("door_left.png", (752, 425, 891, 852)), ("door_right.png", (891, 425, 1031, 852))):
    st_closed.crop(box).save(OUT / name, optimize=True)

st_closed.save(OUT / "station_closed.webp", quality=90)
st_open.save(OUT / "station_open.webp", quality=90)
tracks.save(OUT / "tracks.webp", quality=90)
print("assets written to", OUT)
