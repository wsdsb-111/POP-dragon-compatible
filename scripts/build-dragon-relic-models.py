"""Build seven original CK3 court relic meshes and offline previews.

Geometry is authored in native Y-up units, then oriented to the court's -X
front. PDX mesh encoding, material channels, editable exports and raster previews
reuse the checked dragon-weapon/trophy pipeline.
"""
from pathlib import Path
import hashlib
import importlib.util
import json
import math

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'artwork/dragon-relics/models'
GAME = ROOT / 'patches/dragon-relics/mod/gfx/models/artifacts/mm_dragon_relics'
TEXTURE_PREFIX = 'mm_dragon_relics'
WEAPON_SCRIPT = ROOT / 'scripts/build-dragon-weapon-models.py'
GEO_SCRIPT = ROOT / 'scripts/build-wyvern-trophy-models.py'

geo_spec = importlib.util.spec_from_file_location('relic_trophy_geometry', GEO_SCRIPT)
geo = importlib.util.module_from_spec(geo_spec)
geo_spec.loader.exec_module(geo)
weapon_spec = importlib.util.spec_from_file_location('relic_weapon_geometry', WEAPON_SCRIPT)
weapon = importlib.util.module_from_spec(weapon_spec)
weapon_spec.loader.exec_module(weapon)
import dragon_materials as material_shader
from dragon_materials import save_dds_mips
from dragon_sculpt import plate as sculpt_plate, torus as sculpt_torus
from native_model_export import asset_definition, encode_mesh

PALETTE = [
    ('hide', (52, 61, 56), .62, .06),
    ('plates', (104, 108, 83), .56, .12),
    ('ivory', (226, 216, 191), .42, .00),
    ('horn', (49, 39, 30), .46, .08),
    ('bronze', (142, 105, 55), .38, .58),
    ('wood', (57, 37, 27), .66, .03),
    ('amber', (172, 90, 30), .31, .10),
    ('black', (46, 51, 65), .28, .12),
    ('highlight', (203, 211, 217), .25, .72),
    ('mouth', (60, 27, 24), .73, .00),
    ('ridge', (49, 80, 68), .48, .24),
    ('bronze_dark', (112, 77, 42), .44, .51),
    ('red', (130, 35, 31), .29, .10),
    ('green', (35, 82, 70), .37, .17),
    ('bone', (132, 125, 106), .69, .04),
    ('gold', (190, 149, 72), .29, .75),
]
geo.PALETTE = PALETTE
weapon.PALETTE = PALETTE
weapon.geo.PALETTE = PALETTE
weapon.ART = ART
weapon.GAME = GAME
weapon.TEXTURE_PREFIX = TEXTURE_PREFIX


class RelicMesh(weapon.WeaponMesh):
    curve_steps = 5

    def __init__(self, name):
        super().__init__(name)
        self.texture_prefix = TEXTURE_PREFIX

    def tube(self, centers, radii, material, sides=18):
        super().tube(centers, radii, material, round(sides * 1.65))

    def ellipsoid(self, center, radius, material, segments=28, rings=14):
        super().ellipsoid(center, radius, material, round(segments * 1.7), round(rings * 1.7))


def torus(mesh, center, radius, thickness, material, axis=(0, 1, 0), segments=64, sides=12):
    sculpt_torus(mesh, center, radius, thickness, material, axis=axis,
                 segments=round(segments * 1.6), sides=round(sides * 1.6))


def plate(mesh, center, size, material, normal=(0, 0, -1), long=(0, 1, 0), rings=8, sides=28):
    sculpt_plate(mesh, center, size, material, normal=normal, long=long,
                 rings=round(rings * 1.65), sides=round(sides * 1.65))


def rosette(mesh, center, radius, material='gold', stone='red'):
    x, y, z = center
    torus(mesh, center, radius * .72, radius * .09, material,
          axis=(0, 0, 1), segments=60, sides=12)
    for j in range(8):
        a = j * math.tau / 8
        mesh.ellipsoid((x + radius * .60 * math.cos(a), y + radius * .60 * math.sin(a), z),
                       (radius * .22, radius * .22, radius * .09), material, 20, 12)
    mesh.gem((x, y, z - radius * .14), (radius * .38, radius * .43, radius * .15), stone)


def rounded_loft(mesh, sections, material, sides=64, exponent=.72):
    """Closed, gently chamfered vertical body; each section is y, half-x, half-z."""
    rings = []
    for y, rx, rz in sections:
        ring = []
        for j in range(sides):
            angle = 2 * math.pi * j / sides
            c, s = math.cos(angle), math.sin(angle)
            x = math.copysign(abs(c) ** exponent, c) * rx
            z = math.copysign(abs(s) ** exponent, s) * rz
            ring.append((x, y, z))
        rings.append(ring)
    for i in range(len(rings) - 1):
        points, normals, uvs, faces = [], [], [], []
        for ring_index in (i, i + 1):
            y, rx, rz = sections[ring_index]
            for j, point in enumerate(rings[ring_index]):
                angle = 2 * math.pi * j / sides
                normal = np.array([math.cos(angle) / max(rx, .001), 0,
                                   math.sin(angle) / max(rz, .001)])
                points.append(point)
                normals.append(normal)
                uvs.append((j / sides, ring_index / (len(rings) - 1)))
        for j in range(sides):
            a, b = j, (j + 1) % sides
            c, d = sides + (j + 1) % sides, sides + j
            faces.extend([(a, d, c), (a, c, b)])
        mesh.surface(points, normals, uvs, faces, material)
    for ring_index, sign in [(0, -1), (len(rings) - 1, 1)]:
        y, _rx, _rz = sections[ring_index]
        points = [(0, y, 0), *rings[ring_index]]
        normals = [(0, sign, 0)] * len(points)
        uvs = [(.5, .5)] + [
            (.5 + p[0] / max(sections[ring_index][1] * 2, .001),
             .5 + p[2] / max(sections[ring_index][2] * 2, .001))
            for p in rings[ring_index]
        ]
        faces = [(0, j + 1, (j + 1) % sides + 1) for j in range(sides)]
        mesh.surface(points, normals, uvs, faces, material)


def court_foot(mesh, width, depth, accent='gold', body='bronze_dark', inset='wood'):
    mesh.box((0, 1.25, 0), (width, 2.5, depth), body)
    mesh.box((0, 2.95, 0), (width * .91, 1.0, depth * .90), inset)
    mesh.box((0, 3.72, 0), (width * .83, .68, depth * .82), accent)
    mesh.box((0, 4.36, 0), (width * .73, .62, depth * .73), body)
    for x in (-width * .35, width * .35):
        mesh.ellipsoid((x, 1.22, -depth * .49), (.38, .42, .18), accent, 16, 10)
        mesh.ellipsoid((x, 1.22, depth * .49), (.38, .42, .18), accent, 16, 10)
    mesh.box((0, 1.42, -depth * .516), (width * .28, 1.16, .22), accent)
    mesh.gem((0, 1.45, -depth * .535), (width * .075, .43, .18), 'red')


def rune(mesh, x, y, z, scale, material='gold', width=.075):
    """Small angular dragon-script mark, closed as raised incised inlay."""
    glyph = [
        [(0, -1), (-.42, -.28), (.34, -.07), (-.3, .45), (0, 1)],
        [(-.52, .52), (0, .05), (.52, .52)],
        [(-.5, -.55), (0, -.05), (.5, -.55)],
    ]
    for stroke in glyph:
        points = [(x + px * scale, y + py * scale, z) for px, py in stroke]
        mesh.tube(points, [width] * len(points), material, 7)


def closed_edge(mesh, rx, rz, y, z_offset=0, material='gold', radius=.11):
    points = []
    for i in range(81):
        a = i / 80 * math.tau
        c, s = math.cos(a), math.sin(a)
        points.append((math.copysign(abs(c) ** .68, c) * rx, y,
                       z_offset + math.copysign(abs(s) ** .68, s) * rz))
    mesh.tube(points, [radius] * len(points), material, 8)


def helical_line(mesh, radius, y0, y1, turns, material, thickness=.10, zcenter=0, steps=260):
    points = []
    for i in range(steps):
        t = i / (steps - 1)
        angle = turns * math.tau * t
        points.append((radius * math.cos(angle), y0 + (y1 - y0) * t,
                       zcenter + radius * math.sin(angle)))
    mesh.tube(points, [thickness] * len(points), material, 8)


def make_black_crown():
    m = RelicMesh('mm_relic_black_crown')
    court_foot(m, 28, 22, 'gold', 'black', 'bronze_dark')
    m.ellipsoid((0, 5.9, 0), (10.8, 1.5, 9.2), 'black', 64, 28)
    torus(m, (0, 6.5, 0), 8.9, .28, 'gold', segments=96, sides=16)
    torus(m, (0, 9.0, 0), 8.5, 1.3, 'black', segments=112, sides=24)
    for y in (7.9, 10.1):
        torus(m, (0, y, 0), 8.55, .25, 'gold', segments=112, sides=16)
    for j in range(28):
        a = j * math.tau / 28
        c, s = math.cos(a), math.sin(a)
        plate(m, (8.65*c, 9.0, 8.65*s), 1.15, 'bronze_dark',
              normal=(c, .05, s), rings=12, sides=40)
        m.ellipsoid((9.35*c, 9.6, 9.35*s), (.22, .25, .22), 'gold', 20, 14)
    # Low interlaced imperial arches rest on the band; no long horn finials.
    for side in (-1, 1):
        pts = [(side*8.0*math.cos(a), 10.0+3.0*math.sin(a), 2.7*math.sin(a))
               for a in np.linspace(0, math.pi, 90)]
        m.tube(pts, [.30]*len(pts), 'gold', 18)
        pts = [(side*8.0*math.cos(a), 10.0+2.0*math.sin(a), -2.7*math.sin(a))
               for a in np.linspace(0, math.pi, 90)]
        m.tube(pts, [.20]*len(pts), 'bronze_dark', 16)
    rosette(m, (0, 10.7, -9.0), 2.6, 'gold', 'red')
    for side in (-1, 1):
        rosette(m, (side*5.3, 9.6, -7.3), 1.1, 'gold', 'amber')
        pts = [(side*x, 11.1+.6*math.sin(x*.8), -8.45+.17*x)
               for x in np.linspace(1.8, 7.4, 65)]
        m.tube(pts, [.13]*len(pts), 'gold', 14)
    return m


def make_black_regalia():
    m = RelicMesh('mm_relic_black_regalia')
    court_foot(m, 24, 20, 'bronze', 'black', 'wood')
    # The upright court mount holds a ceremonial, double-headed dragon scepter.
    for side in (-1, 1):
        m.tube([(side * 7.2, 5.5, 0), (side * 7.0, 13, 0),
                (side * 5.4, 16.7, 0), (side * 2.1, 17.5, 0)],
               [1.0, .82, .56, .34], 'bronze_dark', 18)
        m.tube([(side * 7.0, 13, -.55), (side * 5.5, 16.3, -.52),
                (side * 2.1, 17.1, -.38)], [.12, .09, .025], 'gold', 8)
    # Spiral fluting and counter-wound inlay cover the solid bronze shaft.
    centers = [(0, y, 0) for y in np.linspace(7, 76, 96)]
    radii = [.92 + .16 * math.sin(y * .11) ** 2 for _, y, _ in centers]
    m.tube(centers, radii, 'bronze', 24)
    helical_line(m, 1.03, 8, 75, 6, 'gold', .12, steps=220)
    helical_line(m, 1.05, 8, 75, -6, 'bronze_dark', .085, steps=220)
    for y in (8, 11, 22, 38, 55, 72, 75):
        m.band(y, 1.32 if y in (8, 75) else 1.12, .58, 'gold')
        m.band(y + .42, .98, .16, 'black')
    for y in np.linspace(13, 69, 18):
        side = -1 if int(y) % 2 else 1
        rune(m, side * .13, y, -1.05, .29, 'highlight', .048)
    # An open halo, inset ruby and symmetrical scrolls crown the refined scepter.
    torus(m,(0,80.0,0),5.1,.48,'gold',axis=(0,0,1),segments=112,sides=20)
    torus(m,(0,80.0,0),4.2,.18,'bronze_dark',axis=(0,0,1),segments=112,sides=16)
    rosette(m,(0,80.0,-.4),2.7,'gold','red')
    for side in (-1,1):
        pts=[(side*(1.6+2.0*math.sin(a)),75.5+4.5*a/math.pi,-.5)
             for a in np.linspace(0,math.pi,90)]
        m.tube(pts,[.24]*len(pts),'gold',18)
    m.ellipsoid((0,86.0,0),(.9,1.1,.65),'amber',36,24)
    # A double-sided ceremonial seal sits at the foot of the staff.
    torus(m, (0, 10, -2.0), 3.1, .52, 'gold', axis=(0, 0, 1), segments=64, sides=14)
    m.gem((0, 10, -2.55), (1.45, 1.65, .58), 'red')
    for side in (-1, 1):
        m.tube([(0, 10, -2.35), (side * 1.6, 10.8, -2.2),
                (side * 2.35, 12.4, -1.7)], [.20, .14, .02], 'bronze_dark', 12)
    return m


def make_white_book():
    m = RelicMesh('mm_relic_white_book')
    court_foot(m, 39, 24, 'highlight', 'bronze_dark', 'wood')
    # Rear easel arms support a closed, page-thick oracle book upright.
    for side in (-1, 1):
        m.tube([(side * 10.2, 5.0, 0), (side * 9.2, 10.0, 1.0),
                (side * 7.0, 12.6, 1.1)], [1.05, .82, .44], 'wood', 18)
        m.tube([(side * 8.9, 10.1, .65), (side * 7.2, 12.2, .7)],
               [.12, .035], 'gold', 8)
    # The page block and two fully closed platinum covers.
    m.box((0, 23.0, 0), (29, 21, 5.8), 'ivory')
    m.box((0, 23.0, -3.35), (31.2, 23.0, 1.25), 'highlight')
    m.box((0, 23.0, 3.35), (31.2, 23.0, 1.25), 'highlight')
    # Layered page edges, spine ribs, and corner guards are all geometry.
    for y in np.linspace(14.5, 31.4, 22):
        m.tube([(14.65, y, -2.58), (14.9, y + .02, 0),
                (14.65, y, 2.58)], [.065, .07, .025], 'bone', 7)
    for y in (15.0, 18.1, 21.2, 24.3, 27.4, 30.5):
        m.band(y, .43, .75, 'bronze_dark', center=(-15.45, 0), sides=18)
    for sign in (-1, 1):
        x = sign * 14.2
        for y in (14.2, 31.8):
            m.ellipsoid((x, y, -4.08), (1.0, .85, .22), 'gold', 18, 10)
        m.tube([(x, 13.3, -4.0), (x + sign * .65, 15, -4.0),
                (x + sign * .65, 31, -4.0), (x, 32.7, -4.0)],
               [.22, .16, .16, .06], 'bronze_dark', 12)
    # Gilded frame and an embossed lunar-eye seal with feathered scrollwork.
    for rx, ry, z, mat, radius in [(14.0, 9.8, -4.18, 'gold', .20),
                                   (12.7, 8.7, -4.22, 'bronze_dark', .13)]:
        points = [(-rx, 23 - ry, z), (-rx, 23 + ry, z),
                  (rx, 23 + ry, z), (rx, 23 - ry, z), (-rx, 23 - ry, z)]
        m.tube(points, [radius] * len(points), mat, 9)
    torus(m, (0, 23, -4.2), 5.2, .42, 'gold', axis=(0, 0, 1), segments=72, sides=14)
    torus(m, (0, 23, -4.28), 4.25, .15, 'bronze_dark', axis=(0, 0, 1), segments=72, sides=10)
    rosette(m, (0,23,-4.72), 3.0, 'gold', 'highlight')
    m.ellipsoid((0, 23, -5.15), (.52, 1.3, .42), 'highlight', 28, 14)
    for side in (-1, 1):
        for y in (18.0, 20.6, 25.4, 28.0):
            rune(m, side * 8.9, y, -4.35, .74, 'gold', .095)
        for y in (17.2, 28.8):
            m.tube([(side * 4.0, y, -4.33), (side * 6.2, y + 1.0, -4.32),
                    (side * 8.0, y, -4.33)], [.10, .15, .025], 'highlight', 8)
    for side in (-1, 1):
        for x in (-10.2, -5.2, 5.2, 10.2):
            m.gem((x, 23 + side * 7.8, -4.40), (.42, .55, .17), 'amber')
    for side in (-1,1):
        for y in (15.5,30.5):
            rosette(m,(side*11.4,y,-4.45),1.25,'gold','highlight')
    for x in np.linspace(-12,12,25):
        for y in (13.0,33.0):
            m.ellipsoid((x,y,-4.15),(.17,.20,.13),'gold',18,12)
    return m


def make_fire_ring():
    m = RelicMesh('mm_relic_fire_ring')
    court_foot(m, 28, 22, 'gold', 'black', 'bronze_dark')
    for side in (-1, 1):
        m.tube([(side*5.5, 4.8, .6), (side*4.4, 8, .4), (side*3.8, 11.3, 0)],
               [.65, .50, .30], 'gold', 22)
    torus(m, (0, 16.7, 0), 6.0, 1.35, 'bronze', axis=(0,0,1), segments=112, sides=28)
    for z in (-.9, .9):
        torus(m, (0, 16.7, z), 6.0, .27, 'gold', axis=(0,0,1), segments=112, sides=16)
    # The setting is physically joined to the top shoulder of the ring.
    m.box((0, 22.7, 0), (7.2, 3.7, 3.3), 'bronze_dark')
    m.box((0, 22.8, -1.9), (6.8, 3.4, .8), 'gold')
    m.gem((0, 22.9, -2.5), (2.65, 1.55, .85), 'red')
    for side in (-1, 1):
        for y in (21.7, 23.9):
            m.ellipsoid((side*2.7, y, -2.8), (.35,.40,.35), 'gold', 24, 16)
    for j in range(36):
        a = j*math.tau/36
        x,y = 6.25*math.cos(a),16.7+6.25*math.sin(a)
        plate(m, (x,y,-1.20), .62, 'gold', rings=12, sides=36)
        if j%3 == 0:
            rune(m, x, y, -1.36, .28, 'bronze_dark', .05)
    for side in (-1,1):
        rosette(m, (side*4.9, 18.5, -1.48), .85, 'gold', 'amber')
    return m


def make_earth_sarcophagus():
    m = RelicMesh('mm_relic_earth_sarcophagus')
    court_foot(m, 43, 27, 'gold', 'black', 'bronze_dark')
    # A sealed imperial stone casket, with a stepped rectangular lid and pilasters.
    m.box((0, 11.7, 0), (36, 13, 20), 'black')
    m.box((0, 5.8, 0), (39, 1.5, 23), 'bronze_dark')
    m.box((0, 17.9, 0), (39, 1.2, 23), 'gold')
    m.box((0, 19.5, 0), (38, 2.2, 22), 'black')
    m.box((0, 21.1, 0), (34, 1.2, 19), 'bronze_dark')
    m.box((0, 22.0, 0), (30, .8, 16), 'black')
    for x in (-17.5,17.5):
        for z in (-9.4,9.4):
            m.tube([(x,6.8,z),(x,16.8,z)], [.65,.65], 'gold', 28)
            for y in (7.0,16.5):
                m.ellipsoid((x,y,z),(.85,.6,.85),'bronze_dark',24,16)
    for sign in (-1,1):
        z=sign*10.2
        for x in (-10.4,0,10.4):
            m.box((x,11.9,z),(8.7,8.3,.35),'bronze_dark')
            m.box((x,11.9,z+sign*.25),(7.8,7.4,.22),'black')
            for y in (9.4,12.0,14.6):
                rune(m,x,y,z+sign*.48,.58,'gold',.09)
            rosette(m,(x,16.2,z+sign*.55),.82,'gold','amber')
    # Repeated gilded scale relief on the lid follows the rock's continuous surface.
    for x in np.linspace(-12,12,13):
        for z in (-4.8,0,4.8):
            plate(m,(x,22.5,z),1.45,'gold',normal=(0,1,0),long=(1,0,0),rings=12,sides=40)
    torus(m,(0,23.0,0),4.6,.32,'gold',axis=(0,1,0),segments=112,sides=18)
    m.ellipsoid((0,23.0,0),(3.1,.8,3.1),'green',52,28)
    return m


def make_sea_armor():
    m = RelicMesh('mm_relic_sea_armor')
    court_foot(m, 31, 24, 'bronze', 'wood', 'black')
    # Rear rack, shoulder crossbar, and sculpted full cuirass are one static asset.
    m.tube([(0, 5.2, 1.8), (0, 24, 1.8), (0, 45, 1.8)],
           [1.25, 1.05, .72], 'bronze_dark', 20)
    m.tube([(-14, 50, 1.3), (-10, 54, 1.3), (0, 55, 1.3),
            (10, 54, 1.3), (14, 50, 1.3)],
           [1.1, .72, .55, .72, 1.1], 'bronze', 16)
    rounded_loft(m, [(23, 5.0, 4.0), (27, 8.5, 5.3), (35, 12.6, 7.2),
                     (44, 12.0, 7.0), (54, 9.4, 6.0), (60, 5.8, 4.2)],
                 'black', 56, .8)
    # A front cuirass of individual sea-dragon scales with raised gold ribs.
    scale_count = 0
    for row, y in enumerate((30.0, 35.0, 40.0, 45.0, 50.0, 54.0)):
        half = (6.3, 9.0, 10.2, 10.2, 8.7, 6.4)[row]
        count = (3, 4, 5, 5, 4, 3)[row]
        for column in range(count):
            x = -half + (2 * half * column / max(1, count - 1))
            z = -math.sqrt(max(8.0, 13.0 ** 2 - x ** 2)) - .18
            size = (3.8, 4.0, 3.75, 3.55, 3.25, 2.9)[row]
            plate(m, (x, y, z), size, 'ridge',
                  normal=(x * .045, .05, -1), long=(0, 1, 0), rings=10, sides=36)
            m.tube([(x - size * .35, y - size * .28, z - .32),
                    (x, y + size * .28, z - .63),
                    (x + size * .35, y - size * .28, z - .32)],
                   [.075, .10, .025], 'gold', 8)
            m.ellipsoid((x, y + size * .34, z - .38), (.22, .24, .15), 'bronze', 14, 8)
            scale_count += 1
    # Closed rear scales and two overlapping, fin-edged pauldrons.
    for side in (-1, 1):
        for row, y in enumerate((35, 42, 49)):
            for z in (-3.3, 0, 3.3):
                plate(m, (side * (8.8 - .45 * row), y, z), 3.6 - .25 * row,
                      'hide', normal=(side * .58, .1, .80), long=(0, 1, 0),
                      rings=9, sides=32)
        m.ellipsoid((side * 12.4, 53.2, 0), (5.2, 4.5, 6.4), 'ridge', 38, 20)
        for row in range(3):
            for j, z in enumerate((-4.2, 0, 4.2)):
                x = side * (12.1 + row * .2)
                y = 51.2 + row * 1.65
                plate(m, (x, y, z), 3.3 - row * .35, 'green',
                      normal=(side * .72, .12, -.68), long=(0, 1, 0),
                      rings=9, sides=32)
                m.ellipsoid((side * 15.3, y + .15, z), (.22, .25, .22), 'gold', 14, 8)
        # Detached forearm guards hang symmetrically from the rack.
        arm_x = side * 17.0
        m.tube([(arm_x, 32, -.4), (arm_x, 42, -.4), (arm_x, 50, -.2)],
               [2.3, 2.8, 1.9], 'black', 24)
        for y in (34, 38, 42, 46, 49):
            plate(m, (arm_x, y, -2.0), 2.3, 'ridge',
                  normal=(0, 0, -1), long=(0, 1, 0), rings=8, sides=28)
            m.band(y, 2.5, .24, 'bronze_dark', center=(arm_x, 0), sides=20)
    # Helm, cheek plates, and trident crest complete the ceremonial display.
    m.ellipsoid((0, 65.5, 0), (7.2, 7.2, 5.8), 'black', 44, 24)
    m.ellipsoid((0, 63.6, -4.4), (5.9, 3.2, 2.3), 'ridge', 36, 18)
    for side in (-1, 1):
        for row in range(3):
            plate(m, (side * (4.0 + row * .55), 64.2 + row * 1.65, -4.3),
                  2.4, 'green', normal=(side * .35, .12, -1),
                  long=(0, 1, 0), rings=8, sides=30)
        m.gem((side * 2.1, 65.4, -6.2), (.46, .43, .22), 'amber')
    torus(m,(0,69.5,0),5.7,.35,'gold',axis=(0,1,0),segments=112,sides=18)
    rosette(m,(0,68.4,-5.5),1.65,'gold','green')
    for side in (-1,1):
        for row in range(5):
            for j in range(3):
                x=side*(1.2+j*3.0)
                y=31.0+row*3.8
                plate(m,(x,y,6.6),2.35,'ridge',normal=(0,0,1),rings=12,sides=36)
    torus(m, (0, 38.5, -7.2), 2.1, .35, 'gold',
          axis=(0, 0, 1), segments=56, sides=12)
    m.gem((0, 38.5, -7.7), (1.1, 1.3, .45), 'amber')
    if scale_count < 20:
        raise RuntimeError('Sea armor did not receive its required layered scales')
    return m


def forged_spearhead(mesh):
    profile = [(0, -1), (.34, -.56), (1, -.16), (.30, 0), (1, .16),
               (.34, .56), (0, 1), (-.34, .56), (-1, .16), (-.30, 0),
               (-1, -.16), (-.34, -.56)]
    sections = [(70, .82, .38), (75, 2.5, .8), (79, 4.1, 1.05),
                (84, 4.7, .96), (91, 3.5, .70), (98, 1.1, .34), (103, .015, .015)]
    rings = []
    for y, width, depth in sections:
        rings.append([(x * width, y, z * depth) for x, z in profile])
    for i in range(len(rings) - 1):
        points = rings[i] + rings[i + 1]
        normals = []
        uvs = []
        for ring_index in (i, i + 1):
            y, width, depth = sections[ring_index]
            for j, (x, _py, z) in enumerate(rings[ring_index]):
                px, pz = profile[j]
                normals.append((px / max(width, .001), 0, pz / max(depth, .001)))
                uvs.append((j / len(profile), ring_index / (len(rings) - 1)))
        faces = []
        for j in range(len(profile)):
            a, b = j, (j + 1) % len(profile)
            c, d = len(profile) + (j + 1) % len(profile), len(profile) + j
            faces.extend([(a, d, c), (a, c, b)])
        mesh.surface(points, normals, uvs, faces, 'highlight')
    for ring_index, sign in ((0, -1), (len(rings) - 1, 1)):
        points = [(0, sections[ring_index][0], 0), *rings[ring_index]]
        normals = [(0, sign, 0)] * len(points)
        uvs = [(.5, .5)] + [(x / 2 + .5, z / 2 + .5)
                             for x, _y, z in rings[ring_index]]
        faces = [(0, j + 1, (j + 1) % len(profile) + 1) for j in range(len(profile))]
        mesh.surface(points, normals, uvs, faces, 'highlight')


def make_sky_spear():
    m = RelicMesh('mm_relic_sky_spear')
    court_foot(m, 26, 23, 'gold', 'bronze_dark', 'wood')
    # A tall freestanding frame with paired padded cradles leaves both faces visible.
    for side in (-1, 1):
        x = side * 7.2
        m.tube([(x, 5.0, 1.7), (x, 34, 1.7), (x * .92, 70, 1.4)],
               [1.25, .95, .50], 'wood', 18)
        m.tube([(x, 19, 1.0), (x * .72, 21.6, .2), (0, 22, -.3)],
               [.72, .50, .35], 'bronze', 16)
        m.tube([(x, 61, 1.0), (x * .72, 59.5, .2), (0, 59, -.3)],
               [.60, .44, .32], 'bronze', 16)
        for y in (13, 27, 46, 65):
            m.ellipsoid((x, y, 1.25), (.42, .46, .38), 'gold', 16, 10)
    # Full-length wind-bone shaft, gold spiral, and alternating ring ferrules.
    centers = [(0, y, 0) for y in np.linspace(7, 76, 105)]
    radii = [.78 + .16 * math.sin(y * .14) ** 2 for _, y, _ in centers]
    m.tube(centers, radii, 'horn', 24)
    helical_line(m, .87, 9, 71, 7, 'gold', .10, steps=250)
    helical_line(m, .90, 9, 71, -7, 'bronze_dark', .075, steps=250)
    for y in (8, 12, 22, 30, 50, 59, 69, 75):
        m.band(y, 1.15, .55, 'bronze', sides=24)
        m.band(y + .35, .92, .12, 'gold', sides=20)
    forged_spearhead(m)
    # Triple cutting ridge and hooked wings turn the head into an unmistakable icon.
    for side in (-1, 1):
        m.tube([(side * .8, 76, -.55), (side * 2.6, 79, -.68),
                (side * 4.4, 83, -.38), (side * 3.1, 84.0, -.18)],
               [.46, .32, .17, .02], 'highlight', 18)
        m.tube([(side * .15, 75, -.9), (side * .35, 83, -.82),
                (side * .4, 91, -.5), (side * .1, 98, -.1)],
               [.17, .15, .10, .01], 'gold', 10)
        for y in (78, 81, 84, 87, 90):
            m.gem((side * (.7 + .12 * (y - 78)), y, -.92),
                  (.32, .39, .17), 'amber')
    m.gem((0, 77.2, -1.12), (1.0, 1.12, .44), 'red')
    m.gem((0, 97, -.55), (.37, .55, .18), 'highlight')
    for side in (-1, 1):
        for y in np.linspace(31, 69, 11):
            rune(m, side * 1.0, y, -.73, .40, 'bronze_dark', .06)
        # Polished ivory-and-gold filigree wraps the butt and shoulder of the shaft.
        path = [(side * 1.3, 13, -.62), (side * 2.0, 16, -.3),
                (side * .9, 19, -.79), (side * 1.8, 22, -.35),
                (side * .9, 25, -.72)]
        m.tube(path, [.15, .12, .14, .11, .025], 'bone', 9)
    m.ellipsoid((0, 6.6, 0), (2.0, 2.0, 1.55), 'bronze_dark', 32, 18)
    torus(m, (0, 6.8, 0), 2.0, .27, 'gold', axis=(0, 1, 0), segments=56, sides=12)
    return m


def build_imperial_materials():
    # Original procedural surfaces: fine metal grain, polished stone and woven cloth.
    tile = 512
    size = tile * 4
    diffuse = np.zeros((size, size, 4), dtype=np.uint8)
    normal = np.zeros_like(diffuse)
    properties = np.zeros_like(diffuse)
    yy, xx = np.mgrid[:tile, :tile].astype(np.float32)
    for index, (name, rgb, rough, metal) in enumerate(PALETTE):
        rng = np.random.default_rng(1320 + index)
        grain = rng.normal(0, .6, (tile, tile)).astype(np.float32)
        waves = np.sin(xx * .17 + np.sin(yy * .035)) * .7
        height = grain * .002
        if name in ['gold', 'bronze', 'bronze_dark', 'highlight']:
            detail = grain + np.sin(xx * .9) * .8 + waves
            height += np.sin(xx * .9) * .001
        elif name in ['black', 'green', 'red', 'amber']:
            detail = grain * .5 + np.sin(xx * .018 + yy * .012) * 1.6
        elif name in ['ivory', 'bone']:
            detail = grain * .45 + np.sin(yy * .65) * .8
        elif name in ['hide', 'mouth', 'wood', 'horn']:
            detail = grain + np.sin(xx * .7) * np.sin(yy * .7) * 1.6
            height += np.sin(xx * .7) * np.sin(yy * .7) * .004
        else:
            detail = grain + waves
        y, x = index // 4 * tile, index % 4 * tile
        diffuse[y:y+tile, x:x+tile, :3] = np.clip(np.asarray(rgb)[None,None,:] + detail[:,:,None], 0, 255).astype(np.uint8)
        diffuse[y:y+tile, x:x+tile, 3] = 255
        gy, gx = np.gradient(height)
        n = normal[y:y+tile, x:x+tile]
        n[:,:,0] = 255
        n[:,:,1] = np.clip(127.5 - gx * 127.5, 0, 255)
        n[:,:,2] = 0
        n[:,:,3] = np.clip(127.5 + gy * 127.5, 0, 255)
        props = properties[y:y+tile, x:x+tile]
        props[:,:,0] = 0
        props[:,:,1] = 42 if name in ['red','green','amber','black'] else 0
        props[:,:,2] = round(metal * 255)
        props[:,:,3] = np.clip((rough + grain * .003) * 255, 28, 245)
    for name, data in [('diffuse', diffuse), ('normal', normal), ('properties', properties)]:
        image = Image.fromarray(data)
        image.save(ART / (TEXTURE_PREFIX + '_' + name + '.png'))
        save_dds_mips(image, GAME / (TEXTURE_PREFIX + '_' + name + '.dds'))


def orient_for_court(mesh):
    # Local -Z front becomes the shipped court-artifact -X front.
    matrix = np.array([[0, 0, 1], [0, 1, 0], [-1, 0, 0]], dtype=float)
    mesh.p = (np.asarray(mesh.p) @ matrix.T).tolist()
    mesh.n = (np.asarray(mesh.n) @ matrix.T).tolist()


def write_editable(mesh):
    geo.ART = ART
    geo.write_obj(mesh)
    geo.write_glb(mesh)
    obj_path = ART / (mesh.name + '.obj')
    obj_text = obj_path.read_text(encoding='utf8')
    obj_path.write_text(
        '# Original CK3 court relic; native Y-up coordinates; no external mesh source.\n'
        + '\n'.join(obj_text.splitlines()[1:]) + '\n',
        encoding='utf8')


unit = geo.unit

def render_mesh(m, width=600, height=600, transparent=False, view=(1.1,.65,-2.1)):
    from dragon_materials import shade_surface, PreviewTextures
    # Software render uses the actual generated triangles, not an illustration.
    eye=unit(view); right=unit(np.cross((0,1,0),eye)); up=np.cross(eye,right)
    basis=np.array([right,up,eye]); p=np.array(m.p); q=p@basis.T
    lo,hi=q[:,:2].min(0),q[:,:2].max(0); center=(lo+hi)/2
    scale=min((width*.82)/(hi[0]-lo[0]),(height*.82)/(hi[1]-lo[1]))
    screen=(q[:,:2]-center)*[scale,-scale]+[width/2,height/2]
    color=np.zeros((height,width,4),np.uint8)
    if not transparent: color[:]=[34,38,31,255]
    depth=np.full((height,width),-np.inf)
    normals=np.array(m.n); light=unit(eye*.7+np.array([-.15,.85,-.25]))
    prefix=getattr(m,'texture_prefix','mm_wyvern_trophies')
    textures=PreviewTextures(ART,prefix)
    uv=np.array(m.uv)
    faces=np.array(m.faces)
    facing=np.cross(p[faces[:,1]]-p[faces[:,0]],p[faces[:,2]]-p[faces[:,0]])@eye>0
    visible=np.flatnonzero(facing)
    visible=visible[np.argsort(q[faces[visible],2].mean(axis=1))[::-1]]
    for face in faces[visible]:
        ids=np.array(face); xyz=screen[ids]; z=q[ids,2]
        low=np.maximum(np.floor(xyz.min(0)).astype(int),[0,0]); high=np.minimum(np.ceil(xyz.max(0)).astype(int),[width-1,height-1])
        if np.any(high<low):continue
        a,b,c=xyz; den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
        if abs(den)<1e-8:continue
        yy,xx=np.mgrid[low[1]:high[1]+1,low[0]:high[0]+1]
        w0=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den
        w1=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den; w2=1-w0-w1
        zz=w0*z[0]+w1*z[1]+w2*z[2]; dst=depth[low[1]:high[1]+1,low[0]:high[0]+1]
        mask=(w0>=-1e-6)&(w1>=-1e-6)&(w2>=-1e-6)&(zz>dst)
        if not mask.any():continue
        n=w0[:,:,None]*normals[ids[0]]+w1[:,:,None]*normals[ids[1]]+w2[:,:,None]*normals[ids[2]]
        n/=np.maximum(np.linalg.norm(n,axis=2)[:,:,None],1e-8)
        tex=w0[:,:,None]*uv[ids[0]]+w1[:,:,None]*uv[ids[1]]+w2[:,:,None]*uv[ids[2]]
        color_sample,property_sample,normal_sample=textures.sample(tex,xyz,uv[ids])
        rgb=shade_surface(color_sample[:,:,:3],property_sample,normal_sample,n,p[ids[1]]-p[ids[0]],p[ids[2]]-p[ids[0]],uv[ids[1]]-uv[ids[0]],uv[ids[2]]-uv[ids[0]],light,eye)
        region=color[low[1]:high[1]+1,low[0]:high[0]+1]; region[mask,:3]=rgb[mask]; region[mask,3]=255; dst[mask]=zz[mask]
    return Image.fromarray(color)



def render_preview(mesh, label, eye):
    image = render_mesh(mesh, width=900, height=900, view=eye).resize((640,640), Image.Resampling.LANCZOS)
    draw = ImageDraw.Draw(image)
    draw.rectangle((8, 8, 375, 34), fill=(18, 22, 25, 220))
    draw.text((16, 15), 'OFFLINE COURT-SHADER APPROXIMATION',
              fill=(231, 216, 177, 255))
    draw.rectangle((8, 606, 180, 632), fill=(18, 22, 25, 220))
    draw.text((16, 613), label.upper(), fill=(231, 216, 177, 255))
    return image


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def align_face_winding(mesh):
    # Validate the float32 geometry the engine actually reads, before tangents/export.
    p = np.asarray(mesh.p, dtype=np.float32).astype(float)
    n = np.asarray(mesh.n, dtype=np.float32).astype(float)
    faces = np.asarray(mesh.faces, dtype=np.int32)
    cross = np.cross(p[faces[:, 1]] - p[faces[:, 0]], p[faces[:, 2]] - p[faces[:, 0]])
    dot = np.einsum('ij,ij->i', cross, n[faces].mean(axis=1))
    inward = dot < 0
    faces[inward] = faces[inward][:, [0, 2, 1]]
    mesh.faces = faces.tolist()
    print('WINDING ALIGNED', mesh.name, int(inward.sum()), flush=True)


def main():
    ART.mkdir(parents=True, exist_ok=True)
    GAME.mkdir(parents=True, exist_ok=True)
    build_imperial_materials()
    factories = [make_black_crown, make_black_regalia, make_white_book,
                 make_fire_ring, make_earth_sarcophagus, make_sea_armor,
                 make_sky_spear]
    metadata = {
        'format': 'PDX binary @@b@ 1.0',
        'shader': 'court',
        'shaderFile': 'gfx/FX/court_scene.shader',
        'axis': 'Y-up; face toward native court -X; base at or above Y=0',
        'texturePrefix': TEXTURE_PREFIX,
        'textureSize': [2048, 2048],
        'artDirection': 'Imperial court luxury: low circlet, openwork scepter, gilded casket and polished ceremonial armor; no bone-spike forest.',
        'authoring': 'Main agent geometry and material revision after user feedback; serial model builds.',
        'normalChannels': 'RRxG tangent normal; blue emissive mask is zero',
        'propertiesChannels': 'alpha roughness, green specular color, blue metalness',
        'preview': 'Offline software render using court-style material/lighting approximation; not an in-game capture.',
        'models': {},
    }
    definitions, preview_sheet = [], Image.new('RGB', (1080, 2520), (25, 30, 31))
    sheet_draw = ImageDraw.Draw(preview_sheet)
    views = [('front', (-1.0, .08, 0.0)),
             ('angle', (-2.5, .85, -1.55)),
             ('back', (1.0, .28, 0.0))]
    for model_index, factory in enumerate(factories):
        print('BUILDING', factory.__name__, flush=True)
        mesh = factory()
        orient_for_court(mesh)
        align_face_winding(mesh)
        shape = mesh.name + '_shape'
        mesh_file = mesh.name + '.mesh'
        blob, info = encode_mesh(mesh, shape, TEXTURE_PREFIX, geo.property_bytes)
        mesh_path = GAME / mesh_file
        mesh_path.write_bytes(blob)
        write_editable(mesh)
        print('MESH READY', mesh.name, info['triangles'], flush=True)
        info['modelId'] = mesh.name
        info['meshFile'] = mesh_file
        info['meshSha256'] = sha256(mesh_path)
        info['editableFiles'] = {
            suffix: {
                'file': mesh.name + '.' + suffix,
                'sha256': sha256(ART / (mesh.name + '.' + suffix)),
            }
            for suffix in ('obj', 'glb')
        }
        for view_index, (label, eye) in enumerate(views):
            print('RENDERING', mesh.name, label, flush=True)
            image = render_preview(mesh, label, eye)
            preview_path = ART / (mesh.name + '-' + label + '.png')
            image.save(preview_path)
            info.setdefault('previews', {})[label] = {
                'file': preview_path.name,
                'sha256': sha256(preview_path),
                'offline': True,
            }
            preview_sheet.paste(image.resize((340, 340), Image.Resampling.LANCZOS),
                               (view_index * 360 + 10, model_index * 360 + 10))
            sheet_draw.text((view_index * 360 + 18, model_index * 360 + 352),
                            mesh.name + ' / ' + label, fill=(231, 216, 177))
        definitions.append(asset_definition(
            mesh.name + '_mesh', shape, mesh.name + '_entity', mesh_file,
            TEXTURE_PREFIX, info['submeshes']))
        icon_dir = ROOT / 'patches/dragon-relics/mod/gfx/interface/icons/artifact'
        icon_dir.mkdir(parents=True, exist_ok=True)
        icon = render_mesh(mesh, width=512, height=512, transparent=True, view=views[1][1])
        icon.save(icon_dir / (mesh.name + '.dds'), pixel_format='DXT5')
        icon.save(ART / (mesh.name + '-icon.png'))
        info['inventoryIcon'] = {'file': (icon_dir / (mesh.name + '.dds')).relative_to(ROOT).as_posix(), 'sha256': sha256(icon_dir / (mesh.name + '.dds'))}
        metadata['models'][mesh.name] = info
        print(mesh.name, info['triangles'], info['min'], info['max'], info['meshSha256'], flush=True)
        del mesh, blob, info
    asset_path = GAME / 'mm_dragon_relics.asset'
    asset_path.write_text('\ufeff' + '\n'.join(definitions), encoding='utf8')
    (ART / 'trophies.mtl').write_text(
        'newmtl court_relics\nKd 1 1 1\nmap_Kd ' + TEXTURE_PREFIX + '_diffuse.png\n',
        encoding='utf8')
    preview_sheet.save(ART / 'contact-sheet.png')
    metadata['sharedTextures'] = {
        suffix: {
            'png': TEXTURE_PREFIX + '_' + suffix + '.png',
            'pngSha256': sha256(ART / (TEXTURE_PREFIX + '_' + suffix + '.png')),
            'dds': TEXTURE_PREFIX + '_' + suffix + '.dds',
            'ddsSha256': sha256(GAME / (TEXTURE_PREFIX + '_' + suffix + '.dds')),
        }
        for suffix in ('diffuse', 'normal', 'properties')
    }
    metadata['assetDefinition'] = {
        'file': asset_path.name,
        'sha256': sha256(asset_path),
        'entities': [name + '_entity' for name in metadata['models']],
    }
    metadata['contactSheet'] = {
        'file': 'contact-sheet.png',
        'sha256': sha256(ART / 'contact-sheet.png'),
        'offline': True,
    }
    (ART / 'manifest.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf8')
    print(json.dumps({name: {'triangles': item['triangles'],
                             'bounds': [item['min'], item['max']],
                             'meshSha256': item['meshSha256']}
                      for name, item in metadata['models'].items()}, indent=2), flush=True)


if __name__ == '__main__':
    main()
