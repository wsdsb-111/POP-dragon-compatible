# -*- coding: utf-8 -*-
"""fire_ring 烛龙青铜玄戒：从零新建。外宽 42 / 总高 38 / 内宽 22 / 戒面纵深 26 mm。
依据：资料包/参考图/fire_ring.png（正/侧/背/俯 + 6 组特写）。
布局要点（照三视图）：戒孔通透；宝珠+双龙首+星芒+尖顶坐在**戒圈上弧**，不是吊在孔中央。
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
BLEND = OUT + "/fire_ring.blend"

A_CL, B_CL = 16.0, 12.0    # 戒圈中线：外 42 宽 / 内孔 22 宽
RX_SIDE, RX_TOPBOT = 5.0, 3.0   # 截面径向半厚：两侧 5、上下 3（戒圈肩部更厚）
RY = 13.0                  # 截面纵深半厚（戒面纵深 26）
ORB_Z, ORB_R = 12.0, 7.0   # 宝珠坐在上弧之上
TOP_Z = 23.0               # 总高 38 = -15 … +23


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
    coll = bpy.data.collections.get("COL_Ring") or bpy.data.collections.new("COL_Ring")
    if coll.name not in sc.collection.children:
        sc.collection.children.link(coll)
    M = G.std_materials()

    # ---------- 戒圈 ----------
    verts, faces, idx = [], [], []
    seg, ring = 72, 20
    for i in range(seg):
        th = math.tau * i / seg
        C = Vector((A_CL * math.cos(th), 0.0, B_CL * math.sin(th)))
        Nr = Vector((math.cos(th), 0.0, math.sin(th)))
        rx = RX_TOPBOT + (RX_SIDE - RX_TOPBOT) * (math.cos(th) ** 2)
        row = []
        for j in range(ring):
            a = math.tau * j / ring
            v = C + Nr * (math.cos(a) * rx) + Vector((0, 1, 0)) * (math.sin(a) * RY)
            row.append(len(verts)); verts.append(v * MM)
        idx.append(row)
    for i in range(seg):
        A_, B_ = idx[i], idx[(i + 1) % seg]
        for j in range(ring):
            jn = (j + 1) % ring
            faces.append([A_[j], A_[jn], B_[jn], B_[j]])
    ob = G.mesh_from("GEO-ring_band", verts, faces, coll)
    ob.data.materials.append(M["bronze"])

    # 戒圈两侧金边（正/背两条闭合椭圆管，对应三视图戒臂边缘金线）
    for sy in (-1, 1):
        pts = []
        for i in range(73):
            th = math.tau * i / 72.0 * 0.985
            pts.append((A_CL * math.cos(th), sy * (RY - 1.2), B_CL * math.sin(th)))
        G.tube_along("GEO-band_rail%d" % sy, pts, 1.9, coll, seg=6, closed=False,
                     mat=M["gold"])

    # ---------- 戒圈正面：黑裂石面板 + 熔裂光 ----------
    plates, cracks = [], []
    for i in range(32):
        th = math.tau * i / 32
        C = Vector((A_CL * math.cos(th), 0.0, B_CL * math.sin(th)))
        rx = RX_TOPBOT + (RX_SIDE - RX_TOPBOT) * (math.cos(th) ** 2)
        C = C + Vector((math.cos(th), 0.0, math.sin(th))) * (rx * 0.0)
        p = C + Vector((0, -RY + 0.4, 0))
        v, f = G.scale_plate_geo(p * MM, Z, Vector((0, -1, 0)), 1.05, 2.3, 0.28, 0.3)
        plates.append((v, f))
        if i % 2 == 0:
            v2, f2 = G.scale_plate_geo(p * MM + Vector((0, -0.35 * MM, 0)), Z,
                                       Vector((0, -1, 0)), 0.35, 1.5, 0.18, 0.18)
            cracks.append((v2, f2))
    ob = G.merge_geo("GEO-ring_plates", plates, coll)
    ob.data.materials.append(M["stone_dark"])
    ob = G.merge_geo("GEO-ring_cracks", cracks, coll)
    ob.data.materials.append(M["crack"])

    # ---------- 戒面：底座 + 宝珠 + 星芒 + 双龙首 + 尖顶 ----------
    G.torus("GEO-bezel_base", coll, (0.0, 0.0, ORB_Z - ORB_R * 0.80), 6.2, 2.2,
            plane='XZ', seg=32, ring=10, mat=M["bronze"])
    G.torus("GEO-bezel_ring", coll, (0.0, 0.0, ORB_Z + 0.4), ORB_R * 1.04, 1.8,
            plane='XZ', seg=32, ring=10, mat=M["bronze"])
    G.sphere("GEO-orb", coll, (0.0, 0.0, ORB_Z), ORB_R, seg=26, ring=18,
             mat=M["orb_red"])
    for i in range(4):
        a = math.tau * i / 4
        L = 12.6 if i % 2 == 0 else 10.8
        G.spoke("GEO-star%d" % i, coll, (0.0, -5.6, ORB_Z),
                (math.cos(a) * L, -5.6, ORB_Z + math.sin(a) * L),
                2.4, 0.4, 2.6, mat=M["bronze"])
    G.spoke("GEO-spire", coll, (0.0, 0.0, ORB_Z + 6.0), (0.0, 0.0, TOP_Z),
            2.8, 0.3, 2.6, mat=M["bronze"])
    G.spoke("GEO-spire_low", coll, (0.0, 0.0, ORB_Z - ORB_R - 1.0),
            (0.0, 0.0, ORB_Z - ORB_R - 6.0), 3.0, 0.4, 2.8, mat=M["bronze"])
    G.add_gem("GEO-spire_gem", coll, (0.0, -2.4, ORB_Z + 5.4), 1.9, 1.4, 6.0, n=6,
              mat=M["ruby"])

    # 双龙首（左右各一，抬头向宝珠）
    for sgn in (-1, 1):
        hx = sgn * 9.6
        G.curved_blade("GEO-dragon%d" % sgn,
                       [(hx, -3.0, 4.0), (hx + sgn * 3.2, -4.4, 9.0),
                        (hx + sgn * 1.2, -4.8, 14.0), (hx - sgn * 3.6, -4.2, 17.0)],
                       4.6, 3.4, coll, n=16, plane=Vector((0, 1, 0)))
        for ob in coll.objects:
            if ob.name == "GEO-dragon%d" % sgn:
                ob.data.materials.append(M["bronze"])
        G.curved_blade("GEO-horn%d" % sgn,
                       [(hx - sgn * 1.4, -4.2, 14.4), (hx - sgn * 4.2, -4.6, 17.4),
                        (hx - sgn * 6.2, -4.2, 19.6)], 2.0, 1.5, coll, n=12,
                       plane=Vector((0, 1, 0)))
        for ob in coll.objects:
            if ob.name == "GEO-horn%d" % sgn:
                ob.data.materials.append(M["bronze"])
        G.sphere("GEO-eye%d" % sgn, coll, (hx - sgn * 1.2, -5.4, 14.6), 1.2,
                 seg=10, ring=8, mat=M["crack"])
        # 龙身：沿戒圈上弧向两侧盘下
        body = []
        for k in range(17):
            t = k / 16.0
            th = sgn * (0.36 + 2.1 * t)
            body.append(((A_CL + RX_SIDE * 0.55) * math.sin(th),
                         -RY * 0.62,
                         (B_CL + RX_TOPBOT * 0.55) * math.cos(th)))
        G.tube_along("GEO-dragon_body%d" % sgn, body, 3.0, coll, seg=8,
                     mat=M["bronze"])

    # ---------- 背部菱形纹饰 ----------
    G.add_gem("GEO-backplate", coll, (0.0, RY + 0.5, 0.0), 6.2, 5.2, 10.0, n=6,
              mat=M["bronze"])
    G.add_gem("GEO-backgem", coll, (0.0, RY + 1.6, 0.0), 2.2, 2.2, 5.6, n=6,
              mat=M["ruby"])

    # ---------- 内圈铭纹 ----------
    for i in range(12):
        a = math.tau * i / 12
        G.spoke("GEO-inner_engrave%d" % i, coll,
                (0.0, 0.0, -(B_CL - RX_TOPBOT) - 0.2),
                (math.cos(a) * 3.0, -0.2, -(B_CL - RX_TOPBOT) - 0.2 + math.sin(a) * 3.0),
                0.6, 0.2, 0.5, mat=M["bronze"])

    mn, mx, tris = G.asset_bbox(coll)
    print("BUILD obj=%d tris=%d W=%.1f D=%.1f H=%.1f" %
          (len(coll.objects), tris, (mx.x - mn.x) * 1000, (mx.y - mn.y) * 1000,
           (mx.z - mn.z) * 1000))
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print("SAVED", BLEND)
    R.render_ortho(OUT + "/render", "COL_Ring", res=900)
    R.render_beauty(OUT + "/render", "COL_Ring", views=2, res=900)
    R.export_glb(OUT + "/out/fire_ring.glb")


main()
