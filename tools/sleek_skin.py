# Draws the whole "Sleek" skin: the game's second look, smooth and
# anti-aliased where the base art is hand-placed pixels.
#
#     python3 tools/sleek_skin.py
#
# Writes skins/sleek/assets/** mirroring the base assets/ layout, plus
# skins/sleek/skin.json listing every file it wrote (the manifest the
# game's skinAsset() resolver reads -- see js/skins.js). Rerunning
# regenerates everything; hand edits to skins/sleek do not survive it.
#
# THE ONE RULE: every override is the exact pixel size of the base file
# it replaces. Gameplay never reads a skin -- sizes come from configs and
# elements -- but art at the wrong size would DRAW at the wrong size, and
# tests/skins.test.mjs fails the build on any mismatch. The sizes below
# are therefore read from the base files where practical and asserted
# against them at save time either way.
#
# HOW IT IS SMOOTH AT PIXEL-ART SIZES: everything is drawn at SS times
# its final size and downscaled with Lanczos, so a 16px ball still gets
# anti-aliased edges, gradients and a specular highlight instead of
# 1px-stepped shading. The manifest marks the skin render.pixelArt:false,
# which makes Phaser scale these textures with linear filtering instead
# of nearest-neighbour (see js/skins.js / js/main.js).
import json
import math
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'skins', 'sleek')
SS = 4  # supersample factor

FONT_BOLD = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'

# The skin's palette. Cool blue glass around cyan light -- deliberately a
# different temperature from the base skin's warm gold, so the two are
# never mistaken for each other.
ACCENT = (76, 201, 240)

BALL_COLORS = {
    'round': (255, 89, 100),
    'wave': (74, 222, 128),
    'hunter': (96, 165, 250),
    'heavy': (167, 139, 250),
    'hex': (251, 191, 36),
}

written = []


def base_size(rel):
    with Image.open(os.path.join(ROOT, rel)) as im:
        return im.size


def save(img, rel, final_size):
    # Downscale from the supersampled canvas and refuse to write anything
    # that is not the base file's exact size.
    assert img.size == (final_size[0] * SS, final_size[1] * SS), rel
    base = base_size(rel)
    assert base == final_size, f'{rel}: base is {base}, drew {final_size}'
    out = img.resize(final_size, Image.LANCZOS)
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if rel.endswith('.png'):
        out.save(path)
    else:
        out.save(path, 'WEBP', lossless=True)
    written.append(rel)


def canvas(w, h):
    return Image.new('RGBA', (w * SS, h * SS), (0, 0, 0, 0))


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(len(a)))


def shade(color, factor):
    return tuple(min(255, int(c * factor)) for c in color[:3])


# -- gloss ------------------------------------------------------------------

def glossy_disc(draw_img, cx, cy, r, color):
    """A smooth orb: vertical gradient body, soft top highlight, specular
    dot, darker rim. Coordinates in supersampled pixels."""
    d = ImageDraw.Draw(draw_img)
    steps = max(24, int(r))
    top = shade(color, 1.25)
    bottom = shade(color, 0.55)
    for i in range(steps, 0, -1):
        t = i / steps
        band = lerp(top, bottom, 1 - t)
        d.ellipse([cx - r * t, cy - r * t, cx + r * t, cy + r * t], fill=band + (255,))
    # gradient re-read: concentric shrink gives a radial ramp; bias it
    # vertically with a translucent dark lower arc.
    low = Image.new('RGBA', draw_img.size, (0, 0, 0, 0))
    ImageDraw.Draw(low).ellipse([cx - r, cy - r * 0.1, cx + r, cy + r], fill=(0, 0, 0, 70))
    low = low.filter(ImageFilter.GaussianBlur(r * 0.25))
    draw_img.alpha_composite(low)
    # top sheen
    sheen = Image.new('RGBA', draw_img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sheen).ellipse([cx - r * 0.72, cy - r * 0.9, cx + r * 0.72, cy - r * 0.1],
                                  fill=(255, 255, 255, 90))
    sheen = sheen.filter(ImageFilter.GaussianBlur(r * 0.16))
    draw_img.alpha_composite(sheen)
    # specular dot
    spec = Image.new('RGBA', draw_img.size, (0, 0, 0, 0))
    ImageDraw.Draw(spec).ellipse([cx - r * 0.45, cy - r * 0.62, cx - r * 0.12, cy - r * 0.3],
                                 fill=(255, 255, 255, 200))
    spec = spec.filter(ImageFilter.GaussianBlur(r * 0.07))
    draw_img.alpha_composite(spec)
    # rim
    d = ImageDraw.Draw(draw_img)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=shade(color, 0.4) + (255,), width=max(2, int(r * 0.06)))


def rounded_hex_points(cx, cy, r, rot_deg):
    pts = []
    for i in range(6):
        a = math.radians(rot_deg + 60 * i - 90)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def glossy_hex(img, cx, cy, r, color, rot_deg):
    d = ImageDraw.Draw(img)
    steps = max(24, int(r))
    top = shade(color, 1.25)
    bottom = shade(color, 0.55)
    for i in range(steps, 0, -1):
        t = i / steps
        band = lerp(top, bottom, 1 - t)
        d.polygon(rounded_hex_points(cx, cy, r * t, rot_deg), fill=band + (255,))
    sheen = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sheen).ellipse([cx - r * 0.6, cy - r * 0.85, cx + r * 0.6, cy - r * 0.1],
                                  fill=(255, 255, 255, 80))
    sheen = sheen.filter(ImageFilter.GaussianBlur(r * 0.15))
    img.alpha_composite(sheen)
    d = ImageDraw.Draw(img)
    d.polygon(rounded_hex_points(cx, cy, r, rot_deg), outline=shade(color, 0.4) + (255,),
              width=max(2, int(r * 0.07)))


# -- balls ------------------------------------------------------------------

def draw_balls():
    for shape in ['round', 'wave', 'hunter', 'heavy']:
        for size, radius in [(1, 8), (2, 16), (3, 24), (4, 32), (5, 48)]:
            d = radius * 2
            img = canvas(d, d)
            glossy_disc(img, d * SS / 2, d * SS / 2, radius * SS * 0.96, BALL_COLORS[shape])
            mark_ball(img, shape, radius)
            save(img, f'assets/balls/ball_{shape}_{size}.webp', (d, d))
    for size, radius in [(1, 8), (2, 16), (3, 24)]:
        d = radius * 2
        img = canvas(d, d * 3)
        for frame, rot in enumerate([0, 20, 40]):
            glossy_hex(img, d * SS / 2, (frame * d + radius) * SS, radius * SS * 0.94,
                       BALL_COLORS['hex'], rot)
        save(img, f'assets/balls/ball_hex_{size}.webp', (d, d * 3))


def mark_ball(img, shape, radius):
    """The kind has to read at a glance in this skin too: the wave gets a
    sine sweep, the hunter a slit eye, the heavy a weight band. The round
    ball stays bare, exactly as its pixel original is."""
    r = radius * SS
    cx = cy = r
    d = ImageDraw.Draw(img)
    white = (255, 255, 255, 150)
    if shape == 'wave':
        pts = [(cx - r * 0.55 + r * 1.1 * t / 24,
                cy + math.sin(t / 24 * math.pi * 2) * r * 0.22 + r * 0.15) for t in range(25)]
        d.line(pts, fill=white, width=max(2, int(r * 0.09)), joint='curve')
    elif shape == 'hunter':
        d.ellipse([cx - r * 0.42, cy - r * 0.18 + r * 0.1, cx + r * 0.42, cy + r * 0.18 + r * 0.1],
                  fill=(20, 30, 60, 200))
        d.ellipse([cx - r * 0.14, cy - r * 0.14 + r * 0.1, cx + r * 0.14, cy + r * 0.14 + r * 0.1],
                  fill=(255, 255, 255, 230))
    elif shape == 'heavy':
        d.rectangle([cx - r * 0.55, cy + r * 0.05, cx + r * 0.55, cy + r * 0.32], fill=(30, 20, 60, 140))


def draw_pops():
    sizes = {'round': 5, 'wave': 5, 'hunter': 5, 'heavy': 5, 'hex': 3}
    radii = [8, 16, 24, 32, 48]
    for shape, top in sizes.items():
        for size in range(1, top + 1):
            radius = radii[size - 1]
            frame = round(radius * 2 * 1.6)
            img = canvas(frame, frame * 2)
            color = BALL_COLORS[shape]
            for f in range(2):
                cx = frame * SS / 2
                cy = (f * frame + frame / 2) * SS
                grow = 0.55 if f == 0 else 0.92
                alpha = 230 if f == 0 else 120
                ring = Image.new('RGBA', img.size, (0, 0, 0, 0))
                rd = ImageDraw.Draw(ring)
                rr = frame * SS / 2 * grow
                rd.ellipse([cx - rr, cy - rr, cx + rr, cy + rr],
                           outline=shade(color, 1.2) + (alpha,), width=max(3, int(rr * 0.16)))
                ring = ring.filter(ImageFilter.GaussianBlur(SS * 0.8))
                img.alpha_composite(ring)
                if f == 0:
                    flash = Image.new('RGBA', img.size, (0, 0, 0, 0))
                    ImageDraw.Draw(flash).ellipse([cx - rr * 0.4, cy - rr * 0.4, cx + rr * 0.4, cy + rr * 0.4],
                                                  fill=(255, 255, 255, 160))
                    flash = flash.filter(ImageFilter.GaussianBlur(rr * 0.2))
                    img.alpha_composite(flash)
                else:
                    dd = ImageDraw.Draw(img)
                    for k in range(8):
                        a = math.radians(k * 45 + 22)
                        px, py = cx + math.cos(a) * rr * 1.0, cy + math.sin(a) * rr * 1.0
                        pr = frame * SS * 0.03
                        dd.ellipse([px - pr, py - pr, px + pr, py + pr], fill=shade(color, 1.3) + (150,))
            save(img, f'assets/balls/pop_{shape}_{size}.webp', (frame, frame * 2))


# -- world ------------------------------------------------------------------

def vertical_gradient(img, top, bottom, alpha=255):
    w, h = img.size
    d = ImageDraw.Draw(img)
    for y in range(h):
        d.line([(0, y), (w, y)], fill=lerp(top, bottom, y / max(1, h - 1)) + (alpha,))


def draw_tiles():
    # wall: cool graphite glass, a soft inner bevel, no pixel grid.
    img = canvas(16, 16)
    vertical_gradient(img, (58, 74, 110), (30, 40, 64))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 16 * SS - 1, 16 * SS - 1], outline=(88, 110, 150, 255), width=SS)
    d.line([(SS, SS), (16 * SS - SS, SS)], fill=(140, 165, 205, 200), width=SS)
    d.line([(SS, 16 * SS - SS), (16 * SS - SS, 16 * SS - SS)], fill=(16, 22, 38, 220), width=SS)
    save(img, 'assets/obstacles/wall.webp', (16, 16))

    # crate: warm amber panel with a rounded strap cross.
    img = canvas(16, 16)
    vertical_gradient(img, (222, 160, 74), (150, 96, 38))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([SS, SS, 16 * SS - SS, 16 * SS - SS], radius=3 * SS,
                        outline=(255, 216, 150, 220), width=SS)
    d.line([(0, 8 * SS), (16 * SS, 8 * SS)], fill=(120, 72, 26, 230), width=2 * SS)
    d.line([(8 * SS, 0), (8 * SS, 16 * SS)], fill=(120, 72, 26, 230), width=2 * SS)
    save(img, 'assets/obstacles/crate.webp', (16, 16))

    # ice: translucent glass with a diagonal sheen.
    img = canvas(16, 16)
    vertical_gradient(img, (150, 215, 250), (70, 130, 200))
    sheen = Image.new('RGBA', img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sheen).polygon([(0, 12 * SS), (10 * SS, 0), (16 * SS, 0), (4 * SS, 16 * SS)],
                                  fill=(255, 255, 255, 90))
    sheen = sheen.filter(ImageFilter.GaussianBlur(SS * 1.4))
    img.alpha_composite(sheen)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 16 * SS - 1, 16 * SS - 1], outline=(210, 240, 255, 220), width=SS)
    save(img, 'assets/obstacles/ice.webp', (16, 16))

    # ladder: two metal rails, rounded rungs, seamless top to bottom.
    img = canvas(48, 96)
    d = ImageDraw.Draw(img)
    for rx in [10, 38]:
        d.rounded_rectangle([(rx - 2.4) * SS, -4 * SS, (rx + 2.4) * SS, 100 * SS],
                            radius=2 * SS, fill=(150, 168, 196, 255))
        d.line([(rx - 1.6) * SS, 0, (rx - 1.6) * SS, 96 * SS], fill=(220, 232, 248, 180), width=SS)
    for i in range(6):
        y = (8 + i * 16) * SS
        d.rounded_rectangle([8 * SS, y - 1.8 * SS, 40 * SS, y + 1.8 * SS],
                            radius=1.8 * SS, fill=(120, 136, 164, 255))
        d.line([(9 * SS, y - 0.8 * SS), (39 * SS, y - 0.8 * SS)], fill=(210, 224, 244, 150), width=SS)
    save(img, 'assets/ladders/ladder.webp', (48, 96))


def sky(rel, w, h, top, mid, bottom, stars=90, glow=None):
    img = canvas(w, h)
    half = Image.new('RGBA', img.size, (0, 0, 0, 0))
    vertical_gradient(half, top, mid)
    img.alpha_composite(half)
    lower = Image.new('RGBA', (w * SS, h * SS // 2), (0, 0, 0, 0))
    vertical_gradient(lower, mid, bottom)
    img.alpha_composite(lower, (0, h * SS - h * SS // 2))
    import random
    rng = random.Random(rel)
    d = ImageDraw.Draw(img)
    for _ in range(stars):
        x, y = rng.uniform(0, w * SS), rng.uniform(0, h * SS * 0.8)
        r = rng.uniform(0.5, 1.6) * SS * 0.5
        a = rng.randint(60, 170)
        d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, a))
    if glow:
        gx, gy, gr, gc = glow
        layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
        ImageDraw.Draw(layer).ellipse([(gx - gr) * SS, (gy - gr) * SS, (gx + gr) * SS, (gy + gr) * SS],
                                      fill=gc + (110,))
        layer = layer.filter(ImageFilter.GaussianBlur(gr * SS * 0.5))
        img.alpha_composite(layer)
    save(img, rel, (w, h))


# One smooth sky per daylight phase, tinted a little per region so the
# continents still feel like places -- the same relationship the base art
# has, painted as gradients instead of pixels.
PHASE_SKIES = {
    'morning': ((255, 183, 130), (120, 130, 190), (44, 52, 96)),
    'noon': ((120, 190, 245), (70, 120, 200), (30, 60, 120)),
    'afternoon': ((250, 205, 120), (150, 120, 170), (60, 60, 110)),
    'dusk': ((250, 130, 100), (110, 70, 140), (35, 30, 80)),
    'night': ((28, 34, 72), (18, 22, 48), (8, 10, 26)),
}

REGION_TINT = {
    'europe': (0, 0, 0), 'africa': (25, 10, -10), 'middle_east': (20, 5, -5),
    'india': (15, -5, 5), 'asia': (-5, 5, 10), 'oceania': (-10, 10, 15),
    'pacific': (-15, 5, 20), 'south_america': (5, 15, -5), 'america': (0, 5, 10),
    'arctic': (-20, 5, 25),
}


def tinted(color, tint):
    return tuple(max(0, min(255, c + t)) for c, t in zip(color, tint))


def draw_backgrounds():
    w, h = base_size('assets/backgrounds/default.webp')
    sky('assets/backgrounds/default.webp', w, h,
        (26, 32, 66), (14, 18, 40), (7, 9, 22), stars=140, glow=(640, 90, 60, (140, 180, 255)))
    for region, tint in REGION_TINT.items():
        night = PHASE_SKIES['night']
        sky(f'assets/backgrounds/{region}.webp', w, h, *[tinted(c, tint) for c in night], stars=120)
        for phase, colors in PHASE_SKIES.items():
            sky(f'assets/backgrounds/{region}_{phase}.webp', w, h,
                *[tinted(c, tint) for c in colors], stars=30 if phase != 'night' else 120)


# -- weapons ----------------------------------------------------------------

def beam_cell(d, cx, color, head='arrow'):
    """One 36x400 shot cell at supersample: a glowing core the full
    height, a head at the top."""
    core_w = 3 * SS  # half of SHOT_BEAM_WIDTH (6px) each side
    for spread, alpha in [(3.2, 40), (2.2, 80), (1.2, 160), (0.55, 255)]:
        d.rounded_rectangle([cx - core_w * spread, 8 * SS, cx + core_w * spread, 400 * SS],
                            radius=core_w * spread, fill=color + (alpha,))
    d.rounded_rectangle([cx - core_w * 0.22, 10 * SS, cx + core_w * 0.22, 400 * SS],
                        radius=core_w, fill=(255, 255, 255, 230))
    if head == 'arrow':
        d.polygon([(cx, 0), (cx - 8 * SS, 18 * SS), (cx + 8 * SS, 18 * SS)], fill=(255, 255, 255, 255))
        d.polygon([(cx, 3 * SS), (cx - 5 * SS, 16 * SS), (cx + 5 * SS, 16 * SS)], fill=color + (255,))


def hook_head(d, cx, cy, color, open_claws):
    w = 4.6 * SS
    d.ellipse([cx - 3 * SS, cy - 2 * SS, cx + 3 * SS, cy + 4 * SS], fill=color + (255,))
    d.arc([cx - 12 * SS, cy - 4 * SS, cx + 12 * SS, cy + 20 * SS], start=190, end=350,
          fill=color + (255,), width=int(w))
    if open_claws:
        for sx in (-1, 1):
            d.line([cx + sx * 11 * SS, cy + 4 * SS, cx + sx * 16 * SS, cy - 6 * SS],
                   fill=color + (255,), width=int(w))
            d.ellipse([cx + sx * 16 * SS - 2 * SS, cy - 8 * SS, cx + sx * 16 * SS + 2 * SS, cy - 4 * SS],
                      fill=color + (255,))


def draw_weapons():
    img = canvas(144, 400)
    d = ImageDraw.Draw(img)
    beam_cell(d, 18 * SS, ACCENT)  # harpoon
    # grapple cells: chain + hook, three phases
    chain_color = (170, 190, 220)
    for cell, (claws, alpha) in enumerate([(False, 255), (True, 255), (True, 130)], start=1):
        cx = (cell * 36 + 18) * SS
        for y in range(14, 400, 10):
            d.rounded_rectangle([cx - 1.6 * SS, y * SS, cx + 1.6 * SS, (y + 6) * SS],
                                radius=1.6 * SS, fill=chain_color + (alpha,))
        hook_head(d, cx, 8 * SS, (255, 214, 90), claws)
    save(img, 'assets/weapons/shots.webp', (144, 400))

    img = canvas(6, 12)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0.6 * SS, 0.6 * SS, 5.4 * SS, 11.4 * SS], radius=3 * SS, fill=(255, 214, 90, 255))
    d.rounded_rectangle([1.4 * SS, 1.2 * SS, 3 * SS, 6 * SS], radius=1.5 * SS, fill=(255, 255, 255, 190))
    save(img, 'assets/weapons/bullet.webp', (6, 12))

    # bullet_hit: 2 frames 16x16 -- a small warm spark.
    img = canvas(16, 32)
    for f, (r, a) in enumerate([(4.5, 255), (7, 130)]):
        cx, cy = 8 * SS, (f * 16 + 8) * SS
        layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
        ImageDraw.Draw(layer).ellipse([cx - r * SS, cy - r * SS, cx + r * SS, cy + r * SS],
                                      fill=(255, 214, 90, a))
        layer = layer.filter(ImageFilter.GaussianBlur(SS * 1.2))
        img.alpha_composite(layer)
        ImageDraw.Draw(img).ellipse([cx - r * SS * 0.4, cy - r * SS * 0.4, cx + r * SS * 0.4, cy + r * SS * 0.4],
                                    fill=(255, 255, 255, a))
    save(img, 'assets/weapons/bullet_hit.webp', (16, 32))

    # beam_hit: 2 frames 32x20, hanging from the top edge, cool grey.
    img = canvas(32, 40)
    for f, (spread, a) in enumerate([(0.7, 220), (1.0, 110)]):
        top = f * 20
        layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        for i, (ox, r) in enumerate([(-9, 6), (0, 8), (9, 6), (-4, 5), (5, 5)]):
            cx = (16 + ox * spread) * SS
            cy = (top + 4 + r * 0.7) * SS
            ld.ellipse([cx - r * SS * spread, cy - r * SS * 0.8, cx + r * SS * spread, cy + r * SS * 0.8],
                       fill=(190, 200, 215, a))
        layer = layer.filter(ImageFilter.GaussianBlur(SS * 1.3))
        img.alpha_composite(layer)
    save(img, 'assets/weapons/beam_hit.webp', (32, 40))


# -- power-ups --------------------------------------------------------------

POWERUP_COLORS = {
    'bonus_fruit': (255, 159, 243), 'dynamite': (240, 86, 45), 'extra_life': (255, 107, 129),
    'hourglass': (200, 162, 255), 'rapid_shot': (255, 210, 63), 'score_multiplier': (254, 202, 87),
    'shield': (200, 214, 229), 'speed_boost': (29, 209, 161), 'time_freeze': (72, 219, 251),
    'weapon_grapple': (255, 210, 63), 'weapon_harpoon': (255, 210, 63), 'weapon_machinegun': (255, 210, 63),
}


def glyph(d, kind, cx, cy, s):
    """A small white symbol, drawn smooth. `s` is the glyph radius in
    supersampled px."""
    W = (255, 255, 255, 235)
    lw = max(2, int(s * 0.28))
    if kind == 'bonus_fruit':
        d.ellipse([cx - s * 0.9, cy - s * 0.1, cx - s * 0.05, cy + s * 0.75], fill=W)
        d.ellipse([cx + s * 0.05, cy + s * 0.05, cx + s * 0.9, cy + s * 0.9], fill=W)
        d.line([cx - s * 0.45, cy - s * 0.05, cx + s * 0.1, cy - s * 0.9], fill=W, width=lw)
        d.line([cx + s * 0.45, cy + s * 0.1, cx + s * 0.1, cy - s * 0.9], fill=W, width=lw)
    elif kind == 'dynamite':
        d.rounded_rectangle([cx - s * 0.35, cy - s * 0.5, cx + s * 0.35, cy + s * 0.9], radius=s * 0.3, fill=W)
        d.line([cx, cy - s * 0.5, cx + s * 0.4, cy - s * 0.95], fill=W, width=lw)
    elif kind == 'extra_life':
        d.polygon([(cx, cy + s * 0.85), (cx - s * 0.85, cy - s * 0.05), (cx - s * 0.45, cy - s * 0.65),
                   (cx, cy - s * 0.25), (cx + s * 0.45, cy - s * 0.65), (cx + s * 0.85, cy - s * 0.05)], fill=W)
    elif kind == 'hourglass':
        d.polygon([(cx - s * 0.6, cy - s * 0.8), (cx + s * 0.6, cy - s * 0.8), (cx, cy),
                   (cx + s * 0.6, cy + s * 0.8), (cx - s * 0.6, cy + s * 0.8), (cx, cy)], fill=W)
    elif kind in ('rapid_shot',):
        d.polygon([(cx + s * 0.1, cy - s * 0.95), (cx - s * 0.55, cy + s * 0.15), (cx - s * 0.05, cy + s * 0.15),
                   (cx - s * 0.1, cy + s * 0.95), (cx + s * 0.55, cy - s * 0.15), (cx + s * 0.05, cy - s * 0.15)], fill=W)
    elif kind == 'score_multiplier':
        pts = []
        for i in range(10):
            a = math.radians(i * 36 - 90)
            rr = s if i % 2 == 0 else s * 0.45
            pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
        d.polygon(pts, fill=W)
    elif kind == 'shield':
        d.polygon([(cx - s * 0.7, cy - s * 0.6), (cx + s * 0.7, cy - s * 0.6), (cx + s * 0.7, cy + s * 0.1),
                   (cx, cy + s * 0.9), (cx - s * 0.7, cy + s * 0.1)], fill=W)
    elif kind == 'speed_boost':
        for ox in (-0.45, 0.25):
            d.polygon([(cx + s * ox, cy - s * 0.7), (cx + s * (ox + 0.55), cy),
                       (cx + s * ox, cy + s * 0.7), (cx + s * (ox + 0.25), cy)], fill=W)
    elif kind == 'time_freeze':
        for i in range(3):
            a = math.radians(i * 60)
            dx, dy = math.cos(a) * s * 0.9, math.sin(a) * s * 0.9
            d.line([cx - dx, cy - dy, cx + dx, cy + dy], fill=W, width=lw)
        d.ellipse([cx - s * 0.18, cy - s * 0.18, cx + s * 0.18, cy + s * 0.18], fill=W)
    elif kind == 'weapon_harpoon':
        d.line([cx, cy + s * 0.9, cx, cy - s * 0.6], fill=W, width=lw)
        d.polygon([(cx, cy - s * 0.95), (cx - s * 0.5, cy - s * 0.2), (cx + s * 0.5, cy - s * 0.2)], fill=W)
    elif kind == 'weapon_grapple':
        d.line([cx, cy - s * 0.9, cx, cy + s * 0.2], fill=W, width=lw)
        d.arc([cx - s * 0.6, cy - s * 0.3, cx + s * 0.6, cy + s * 0.9], start=0, end=220, fill=W, width=lw)
    elif kind == 'weapon_machinegun':
        for i, oy in enumerate((-0.55, 0.05, 0.65)):
            d.rounded_rectangle([cx - s * 0.5 + i * s * 0.12, cy + s * oy - s * 0.16,
                                 cx + s * 0.5 + i * s * 0.12, cy + s * oy + s * 0.16],
                                radius=s * 0.16, fill=W)


def draw_powerups():
    for kind, color in POWERUP_COLORS.items():
        img = canvas(18, 18)
        glossy_disc(img, 9 * SS, 9 * SS, 8.4 * SS, color)
        glyph(ImageDraw.Draw(img), kind, 9 * SS, 9 * SS, 5.2 * SS)
        save(img, f'assets/powerups/{kind}.webp', (18, 18))


# -- player -----------------------------------------------------------------

SUIT = (226, 232, 244)
SUIT_DARK = (148, 163, 190)
VISOR = (34, 46, 74)
TRIM = ACCENT


def limb(d, p1, p2, w, color):
    d.line([p1, p2], fill=color + (255,), width=int(w))
    for p in (p1, p2):
        d.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=color + (255,))


def draw_pose(img, oy, pose):
    """One 36x72 cell. All coordinates in base px * SS; oy is the cell's
    top. The figure: head r=7 at y~14, torso capsule to y~46, legs to
    y~70 -- feet always on the cell floor so the game's bottom-anchored
    hitbox lines up exactly like the pixel art's."""
    U = SS
    cx = 18 * U
    top = oy * U
    d = ImageDraw.Draw(img)
    facing = pose.get('facing', 'back')
    lean = pose.get('lean', 0) * U
    crouch = pose.get('crouch', 0) * U
    airborne = pose.get('air', 0) * U

    hip_y = top + (46 * U) + crouch - airborne
    shoulder_y = top + (24 * U) + crouch - airborne
    head_cy = top + (13 * U) + crouch - airborne
    hcx = cx + lean

    # legs first (behind the torso)
    lw = 5.5 * U
    for i, leg in enumerate(pose.get('legs', [(0, 0), (0, 0)])):
        ka, fa = leg  # knee/foot forward offsets in base px
        knee = (hcx + ka * U, hip_y + 12 * U - airborne * 0.2)
        foot = (hcx + fa * U, top + 70 * U - pose.get('footlift', [0, 0])[i] * U - airborne)
        color = SUIT_DARK if i == 0 else shade(SUIT_DARK, 0.85)
        limb(d, (hcx + (ka * U) * 0.3, hip_y), knee, lw, color)
        limb(d, knee, foot, lw, color)
        # boot
        bx, by = foot
        d.rounded_rectangle([bx - 4 * U, by - 3 * U, bx + 4 * U, by + 2 * U], radius=2 * U,
                            fill=TRIM + (255,))

    # torso
    d.rounded_rectangle([hcx - 8.5 * U, shoulder_y - 4 * U, hcx + 8.5 * U, hip_y + 2 * U],
                        radius=7 * U, fill=SUIT + (255,))
    d.rounded_rectangle([hcx - 8.5 * U, shoulder_y - 4 * U, hcx + 8.5 * U, hip_y + 2 * U],
                        radius=7 * U, outline=shade(SUIT_DARK, 0.9) + (255,), width=U)
    # chest light
    d.ellipse([hcx - 2.5 * U, shoulder_y + 4 * U, hcx + 2.5 * U, shoulder_y + 9 * U], fill=TRIM + (255,))
    if facing == 'back':
        d.rounded_rectangle([hcx - 6 * U, shoulder_y - 2 * U, hcx + 6 * U, shoulder_y + 14 * U],
                            radius=4 * U, fill=SUIT_DARK + (255,))

    # arms
    aw = 5 * U
    for i, arm in enumerate(pose.get('arms', [(-10, 8), (10, 8)])):
        ax, ay = arm  # hand offset from shoulder, base px
        sx = hcx + (-7 * U if i == 0 else 7 * U)
        hand = (sx + ax * U, shoulder_y + ay * U)
        limb(d, (sx, shoulder_y), hand, aw, SUIT_DARK if facing == 'back' else SUIT)
        d.ellipse([hand[0] - 3 * U, hand[1] - 3 * U, hand[0] + 3 * U, hand[1] + 3 * U],
                  fill=TRIM + (255,))

    # head
    hr = 8 * U
    d.ellipse([hcx - hr, head_cy - hr, hcx + hr, head_cy + hr], fill=SUIT + (255,))
    d.ellipse([hcx - hr, head_cy - hr, hcx + hr, head_cy + hr],
              outline=shade(SUIT_DARK, 0.9) + (255,), width=U)
    if facing == 'front':
        d.rounded_rectangle([hcx - 5.5 * U, head_cy - 3 * U, hcx + 5.5 * U, head_cy + 3.5 * U],
                            radius=3 * U, fill=VISOR + (255,))
        if pose.get('dead'):
            for sx in (-2.6, 2.6):
                exc, eyc = hcx + sx * U, head_cy + 0.3 * U
                for a in (45, -45):
                    r = math.radians(a)
                    d.line([exc - math.cos(r) * 1.6 * U, eyc - math.sin(r) * 1.6 * U,
                            exc + math.cos(r) * 1.6 * U, eyc + math.sin(r) * 1.6 * U],
                           fill=(255, 255, 255, 255), width=int(0.9 * U))
        else:
            for sx in (-2.6, 2.6):
                d.ellipse([hcx + sx * U - 1.2 * U, head_cy - 1 * U, hcx + sx * U + 1.2 * U, head_cy + 1.4 * U],
                          fill=(160, 220, 255, 255))
    elif facing == 'side':
        d.rounded_rectangle([hcx - hr + 1 * U, head_cy - 3 * U, hcx - hr + 8 * U, head_cy + 3.5 * U],
                            radius=3 * U, fill=VISOR + (255,))
    else:  # back
        d.rounded_rectangle([hcx - 5 * U, head_cy - 2 * U, hcx + 5 * U, head_cy + 4 * U],
                            radius=3 * U, fill=SUIT_DARK + (255,))


PLAYER_POSES = [
    # 0 idle: from behind, weapon arm up
    {'facing': 'back', 'arms': [(-3, -14), (4, 6)], 'legs': [(-4, -4), (4, 4)]},
    # 1 shot: both up, planted wide
    {'facing': 'back', 'arms': [(-4, -16), (4, -16)], 'legs': [(-6, -6), (6, 6)]},
    # 2-5 walk cycle (side, facing left)
    {'facing': 'side', 'arms': [(-4, -14), (2, 6)], 'legs': [(-7, -10), (5, 6)], 'footlift': [3, 0]},
    {'facing': 'side', 'arms': [(-4, -14), (1, 7)], 'legs': [(-3, -4), (2, 2)], 'footlift': [0, 0]},
    {'facing': 'side', 'arms': [(-4, -14), (2, 6)], 'legs': [(5, 7), (-6, -8)], 'footlift': [0, 3]},
    {'facing': 'side', 'arms': [(-4, -14), (1, 7)], 'legs': [(2, 3), (-3, -3)], 'footlift': [0, 0]},
    # 6 victory: front, arms up
    {'facing': 'front', 'arms': [(-5, -16), (5, -16)], 'legs': [(-4, -4), (4, 4)]},
    # 7 dead: front, slumped, X visor
    {'facing': 'front', 'arms': [(-9, 10), (9, 10)], 'legs': [(-5, -6), (5, 6)], 'crouch': 4, 'dead': True},
    # 8-9 climb: back, alternating reach
    {'facing': 'back', 'arms': [(-3, -16), (4, -6)], 'legs': [(-4, -5), (4, 3)], 'footlift': [6, 0], 'crouch': 1},
    {'facing': 'back', 'arms': [(-3, -6), (4, -16)], 'legs': [(4, 5), (-4, -3)], 'footlift': [0, 6], 'crouch': 1},
    # 10-11 stepping off a ladder top: crouch, straighten
    {'facing': 'back', 'arms': [(-6, 2), (6, 2)], 'legs': [(-5, -5), (5, 5)], 'crouch': 6},
    {'facing': 'back', 'arms': [(-4, 4), (4, 4)], 'legs': [(-4, -4), (4, 4)], 'crouch': 2},
    # 12-13 step up
    {'facing': 'side', 'arms': [(-4, -14), (2, 5)], 'legs': [(-8, -9), (4, 5)], 'footlift': [10, 0], 'crouch': 2},
    {'facing': 'side', 'arms': [(-4, -14), (2, 5)], 'legs': [(-5, -6), (3, 3)], 'footlift': [4, 0], 'crouch': 1},
    # 14-15 step down
    {'facing': 'side', 'arms': [(-4, -14), (2, 5)], 'legs': [(-7, -9), (3, 4)], 'footlift': [0, 4], 'crouch': 2},
    {'facing': 'side', 'arms': [(-4, -14), (2, 5)], 'legs': [(-4, -5), (2, 2)], 'footlift': [0, 1], 'crouch': 1},
    # 16 jump: front, airborne
    {'facing': 'front', 'arms': [(-6, -14), (6, -14)], 'legs': [(-5, -7), (5, 7)], 'footlift': [6, 6], 'air': 3},
]


def draw_player():
    img = canvas(36, 72 * 17)
    for i, pose in enumerate(PLAYER_POSES):
        draw_pose(img, i * 72, pose)
    save(img, 'assets/player/player.png', (36, 72 * 17))

    # ghost: the dead figure gone translucent, with wings; 2 frames.
    img = canvas(64, 144)
    for f, wing_lift in enumerate([10, -4]):
        cell = Image.new('RGBA', (36 * SS, 72 * SS), (0, 0, 0, 0))
        draw_pose(cell, 0, {'facing': 'front', 'arms': [(-7, 4), (7, 4)],
                            'legs': [(-4, -4), (4, 4)], 'dead': True})
        # wash it out
        alpha = cell.getchannel('A').point(lambda a: a * 0.55)
        white = Image.new('RGBA', cell.size, (225, 238, 255, 0))
        white.putalpha(alpha)
        frame_top = f * 72 * SS
        d = ImageDraw.Draw(img)
        for sx in (-1, 1):
            wx = 32 * SS + sx * 15 * SS
            d.polygon([(32 * SS + sx * 8 * SS, frame_top + 30 * SS),
                       (wx + sx * 8 * SS, frame_top + (18 - wing_lift) * SS),
                       (wx, frame_top + (38 - wing_lift // 2) * SS),
                       (32 * SS + sx * 9 * SS, frame_top + 42 * SS)],
                      fill=(235, 244, 255, 170))
        img.alpha_composite(white, (14 * SS, frame_top))
    save(img, 'assets/player/ghost.png', (64, 144))

    # shield: 3 pulsing cyan rings, 64x64 frames.
    img = canvas(64, 192)
    for f, (r, a) in enumerate([(26, 150), (29, 190), (27, 120)]):
        cx, cy = 32 * SS, (f * 64 + 32) * SS
        layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
        ImageDraw.Draw(layer).ellipse([cx - r * SS, cy - r * SS, cx + r * SS, cy + r * SS],
                                      outline=ACCENT + (a,), width=3 * SS)
        layer = layer.filter(ImageFilter.GaussianBlur(SS * 1.6))
        img.alpha_composite(layer)
        ImageDraw.Draw(img).ellipse([cx - r * SS, cy - r * SS, cx + r * SS, cy + r * SS],
                                    outline=(220, 245, 255, a), width=SS)
    save(img, 'assets/player/shield.webp', (64, 192))

    # hit: 2-frame warm burst 32x32.
    img = canvas(32, 64)
    for f, (r, a) in enumerate([(9, 240), (14, 110)]):
        cx, cy = 16 * SS, (f * 32 + 16) * SS
        layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
        ImageDraw.Draw(layer).ellipse([cx - r * SS, cy - r * SS, cx + r * SS, cy + r * SS],
                                      fill=(255, 120, 90, a))
        layer = layer.filter(ImageFilter.GaussianBlur(SS * 2))
        img.alpha_composite(layer)
        ImageDraw.Draw(img).ellipse([cx - r * SS * 0.4, cy - r * SS * 0.4, cx + r * SS * 0.4, cy + r * SS * 0.4],
                                    fill=(255, 235, 200, a))
    save(img, 'assets/player/hit.webp', (32, 64))

    # dust: 2 soft grey puffs 32x16 frames.
    img = canvas(32, 32)
    for f, (spread, a) in enumerate([(0.8, 200), (1.15, 90)]):
        cy = (f * 16 + 11) * SS
        layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        for ox, r in [(-9, 4.5), (0, 6), (9, 4.5)]:
            cx = (16 + ox * spread) * SS
            ld.ellipse([cx - r * SS * spread, cy - r * SS * 0.7, cx + r * SS * spread, cy + r * SS * 0.7],
                       fill=(205, 212, 226, a))
        layer = layer.filter(ImageFilter.GaussianBlur(SS * 1.4))
        img.alpha_composite(layer)
    save(img, 'assets/player/dust.webp', (32, 32))


# -- HUD & UI text ----------------------------------------------------------

def text_image(rel, w, h, text, size_ratio=0.92):
    img = canvas(w, h)
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT_BOLD, int(h * SS * size_ratio))
    box = d.textbbox((0, 0), text, font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    d.text(((w * SS - tw) / 2 - box[0], (h * SS - th) / 2 - box[1]), text,
           font=font, fill=(255, 255, 255, 255))
    save(img, rel, (w, h))


def digit_strip(rel, cell_w, cell_h):
    img = canvas(cell_w * 10, cell_h)
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT_BOLD, int(cell_h * SS * 0.98))
    for i in range(10):
        ch = str(i)
        box = d.textbbox((0, 0), ch, font=font)
        tw, th = box[2] - box[0], box[3] - box[1]
        d.text((i * cell_w * SS + (cell_w * SS - tw) / 2 - box[0], (cell_h * SS - th) / 2 - box[1]),
               ch, font=font, fill=(255, 255, 255, 255))
    save(img, rel, (cell_w * 10, cell_h))


def draw_hud():
    digit_strip('assets/hud/digits_large.webp', 12, 18)
    digit_strip('assets/hud/digits_small.webp', 8, 12)
    text_image('assets/hud/hud_1p.webp', 28, 12, '1-P')
    text_image('assets/hud/hud_time_label.webp', 40, 12, 'TIME')
    text_image('assets/hud/hud_level_label.webp', 50, 12, 'LEVEL')
    text_image('assets/hud/hud_hi_label.webp', 16, 12, 'HI')
    text_image('assets/ui/percent.webp', 8, 12, '%')

    # life: a smooth heart, white (the HUD tints it).
    img = canvas(10, 10)
    d = ImageDraw.Draw(img)
    s = 4.6 * SS
    cx, cy = 5 * SS, 4.6 * SS
    d.polygon([(cx, cy + s), (cx - s, cy - s * 0.1), (cx - s * 0.5, cy - s * 0.75),
               (cx, cy - s * 0.25), (cx + s * 0.5, cy - s * 0.75), (cx + s, cy - s * 0.1)],
              fill=(255, 255, 255, 255))
    save(img, 'assets/hud/hud_life.webp', (10, 10))

    # weapon socket: rounded glass square.
    img = canvas(33, 33)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([SS, SS, 32 * SS, 32 * SS], radius=7 * SS, fill=(22, 30, 52, 210))
    d.rounded_rectangle([SS, SS, 32 * SS, 32 * SS], radius=7 * SS, outline=ACCENT + (255,), width=SS)
    d.rounded_rectangle([2.5 * SS, 2.5 * SS, 30.5 * SS, 30.5 * SS], radius=6 * SS,
                        outline=(255, 255, 255, 60), width=SS)
    save(img, 'assets/hud/hud_weapon_frame.webp', (33, 33))

    for kind in ['weapon_harpoon', 'weapon_grapple', 'weapon_machinegun']:
        img = canvas(21, 21)
        glyph(ImageDraw.Draw(img), kind, 10.5 * SS, 10.5 * SS, 7.5 * SS)
        save(img, f'assets/hud/{kind}.webp', (21, 21))


def draw_loading():
    w, h = base_size('assets/ui/loading.webp')
    img = canvas(w, h)
    half = Image.new('RGBA', img.size, (0, 0, 0, 0))
    vertical_gradient(half, (22, 30, 62), (8, 10, 24))
    img.alpha_composite(half)
    import random
    rng = random.Random('loading')
    d = ImageDraw.Draw(img)
    for _ in range(160):
        x, y = rng.uniform(0, w * SS), rng.uniform(0, h * SS)
        r = rng.uniform(0.4, 1.4) * SS * 0.5
        d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, rng.randint(50, 150)))
    # a few glass orbs floating up
    for cx, cy, r, col in [(160, 180, 46, BALL_COLORS['round']), (640, 140, 34, BALL_COLORS['hunter']),
                           (540, 330, 26, BALL_COLORS['wave']), (250, 350, 20, BALL_COLORS['hex'])]:
        glossy_disc(img, cx * SS, cy * SS, r * SS, col)
    font = ImageFont.truetype(FONT_BOLD, 64 * SS)
    for i, line in enumerate(['BALLOON', 'BUSTER']):
        box = d.textbbox((0, 0), line, font=font)
        tw = box[2] - box[0]
        y = (150 + i * 78) * SS
        d.text(((w * SS - tw) / 2 - box[0] + 2 * SS, y + 2 * SS), line, font=font, fill=(0, 0, 0, 140))
        d.text(((w * SS - tw) / 2 - box[0], y), line, font=font, fill=ACCENT + (255,))
    save(img, 'assets/ui/loading.webp', (w, h))


def draw_menu_font():
    """The DOM menu font at 4x the base cell (js/PixelText.js draws it at
    this resolution and shows it at the base size -- same layout, four
    times the pixels). White glyphs, tinted by the UI."""
    chars = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ!0123456789:.'
    res = 4
    cw, ch = 5 * res, 6 * res
    img = Image.new('RGBA', (cw * len(chars) * SS, ch * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT_BOLD, int(ch * SS * 0.95))
    for i, c in enumerate(chars):
        if c == ' ':
            continue
        box = d.textbbox((0, 0), c, font=font)
        tw, th = box[2] - box[0], box[3] - box[1]
        d.text((i * cw * SS + (cw * SS - tw) / 2 - box[0], (ch * SS - th) / 2 - box[1]),
               c, font=font, fill=(255, 255, 255, 255))
    out = img.resize((cw * len(chars), ch), Image.LANCZOS)
    path = os.path.join(OUT, 'font', 'menu_font.png')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out.save(path)
    return res


# -- manifest ---------------------------------------------------------------

def write_manifest(font_res):
    manifest = {
        'id': 'sleek',
        'name': 'Sleek',
        'description': 'Smooth, glassy, anti-aliased -- the same game with modern art.',
        'system': True,
        'enabled': True,
        'render': {'pixelArt': False},
        'style': {
            '--bg': '#0a0f1e',
            '--panel': '#141d33',
            '--panel-border': '#2e4a6b',
            '--text': '#e8eef8',
            '--accent': '#4cc9f0',
            '--danger': '#ff5d73',
        },
        'colors': {
            'accent': '#4cc9f0',
            'text': '#e8eef8',
            'danger': '#ff5d73',
            'bgTop': '#0a0f1e',
            'bgBottom': '#141d33',
            'ground': '#243b5c',
            'groundEdge': '#3b5f8a',
            'hudBg': '#060a14',
        },
        'font': {'file': 'font/menu_font.png', 'scale': font_res},
        'overrides': sorted(written),
    }
    with open(os.path.join(OUT, 'skin.json'), 'w') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')


if __name__ == '__main__':
    draw_balls()
    draw_pops()
    draw_tiles()
    draw_backgrounds()
    draw_weapons()
    draw_powerups()
    draw_player()
    draw_hud()
    draw_loading()
    res = draw_menu_font()
    write_manifest(res)
    print(f'skins/sleek: {len(written)} overrides + menu font + skin.json')
