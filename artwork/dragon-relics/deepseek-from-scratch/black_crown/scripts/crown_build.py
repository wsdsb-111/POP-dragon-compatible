# -*- coding: utf-8 -*-
"""black_crown 成品构建（阶段B）：冠体+黑鳞+弯曲冠刺+金边+火焰金饰+龙首+红宝石+材质。
说明：catalog 的 material_build 只覆盖程序化 preset，不含本地 ambientCG CC0 贴图集，
故贴图材质在此自建节点树（理由已记录）；几何仍走 audit/qc 门验收。
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import crown_geo as G
from crown_geo import MM, Z

OUT = os.path.dirname(HERE)
BLEND = OUT + "/black_crown.blend"
MATDIR = r"./artwork/dragon-relics/materials-cc0"

# ---------------- SPEC ----------------
RING_A, RING_B, RING_WALL = 192.0, 176.0, 30.0
BAND_Z0 = 20.0
P_K = 0.45

H_PROF = [(0.0, 0.0), (0.15, 0.26), (0.35, 0.52), (0.58, 0.74), (0.78, 0.90),
          (0.92, 0.975), (1.0, 1.0)]
LAT_PROF = [(0.0, 0.0), (0.28, 0.04), (0.52, 0.12), (0.72, 0.34), (0.86, 0.66), (1.0, 1.0)]
W_OUT = [(0.0, 0.90), (0.15, 1.0), (0.35, 1.02), (0.55, 0.84), (0.72, 0.56),
         (0.86, 0.26), (0.95, 0.08), (1.0, 0.0)]
W_IN = [(0.0, 0.78), (0.15, 0.86), (0.35, 0.80), (0.55, 0.56), (0.72, 0.34),
        (0.86, 0.16), (1.0, 0.0)]
T_PROF = [(0.0, 9.0), (0.25, 7.0), (0.5, 4.5), (0.75, 2.4), (0.9, 1.0), (1.0, 0.2)]

# name, theta, h(尖端 z), wb, lean, lat(钩出), material
SPIKES = [
    ("C0", 0.0,   380.0, 30.0, 2.0,  0.0, "dark"),
    ("F1", 16.0,  268.0, 14.0, 7.0,  30.0, "gold"),
    ("T2", 38.0,  342.0, 40.0, 10.0, 54.0, "dark"),
    ("H3", 62.0,  276.0, 15.0, 16.0, 46.0, "gold"),
    ("T4", 82.0,  232.0, 30.0, 26.0, 40.0, "dark"),
    ("K5", 108.0, 158.0, 14.0, 36.0, 26.0, "gold"),
    ("C6", 180.0, 314.0, 28.0, -2.0, 0.0, "dark"),
]
# 金火焰舌 (theta0, z0, theta1, z1, bulge, half_w, half_t)
FLAMES = [
    (9.0, 132.0, 13.0, 300.0, 4.0, 10.0, 6.0),
    (26.0, 108.0, 34.0, 246.0, 9.0, 13.0, 7.0),
    (44.0, 100.0, 58.0, 214.0, 12.0, 14.0, 7.0),
    (66.0, 96.0, 84.0, 186.0, 14.0, 16.0, 8.0),
    (92.0, 92.0, 112.0, 152.0, 10.0, 12.0, 7.0),
    (118.0, 90.0, 138.0, 120.0, 8.0, 9.0, 6.0),
    (20.0, 74.0, 8.0, 168.0, 6.0, 11.0, 6.0),
    (40.0, 66.0, 30.0, 150.0, 8.0, 12.0, 7.0),
    (72.0, 62.0, 62.0, 132.0, 10.0, 13.0, 7.0),
    (100.0, 60.0, 96.0, 116.0, 8.0, 11.0, 6.0),
    (140.0, 58.0, 150.0, 100.0, 6.0, 9.0, 5.0),
    (166.0, 96.0, 176.0, 150.0, 6.0, 12.0, 6.0),
]
PEAKS = [(0.0, 150.0, 10.0), (38.0, 122.0, 16.0), (62.0, 84.0, 13.0),
         (82.0, 62.0, 12.0), (108.0, 34.0, 14.0), (180.0, 120.0, 14.0)]
Z_BASE_TOP = 118.0


def z_top(theta_deg):
    z = Z_BASE_TOP
    for c, amp, wid in PEAKS:
        cands = (c,) if c in (0.0, 180.0) else (c, -c)
        for cand in cands:
            d = ((theta_deg - cand + 180.0) % 360.0) - 180.0
            z += amp * math.exp(-(d / wid) ** 2)
    return z


def surface_pt(th, z, off=0.0):
    """冠体外表面点(m)与法线。"""
    a, b = RING_A + off, RING_B + off
    p = Vector((a * math.sin(th) * MM, -b * math.cos(th) * MM, z * MM))
    n = Vector((math.sin(th) / a, -math.cos(th) / b, 0.0)).normalized()
    return p, n


# ---------------- 材质 ----------------
def _img(mat, path, non_color, proj_scale=7.0, name="Tex"):
    nt = mat.node_tree
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (proj_scale, proj_scale, proj_scale)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(path, check_existing=True)
    tex.projection = 'BOX'
    tex.projection_blend = 0.25
    tex.name = name
    if non_color:
        tex.image.colorspace_settings.name = 'Non-Color'
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], tex.inputs["Vector"])
    return tex


def make_materials():
    mats = {}
    # 金色 = Metal042A
    m = bpy.data.materials.new("M-gold")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    c = _img(m, MATDIR + "/Metal042A/Metal042A_2K-PNG_Color.png", False)
    r = _img(m, MATDIR + "/Metal042A/Metal042A_2K-PNG_Roughness.png", True)
    me = _img(m, MATDIR + "/Metal042A/Metal042A_2K-PNG_Metalness.png", True)
    n = _img(m, MATDIR + "/Metal042A/Metal042A_2K-PNG_NormalGL.png", True)
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(c.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(r.outputs["Color"], bsdf.inputs["Roughness"])
    nt.links.new(me.outputs["Color"], bsdf.inputs["Metallic"])
    nt.links.new(n.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    mats["gold"] = m
    # 暗金 = Metal042B
    m = bpy.data.materials.new("M-darkgold")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    c = _img(m, MATDIR + "/Metal042B/Metal042B_2K-PNG_Color.png", False)
    r = _img(m, MATDIR + "/Metal042B/Metal042B_2K-PNG_Roughness.png", True)
    n = _img(m, MATDIR + "/Metal042B/Metal042B_2K-PNG_NormalGL.png", True)
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(c.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(r.outputs["Color"], bsdf.inputs["Roughness"])
    bsdf.inputs["Metallic"].default_value = 1.0
    nt.links.new(n.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    mats["darkgold"] = m
    # 黑鳞 = Metal046A 压暗
    m = bpy.data.materials.new("M-blackscale")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    c = _img(m, MATDIR + "/Metal046A/Metal046A_2K-PNG_Color.png", False)
    r = _img(m, MATDIR + "/Metal046A/Metal046A_2K-PNG_Roughness.png", True)
    n = _img(m, MATDIR + "/Metal046A/Metal046A_2K-PNG_NormalGL.png", True)
    nm = nt.nodes.new("ShaderNodeNormalMap")
    hs = nt.nodes.new("ShaderNodeHueSaturation")
    hs.inputs["Value"].default_value = 0.075
    hs.inputs["Saturation"].default_value = 0.55
    nt.links.new(c.outputs["Color"], hs.inputs["Color"])
    ram = nt.nodes.new("ShaderNodeValToRGB")
    nt.links.new(r.outputs["Color"], ram.inputs["Fac"])
    nt.links.new(hs.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(ram.outputs["Color"], bsdf.inputs["Roughness"])
    bsdf.inputs["Metallic"].default_value = 0.32
    nt.links.new(n.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    mats["dark"] = m
    # 红宝石
    m = bpy.data.materials.new("M-ruby")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.42, 0.012, 0.008, 1.0)
    b.inputs["Metallic"].default_value = 0.0
    b.inputs["Roughness"].default_value = 0.08
    b.inputs["IOR"].default_value = 1.78
    if "Transmission Weight" in b.inputs:
        b.inputs["Transmission Weight"].default_value = 0.55
    b.inputs["Emission Color"].default_value = (0.55, 0.02, 0.01, 1.0)
    b.inputs["Emission Strength"].default_value = 0.55
    mats["ruby"] = m
    # 熔裂发光
    m = bpy.data.materials.new("M-crack")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.6, 0.05, 0.01, 1.0)
    b.inputs["Emission Color"].default_value = (1.0, 0.12, 0.03, 1.0)
    b.inputs["Emission Strength"].default_value = 14.0
    b.inputs["Roughness"].default_value = 0.5
    mats["crack"] = m
    return mats


# ---------------- 部件 ----------------
def build_spikes(coll, mats, defaults):
    rim_chunks = []
    for name, theta, h, wb, lean, lat, matk in SPIKES:
        th = math.radians(theta)
        bx = (RING_A - RING_WALL * 0.5) * math.sin(th)
        by = -(RING_B - RING_WALL * 0.5) * math.cos(th)
        bz = max(z_top(theta) - 26.0, BAND_Z0 + 20.0)
        base = (bx * MM, by * MM, bz * MM)
        radial = Vector((math.sin(th), -math.cos(th), 0.0))
        A, U, P = G.blade_frame(radial, P_K, lean)
        w_in = [(u, v * wb) for u, v in W_IN]
        w_out = [(u, v * wb) for u, v in W_OUT]
        lat_c = [(u, v * lat) for u, v in LAT_PROF]
        h_local = max((h - bz) / max(math.cos(math.radians(lean)), 0.2), 10.0)
        ob, edges = G.lens_blade("GEO-SPK_" + name, base, A, U, P, h_local,
                                 H_PROF, lat_c, w_in, w_out, T_PROF,
                                 n=34, coll=coll, return_edges=True)
        ob.data.materials.append(mats[matk])
        # 外缘倒钩（大刃才有）
        if wb >= 28.0 and edges:
            eo = edges["out"]
            for bi, ui in enumerate((0.46, 0.64)):
                k = int(ui * (len(eo) - 1))
                p0 = eo[k] / MM   # 转回 mm（curved_blade 吃 mm）
                barb = [tuple(p0),
                        tuple(p0 + A * 26.0 + U * 20.0),
                        tuple(p0 + A * 40.0 + U * 52.0)]
                bb = G.curved_blade("GEO-BARB_%s_%d" % (name, bi), barb, 11.0, 6.0,
                                    coll, n=12, plane=P)
                bb.data.materials.append(mats[matk])
        # 金边管沿外缘
        # 金边只在"大刃"上加（K5/T4 侧向钩太急，镶管会自折）；T4 只镶到 55%
        rim_frac = 0.72 if name in ("C0", "C6", "T2") else 0.55
        has_rim = matk == "dark" and name not in ("K5",)
        pts = edges["out"][:max(3, int(len(edges["out"]) * rim_frac))] if has_rim else []
        if len(pts) >= 3:
            rim_chunks.append(G.tube_along("GEO-RIM_" + name, pts, 2.2, coll, seg=8))
        if abs(theta) > 1e-6:
            for o in list(coll.objects):
                pass
            ml = G.mirror_x(ob, "GEO-SPK_%sL" % name, coll)
            ml.data.materials.append(mats[matk])
            if len(pts) >= 3:
                mir = rim_chunks[-1]
                rl = G.mirror_x(mir, "GEO-RIM_%sL" % name, coll)
                rl.data.materials.append(mats["gold"])
        if rim_chunks:
            rim_chunks[-1].data.materials.append(mats["gold"])
    return rim_chunks


def build_flames(coll, mats):
    for i, (t0, z0, t1, z1, bulge, w0, th0) in enumerate(FLAMES):
        thm = math.radians((t0 + t1) * 0.5)
        plane = Vector((math.sin(thm), -math.cos(thm), 0.0))
        pts = []
        for t in (0.0, 0.34, 0.68, 1.0):
            th = math.radians(t0 + (t1 - t0) * t)
            z = z0 + (z1 - z0) * t
            bb = 1.0 + (bulge / 100.0) * math.sin(math.pi * t)
            pts.append(((RING_A + 5.0) * math.sin(th) * bb,
                        -(RING_B + 5.0) * math.cos(th) * bb, z))
        m = G.curved_blade("GEO-FLM_%02d" % i, pts, w0 * 1.38, th0 * 1.30,
                           coll, n=24, plane=plane)
        m.data.materials.append(mats["gold"])
        ml = G.mirror_x(m, "GEO-FLM_%02dL" % i, coll)
        ml.data.materials.append(mats["gold"])


def build_scales(coll, mats):
    groups = [[], [], [], [], [], []]
    row_z = 40.0
    row = 0
    while row_z < 260.0:
        dth = 19.0 / ((RING_A + RING_B) * 0.5) * (180.0 / math.pi)   # 19mm 弧长
        off = (dth * 0.5) if row % 2 else 0.0
        off += dth * 0.22 * ((row // 3) % 2)   # 每 3 行再错一次相位
        th = -170.0 + off
        while th <= 170.0:
            zt = z_top(th)
            if row_z < zt - 1.0:
                # 逐片伪随机抖动（尺寸/高度/侧倾），脱开规则栅格
                jit = (math.sin(row * 12.9898 + th * 78.233) * 43758.5453) % 1.0
                zz = row_z + (jit - 0.5) * 3.0
                p, n = surface_pt(math.radians(th), zz, 1.2)
                tang = Vector((math.cos(math.radians(th)),
                               math.sin(math.radians(th)), 0.0))
                Td = (-Z + tang * (0.16 * (jit - 0.5))).normalized()
                w, L = 12.5, 17.0
                span_scale = (1.0 + 0.30 * max(0.0, (row_z - 140.0) / 120.0))                     * (0.86 + 0.30 * jit)
                v, f = G.scale_plate_geo(p, Td, n, w * span_scale, L * span_scale,
                                         1.2, 1.6)
                groups[row % 6].append((v, f))
            th += dth
        row_z += 9.5
        row += 1
    for gi, gp in enumerate(groups):
        if gp:
            ob = G.merge_geo("GEO-scales_%d" % gi, gp, coll)
            ob.data.materials.append(mats["dark"])
    # 熔裂发光条（鳞缝间红光）
    crack = []
    row_z = 46.0
    k = 0
    while row_z < 230.0:
        th = -160.0
        while th <= 160.0:
            if row_z < z_top(th) - 12.0 and (k % 7 == 3):
                p, n = surface_pt(math.radians(th), row_z, 2.0)
                d = 26.0
                for s in (-0.5, 0.5):
                    q = p + Vector((math.cos(math.radians(th)) * s * d,
                                    math.sin(math.radians(th)) * s * d, 0.0)) * MM
                    v, f = G.scale_plate_geo(q, Z, n, 2.6, 16.0, 1.6, 0.8)
                    crack.append((v, f))
            th += 12.0
            k += 1
        row_z += 19.0
    if crack:
        ob2 = G.merge_geo("GEO-cracks", crack, coll)
        ob2.data.materials.append(mats["crack"])


def build_trim(coll, mats):
    """前下方金色弧形饰带（中心下垂）+ 底部内金带。"""
    pts = []
    for i in range(61):
        t = -1.0 + 2.0 * i / 60.0
        th = math.radians(96.0 * t)
        dip = 34.0 * (1.0 - abs(t) ** 1.6)
        z = 58.0 - dip + 6.0
        p, n = surface_pt(th, z, 4.0)
        pts.append(p)
    ob = G.tube_along("GEO-trim_front", pts, 5.5, coll, seg=8)
    ob.data.materials.append(mats["gold"])
    # 内圈金带
    inner = G.torus_ellipse("GEO-band_inner", coll, RING_A - RING_WALL + 4.0,
                            RING_B - RING_WALL + 4.0, 52.0, 7.0, seg=96, ring=8)
    inner.data.materials.append(mats["gold"])
    # 底部前沿垂饰（V 形金片）
    for sgn in (-1, 1):
        pts2 = [(sgn * 6.0, -172.0, 60.0), (sgn * 26.0, -170.0, 44.0),
                (sgn * 40.0, -166.0, 26.0), (sgn * 46.0, -160.0, 8.0)]
        o2 = G.curved_blade("GEO-trim_drop%+d" % sgn, pts2, 11.0, 5.0, coll, n=16,
                            plane=Vector((0, -1, 0)))
        o2.data.materials.append(mats["gold"])


    # 前中心金 V 冠饰（三视图正面最显眼的金色 V 形）
    for sgn in (-1, 1):
        pts = [(sgn * 14.0, -168.0, 62.0), (sgn * 44.0, -176.0, 116.0),
               (sgn * 86.0, -172.0, 176.0), (sgn * 118.0, -160.0, 232.0),
               (sgn * 104.0, -150.0, 262.0)]
        v = G.curved_blade("GEO-crestV%d" % sgn, pts, 17.0, 10.0, coll, n=22,
                           plane=Vector((0, 1, 0)))
        v.data.materials.append(mats["gold"])
        # 内侧小卷
        pts2 = [(sgn * 10.0, -166.0, 96.0), (sgn * 34.0, -172.0, 146.0),
                (sgn * 26.0, -168.0, 186.0), (sgn * 46.0, -162.0, 210.0)]
        v2 = G.curved_blade("GEO-crestV_in%d" % sgn, pts2, 9.0, 6.0, coll, n=16,
                            plane=Vector((0, 1, 0)))
        v2.data.materials.append(mats["gold"])

def build_head(coll, mats):
    """前中心龙首（额、吻、角、眼）。"""
    # 面盘
    A = Vector((1, 0, 0))
    U = Vector((0, 0, 1))
    P = Vector((0, -1, 0))
    face, fe = G.lens_blade("GEO-head_face", (0.0, -178.0 * MM, 62.0 * MM), A, U, P,
                            96.0, [(0, 0), (1, 1)], [(0, 0), (1, 0)],
                            [(0, 26.0), (0.3, 34.0), (0.62, 30.0), (0.86, 18.0), (1, 6.0)],
                            [(0, 26.0), (0.3, 34.0), (0.62, 30.0), (0.86, 18.0), (1, 6.0)],
                            [(0, 14.0), (0.4, 16.0), (0.75, 9.0), (1, 3.0)],
                            n=18, coll=coll, return_edges=True)
    face.data.materials.append(mats["gold"])
    # 吻部（前伸下钩）
    snout = G.curved_blade("GEO-head_snout",
                           [(0, -186, 96), (0, -196, 78), (0, -198, 58), (0, -190, 40)],
                           13.0, 9.0, coll, n=16, plane=Vector((0, -1, 0)))
    snout.data.materials.append(mats["gold"])
    # 双角
    for sgn in (-1, 1):
        horn = G.curved_blade("GEO-head_horn%+d" % sgn,
                              [(sgn * 22, -180, 150), (sgn * 34, -186, 172),
                               (sgn * 40, -180, 196), (sgn * 30, -172, 214),
                               (sgn * 18, -168, 224)],
                              8.0, 6.0, coll, n=20, plane=Vector((0, 1, 0)))
        horn.data.materials.append(mats["gold"])
        # 眉脊
        brow = G.curved_blade("GEO-head_brow%+d" % sgn,
                              [(sgn * 4, -186, 138), (sgn * 20, -190, 146),
                               (sgn * 32, -184, 150)], 7.0, 5.0, coll, n=12,
                              plane=Vector((0, -1, 0)))
        brow.data.materials.append(mats["gold"])
        # 眼
        G.add_gem("GEO-eye%+d" % sgn, coll, (sgn * 20.0, -196.0, 132.0),
                  7.0, 5.0, 12.0, rot_z=0.0, n=6, mat=mats["ruby"])
    # 龙首下宝石
    G.add_gem("GEO-gem_front", coll, (0.0, -196.0, 54.0), 16.0, 13.0, 34.0, n=8,
              mat=mats["ruby"])
    for sgn in (-1, 1):
        G.add_gem("GEO-gem_side%+d" % sgn, coll, (sgn * 56.0, -188.0, 40.0),
                  9.0, 8.0, 20.0, n=6, mat=mats["ruby"])


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
    sc.unit_settings.length_unit = 'MILLIMETERS'
    clear()
    coll = bpy.data.collections.get("COL_Crown") or bpy.data.collections.new("COL_Crown")
    if coll.name not in sc.collection.children:
        sc.collection.children.link(coll)
    mats = make_materials()

    G.ring_wall("GEO-body", coll, RING_A, RING_B, RING_WALL, BAND_Z0, 120.0, 168,
                z_top=lambda th: z_top(math.degrees(th)))
    for ob in coll.objects:
        if ob.name == "GEO-body":
            ob.data.materials.append(mats["dark"])

    defaults = None
    build_spikes(coll, mats, defaults)
    build_flames(coll, mats)
    build_scales(coll, mats)
    build_trim(coll, mats)
    build_head(coll, mats)

    # 归一化：三视图标注 WIDTH 42cm —— 等比缩放到 W=420mm（保持图面比例）
    def _bbox():
        a = Vector((1e9,) * 3); b = Vector((-1e9,) * 3)
        for o in coll.objects:
            for v in o.data.vertices:
                q = o.matrix_world @ v.co
                for i in range(3):
                    a[i] = min(a[i], q[i]); b[i] = max(b[i], q[i])
        return a, b

    a0, b0 = _bbox()
    f = 420.0 / max((b0.x - a0.x) * 1000.0, 1e-6)
    if abs(f - 1.0) > 1e-4:
        for o in coll.objects:
            for v in o.data.vertices:
                v.co = v.co * f
            o.data.update()
    a0, b0 = _bbox()
    # 落地：把最低点移到 z=0
    dz = -a0.z
    if abs(dz) > 1e-6:
        for o in coll.objects:
            for v in o.data.vertices:
                v.co.z += dz
            o.data.update()
    print("NORMALIZED scale=%.4f  W=%.1f D=%.1f H=%.1f" %
          (f, (b0.x - a0.x) * 1000 * f, (b0.y - a0.y) * 1000 * f, (b0.z - a0.z) * 1000 * f))

    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    tris = 0
    for ob in coll.objects:
        ob.data.calc_loop_triangles()
        tris += len(ob.data.loop_triangles)
        for v in ob.data.vertices:
            p = ob.matrix_world @ v.co
            for i in range(3):
                mn[i] = min(mn[i], p[i]); mx[i] = max(mx[i], p[i])
    dim = (mx - mn) * 1000.0
    print("BUILD obj=%d tris=%d W=%.1f D=%.1f H=%.1f z[%.1f,%.1f]" %
          (len(coll.objects), tris, dim.x, dim.y, dim.z, mn.z * 1000, mx.z * 1000))
    for ob in sorted(coll.objects, key=lambda o: o.name):
        zs = [(ob.matrix_world @ v.co).z for v in ob.data.vertices]
        print("  %-18s z[%6.1f,%6.1f] v=%d" % (ob.name, min(zs) * 1000,
                                              max(zs) * 1000, len(ob.data.vertices)))
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print("SAVED", BLEND)
    import render_views
    render_views.render_views()


main()
