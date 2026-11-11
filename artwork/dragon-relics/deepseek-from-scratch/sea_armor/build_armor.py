# -*- coding: utf-8 -*-
"""sea_armor 怒潮海妖之甲（海渊圣遗·神裔礼甲）：从零新建。
图上未标注整体尺寸 —— 按各视图比例建（衣长 1650mm，含披纱包络约 900mm）。
依据：资料包/参考图/sea_armor.png（正/左/背/俯 + 7 组特写）。
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
BLEND = OUT + "/sea_armor.blend"

Z_WAIST = 1050.0
Z_NECK = 1520.0
Z_HEM = 20.0


def clear():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)


def cone_wall(name, coll, z0, z1, r0, r1, seg=72, thick=4.0, mat=None,
              wave=0.0, waven=6, taper_pow=1.0, phase=0.0):
    """椭圆锥面薄壳（r0 在底、r1 在顶；可带波浪下摆）。"""
    verts, faces, loops = [], [], []
    for i in range(seg):
        th = math.tau * i / seg
        t = 0.0
        zb = z0 + wave * math.sin(waven * th + phase)
        cx, sy = math.cos(th), math.sin(th)
        row = []
        for (z, r, off) in ((zb, r0, 0.0), (z1, r1, 0.0)):
            row += [Vector((r * cx, r * sy * 0.86, z)) * MM,
                    Vector(((r - thick) * cx, (r - thick) * sy * 0.86, z)) * MM]
        idx = []
        for v in row:
            idx.append(len(verts)); verts.append(v)
        loops.append(idx)     # [外底, 内底, 外顶, 内顶]
    for i in range(seg):
        A_, B_ = loops[i], loops[(i + 1) % seg]
        faces.append([A_[0], B_[0], B_[2], A_[2]])      # 外面
        faces.append([A_[3], B_[3], B_[1], A_[1]])      # 内面
        faces.append([A_[1], B_[1], B_[0], A_[0]])      # 下摆
        faces.append([A_[2], B_[2], B_[3], A_[3]])      # 上口
    ob = G.mesh_from(name, verts, faces, coll)
    if mat:
        ob.data.materials.append(mat)
    return ob


def loft_wall(name, coll, sections, seg=64, thick=6.0, mat=None, wave=0.0, waven=6):
    """多截面闭合薄壳。sections: [(z, rx, ry), ...] 自下而上。"""
    verts, faces, loops = [], [], []
    n = len(sections)
    for i in range(n):
        z, rx, ry = sections[i]
        row = []
        for k in range(seg):
            th = math.tau * k / seg
            zz = z + (wave * math.sin(waven * th) if i == 0 else 0.0)
            cx, sy = math.cos(th), math.sin(th)
            row += [Vector((rx * cx, ry * sy, zz)) * MM,
                    Vector(((rx - thick) * cx, (ry - thick) * sy, zz)) * MM]
        idx = []
        for v in row:
            idx.append(len(verts)); verts.append(v)
        loops.append(idx)
    for i in range(n - 1):
        A_, B_ = loops[i], loops[i + 1]
        for k in range(seg):
            kn = (k + 1) % seg
            a0, a1 = A_[2 * k], A_[2 * k + 1]
            b0, b1 = B_[2 * k], B_[2 * k + 1]
            a0n, a1n = A_[2 * kn], A_[2 * kn + 1]
            b0n, b1n = B_[2 * kn], B_[2 * kn + 1]
            faces.append([a0, a0n, b0n, b0])
            faces.append([a1, b1, b1n, a1n])
    bottom, top = loops[0], loops[-1]
    for k in range(seg):
        kn = (k + 1) % seg
        faces.append([bottom[2 * k], bottom[2 * k + 1], bottom[2 * kn + 1], bottom[2 * kn]])
        faces.append([top[2 * k], top[2 * kn], top[2 * kn + 1], top[2 * k + 1]])
    ob = G.mesh_from(name, verts, faces, coll)
    if mat:
        ob.data.materials.append(mat)
    return ob


def panel(name, coll, z0, z1, r0, r1, th0, th1, seg=24, thick=4.0, mat=None):
    """局部锥面壳（前中白裙片/侧片用）。"""
    verts, faces, loops = [], [], []
    for i in range(seg + 1):
        th = th0 + (th1 - th0) * i / seg
        cx, sy = math.cos(th), math.sin(th)
        row = []
        for (z, r) in ((z0, r0), (z1, r1)):
            row += [Vector((r * cx, r * sy * 0.86, z)) * MM,
                    Vector(((r - thick) * cx, (r - thick) * sy * 0.86, z)) * MM]
        idx = []
        for v in row:
            idx.append(len(verts)); verts.append(v)
        loops.append(idx)
    for i in range(seg):
        A_, B_ = loops[i], loops[i + 1]
        faces.append([A_[0], B_[0], B_[2], A_[2]])
        faces.append([A_[3], B_[3], B_[1], A_[1]])
        faces.append([A_[1], B_[1], B_[0], A_[0]])
        faces.append([A_[2], B_[2], B_[3], A_[3]])
    faces.append([loops[0][0], loops[0][1], loops[0][3], loops[0][2]])
    faces.append([loops[-1][2], loops[-1][3], loops[-1][1], loops[-1][0]])
    ob = G.mesh_from(name, verts, faces, coll)
    if mat:
        ob.data.materials.append(mat)
    return ob


def pauldron(coll, M, sgn):
    """龙首肩甲。"""
    cx = sgn * 214.0
    cz = 1452.0
    # 龙首主体（吻部朝外下）
    G.curved_blade("GEO-pauld_head%d" % sgn,
                   [(cx - sgn * 30, -18, cz + 60), (cx + sgn * 10, -34, cz + 26),
                    (cx + sgn * 58, -30, cz - 12), (cx + sgn * 92, -18, cz - 46)],
                   54.0, 38.0, coll, n=18, plane=Vector((0, 1, 0)))
    for ob in coll.objects:
        if ob.name == "GEO-pauld_head%d" % sgn:
            ob.data.materials.append(M["gold"])
    # 犄角
    for k, a in enumerate((-0.5, 0.4)):
        G.curved_blade("GEO-pauld_horn%d_%d" % (sgn, k),
                       [(cx - sgn * 26, -10, cz + 64), (cx - sgn * 54, 6, cz + 108),
                        (cx - sgn * 70, 20, cz + 140)], 9.0, 7.0, coll, n=14,
                       plane=Vector((0, 1, 0)))
    # 层叠鳞片
    for k in range(4):
        G.sphere("GEO-pauld_scale%d_%d" % (sgn, k), coll,
                 (cx - sgn * (10 + 26 * k), -40 - 5 * k, cz + 34 - 12 * k),
                 22.0 - 2.5 * k, seg=12, ring=8, mat=M["gold"])
    # 珍珠 + 蓝晶垂饰
    G.sphere("GEO-pauld_pearl%d" % sgn, coll, (cx + sgn * 6, -46, cz - 24), 13.0,
             seg=14, ring=10, mat=M["pearl"])
    G.add_gem("GEO-pauld_gem%d" % sgn, coll, (cx + sgn * 20, -40, cz - 96),
              9.0, 8.0, 34.0, n=6, mat=M["crystal_blue"])


def main():
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0
    clear()
    coll = bpy.data.collections.get("COL_Armor") or bpy.data.collections.new("COL_Armor")
    if coll.name not in sc.collection.children:
        sc.collection.children.link(coll)
    M = G.std_materials()
    M["cloth_white2"] = G.tex_mat("M-cloth_white2", "Fabric030", darken=1.0,
                                  metallic=0.0, tint=(1.02, 1.02, 1.05), proj_scale=3.0)
    M["cloth_blue"] = G.tex_mat("M-cloth_blue", "Fabric030", darken=0.80, metallic=0.0,
                                tint=(0.24, 0.38, 0.80), proj_scale=2.6)
    M["veil_blue"] = G.tex_mat("M-veil_blue", "Fabric030", darken=0.85, metallic=0.0,
                               tint=(0.35, 0.55, 0.95), proj_scale=2.4)
    M["veil_blue"].surface_render_method = 'BLENDED'
    _b = M["veil_blue"].node_tree.nodes["Principled BSDF"]
    _b.inputs["Alpha"].default_value = 0.34
    M["veil_white"] = G.tex_mat("M-veil_white", "Fabric030", darken=1.0, metallic=0.0,
                                tint=(1.05, 1.05, 1.10), proj_scale=2.4)
    M["veil_white"].surface_render_method = 'BLENDED'
    _b = M["veil_white"].node_tree.nodes["Principled BSDF"]
    _b.inputs["Alpha"].default_value = 0.40

    # ---------- 长裙 ----------
    loft_wall("GEO-skirt_white", coll,
              [(Z_HEM, 392.0, 337.0), (240.0, 352.0, 303.0), (520.0, 300.0, 258.0),
               (780.0, 240.0, 206.0), (950.0, 190.0, 163.0), (Z_WAIST, 152.0, 131.0)],
              seg=80, thick=5.0, mat=M["cloth_white2"], wave=26.0, waven=6)
    loft_wall("GEO-skirt_blue", coll,
              [(Z_HEM + 60.0, 418.0, 359.0), (280.0, 372.0, 320.0), (560.0, 316.0, 272.0),
               (820.0, 252.0, 217.0), (Z_WAIST - 10.0, 168.0, 145.0)],
              seg=80, thick=4.0, mat=M["cloth_blue"], wave=34.0, waven=5)
    # 前中白裙片 + 金边（对应三视图白色主裙面）
    panel("GEO-apron", coll, 26.0, Z_WAIST - 10.0, 434.0, 178.0, -0.62, 0.62,
          seg=26, thick=5.0, mat=M["cloth_white2"])
    for sgn in (-1, 1):
        pts = []
        for i in range(21):
            t = i / 20.0
            th = sgn * 0.62
            r = 434.0 + (178.0 - 434.0) * t
            pts.append((r * math.cos(th) * 1.01, r * math.sin(th) * 0.86 * 1.01,
                        30.0 + (Z_WAIST - 50.0) * t))
        G.tube_along("GEO-apron_trim%d" % sgn, pts, 5.0, coll, seg=6, mat=M["gold"])
    # 裙摆金边 + 浪纹
    for k, (rr, zz, wv) in enumerate(((404.0, 40.0, 24.0), (424.0, 96.0, 30.0))):
        G.ring_tube("GEO-hem_trim%d" % k, coll, rr, rr * 0.86,
                    (lambda th, zz=zz, wv=wv, k=k: zz + wv * math.sin(6 * th + k * 0.5)),
                    5.0, seg=180, ring=8, mat=M["gold"])

    # ---------- 胸甲 ----------
    loft_wall("GEO-bodice", coll,
              [(Z_WAIST, 152.0, 131.0), (1120.0, 156.0, 134.0), (1200.0, 168.0, 143.0),
               (1290.0, 186.0, 156.0), (1370.0, 198.0, 165.0), (1430.0, 196.0, 163.0),
               (1478.0, 168.0, 141.0), (Z_NECK, 118.0, 102.0)],
              seg=64, thick=9.0, mat=M["cloth_white2"])
    # 胸部白甲片（前凸）
    for sgn in (-1, 1):
        G.sphere("GEO-bust%d" % sgn, coll, (sgn * 56.0, -104.0, 1330.0), 72.0,
                 seg=22, ring=14, mat=M["cloth_white2"])
    # 金色胸饰（V 形 + 珍珠 + 蓝晶）
    for sgn in (-1, 1):
        G.curved_blade("GEO-chest_trim%d" % sgn,
                       [(0, -168, 1250), (sgn * 70, -150, 1310),
                        (sgn * 104, -110, 1420), (sgn * 84, -96, 1490)],
                       16.0, 9.0, coll, n=18, plane=Vector((0, 1, 0)))
    G.sphere("GEO-chest_pearl", coll, (0.0, -186.0, 1300.0), 26.0, seg=18, ring=12,
             mat=M["pearl"])
    G.torus("GEO-chest_ring", coll, (0.0, -186.0, 1300.0), 30.0, 5.0, plane='XZ',
            seg=28, ring=8, mat=M["gold"])
    G.add_gem("GEO-chest_gem", coll, (0.0, -178.0, 1240.0), 14.0, 10.0, 40.0, n=6,
              mat=M["crystal_blue"])
    # 领口
    G.torus("GEO-collar", coll, (0.0, 0.0, Z_NECK + 4), 92.0, 12.0, plane='XY',
            seg=40, ring=10, mat=M["gold"])
    G.torus("GEO-collar2", coll, (0.0, 0.0, Z_NECK + 24), 78.0, 8.0, plane='XY',
            seg=36, ring=8, mat=M["gold"])

    # ---------- 腰带 + 垂饰 ----------
    G.torus("GEO-belt", coll, (0.0, 0.0, Z_WAIST + 16), 160.0, 13.0, plane='XY',
            seg=48, ring=10, mat=M["gold"])
    G.add_gem("GEO-belt_gem", coll, (0.0, -152.0, Z_WAIST + 10), 16.0, 12.0, 44.0,
              n=6, mat=M["crystal_blue"])
    for sgn in (-1, 1):
        for k in range(4):
            G.add_gem("GEO-waist_drop%d_%d" % (sgn, k), coll,
                      (sgn * (52 + 46 * k), -150.0, Z_WAIST - 40 - 30 * k),
                      8.0, 7.0, 30.0, n=6, mat=M["crystal_blue"])
    # 腰前金 V 饰（三视图腰饰）
    for sgn in (-1, 1):
        pts = [(0.0, -176.0, Z_WAIST - 8.0), (sgn * 52.0, -168.0, Z_WAIST + 20.0),
               (sgn * 96.0, -140.0, Z_WAIST + 56.0)]
        o = G.curved_blade("GEO-waistV%d" % sgn, pts, 13.0, 8.0, coll, n=16,
                           plane=Vector((0, 1, 0)))
        o.data.materials.append(M["gold"])
    # 裙身第二道金饰带
    G.ring_tube("GEO-skirt_band", coll, 352.0, 352.0 * 0.86,
                (lambda th: 470.0), 4.0, seg=180, ring=8, mat=M["gold"])

    # 珍珠链（肩到腰）
    for sgn in (-1, 1):
        for i in range(18):
            t = i / 17.0
            x = sgn * (120 + 60 * math.sin(math.pi * t))
            y = -150 + 40 * t
            z = 1470 - 380 * t
            G.sphere("GEO-chainpearl%d_%d" % (sgn, i), coll, (x, y, z), 7.0,
                     seg=12, ring=8, mat=M["pearl"])

    # ---------- 肩甲 ----------
    for sgn in (-1, 1):
        pauldron(coll, M, sgn)

    # ---------- 披纱（半透明多层） ----------
    for k, (ang, ztop, wd, matk, ln) in enumerate((
            (74.0, 1478.0, 158.0, "veil_blue", 1.00),
            (-74.0, 1478.0, 158.0, "veil_blue", 1.00),
            (112.0, 1470.0, 176.0, "veil_white", 1.05),
            (-112.0, 1470.0, 176.0, "veil_white", 1.05),
            (150.0, 1462.0, 166.0, "veil_blue", 1.02),
            (-150.0, 1462.0, 166.0, "veil_blue", 1.02))):
        a = math.radians(ang)
        r0, r1 = 190.0, 430.0
        pts = [(r0 * math.sin(a), -r0 * math.cos(a), ztop),
               (r0 * 1.25 * math.sin(a), -r0 * 1.25 * math.cos(a), ztop - 420),
               (r1 * 0.85 * math.sin(a), -r1 * 0.85 * math.cos(a), ztop - 900),
               (r1 * math.sin(a), -r1 * math.cos(a), ztop - 1300 * ln),
               (r1 * 0.9 * math.sin(a), -r1 * 0.9 * math.cos(a), 40.0)]
        G.ribbon("GEO-veil%d" % k, coll, pts, wd, 2.5, mat=M[matk], n=28)

    # ---------- 背部纹饰 ----------
    for sgn in (-1, 1):
        G.curved_blade("GEO-back_trim%d" % sgn,
                       [(0, 150, 1200), (sgn * 70, 140, 1300), (sgn * 110, 110, 1420)],
                       14.0, 8.0, coll, n=16, plane=Vector((0, 1, 0)))
    G.add_gem("GEO-back_gem", coll, (0.0, 150.0, 1240.0), 14.0, 10.0, 38.0, n=6,
              mat=M["crystal_blue"])

    mn, mx, tris = G.asset_bbox(coll)
    print("BUILD obj=%d tris=%d W=%.0f D=%.0f H=%.0f" %
          (len(coll.objects), tris, (mx.x - mn.x) * 1000, (mx.y - mn.y) * 1000,
           (mx.z - mn.z) * 1000))
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print("SAVED", BLEND)
    R.render_ortho(OUT + "/render", "COL_Armor", res=900)
    R.render_beauty(OUT + "/render", "COL_Armor", views=2, res=900)
    R.export_glb(OUT + "/out/sea_armor.glb")


main()
