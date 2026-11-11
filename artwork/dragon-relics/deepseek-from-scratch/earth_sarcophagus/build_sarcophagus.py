# -*- coding: utf-8 -*-
"""earth_sarcophagus 常暗地脉石棺：从零新建。长 2660 / 宽 1120 / 高 920 mm。
依据：资料包/参考图/earth_sarcophagus.png（正/侧/背/棺盖俯视 + 分解与剖面）。
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
BLEND = OUT + "/earth_sarcophagus.blend"

L, Wd, Ht = 2660.0, 1120.0, 920.0
BASE_Z = 110.0
BODY_Z = 700.0
LID_Z = 790.0
RIM_Z = 830.0


def clear():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)


def statue(coll, M, x, y, z0, h=380.0, face=-1.0, i=0):
    """壁龛石像：袍摆 + 袍身 + 双肩 + 头 + 兜帽。face=-1 朝 -Y。"""
    G.fluted_robe("GEO-statue_hem_%s" % i, coll, x, y, z0, z0 + h * 0.22,
                  44.0, 34.0, ribs=8, amp=0.05, seg=48, mat=M["stone_light"])
    G.fluted_robe("GEO-statue_body_%s" % i, coll, x, y, z0 + h * 0.20,
                  z0 + h * 0.74, 34.0, 24.0, ribs=6, amp=0.07, seg=44,
                  mat=M["stone_light"])
    G.sphere("GEO-statue_shoulder_%s" % i, coll, (x, y, z0 + h * 0.72), 27.0,
             seg=14, ring=10, mat=M["stone_light"])
    G.sphere("GEO-statue_head_%s" % i, coll, (x, y, z0 + h * 0.86), 16.0, seg=12,
             ring=10, mat=M["stone_light"])
    G.taper_cyl("GEO-statue_hood_%s" % i, coll, (x, y, z0 + h * 0.78),
                (x, y, z0 + h * 1.00), 24.0, 11.0, seg=12, mat=M["stone_light"])
    # 袍褶（两条竖向凹槽用细柱示意）
    for sx in (-1, 1):
        G.spoke("GEO-statue_fold_%s_%d" % (i, sx), coll,
                (x + sx * 11.0, y - face * 24.0, z0 + h * 0.10),
                (x + sx * 8.0, y - face * 20.0, z0 + h * 0.66),
                2.6, 2.0, 2.6, mat=M["stone_dark"])


def gothic_arch(coll, M, cx, cy, z_bottom, w, h, i=0, mat=None):
    """壁龛哥特尖拱框：两侧弧 + 尖端小尖饰。"""
    hw = w * 0.5
    for sgn in (-1, 1):
        pts = [(cx + sgn * hw, cy, z_bottom),
               (cx + sgn * hw * 0.98, cy, z_bottom + h * 0.52),
               (cx + sgn * hw * 0.66, cy, z_bottom + h * 0.86),
               (cx + sgn * hw * 0.18, cy, z_bottom + h * 1.02)]
        o = G.curved_blade("GEO-arch_%s_%d" % (i, sgn), pts, 7.0, 6.0, coll, n=12,
                           plane=Vector((0, 1, 0)))
        o.data.materials.append(mat or M["gold"])
    G.spoke("GEO-arch_finial_%s" % i, coll, (cx, cy, z_bottom + h * 1.0),
            (cx, cy, z_bottom + h * 1.16), 5.0, 0.5, 5.0, mat=mat or M["gold"])


def main():
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0
    clear()
    coll = bpy.data.collections.get("COL_Sarcophagus") or \
        bpy.data.collections.new("COL_Sarcophagus")
    if coll.name not in sc.collection.children:
        sc.collection.children.link(coll)
    M = G.std_materials()
    M["vein_gold"] = G.flat_mat("M-vein_gold", (1.0, 0.62, 0.18), 0.0, 0.35,
                                emission=(1.0, 0.55, 0.12), estr=5.0)
    M["stone_light"] = G.tex_mat("M-stone_light", "Marble012", darken=0.62,
                                 metallic=0.0, tint=(1.0, 0.96, 0.88), proj_scale=1.6)

    # ---------- 基座 ----------
    ob = G.box_bevel("GEO-base", coll, (L, Wd, BASE_Z), (0, 0, BASE_Z / 2),
                     bevel_mm=12.0, seg=2, taper=0.985)
    ob.data.materials.append(M["stone"])
    # ---------- 棺身 ----------
    ob = G.box_bevel("GEO-chest", coll, (L - 80, Wd - 80, BODY_Z - BASE_Z),
                     (0, 0, (BODY_Z + BASE_Z) / 2), bevel_mm=8.0, seg=2)
    ob.data.materials.append(M["stone"])
    # ---------- 棺盖 + 盖沿 ----------
    ob = G.box_bevel("GEO-lid", coll, (L, Wd, LID_Z - BODY_Z),
                     (0, 0, (LID_Z + BODY_Z) / 2), bevel_mm=10.0, seg=2)
    ob.data.materials.append(M["stone"])
    ob = G.box_bevel("GEO-lid_rim", coll, (L - 90, Wd - 90, RIM_Z - LID_Z),
                     (0, 0, (RIM_Z + LID_Z) / 2), bevel_mm=8.0, seg=2)
    ob.data.materials.append(M["stone_light"])
    # 盖沿金线
    for sgn in (-1, 1):
        G.spoke("GEO-rim_edge_y%d" % sgn, coll, (-L / 2 + 50, sgn * (Wd / 2 - 45), RIM_Z + 2),
                (L / 2 - 50, sgn * (Wd / 2 - 45), RIM_Z + 2), 12.0, 12.0, 5.0,
                mat=M["gold"])
        G.spoke("GEO-rim_edge_x%d" % sgn, coll, (sgn * (L / 2 - 45), -Wd / 2 + 50, RIM_Z + 2),
                (sgn * (L / 2 - 45), Wd / 2 - 50, RIM_Z + 2), 12.0, 12.0, 5.0,
                mat=M["gold"])

    # ---------- 侧面壁龛 + 石像 ----------
    n_niche = 7
    for sy in (-1, 1):
        y_face = sy * (Wd / 2 - 40)
        pitch = (L - 300) / n_niche
        for k in range(n_niche):
            x = -L / 2 + 150 + pitch * (k + 0.5)
            ob = G.box_bevel("GEO-niche_%d_%d" % (sy, k), coll,
                             (pitch - 26, 40.0, 400.0),
                             (x, y_face + sy * 2, 370.0), bevel_mm=6.0, seg=1)
            ob.data.materials.append(M["stone_dark"])
            statue(coll, M, x, y_face + sy * 26, 190.0, 370.0, -sy, "%d_%d" % (sy, k))
            gothic_arch(coll, M, x, y_face + sy * 24.0, 572.0, pitch - 34, 118.0,
                        i="%d_%d" % (sy, k), mat=M["gold"])
            # 壁龛金柱
            for ex in (-1, 1):
                G.spoke("GEO-niche_col_%d_%d_%d" % (sy, k, ex), coll,
                        (x + ex * (pitch - 26) / 2, y_face + sy * 20, 170.0),
                        (x + ex * (pitch - 26) / 2, y_face + sy * 20, 580.0),
                        9.0, 7.0, 12.0, mat=M["gold"])
    # 短边壁龛（各 3 个）
    for sx in (-1, 1):
        x_face = sx * (L / 2 - 40)
        for k in range(3):
            y = -Wd / 2 + 200 + (Wd - 400) / 2 * k
            ob = G.box_bevel("GEO-nichex_%d_%d" % (sx, k), coll,
                             (40.0, (Wd - 460) / 3 - 20, 380.0),
                             (x_face + sx * 2, y, 380.0), bevel_mm=6.0, seg=1)
            ob.data.materials.append(M["stone_dark"])
            statue(coll, M, x_face + sx * 24, y, 200.0, 350.0, sx, "x%d_%d" % (sx, k))

    # ---------- 角塔（四角） ----------
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx, cy = sx * (L / 2 - 60), sy * (Wd / 2 - 60)
            G.taper_cyl("GEO-tower_base%d%d" % (sx, sy), coll, (cx, cy, RIM_Z),
                        (cx, cy, RIM_Z + 30), 46.0, 38.0, seg=4, mat=M["gold"])
            G.taper_cyl("GEO-tower_shaft%d%d" % (sx, sy), coll,
                        (cx, cy, RIM_Z + 30), (cx, cy, RIM_Z + 96), 26.0, 16.0,
                        seg=4, mat=M["gold"])
            G.torus("GEO-tower_ring%d%d" % (sx, sy), coll, (cx, cy, RIM_Z + 92),
                    34.0, 5.0, plane='XZ', seg=24, ring=8, mat=M["gold"])
            G.torus("GEO-tower_ring2%d%d" % (sx, sy), coll, (cx, cy, RIM_Z + 92),
                    34.0, 5.0, plane='YZ', seg=24, ring=8, mat=M["gold"])
            G.sphere("GEO-tower_orb%d%d" % (sx, sy), coll, (cx, cy, RIM_Z + 92),
                     16.0, seg=16, ring=10, mat=M["gold"])
            G.spoke("GEO-tower_tip%d%d" % (sx, sy), coll,
                    (cx, cy, RIM_Z + 92), (cx, cy, Ht - 2.0),
                    11.0, 0.6, 11.0, mat=M["gold"])

    # 盖沿珠边（一圈小珠）
    for k in range(90):
        th = math.tau * k / 90
        G.sphere("GEO-rimbead%d" % k, coll,
                 (math.cos(th) * (L / 2 - 26.0), math.sin(th) * (Wd / 2 - 26.0), RIM_Z + 4.0),
                 7.0, seg=12, ring=8, mat=M["gold"])
    # 基座两级线脚
    for k, (dz, shrink) in enumerate(((0.0, 26.0), (16.0, 52.0))):
        ob = G.box_bevel("GEO-plinth%d" % k, coll, (L - shrink * 2, Wd - shrink * 2, 16.0),
                         (0, 0, 8.0 + dz), bevel_mm=5.0, seg=2)
        ob.data.materials.append(M["stone"])

    # ---------- 棺盖：双龙 + 中央符文 ----------
    for sy in (-1, 1):
        pts = []
        radii = []
        for i in range(41):
            t = i / 40.0
            a = math.tau * 1.05 * t + (0.0 if sy > 0 else math.pi)
            r = 210.0 - 90.0 * t
            pts.append((sy * (L * 0.18) + math.cos(a) * r * 1.5,
                        math.sin(a) * r, RIM_Z + 12.0))
            radii.append(36.0 - 22.0 * t)          # 尾细头粗
        G.tube_along("GEO-lid_dragon%d" % sy, pts, 36.0, coll, seg=12,
                     mat=M["stone_light"], radii=radii)
        # 龙头（在蛇尾端）+ 双角 + 下颚
        hx, hy, hz = pts[-1]
        G.curved_blade("GEO-lidhead%d" % sy,
                       [(hx, hy, hz), (hx + sy * 60.0, hy + 40.0, hz + 26.0),
                        (hx + sy * 110.0, hy + 62.0, hz + 34.0)], 44.0, 30.0, coll,
                       n=16, plane=Vector((0, 0, 1)))
        for sgn2 in (-1, 1):
            G.curved_blade("GEO-lidhorn%d_%d" % (sy, sgn2),
                           [(hx + sy * 30.0, hy + 18.0, hz + 14.0),
                            (hx + sy * 20.0, hy + 18.0 + sgn2 * 34.0, hz + 54.0),
                            (hx + sy * 6.0, hy + 18.0 + sgn2 * 52.0, hz + 74.0)],
                           14.0, 10.0, coll, n=12, plane=Vector((0, 0, 1)))
        # 四爪
        for ci in (6, 14, 22, 30):
            cx, cy, cz = pts[ci]
            G.curved_blade("GEO-lidclaw%d_%d" % (sy, ci),
                           [(cx, cy, cz), (cx + 26.0, cy + 34.0, cz - 6.0),
                            (cx + 44.0, cy + 62.0, cz - 2.0)], 12.0, 9.0, coll, n=12,
                           plane=Vector((0, 0, 1)))
        for nm in ["GEO-lidhead%d" % sy, "GEO-lidhorn%d_-1" % sy,
                   "GEO-lidhorn%d_1" % sy] + ["GEO-lidclaw%d_%d" % (sy, ci)
                                              for ci in (6, 14, 22, 30)]:
            for ob in coll.objects:
                if ob.name == nm:
                    ob.data.materials.append(M["stone_light"])
    # 中央符文环
    G.torus("GEO-rune_ring", coll, (0, 0, RIM_Z + 14), 120.0, 10.0, plane='XY',
            seg=48, ring=10, mat=M["gold"])
    G.torus("GEO-rune_ring2", coll, (0, 0, RIM_Z + 14), 78.0, 7.0, plane='XY',
            seg=40, ring=8, mat=M["gold"])
    for i in range(8):
        a = math.tau * i / 8
        G.spoke("GEO-rune_ray%d" % i, coll, (0, 0, RIM_Z + 14),
                (math.cos(a) * 150, math.sin(a) * 150, RIM_Z + 14),
                10.0, 1.0, 7.0, mat=M["gold"])

    # ---------- 地脉金裂（自发光条） ----------
    veins = []
    for k in range(14):
        sx = -1 if k % 2 else 1
        y = sx * (Wd / 2 - 42)
        x0 = -L / 2 + 120 + (L - 240) * (k / 14.0)
        pts = []
        for i in range(5):
            t = i / 4.0
            pts.append((x0 + t * 150 - 75, y,
                        150 + 300.0 * (0.5 - 0.5 * math.cos(t * 3.1 + k))))
        veins.append(G.tube_along("GEO-vein%d" % k, pts, 2.6, coll, seg=5,
                                  mat=M["vein_gold"]))
    # 基座金线
    ob = G.box_bevel("GEO-base_trim", coll, (L - 20, Wd - 20, 12.0),
                     (0, 0, BASE_Z - 24), bevel_mm=4.0, seg=1)
    ob.data.materials.append(M["gold"])

    # 收尾：统一法线 + 清理退化面
    import bmesh as _bm
    for ob in coll.objects:
        m = _bm.new()
        m.from_mesh(ob.data)
        _bm.ops.dissolve_degenerate(m, dist=1e-6, edges=m.edges)
        _bm.ops.recalc_face_normals(m, faces=m.faces)
        # 符号体积用面扇形求和（不三角化原网格，避免非平面 n-gon 三角化引入自交）
        vol = 0.0
        for f in m.faces:
            vs = [v.co for v in f.verts]
            for k in range(1, len(vs) - 1):
                vol += vs[0].dot(vs[k].cross(vs[k + 1])) / 6.0
        if vol < 0:
            _bm.ops.reverse_faces(m, faces=m.faces)
        m.to_mesh(ob.data)
        m.free()
        ob.data.update()

    mn, mx, tris = G.asset_bbox(coll)
    print("BUILD obj=%d tris=%d W=%.0f D=%.0f H=%.0f" %
          (len(coll.objects), tris, (mx.x - mn.x) * 1000, (mx.y - mn.y) * 1000,
           (mx.z - mn.z) * 1000))
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print("SAVED", BLEND)
    R.render_ortho(OUT + "/render", "COL_Sarcophagus", res=900)
    R.render_beauty(OUT + "/render", "COL_Sarcophagus", views=2, res=900)
    R.export_glb(OUT + "/out/earth_sarcophagus.glb")


main()
