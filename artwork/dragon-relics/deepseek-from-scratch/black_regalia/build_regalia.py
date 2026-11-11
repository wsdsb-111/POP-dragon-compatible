# -*- coding: utf-8 -*-
"""black_regalia 黑色皇帝之权柄：从零新建（全长 2280mm，头宽 420，头深 380）。
三视图依据：资料包/参考图/black_regalia.png
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
BLEND = OUT + "/black_regalia.blend"

H = 2280.0
HEAD_Z = 2070.0
R_RING = 152.0
R_ORB = 80.0


def clear():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)


def main():
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0
    clear()
    coll = bpy.data.collections.get("COL_Regalia") or bpy.data.collections.new("COL_Regalia")
    if coll.name not in sc.collection.children:
        sc.collection.children.link(coll)
    M = G.std_materials()

    # ---------- 杖身 ----------
    G.taper_cyl("GEO-shaft", coll, (0, 0, 118), (0, 0, 1900), 22.0, 17.0, seg=24, mat=M["black_rough"])
    # 杖身金纹（缠绕细管）
    for k in range(3):
        z0 = 260 + k * 520
        pts = []
        for i in range(41):
            t = i / 40.0
            a = math.tau * 2.2 * t + k * 1.1
            z = z0 + 380 * t
            rr = 23.0
            pts.append((rr * math.cos(a), rr * math.sin(a), z))
        G.tube_along("GEO-vein_%d" % k, pts, 3.2, coll, seg=6)

    # ---------- 杖箍 ----------
    for i, (z, hh, rr) in enumerate(((250, 70, 34), (1140, 62, 32), (1790, 84, 40))):
        G.taper_cyl("GEO-collar_%d" % i, coll, (0, 0, z - hh / 2), (0, 0, z + hh / 2),
                    rr, rr * 0.94, seg=28, mat=M["gold"])
        G.torus("GEO-collar_rim%d" % i, coll, (0, 0, z - hh / 2), rr * 0.96, 6.0,
                plane='XY', seg=40, ring=8, mat=M["gold"])
        G.torus("GEO-collar_rim%d_b" % i, coll, (0, 0, z + hh / 2), rr * 0.92, 6.0,
                plane='XY', seg=40, ring=8, mat=M["gold"])
        G.add_gem("GEO-collar_gem%d" % i, coll, (0, -rr * 0.86, z), 15.0, 9.0,
                  hh * 0.55, n=6, mat=M["ruby"])

    # ---------- 头部：主环 + 正交副环 ----------
    G.torus("GEO-head_ring", coll, (0, 0, HEAD_Z), R_RING, 15.0, plane='XZ', seg=72,
            ring=12, mat=M["darkgold"])
    # 镂空轮：内环 + 8 根辐条（对应三视图的镂空金轮）
    G.torus("GEO-wheel_inner", coll, (0, 0, HEAD_Z), R_RING * 0.72, 9.0, plane='XZ',
            seg=56, ring=10, mat=M["gold"])
    for i in range(8):
        a = math.tau * i / 8 + math.pi / 8
        G.spoke("GEO-wheel_spoke%d" % i, coll,
                (math.cos(a) * R_RING * 0.62, 0.0, HEAD_Z + math.sin(a) * R_RING * 0.62),
                (math.cos(a) * R_RING * 0.98, 0.0, HEAD_Z + math.sin(a) * R_RING * 0.98),
                7.0, 5.0, 9.0, mat=M["gold"])
    for i in range(8):
        a = math.tau * i / 8
        G.add_gem("GEO-wheel_gem%d" % i, coll,
                  (math.cos(a) * R_RING, 0.0, HEAD_Z + math.sin(a) * R_RING),
                  7.0, 6.0, 12.0, rot_z=a, n=6, mat=M["ruby"])
    G.torus("GEO-head_ring_y", coll, (0, 0, HEAD_Z), 118.0, 12.0, plane='YZ', seg=64,
            ring=10, mat=M["gold"])
    # 环上金鳞纹（小凸块）
    for i in range(48):
        a = math.tau * i / 48
        cx, cz = R_RING * math.cos(a), R_RING * math.sin(a)
        G.add_gem("GEO-ringstud%d" % i, coll, (cx, 0.0, HEAD_Z + cz), 7.0, 5.0, 9.0,
                  rot_z=a, n=5, mat=M["gold"])
    # 星芒：XZ 面 8 根（左右到 ±210 → 宽 420）
    for i in range(8):
        a = math.tau * i / 8
        cx, cz = math.cos(a), math.sin(a)
        L = 210.0 if i % 2 == 0 else 186.0
        G.spoke("GEO-star%d" % i, coll,
                (cx * (R_RING - 6), 0.0, HEAD_Z + cz * (R_RING - 6)),
                (cx * L, 0.0, HEAD_Z + cz * L),
                24.0, 3.0, 16.0, mat=M["gold"])
    # 前后星芒（深度 380 → ±190）
    for sgn in (-1, 1):
        G.spoke("GEO-star_y%d" % sgn, coll, (0.0, sgn * 112.0, HEAD_Z),
                (0.0, sgn * 190.0, HEAD_Z), 22.0, 3.0, 16.0, mat=M["gold"])

    # ---------- 宝珠 ----------
    G.sphere("GEO-orb", coll, (0, 0, HEAD_Z), R_ORB, seg=32, ring=20, mat=M["orb_red"])
    G.sphere("GEO-orb_core", coll, (0, 0, HEAD_Z), R_ORB * 0.62, seg=24, ring=16,
             mat=M["crack"])
    # 宝珠金笼（四条弧带）
    for i in range(8):
        a0 = math.tau * i / 8
        pts = []
        for j in range(21):
            t = j / 20.0
            a = a0 + math.pi * t
            pts.append((math.cos(a) * R_ORB * 1.06, 0.0,
                        HEAD_Z + math.sin(a) * R_ORB * 1.06))
        G.tube_along("GEO-orbcage%d" % i, pts, 5.0, coll, seg=6)

    # ---------- 盘龙 ----------
    coil = []
    for j in range(41):
        t = j / 40.0
        a = math.tau * 0.92 * t - 0.6
        rad = R_ORB * (1.56 - 0.14 * t)
        coil.append((rad * math.cos(a), 0.0, HEAD_Z + rad * math.sin(a)))
    G.tube_along("GEO-dragon_body", coil, 11.0, coll, seg=10)
    for ob in coll.objects:
        if ob.name == "GEO-dragon_body":
            ob.data.materials.append(M["gold"])
    # 龙鳞（沿脊线贴片，朝外）
    chunks = []
    for j in range(0, len(coil) - 1, 3):
        p0 = Vector(coil[j])
        p1 = Vector(coil[min(j + 1, len(coil) - 1)])
        Td = (p1 - p0)
        if Td.length < 1e-6:
            continue
        Td.normalize()
        out = Vector((coil[j][0], 0.0, coil[j][2] - HEAD_Z))
        if out.length < 1e-6:
            continue
        out.normalize()
        c = p0 + out * 12.0
        v, f = G.scale_plate_geo(c * MM, Td, out, 13.0, 16.0, 2.4, 2.0)
        chunks.append((v, f))
    if chunks:
        ob = G.merge_geo("GEO-dragon_scales", chunks, coll)
        ob.data.materials.append(M["gold"])
    # 龙头（顶部左侧，低多边形：吻 + 角 + 下颚）
    hx, hz = coil[-1][0], coil[-1][2]
    A = Vector((1, 0, 0)); U = Vector((0, 0, 1)); P = Vector((0, 1, 0))
    G.lens_blade("GEO-dragon_head", (hx * MM, 0.0, hz * MM), A, U, P, 78.0,
                 [(0, 0), (1, 1)], [(0, 0), (1, 1)],
                 [(0, 26.0), (0.3, 22.0), (0.62, 14.0), (1, 3.0)],
                 [(0, 26.0), (0.3, 22.0), (0.62, 14.0), (1, 3.0)],
                 [(0, 16.0), (0.5, 11.0), (1, 2.0)], n=16, coll=coll)
    for ob in coll.objects:
        if ob.name == "GEO-dragon_head":
            ob.data.materials.append(M["gold"])
    # 龙首下颚 + 双须
    G.curved_blade("GEO-dragon_jaw",
                   [(hx, 8.0, hz - 4.0), (hx - 26.0, 10.0, hz - 22.0),
                    (hx - 50.0, 8.0, hz - 34.0)], 10.0, 7.0, coll, n=14,
                   plane=Vector((0, 1, 0)))
    for sgn in (-1, 1):
        G.curved_blade("GEO-dragon_whisker%d" % sgn,
                       [(hx - 6.0, sgn * 12.0, hz - 6.0),
                        (hx - 34.0, sgn * 22.0, hz - 26.0),
                        (hx - 62.0, sgn * 18.0, hz - 40.0)], 3.6, 2.6, coll, n=14,
                       plane=Vector((0, 1, 0)))
    for ob in coll.objects:
        if ob.name in ("GEO-dragon_jaw", "GEO-dragon_whisker-1", "GEO-dragon_whisker1"):
            ob.data.materials.append(M["gold"])
    # 宝珠表面熔裂光（4 条，压在球面前方）
    for k in range(4):
        a0 = math.tau * k / 4 + 0.4
        pts = []
        for j in range(9):
            tt = j / 8.0
            aa = a0 + 0.9 * tt
            rr = R_ORB * 1.02
            pts.append((math.cos(aa) * rr * (0.5 + 0.5 * tt),
                        0.0,
                        HEAD_Z + math.sin(aa * 0.8) * rr * (0.55 + 0.45 * tt)))
        o = G.curved_blade("GEO-orbcrack%d" % k, pts, 2.6, 2.0, coll, n=12,
                           plane=Vector((0, 1, 0)))
        o.data.materials.append(M["crack"])

    for sgn in (-1, 1):
        G.curved_blade("GEO-dragon_horn%d" % sgn,
                       [(hx, sgn * 10, hz + 40), (hx - 26, sgn * 16, hz + 74),
                        (hx - 44, sgn * 20, hz + 96)], 7.0, 5.0, coll, n=14,
                       plane=Vector((0, 1, 0)))

    # ---------- 垂链 + 坠饰 ----------
    for sgn in (-1, 1):
        st = (sgn * 118.0, 0.0, HEAD_Z - 96.0)
        G.chain("GEO-chain%d" % sgn, coll, st, (sgn * 0.10, 0, -1.0), 26.0, 3.4, 8,
                mat=M["gold"])
        wz = HEAD_Z - 96.0 - 26.0 * 8 - 26.0
        G.torus("GEO-pend_wheel%d" % sgn, coll, (sgn * 122.0, 0.0, wz), 30.0, 4.5,
                plane='XZ', seg=28, ring=8, mat=M["gold"])
        for k in range(4):
            a = math.tau * k / 4
            G.spoke("GEO-pend_spoke%d_%d" % (sgn, k), coll,
                    (sgn * 122.0, 0, wz), (sgn * 122.0 + math.cos(a) * 28,
                                           0, wz + math.sin(a) * 28), 3.0, 1.0, 3.0,
                    mat=M["gold"])
        G.add_gem("GEO-pend_gem%d" % sgn, coll, (sgn * 122.0, 0.0, wz - 34.0),
                  9.0, 9.0, 30.0, n=6, mat=M["ruby"])
        G.spoke("GEO-pend_drop%d" % sgn, coll, (sgn * 122.0, 0, wz - 40.0),
                (sgn * 122.0, 0, wz - 78.0), 9.0, 1.0, 8.0, mat=M["gold"])

    # ---------- 红飘带 ----------
    for i, sgn in enumerate((-1, 1)):
        for k in range(2):
            x0 = sgn * (52 + 34 * k)
            pts = [(x0, -6 + 10 * k, 1520 - 120 * k),
                   (x0 + sgn * 26, -16 - 20 * k, 1300 - 160 * k),
                   (x0 + sgn * 8, -6, 1060 - 180 * k),
                   (x0 + sgn * 34, 14 + 18 * k, 820 - 160 * k),
                   (x0 + sgn * 16, 6, 600 - 120 * k)]
            G.ribbon("GEO-ribbon%d_%d" % (i, k), coll, pts, 58.0, 3.0,
                     mat=M["silk_red"], n=26)

    # ---------- 杖尾 ----------
    G.spoke("GEO-pommel_tip", coll, (0, 0, 96), (0, 0, -2), 30.0, 2.0, 26.0,
            mat=M["gold"])
    for k in range(4):
        a = math.tau * k / 4 + math.pi / 4
        G.spoke("GEO-pommel_fin%d" % k, coll, (0, 0, 120),
                (math.cos(a) * 34, math.sin(a) * 34, 46), 12.0, 1.5, 12.0, mat=M["gold"])
    G.add_gem("GEO-pommel_gem", coll, (0, 0, 96), 13.0, 13.0, 44.0, n=6, mat=M["ruby"])

    mn, mx, tris = G.asset_bbox(coll)
    print("BUILD obj=%d tris=%d W=%.0f D=%.0f H=%.0f" %
          (len(coll.objects), tris, (mx.x - mn.x) * 1000, (mx.y - mn.y) * 1000,
           (mx.z - mn.z) * 1000))
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print("SAVED", BLEND)
    R.render_ortho(OUT + "/render", "COL_Regalia", res=900)
    R.render_beauty(OUT + "/render", "COL_Regalia", views=2, res=900)
    R.export_glb(OUT + "/out/black_regalia.glb")


main()
