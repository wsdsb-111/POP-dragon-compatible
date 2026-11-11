# -*- coding: utf-8 -*-
"""white_book 白色神谕之书：从零新建。高 280 / 宽 220 / 厚 70 mm。
依据：资料包/参考图/white_book.png（正面/左侧/背面/俯视 + 7 组特写）。
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
for p in (HERE, ROOT + "/_lib"):
    if p not in sys.path:
        sys.path.insert(0, p)
import relic_geo as G
from relic_geo import MM, Z
import relic_render as R

OUT = HERE
BLEND = OUT + "/white_book.blend"

W, Hh, D = 220.0, 280.0, 70.0
X0, X1 = -110.0, 110.0      # 书宽
Z0, Z1 = -140.0, 140.0
COVER_T = 8.0
YF, YB = -35.0, 35.0        # 前后封面外表面


def clear():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)


def compass(coll, M, cx, cz, y, R_out, rays=8, core=14.0, name="cmp", flat=1.0):
    """罗盘星芒饰：环 + 芒 + 核心。y 为所在平面（法线 Y）。"""
    G.torus("GEO-%s_ring" % name, coll, (cx, y, cz), R_out * 0.62, 4.0, plane='XZ',
            seg=40, ring=8, mat=M["gold"])
    for i in range(rays):
        a = math.tau * i / rays
        L = R_out if i % 2 == 0 else R_out * 0.72
        G.spoke("GEO-%s_ray%d" % (name, i), coll,
                (cx, y, cz), (cx + math.cos(a) * L, y, cz + math.sin(a) * L),
                9.0 * flat, 1.2, 5.0, mat=M["gold"])
    G.sphere("GEO-%s_core" % name, coll, (cx, y - 2, cz), core, seg=16, ring=10,
             mat=M["glow_gold"])


def main():
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0
    clear()
    coll = bpy.data.collections.get("COL_Book") or bpy.data.collections.new("COL_Book")
    if coll.name not in sc.collection.children:
        sc.collection.children.link(coll)
    M = G.std_materials()
    M["ivory_tex"] = G.tex_mat("M-ivory_tex", "Marble012", darken=1.0, metallic=0.0,
                               tint=(1.08, 1.03, 0.93), proj_scale=2.2)
    M["glow_gold"] = G.flat_mat("M-glow_gold", (1.0, 0.86, 0.55), 0.35, 0.25,
                                emission=(1.0, 0.82, 0.45), estr=3.2)

    # ---------- 封面 / 书芯 / 书脊 ----------
    for tag, y in (("front", YF + COVER_T / 2), ("back", YB - COVER_T / 2)):
        ob = G.box_bevel("GEO-cover_%s" % tag, coll, (202.0, COVER_T, 280.0),
                         (9.0, y, 0.0), bevel_mm=2.5, seg=2)
        ob.data.materials.append(M["ivory_tex"])
    # 书芯（镀金书页）
    ob = G.box_bevel("GEO-pages", coll, (190.0, 54.0, 272.0), (9.0, 0.0, 0.0),
                     bevel_mm=1.0, seg=1)
    ob.data.materials.append(M["gold"])
    # 书脊：半圆曲面（弧形壳）
    spine = []
    for i in range(15):
        t = i / 14.0
        a = math.pi * (t - 0.5)
        spine.append(((X0 + 4.0), math.sin(a) * 33.0, -138.0 + 276.0 * t))
    pts = [(X0 + 4.0 - math.cos(math.pi * (i / 14.0 - 0.5)) * 20.0,
            math.sin(math.pi * (i / 14.0 - 0.5)) * 33.0,
            -138.0 + 276.0 * (i / 14.0)) for i in range(15)]
    # 书脊：弧形闭合板壳（外弧 + 内弧 + 两端封口）
    verts, faces, rows = [], [], []
    for i in range(15):
        t = i / 14.0
        a = math.pi * (t - 0.5)
        xo = X0 + 4.0 - math.cos(a) * 22.0
        yo = math.sin(a) * 34.0
        xi = X0 + 4.0 - math.cos(a) * 14.0
        yi = math.sin(a) * 26.0
        quad = [(xo, yo, -138.0), (xo, yo, 138.0), (xi, yi, 138.0), (xi, yi, -138.0)]
        row = []
        for q in quad:
            row.append(len(verts)); verts.append(Vector(q) * MM)
        rows.append(row)
    for i in range(14):
        A_, B_ = rows[i], rows[i + 1]
        for j in range(4):
            jn = (j + 1) % 4
            faces.append([A_[j], A_[jn], B_[jn], B_[j]])
    faces.append(list(rows[0]))
    faces.append(list(reversed(rows[-1])))
    ob = G.mesh_from("GEO-spine", verts, faces, coll)
    ob.data.materials.append(M["ivory_tex"])
    # 书脊金箍
    for zz in (-100.0, -20.0, 62.0, 128.0):
        G.torus("GEO-spineband%+.0f" % zz, coll, (X0 + 2.0, 0.0, zz), 34.0, 6.5,
                plane='XY', seg=36, ring=8, mat=M["gold"])
    # 书脊星纹
    for zz in (-60.0, 20.0, 100.0):
        G.sphere("GEO-spinestar%+.0f" % zz, coll, (X0 + 8.0, -30.0, zz), 7.0,
                 seg=8, ring=6, mat=M["gold"])

    # ---------- 四角镂空饰 ----------
    for sx in (-1, 1):
        for sz in (-1, 1):
            cx = 9.0 + sx * 92.0
            cz = sz * 128.0
            for k in range(5):
                a = math.atan2(-sz, sx) + k * 0.62 - 1.24
                G.spoke("GEO-corner_%d_%d_%d" % (sx, sz, k), coll,
                        (cx, YF - 2.0, cz),
                        (cx + math.cos(a) * 34, YF - 2.0, cz + math.sin(a) * 34),
                        7.0, 1.0, 4.0, mat=M["gold"])
            G.sphere("GEO-cornerpearl_%d_%d" % (sx, sz), coll,
                     (cx + sx * 22.0, YF - 6.0, cz + sz * 22.0), 7.0, seg=14, ring=10,
                     mat=M["pearl"])

    # ---------- 封面罗盘 + 龙纹 ----------
    compass(coll, M, 12.0, 6.0, YF - 3.0, 74.0, rays=8, core=15.0, name="med")
    # 龙：蛇形盘龙浮雕（S 波动脊线 + 粗细渐变 + 龙首 + 尾鳍）
    spiral = []
    radii = []
    N = 56
    for k in range(N + 1):
        t = k / N
        a = math.tau * 1.42 * t - 1.25
        r = 110.0 - 58.0 * t + 6.0 * math.sin(math.tau * 2.4 * t)
        spiral.append((12.0 + math.cos(a) * r, YF - 12.0,
                       6.0 + math.sin(a) * r * 1.05))
        radii.append(4.5 + 5.5 * t)          # 尾细头粗（最大 10，离封面留 2mm）
    G.tube_along("GEO-dragon_relief", spiral, 6.0, coll, seg=10,
                 mat=M["ivory_tex"], radii=radii)
    # 龙首（朝内上方，带双角）
    hx, hz = spiral[-1][0], spiral[-1][2]
    G.curved_blade("GEO-dragon_head",
                   [(hx, YF - 16.0, hz), (hx - 26.0, YF - 17.0, hz + 26.0),
                    (hx - 46.0, YF - 16.0, hz + 40.0), (hx - 62.0, YF - 14.0, hz + 44.0)],
                   20.0, 12.0, coll, n=18, plane=Vector((0, 1, 0)))
    for sgn in (-1, 1):
        G.curved_blade("GEO-dragon_horn%d" % sgn,
                       [(hx - 22.0, YF - 19.0, hz + 24.0),
                        (hx - 44.0, YF - 19.0, hz + 48.0 + 8.0 * sgn),
                        (hx - 60.0, YF - 18.0, hz + 66.0 + 12.0 * sgn)], 7.0, 5.0, coll,
                       n=12,
                       plane=Vector((0, 1, 0)))
    # 尾鳍
    tx, tz = spiral[0][0], spiral[0][2]
    G.curved_blade("GEO-dragon_tail",
                   [(tx, YF - 12.0, tz), (tx + 26.0, YF - 11.0, tz - 16.0),
                    (tx + 44.0, YF - 10.0, tz - 26.0)], 14.0, 8.0, coll, n=14,
                   plane=Vector((0, 1, 0)))
    for nm in ("GEO-dragon_head", "GEO-dragon_horn-1", "GEO-dragon_horn1",
               "GEO-dragon_tail"):
        for ob in coll.objects:
            if ob.name == nm:
                ob.data.materials.append(M["ivory_tex"])

    # ---------- 封面金丝卷饰（围绕罗盘的镂空卷草） ----------
    for k in range(6):
        a0 = math.tau * k / 6 + 0.26
        r0 = 82.0
        pts = [(12.0 + math.cos(a0) * r0, YF - 8.0, 6.0 + math.sin(a0) * r0 * 1.12),
               (12.0 + math.cos(a0 + 0.30) * (r0 + 30.0), YF - 10.0,
                6.0 + math.sin(a0 + 0.30) * (r0 + 30.0) * 1.12),
               (12.0 + math.cos(a0 + 0.72) * (r0 + 46.0), YF - 8.0,
                6.0 + math.sin(a0 + 0.72) * (r0 + 46.0) * 1.12)]
        G.curved_blade("GEO-curl%d" % k, pts, 11.0, 6.0, coll, n=14,
                       plane=Vector((0, 1, 0)))
        for ob in coll.objects:
            if ob.name == "GEO-curl%d" % k:
                ob.data.materials.append(M["gold"])

    # ---------- 书扣（罗盘形） ----------
    compass(coll, M, 118.0, 0.0, 0.0, 46.0, rays=8, core=9.0, name="clasp")
    G.torus("GEO-clasp_ring2", coll, (118.0, 0.0, 0.0), 30.0, 3.0, plane='YZ',
            seg=24, ring=6, mat=M["gold"])

    # ---------- 珍珠挂链 ----------
    for i in range(14):
        zz = 128.0 - i * 18.0
        G.sphere("GEO-pearlchain%d" % i, coll, (X0 - 13.0, -26.0, zz), 6.0, seg=14,
                 ring=10, mat=M["pearl"])
    G.sphere("GEO-pearl_drop1", coll, (X0 - 13.0, -26.0, 128.0 - 9 * 26.0), 9.0,
             seg=14, ring=10, mat=M["pearl"])
    G.spoke("GEO-tassel", coll, (X0 - 13.0, -26.0, 128.0 - 9 * 26.0 - 10.0),
            (X0 - 13.0, -26.0, 128.0 - 9 * 26.0 - 44.0), 5.0, 1.0, 4.0, mat=M["gold"])

    mn, mx, tris = G.asset_bbox(coll)
    print("BUILD obj=%d tris=%d W=%.0f D=%.0f H=%.0f" %
          (len(coll.objects), tris, (mx.x - mn.x) * 1000, (mx.y - mn.y) * 1000,
           (mx.z - mn.z) * 1000))
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print("SAVED", BLEND)
    R.render_ortho(OUT + "/render", "COL_Book", res=900)
    R.render_beauty(OUT + "/render", "COL_Book", views=2, res=900)
    R.export_glb(OUT + "/out/white_book.glb")


main()
