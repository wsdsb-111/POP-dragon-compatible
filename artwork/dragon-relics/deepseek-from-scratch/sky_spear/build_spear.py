# -*- coding: utf-8 -*-
"""sky_spear 永恒之矛昆古尼尔：从零新建。全长 2300mm。
依据：资料包/参考图/sky_spear.png（正/左/背/整矛展示 + 7 组特写）。
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
BLEND = OUT + "/sky_spear.blend"

H = 2300.0
SHAFT_R = 17.0
HEAD_Z = 1780.0


def clear():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)


def openwork(coll, M, cz, R, tube=7.0, cross=True, ry=1.0, name="ow"):
    """镂空圆环 + 十字星芒。"""
    G.torus("GEO-%s_ring" % name, coll, (0, 0, cz), R, tube, plane='XZ', seg=56,
            ring=10, mat=M["gold"])
    G.torus("GEO-%s_ring2" % name, coll, (0, 0, cz), R * 0.62, tube * 0.6,
            plane='XZ', seg=40, ring=8, mat=M["gold"])
    if cross:
        for i in range(4):
            a = math.tau * i / 4
            G.spoke("GEO-%s_cross%d" % (name, i), coll, (0, 0, cz),
                    (math.cos(a) * R * 1.02, 0.0, cz + math.sin(a) * R * 1.02),
                    8.0, 2.0, 7.0, mat=M["gold"])
    G.sphere("GEO-%s_core" % name, coll, (0, 0, cz), R * 0.20, seg=16, ring=10,
             mat=M["glow_blue"])


def wing(coll, M, sgn, cz, span=95.0):
    """翼形护饰：每侧 7 片扇形羽列（层叠，替换原先 4 片概括刃）。"""
    ox, oz = sgn * 13.0, cz - 34.0
    for k in range(10):
        t = k / 9.0
        ang = math.radians(14.0 + 6.8 * k)          # 扇形张角 16° -> 73°
        L = 126.0 - 9.0 * k
        tipx = ox + sgn * math.cos(ang) * L
        tipz = oz + math.sin(ang) * L
        midx = ox + sgn * math.cos(ang + 0.16) * L * 0.55
        midz = oz + math.sin(ang + 0.16) * L * 0.55 + 6.0
        curlx = tipx + sgn * 10.0
        curlz = tipz + 8.0
        w = 12.5 - 0.9 * k
        G.curved_blade("GEO-wing%d_%d" % (sgn, k),
                       [(ox, 0.0, oz + 2.0 * k), (midx, 0.0, midz),
                        (tipx, 0.0, tipz), (curlx, 0.0, curlz)],
                       w, 6.0 - 0.4 * k, coll, n=16, plane=Vector((0, 1, 0)))


def main():
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0
    clear()
    coll = bpy.data.collections.get("COL_Spear") or bpy.data.collections.new("COL_Spear")
    if coll.name not in sc.collection.children:
        sc.collection.children.link(coll)
    M = G.std_materials()

    # ---------- 矛杆 ----------
    G.taper_cyl("GEO-shaft", coll, (0, 0, 140), (0, 0, HEAD_Z - 30), SHAFT_R,
                SHAFT_R * 0.86, seg=20, mat=M["steel"])
    # 符文槽（蓝光条）
    for k in range(4):
        a = math.tau * k / 4 + 0.4
        pts = [(math.cos(a) * (SHAFT_R + 1.0), math.sin(a) * (SHAFT_R + 1.0),
                220 + i * 300) for i in range(5)]
        G.tube_along("GEO-rune%d" % k, pts, 3.0, coll, seg=5, mat=M["glow_blue"])
    # 金箍
    for z in (240.0, 560.0, 880.0, 1200.0, 1500.0):
        G.torus("GEO-collar%+.0f" % z, coll, (0, 0, z), SHAFT_R + 2.0, 7.0,
                plane='XY', seg=28, ring=8, mat=M["gold"])
        G.torus("GEO-collar_in%+.0f" % z, coll, (0, 0, z), SHAFT_R - 4.0, 3.0,
                plane='XY', seg=24, ring=6, mat=M["gold"])

    # ---------- 中段镂空环 ----------
    openwork(coll, M, 1050.0, 58.0, 6.0, True, name="ow_mid")
    openwork(coll, M, 1420.0, 44.0, 5.0, True, name="ow_low")

    # ---------- 矛头组 ----------
    openwork(coll, M, HEAD_Z + 90.0, 104.0, 9.0, True, name="ow_head")
    for sgn in (-1, 1):
        wing(coll, M, sgn, HEAD_Z + 190.0, 100.0)
    # 主刃（叶形，含符文芯）
    blade_pts = [(0, 0, HEAD_Z + 120), (0, 0, HEAD_Z + 240), (0, 0, HEAD_Z + 380),
                 (0, 0, H - 4)]
    A = Vector((0, 0, 1)); U = Vector((0, 0, 1)); P = Vector((0, 1, 0))
    G.lens_blade("GEO-blade", (0.0, 0.0, (HEAD_Z + 110) * MM), Vector((1, 0, 0)),
                 Vector((0, 0, 1)), Vector((0, 1, 0)), H - HEAD_Z - 110.0,
                 [(0, 0), (0.25, 0.42), (0.6, 0.78), (1.0, 1.0)],
                 [(0, 0), (1, 0)],
                 [(0, 30.0), (0.3, 26.0), (0.6, 18.0), (0.85, 9.0), (1, 0.5)],
                 [(0, 30.0), (0.3, 26.0), (0.6, 18.0), (0.85, 9.0), (1, 0.5)],
                 [(0, 12.0), (0.5, 9.0), (1, 1.0)], n=22, coll=coll)
    for ob in coll.objects:
        if ob.name == "GEO-blade":
            ob.data.materials.append(M["gold"])
    # 刃芯符文（蓝光细条）
    G.lens_blade("GEO-blade_rune", (0.0, -12.0 * MM, (HEAD_Z + 150) * MM),
                 Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, 1, 0)),
                 H - HEAD_Z - 190.0,
                 [(0, 0), (0.5, 0.55), (1, 1.0)], [(0, 0), (1, 0)],
                 [(0, 5.0), (0.5, 3.4), (1, 0.4)], [(0, 5.0), (0.5, 3.4), (1, 0.4)],
                 [(0, 1.6), (1, 0.3)], n=16, coll=coll)
    for ob in coll.objects:
        if ob.name == "GEO-blade_rune":
            ob.data.materials.append(M["crystal_blue"])
    # 刃基双倒钩
    for sgn in (-1, 1):
        G.curved_blade("GEO-barb%d" % sgn,
                       [(sgn * 22, 0, HEAD_Z + 150), (sgn * 58, 0, HEAD_Z + 196),
                        (sgn * 84, 0, HEAD_Z + 236), (sgn * 96, 0, HEAD_Z + 300)],
                       14.0, 9.0, coll, n=18, plane=Vector((0, 1, 0)))

    # ---------- 矛尾 ----------
    G.torus("GEO-pommel_ring", coll, (0, 0, 150), 30.0, 6.0, plane='XZ', seg=24,
            ring=8, mat=M["gold"])
    G.spoke("GEO-pommel_tip", coll, (0, 0, 150), (0, 0, 0), 24.0, 1.0, 22.0,
            mat=M["gold"])
    G.add_gem("GEO-pommel_gem", coll, (0, -14.0, 96.0), 9.0, 7.0, 26.0, n=6,
              mat=M["crystal_blue"])
    for sgn in (-1, 1):
        G.curved_blade("GEO-pommel_wing%d" % sgn,
                       [(sgn * 12, 0, 190), (sgn * 40, 0, 210), (sgn * 56, 0, 244)],
                       9.0, 6.0, coll, n=12, plane=Vector((0, 1, 0)))

    # ---------- 红绸绑带（4 条） ----------
    for sgn in (-1, 1):
        for k in range(2):
            x0 = sgn * (16 + 10 * k)
            pts = [(x0, -8 + 12 * k, HEAD_Z + 40 - 20 * k),
                   (x0 + sgn * 46, -26 - 16 * k, HEAD_Z - 220),
                   (x0 + sgn * 26, -14, HEAD_Z - 520 - 120 * k),
                   (x0 + sgn * 60, 18, HEAD_Z - 800 - 180 * k),
                   (x0 + sgn * 30, 4, HEAD_Z - 1060 - 160 * k)]
            G.ribbon("GEO-ribbon%d_%d" % (sgn, k), coll, pts, 46.0, 3.0,
                     mat=M["silk_red"], n=28)

    mn, mx, tris = G.asset_bbox(coll)
    print("BUILD obj=%d tris=%d W=%.0f D=%.0f H=%.0f" %
          (len(coll.objects), tris, (mx.x - mn.x) * 1000, (mx.y - mn.y) * 1000,
           (mx.z - mn.z) * 1000))
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print("SAVED", BLEND)
    R.render_ortho(OUT + "/render", "COL_Spear", res=900)
    R.render_beauty(OUT + "/render", "COL_Spear", views=2, res=900)
    R.export_glb(OUT + "/out/sky_spear.glb")


main()
