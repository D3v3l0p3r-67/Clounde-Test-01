"""Draws the pickup icons for the power-ups that have a glyph here.

    python3 tools/powerup_icons.py

Same shape as every other power-up icon (assets/powerups/<type>.webp,
18x18): a round disc in the power-up's own colour with a glyph cut into
it in a darker tone of the same hue. The glyph says what is in the box --
a barbed spear, a two-pronged hook, a bank of barrels, a stick of
dynamite, an hourglass -- because "something drops" is not useful to a
player who cannot tell WHICH thing from across the playfield.

Only the types in GLYPHS below are written, so the icons drawn by hand
(shield, the fruit, and the rest) are never overwritten by running this.
The disc colours come from each type's own elements/powerup-*.json rather
than being repeated here. All three weapons share one yellow: a weapon is
a weapon, and which one it is has to be read off the glyph in any case --
the frame in the HUD shows one at a time, and on the field the disc is a
weapon dropping rather than an effect on a clock.
"""

import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ELEMENTS = ROOT / 'elements'
OUT = ROOT / 'assets' / 'powerups'
HUD_OUT = ROOT / 'assets' / 'hud'
SIZE = 18

# Up to 7x9 pixel glyphs, drawn on the disc and centred in it (a glyph
# with fewer rows simply sits in the middle). Small on purpose: the icon
# is looked at as a SHAPE at speed, not read -- which is also why none of
# them is a letter any more. An R for rapid shot, an S for speed and an F
# for freeze were three things a player had to already know the names of,
# in a game with no text anywhere else in the playfield.
GLYPHS = {
    'weapon_harpoon': [
        '...#...',
        '..###..',
        '.#.#.#.',
        '#..#..#',
        '...#...',
        '...#...',
        '...#...',
        '...#...',
        '..###..',
    ],
    'weapon_grapple': [
        '#.....#',
        '#.....#',
        '.#...#.',
        '.##.##.',
        '...#...',
        '...#...',
        '...#...',
        '...#...',
        '..###..',
    ],
    'weapon_machinegun': [
        '.......',
        '#..#..#',
        '#..#..#',
        '#..#..#',
        '#..#..#',
        '.#####.',
        '...#...',
        '...#...',
        '..###..',
    ],
    # A stick with a lit fuse: the fuse leaves the top right and the spark
    # sits off the end of it, which is what says "about to go off" at this
    # size -- a plain cylinder would read as a barrel or a battery.
    'dynamite': [
        '.....#.',
        '....#..',
        '..###..',
        '..###..',
        '.#####.',
        '..###..',
        '..###..',
        '..###..',
        '..###..',
    ],
    # Two triangles meeting at the waist, with the sand in the top half:
    # the shape reads as an hourglass even where the grains do not, and
    # the frame lines are what keep it from looking like a bow tie.
    'hourglass': [
        '#######',
        '.#####.',
        '..###..',
        '..###..',
        '...#...',
        '..#.#..',
        '.#...#.',
        '#.....#',
        '#######',
    ],
    # An apple with its stem and one leaf: the fruit is a bonus of points
    # and nothing else, so the picture is simply the thing itself.
    'bonus_fruit': [
        '...#.##',
        '...#.#.',
        '.##.##.',
        '#######',
        '#######',
        '#######',
        '#######',
        '.#####.',
        '..###..',
    ],
    # A lightning bolt: the shot that comes faster. On the weapons' own
    # yellow too (see its element), because that is what it acts on --
    # the disc says "something about your gun" before the glyph says
    # which something.
    'rapid_shot': [
        '....##.',
        '...##..',
        '..##...',
        '.#####.',
        '..###..',
        '...##..',
        '..##...',
        '.##....',
        '.#.....',
    ],
    # A boot. The bolt used to be here, which put the same picture on the
    # power-up that makes the PLAYER faster and left nothing for the one
    # that speeds up the shot -- and of the two, the shot is what a bolt
    # says. What moves faster here is the legs, so it is what is on them.
    'speed_boost': [
        '.####..',
        '.####..',
        '.####..',
        '.####..',
        '.#####.',
        '.######',
        '#######',
        '#######',
        '.#####.',
    ],
    # A star: what a score is made of. The multiplier is not spelled out
    # (that would be a digit, which is a letter's cousin) -- the sparkles
    # either side are the "more" of it.
    # Wider than the rest at nine pixels across, because a star drawn at
    # seven is a blob with legs: the arms need a pixel to be thin
    # against. The glyph is centred whatever its size, so this costs
    # nothing but the two pixels of margin it takes.
    'score_multiplier': [
        '....#....',
        '...###...',
        '...###...',
        '#########',
        '.#######.',
        '..#####..',
        '..##.##..',
        '.##...##.',
        '##.....##',
    ],
    # A snowflake: the balls stop where they are, and cold is what says
    # so at seven pixels across.
    'time_freeze': [
        '#..#..#',
        '.#.#.#.',
        '..###..',
        '###.###',
        '..###..',
        '.#.#.#.',
        '#..#..#',
    ],
    # A heater shield. Not a cross, which is the extra life's, and not a
    # letter, which is what this used to be.
    'shield': [
        '#######',
        '#######',
        '#######',
        '#######',
        '.#####.',
        '.#####.',
        '..###..',
        '...#...',
    ],
    # A heart, for the one power-up that is worth a life.
    'extra_life': [
        '.##.##.',
        '#######',
        '#######',
        '#######',
        '.#####.',
        '..###..',
        '...#...',
    ],
    # Two arrows pointing INTO each other: which way is which is exactly
    # the question this power-up makes you ask.
    'reverse_controls': [
        '..#....',
        '.##....',
        '#######',
        '.##....',
        '....##.',
        '#######',
        '....##.',
        '....#..',
    ],
    # The harpoon's own upward arrow with a bar through it.
    'disable_shooting': [
        '...#...',
        '..###..',
        '.#.#.#.',
        '#..#..#',
        '...#..#',
        '...#.#.',
        '..##.#.',
        '..#.#..',
        '...#...',
    ],
    # An ice block, mid-freeze: the outline is the cube, the dot the
    # player inside it.
    'freeze_player': [
        '#######',
        '#.....#',
        '#..#..#',
        '#.###.#',
        '#..#..#',
        '#.....#',
        '#######',
    ],
}



# The same three weapons again, at the size the HUD draws them (21x21,
# see js/assets.js's hudWeaponIconPath) -- the frame beside the score,
# which is where a player looks to see what they are holding.
#
# Written here, next to the discs, because the two have to say the same
# thing: the pickup that drops on the field and the icon that appears in
# the frame when it is collected are one weapon, and a change to either
# that misses the other leaves the game showing two. They are separate
# drawings rather than one scaled up because 18px of disc and 21px of
# frame do not divide into each other, and a doubled-up glyph in the HUD
# would be twice as coarse as everything around it.
#
# The shapes have to carry the whole difference, because the colour no
# longer does any of it: all three weapons are one yellow. So no two of
# them share an outline -- the harpoon flares outward into barbs, the
# grapple opens into two prongs, the machine gun is three barrels over a
# body. Before, the grapple and the machine gun were the same teal in
# near enough the same shape, and the frame could not be read at a
# glance, which is the only thing it is for.
HUD_SIZE = 21
HUD_GLYPHS = {
    'harpoon': [
        '.........###.........',
        '........#####........',
        '........#####........',
        '.......###.###.......',
        '......###...###......',
        '.....###.....###.....',
        '.....##..###..##.....',
        '.........###.........',
        '.........###.........',
        '.........###.........',
        '.........###.........',
        '.........###.........',
        '.........###.........',
        '.........###.........',
        '.........###.........',
        '......#########......',
        '......#########......',
        '......#########......',
        '......###...###......',
        '......###...###......',
        '.....................',
    ],
    'grapple': [
        '......##.....##......',
        '......##.....##......',
        '......##.....##......',
        '......##.....##......',
        '.......##...##.......',
        '.......##...##.......',
        '........#####........',
        '.........###.........',
        '.........###.........',
        '.........###.........',
        '.........###.........',
        '.........###.........',
        '.........###.........',
        '.........###.........',
        '.........###.........',
        '......#########......',
        '......#########......',
        '......#########......',
        '......###...###......',
        '......###...###......',
        '.....................',
    ],
    'machinegun': [
        '...###...###...###...',
        '...###...###...###...',
        '...###...###...###...',
        '...###...###...###...',
        '..#################..',
        '..#################..',
        '....#############....',
        '.........###.........',
        '.........###.........',
        '.........###.........',
        '.........###.........',
        '.........###.........',
        '.........###.........',
        '.........###.........',
        '.........###.........',
        '......#########......',
        '......#########......',
        '......#########......',
        '......###...###......',
        '......###...###......',
        '.....................',
    ],
}


def shade(color: tuple, factor: float) -> tuple:
    return tuple(max(0, min(255, round(channel * factor))) for channel in color)


def hex_to_rgb(value: str) -> tuple:
    value = value.lstrip('#')
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def icon(color: tuple, negative: bool = False) -> Image.Image:
    img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    px = img.load()
    centre = (SIZE - 1) / 2
    radius = SIZE / 2 - 0.5
    # A negative power-up is BLACK AND WHITE and nothing else: a black
    # disc, a white glyph, and a thin white rim so it still reads against
    # a night sky. Every helpful one is a colour with a darker shade of
    # itself for its rim, so "no colour at all" is the whole signal --
    # a player never has to remember which hue means harm.
    rim = (245, 245, 245) if negative else shade(color, 0.55)
    for y in range(SIZE):
        for x in range(SIZE):
            distance = ((x - centre) ** 2 + (y - centre) ** 2) ** 0.5
            if distance > radius:
                continue
            # A one-pixel darker rim, and a lift towards the top left,
            # which is where everything in this game is lit from.
            if distance > radius - 1.2:
                px[x, y] = (*rim, 255)
            elif negative:
                # Flat black -- the lift below is what makes a coloured
                # disc look round, and a black disc has no hue to lift.
                px[x, y] = (12, 12, 14, 255)
            else:
                lift = 1.0 + 0.18 * ((centre - x) + (centre - y)) / SIZE
                px[x, y] = (*shade(color, lift), 255)
    return img


def draw_glyph(img: Image.Image, rows: list, color: tuple) -> None:
    px = img.load()
    width = len(rows[0])
    height = len(rows)
    left = (SIZE - width) // 2
    top = (SIZE - height) // 2
    for y, row in enumerate(rows):
        for x, mark in enumerate(row):
            if mark == '#':
                px[left + x, top + y] = (*color, 255)


# The HUD's version: the weapon's shape alone, no disc behind it -- the
# frame it sits in is the background (see assets/hud/hud_weapon_frame
# .webp). Lit from the top left like everything else, so it belongs to
# the same picture as the pickup it came from.
def hud_icon(rows: list, color: tuple) -> Image.Image:
    img = Image.new('RGBA', (HUD_SIZE, HUD_SIZE), (0, 0, 0, 0))
    px = img.load()
    centre = (HUD_SIZE - 1) / 2
    for y, row in enumerate(rows):
        for x, mark in enumerate(row):
            if mark != '#':
                continue
            lift = 1.0 + 0.35 * ((centre - x) + (centre - y)) / HUD_SIZE
            px[x, y] = (*shade(color, lift), 255)
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    HUD_OUT.mkdir(parents=True, exist_ok=True)
    for path in sorted(ELEMENTS.glob('powerup-*.json')):
        element = json.loads(path.read_text())
        kind = element['type']
        if kind not in GLYPHS:
            continue
        color = hex_to_rgb(element['color'])
        negative = element.get('negative') is True
        img = icon(color, negative)
        # A helpful disc carries its glyph in a darker shade of its own
        # colour; a negative one carries it in plain white on the black.
        draw_glyph(img, GLYPHS[kind], color if negative else shade(color, 0.28))
        out = OUT / f'{kind}.webp'
        img.save(out, 'WEBP', lossless=True)
        print(f'{out.relative_to(ROOT)}: {element["label"]}')

        # The weapons carry on into the HUD frame, in the same colour the
        # disc uses -- one weapon, one look, wherever it is being shown.
        weapon = kind[len('weapon_'):] if kind.startswith('weapon_') else None
        if weapon in HUD_GLYPHS:
            hud_out = HUD_OUT / f'weapon_{weapon}.webp'
            hud_icon(HUD_GLYPHS[weapon], color).save(hud_out, 'WEBP', lossless=True)
            print(f'{hud_out.relative_to(ROOT)}: {element["label"]} (HUD)')


if __name__ == '__main__':
    main()
