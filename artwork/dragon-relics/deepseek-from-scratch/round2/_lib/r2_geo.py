# -*- coding: utf-8 -*-
"""二轮组件库：龙首（多姿态）、真实镂空、布料曲面、真实链环、宝石镶座、鳞场。
约定：长度单位 mm；建模内部换算为米；局部坐标 +X=前方 +Y=左 +Z=上。
所有函数都返回对象（或对象列表），可直接放进独立组件集合。
"""
import bpy, bmesh, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
# 一轮的共享几何库位于 <root>/_lib；按目录路径导入，避免包名问题
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "_lib"))
from relic_geo import (MM, Z, Vector, mesh_from, lens_blade, curved_blade,
                            tube_along, taper_cyl, spoke, sphere, torus, add_gem,
                            catmull3, cr_sample, std_materials, res,
                            scale_plate_geo, merge_geo, ring_tube, flat_mat, tex_mat)


# ---------------- 局部坐标系 ----------------
class Frame(object):
    def __init__(self, origin_mm, forward=(1, 0, 0), up=(0, 0, 1), scale=1.0):
        f = Vector(forward).normalized()
        u = Vector(up)
        u = (u - f * u.dot(f))
        if u.length < 1e-6:
            u = Vector((0, 0, 1))
            u = (u - f * u.dot(f))
            if u.length < 1e-6:
                u = Vector((0, 1, 0))
        u.normalize()
        s = f.cross(u).normalized()          # 左
        self.o = Vector(origin_mm)
        self.f, self.u, self.s = f, u, s
        self.k = scale

    def p(self, x, y, z):
        """局部 mm -> 世界 mm"""
        return self.o + (self.f * x + self.s * y + self.u * z) * self.k

    def d(self, x, y, z):
        return (self.f * x + self.s * y + self.u * z).normalized()


# ---------------- 龙首 ----------------
HEAD_STYLES = {
    # 长宽高比例、吻部下弯、开口、角、须、眉脊、冠板、颈部
    "crown_mask":   dict(L=150, W=132, H=118, snout_drop=0.10, jaw=26, horns=2,
                         horn_len=150, horn_curl=0.55, whisker=0, brow=1.0,
                         crest=3, teeth=0, neck=0.0, eye=13),
    "book_white":   dict(L=180, W=96, H=98, snout_drop=0.16, jaw=18, horns=2,
                         horn_len=190, horn_curl=0.85, whisker=2, brow=0.7,
                         crest=2, teeth=6, neck=0.10, eye=11),
    "regalia_coil": dict(L=130, W=86, H=86, snout_drop=0.20, jaw=34, horns=2,
                         horn_len=150, horn_curl=0.95, whisker=2, brow=0.8,
                         crest=2, teeth=8, neck=0.12, eye=9),
    "ring_pair":    dict(L=46, W=34, H=36, snout_drop=0.18, jaw=24, horns=2,
                         horn_len=52, horn_curl=0.9, whisker=0, brow=0.7,
                         crest=1, teeth=4, neck=0.0, eye=4.2),
    "armor":        dict(L=150, W=120, H=110, snout_drop=0.12, jaw=22, horns=2,
                         horn_len=150, horn_curl=0.7, whisker=2, brow=1.1,
                         crest=4, teeth=6, neck=0.08, eye=12),
    "sarcophagus":  dict(L=260, W=170, H=150, snout_drop=0.22, jaw=30, horns=2,
                         horn_len=240, horn_curl=0.8, whisker=3, brow=1.0,
                         crest=3, teeth=8, neck=0.15, eye=18),
}


def dragon_mask(coll, M, fr, W=250.0, H=270.0, style="crown", mat=None, name="MASK",
                gem=True, simpler=False, horn_scale=1.0, gem_z=None, horn_out=1.0):
    """正面龙面（参考里王冠的龙首是正对观众的"面具"，不是侧脸）。
    局部坐标：+Z 向上（额）、+Y 向左、+X 朝外（观众）。吻尖朝 -Z。
    组成：盾形面盘（带中脊）、眉脊、斜置红眼、双长角、额冠、颊部尖板、獠牙、宝珠四爪座。"""
    mat = mat or M["gold"]
    out = []

    def add(ob, m=None):
        out.append(ob)
        mm = m or mat
        if mm and len(ob.data.materials) == 0:
            ob.data.materials.append(mm)
        return ob

    hz = H * 0.5
    # ---------- 面盘：z 分层，宽度 & 前凸（盾形 + 中脊）----------
    LV = [(-1.00, 0.05, 0.34), (-0.86, 0.14, 0.58), (-0.70, 0.24, 0.74),
          (-0.50, 0.36, 0.88), (-0.28, 0.48, 0.96), (-0.06, 0.58, 1.00),
          (0.16, 0.64, 1.00), (0.40, 0.68, 0.94), (0.62, 0.62, 0.82),
          (0.80, 0.44, 0.62), (0.92, 0.22, 0.42), (1.00, 0.05, 0.24)]
    nz = len(LV); ny = 15
    verts, faces = [], []
    grid = []
    for (tz, wf, bf) in LV:
        z = tz * hz
        w = W * 0.5 * wf
        bulge = W * 0.055 * bf
        ridge = W * 0.030 * bf
        row = []
        for j in range(ny):
            v = -1.0 + 2.0 * j / (ny - 1)
            y = v * w
            x = bulge * (1.0 - v * v) + ridge * (1.0 - abs(v)) ** 1.6
            row.append(len(verts)); verts.append(fr.p(x, y, z))
        grid.append(row)
    for i in range(nz - 1):
        A_, B_ = grid[i], grid[i + 1]
        for j in range(ny - 1):
            faces.append([A_[j], A_[j + 1], B_[j + 1], B_[j]])
    # 背面（向内偏移）形成厚度
    back = []
    for i in range(nz):
        row = []
        for j in range(ny):
            p = verts[grid[i][j]]
            row.append(len(verts)); verts.append(p - fr.d(1, 0, 0) * (W * 0.030))
        back.append(row)
    for i in range(nz - 1):
        A_, B_ = back[i], back[i + 1]
        for j in range(ny - 1):
            faces.append([A_[j + 1], A_[j], B_[j], B_[j + 1]])
    # 边缘缝合
    for i in range(nz - 1):
        for (a, b) in ((0, 0), (ny - 1, ny - 1)):
            faces.append([grid[i][a], grid[i + 1][a], back[i + 1][b], back[i][b]])
    for j in range(ny - 1):
        faces.append([grid[0][j + 1], grid[0][j], back[0][j], back[0][j + 1]])
        faces.append([grid[-1][j], grid[-1][j + 1], back[-1][j + 1], back[-1][j]])
    add(mesh_from("GEO-%s_face" % name, [v * MM for v in verts], faces, coll, smooth=True))

    # ---------- 眉脊（棱角状金脊，非圆管）----------
    for sy in (-1, 1):
        bp = [fr.p(W * 0.03, sy * W * 0.04, H * 0.14),
              fr.p(W * 0.10, sy * W * 0.16, H * 0.20),
              fr.p(W * 0.18, sy * W * 0.26, H * 0.14),
              fr.p(W * 0.24, sy * W * 0.32, H * 0.02)]
        add(curved_blade("GEO-%s_brow%d" % (name, sy),
                         [tuple(v) for v in bp], W * 0.055, W * 0.042, coll,
                         n=14, plane=fr.d(1, 0, 0), smooth=True))

    # ---------- 斜置红眼（杏仁形，贴在面盘表面朝外）----------
    for sy in (-1, 1):
        P = fr.d(1, 0, 0)                       # 眼睛朝向（面法线）
        ang = math.radians(24)
        E = fr.d(0, sy * math.cos(ang), math.sin(ang))     # 长轴：向外上
        A = E.cross(P).normalized()
        base = fr.p(W * 0.060, sy * W * 0.095, -H * 0.015)  # 内眼角
        eye = lens_blade("GEO-%s_eye%d" % (name, sy), tuple(base * MM), A, E, P,
                         W * 0.235,
                         [(0, 0), (0.30, 0.34), (0.62, 0.68), (1.0, 1.0)],
                         [(0, 0), (1, 0)],
                         [(0, W * 0.005), (0.22, W * 0.028), (0.5, W * 0.036),
                          (0.78, W * 0.024), (1.0, W * 0.004)],
                         [(0, W * 0.005), (0.22, W * 0.028), (0.5, W * 0.036),
                          (0.78, W * 0.024), (1.0, W * 0.004)],
                         [(0, W * 0.008), (0.5, W * 0.012), (1.0, W * 0.003)],
                         n=18, coll=coll, smooth=True)
        if "eye_red" not in M:
            M["eye_red"] = flat_mat("M-eye_red", (0.42, 0.012, 0.008), 0.0, 0.10,
                                    emission=(1.0, 0.10, 0.04), estr=0.55,
                                    transmission=0.30, ior=1.78)
        add(eye, m=M["eye_red"])
        # 眶缘（沿眼睛轮廓外一圈细管，压出凹陷感）
        rim = []
        for k in range(7):
            t = k / 6.0
            rim.append(fr.p(W * 0.060 + W * 0.012, sy * W * (0.095 + 0.16 * t),
                            -H * 0.015 + H * (0.075 * math.sin(math.pi * t) - 0.02 * t)))
        add(tube_along("GEO-%s_eyebone%d" % (name, sy), [tuple(v) for v in rim],
                       W * 0.012, coll, seg=6, mat=mat))

    # ---------- 额冠（中线脊 + 顶刺）----------
    cp = [fr.p(W * 0.045, 0, H * 0.06), fr.p(W * 0.050, 0, H * 0.22),
          fr.p(W * 0.040, 0, H * 0.38), fr.p(W * 0.020, 0, H * 0.52)]
    add(tube_along("GEO-%s_crista" % name, [tuple(v) for v in cp], W * 0.020, coll,
                   seg=8, mat=mat))
    add(spoke("GEO-%s_topspike" % name, coll, tuple(fr.p(W * 0.02, 0, H * 0.50)),
              tuple(fr.p(W * 0.01, 0, H * 0.66)), W * 0.030, W * 0.002, W * 0.026,
              mat=mat))

    # ---------- 双长角（向外上 S 形扫出）----------
    for sy in (-1, 1):
        hs = horn_scale
        hp = [fr.p(W * 0.02, sy * W * 0.24, H * 0.26),
              fr.p(-W * 0.03 * hs, sy * W * 0.38 * horn_out, H * 0.26 + H * 0.20 * hs),
              fr.p(-W * 0.04 * hs, sy * W * 0.50 * horn_out, H * 0.26 + H * 0.42 * hs),
              fr.p(W * 0.00, sy * W * 0.54 * horn_out, H * 0.26 + H * 0.62 * hs),
              fr.p(W * 0.06, sy * W * 0.48 * horn_out, H * 0.26 + H * 0.76 * hs)]
        radii = [W * 0.075, W * 0.058, W * 0.036, W * 0.016, W * 0.002]
        rows = []
        for i in range(len(hp) - 1):
            for k in range(10):
                f = k / 10.0
                rows.append(([hp[i][j] * (1 - f) + hp[i + 1][j] * f for j in range(3)],
                             radii[i] * (1 - f) + radii[i + 1] * f))
        rows.append((hp[-1], radii[-1]))
        add(tube_along("GEO-%s_horn%d" % (name, sy), [r[0] for r in rows],
                       W * 0.02, coll, seg=10, radii=[r[1] for r in rows], mat=mat))

    # ---------- 颊部尖板（每侧 3 片，向外下展开）----------
    if not simpler:
        for sy in (-1, 1):
            for k in range(3):
                t = k / 2.0
                base = fr.p(W * 0.06, sy * W * (0.30 + 0.04 * t), -H * (0.06 + 0.10 * t))
                tip = fr.p(W * 0.02, sy * W * (0.44 + 0.06 * t), -H * (0.20 + 0.16 * t))
                mid = fr.p(W * 0.05, sy * W * (0.38 + 0.05 * t), -H * (0.13 + 0.13 * t))
                add(curved_blade("GEO-%s_frill%d_%d" % (name, sy, k),
                                 [tuple(base), tuple(mid), tuple(tip)],
                                 W * 0.075, W * 0.026, coll, n=14,
                                 plane=fr.d(1, 0, 0), smooth=True))

    # ---------- 獠牙 ----------
    for sy in (-1, 1):
        add(spoke("GEO-%s_fang%d" % (name, sy), coll,
                  tuple(fr.p(W * 0.06, sy * W * 0.07, -H * 0.30)),
                  tuple(fr.p(W * 0.04, sy * W * 0.05, -H * 0.42)),
                  W * 0.018, W * 0.002, W * 0.016, mat=mat))

    # ---------- 宝珠四爪座（在吻下方，claws 抱珠）----------
    if gem:
        gz = -H * 0.62 if gem_z is None else gem_z
        gc = fr.p(W * 0.02, 0, gz)
        gr = W * 0.17
        for k in range(4):
            a = math.tau * k / 4 + math.pi / 4
            p0 = fr.p(W * 0.02 + math.cos(a) * gr * 1.15, math.sin(a) * gr * 1.15,
                      gz + gr * 1.55)
            p1 = fr.p(W * 0.02 + math.cos(a) * gr * 1.10, math.sin(a) * gr * 1.10,
                      gz + gr * 1.05)
            p2 = fr.p(W * 0.02 + math.cos(a) * gr * 0.80, math.sin(a) * gr * 0.80,
                      gz + gr * 0.72)
            add(curved_blade("GEO-%s_gemclaw%d" % (name, k),
                             [tuple(p0), tuple(p1), tuple(p2)], W * 0.045, W * 0.022,
                             coll, n=12, plane=fr.d(1, 0, 0), smooth=True))
        out.append(add_gem("GEO-%s_gem" % name, coll, tuple(gc),
                           gr * 0.92, gr * 0.92, gr * 2.1, n=8, mat=M["ruby"]))
    return out


def _loft(name, coll, fr, sections, mat, smooth=True, close_end=True):
    """按局部截面放样成闭合实体。sections: [(x, [(y,z), ...]), ...]，每环点数一致。"""
    verts, faces, rings = [], [], []
    for (x, prof) in sections:
        ring = []
        for (y, z) in prof:
            ring.append(len(verts))
            verts.append(fr.p(x, y, z) * MM)
        rings.append(ring)
    n = len(rings[0])
    for i in range(len(rings) - 1):
        A_, B_ = rings[i], rings[i + 1]
        for k in range(n):
            kn = (k + 1) % n
            faces.append([A_[k], A_[kn], B_[kn], B_[k]])
    faces.append(list(reversed(rings[0])))
    if close_end:
        faces.append(list(rings[-1]))
    ob = mesh_from("GEO-%s" % name, verts, faces, coll, smooth=smooth)
    if mat:
        ob.data.materials.append(mat)
    return ob


def _ring_profile(w, ztop, zbot, n=16, flat_top=0.55):
    """截面：上半为较平的额面，下半为略收的颌底。返回 [(y,z)...] 逆时针。"""
    pts = []
    for k in range(n):
        a = math.tau * k / n
        cy, sz = math.cos(a), math.sin(a)
        y = cy * w
        if sz >= 0:
            z = (ztop * (sz ** flat_top))
        else:
            z = (zbot * ((-sz) ** 0.85))
        pts.append((y, z))
    return pts


def dragon_head(coll, M, fr, style="book_white", mat=None, name="HEAD",
                bulk=1.0, jaw_open=None, crest_scale=1.0, horn_thick=1.0):
    """真龙首（v2，放样实体）：
    上颌+颅骨一体放样、下颌独立放样（可张开）、双角（锥形后弯）、
    眉脊、眼窝+眼、齿列、须、冠板、颈根。返回对象列表。"""
    st = dict(HEAD_STYLES[style])
    L, W, H = st["L"], st["W"] * bulk, st["H"] * bulk
    jr = math.radians(st["jaw"] if jaw_open is None else jaw_open)
    mat = mat or M["gold"]
    out = []

    def add(ob):
        out.append(ob)
        if mat and len(ob.data.materials) == 0:
            ob.data.materials.append(mat)
        return ob

    # ---------- 上颌 + 颅骨（一体放样） ----------
    # (x/L, 半宽系数, 顶高系数, 底高系数)
    UP = [(-0.06, 0.40, 0.14, -0.10), (0.06, 0.46, 0.22, -0.14),
          (0.20, 0.50, 0.28, -0.17), (0.34, 0.50, 0.30, -0.18),
          (0.50, 0.40, 0.24, -0.16), (0.66, 0.31, 0.17, -0.14),
          (0.82, 0.24, 0.11, -0.12), (0.93, 0.18, 0.06, -0.11),
          (1.00, 0.09, 0.015, -0.05)]
    secs = []
    for (t, wf, zt, zb) in UP:
        secs.append((t * L, _ring_profile(W * 0.5 * wf, H * zt, H * zb, n=16)))
    add(_loft("%s_upper" % name, coll, fr, secs, mat))

    # ---------- 下颌（放样，绕铰点张开 jr） ----------
    hinge_x = 0.30 * L
    jaw_len = 0.70 * L
    LOW = [(0.00, 0.34, 0.00), (0.22, 0.36, 0.03), (0.48, 0.30, 0.05),
           (0.72, 0.22, 0.05), (0.90, 0.15, 0.04), (1.00, 0.08, 0.02)]
    lsecs = []
    for (t, wf, dz) in LOW:
        x = hinge_x + jaw_len * t * math.cos(jr)
        zc = -H * 0.16 - jaw_len * t * math.sin(jr)
        prof = _ring_profile(W * 0.5 * wf, H * 0.05 + dz * H, -H * 0.16, n=14)
        lsecs.append((x, [(y, z + zc) for (y, z) in prof]))
    add(_loft("%s_lower" % name, coll, fr, lsecs, mat))

    # ---------- 齿列（小三角，沿上下颌内缘） ----------
    for i in range(st["teeth"]):
        t = 0.12 + 0.80 * (i / max(1, st["teeth"] - 1))
        x = hinge_x + jaw_len * t
        # 上齿：朝下
        add(spoke("GEO-%s_utooth%d" % (name, i), coll,
                  tuple(fr.p(x, 0, -H * 0.15)), tuple(fr.p(x + H * 0.02, 0, -H * 0.05)),
                  W * 0.022, W * 0.004, W * 0.022, mat=mat))
        for sy in (-1, 1):
            add(spoke("GEO-%s_utooth%d_%d" % (name, sy, i), coll,
                      tuple(fr.p(x, sy * W * 0.17, -H * 0.15)),
                      tuple(fr.p(x + H * 0.02, sy * W * 0.15, -H * 0.05)),
                      W * 0.020, W * 0.004, W * 0.020, mat=mat))
            xj = hinge_x + jaw_len * t * math.cos(jr)
            zj = -H * 0.16 - jaw_len * t * math.sin(jr) + H * 0.04
            add(spoke("GEO-%s_ltooth%d_%d" % (name, sy, i), coll,
                      tuple(fr.p(xj, sy * W * 0.15, zj)),
                      tuple(fr.p(xj + H * 0.02, sy * W * 0.13, zj + H * 0.09)),
                      W * 0.018, W * 0.004, W * 0.018, mat=mat))

    # ---------- 双角（锥形后弯，粗根细尖） ----------
    for sy in (-1, 1):
        curl = st["horn_curl"]
        hp = [fr.p(0.02 * L, sy * W * 0.36, H * 0.26),
              fr.p(-0.14 * L, sy * W * (0.44 + 0.06 * curl), H * 0.52),
              fr.p(-0.30 * L, sy * W * (0.46 + 0.12 * curl), H * 0.72 + st["horn_len"] * 0.18),
              fr.p(-0.44 * L - st["horn_len"] * 0.12,
                   sy * W * (0.40 + 0.24 * curl), H * 0.66 + st["horn_len"] * 0.42)]
        radii = [W * 0.085 * horn_thick, W * 0.062 * horn_thick,
                 W * 0.038 * horn_thick, W * 0.006 * horn_thick]
        pts = [tuple(v) for v in hp]
        segs = 8
        prev = None
        rows = []
        for i in range(len(pts) - 1):
            for k in range(segs):
                f = k / float(segs)
                x = [pts[i][j] * (1 - f) + pts[i + 1][j] * f for j in range(3)]
                r = radii[i] * (1 - f) + radii[i + 1] * f
                rows.append((x, r))
        rows.append((pts[-1], radii[-1]))
        add(tube_along("GEO-%s_horn%d" % (name, sy), [r[0] for r in rows],
                       W * 0.05 * horn_thick, coll, seg=10, radii=[r[1] for r in rows],
                       mat=mat))

    # ---------- 眉脊 ----------
    for sy in (-1, 1):
        bp = [fr.p(0.26 * L, sy * W * 0.30, H * 0.26 * st["brow"]),
              fr.p(0.40 * L, sy * W * 0.36, H * 0.30 * st["brow"]),
              fr.p(0.54 * L, sy * W * 0.28, H * 0.20)]
        add(tube_along("GEO-%s_brow%d" % (name, sy), [tuple(v) for v in bp],
                       W * 0.035, coll, seg=8, mat=mat))

    # ---------- 眼窝 + 眼 ----------
    for sy in (-1, 1):
        ec = fr.p(0.40 * L, sy * W * 0.33, H * 0.10)
        add(sphere("GEO-%s_socket%d" % (name, sy), coll, tuple(ec), st["eye"] * 1.5,
                   seg=14, ring=10, mat=mat))
        out.append(add_gem("GEO-%s_eye%d" % (name, sy), coll, tuple(ec),
                           st["eye"] * 0.85, st["eye"] * 0.85, st["eye"] * 1.7, n=8,
                           mat=(M["ruby"] if style != "book_white"
                                else M.get("glow_gold") or M["gold"])))

    # ---------- 鼻孔 ----------
    for sy in (-1, 1):
        add(sphere("GEO-%s_nostril%d" % (name, sy), coll,
                   tuple(fr.p(0.88 * L, sy * W * 0.10, H * 0.10)),
                   W * 0.035, seg=10, ring=8, mat=M["crack"]))

    # ---------- 须 ----------
    if st["whisker"]:
        for sy in (-1, 1):
            wp = [fr.p(0.80 * L, sy * W * 0.20, -H * 0.02),
                  fr.p(0.72 * L, sy * W * 0.44, -H * 0.14),
                  fr.p(0.56 * L, sy * W * 0.60, -H * 0.22),
                  fr.p(0.38 * L, sy * W * 0.66, -H * 0.14)]
            add(tube_along("GEO-%s_whisker%d" % (name, sy), [tuple(v) for v in wp],
                           W * 0.022, coll, seg=8, mat=mat))

    # ---------- 冠板 ----------
    for i in range(st["crest"]):
        t = 0.04 + 0.13 * i
        hh = (H * 0.22 + H * 0.14 * (i % 2)) * crest_scale
        cp = [fr.p(t * L, 0, H * 0.30), fr.p((t + 0.05) * L, 0, H * 0.30 + hh * 0.55),
              fr.p((t + 0.09) * L, 0, H * 0.30 + hh)]
        add(curved_blade("GEO-%s_crest%d" % (name, i),
                         [tuple(v) for v in cp], W * 0.13, W * 0.045, coll, n=12,
                         plane=fr.d(0, 1, 0), smooth=True))

    # ---------- 颈根 ----------
    if st["neck"] > 0:
        add(taper_cyl("GEO-%s_neck" % name, coll,
                      tuple(fr.p(-0.06 * L, 0, 0)),
                      tuple(fr.p(-0.06 * L - st["neck"] * L * 2.4, 0, -H * 0.10)),
                      W * 0.40, W * 0.30, seg=18, mat=mat))
    return out


# ---------------- 真实镂空：肋条 + 节点（负空间是真的） ----------------
def openwork_fan(coll, M, fr, radius, count, bar_w, bar_t, mat=None, name="OW",
                 sweep=(-70, 70), inner=0.30, curl=0.35):
    """扇形镂空：从根部发散的弯肋 + 内外两道弧 + 交点圆节点。
    肋与肋之间是真开孔；外弧把肋连成一体（有连接桥）。"""
    mat = mat or M["gold"]
    out = []
    a0, a1 = math.radians(sweep[0]), math.radians(sweep[1])
    for i in range(count):
        t = i / max(1, count - 1)
        a = a0 + (a1 - a0) * t
        r0 = radius * inner
        r1 = radius * (0.86 + 0.14 * math.cos(t * math.pi))
        p0 = fr.p(math.cos(a) * r0, math.sin(a) * r0, 0)
        pm = fr.p(math.cos(a + curl * 0.10) * (r0 + r1) * 0.5,
                  math.sin(a + curl * 0.10) * (r0 + r1) * 0.5, 0)
        p1 = fr.p(math.cos(a + curl * 0.22) * r1, math.sin(a + curl * 0.22) * r1, 0)
        ob = curved_blade("GEO-%s_rib%d" % (name, i),
                          [tuple(v) for v in (p0, pm, p1)], bar_w, bar_t, coll,
                          n=14, plane=fr.d(0, 0, 1), smooth=True)
        ob.data.materials.append(mat)
        out.append(ob)
    # 内外两道弧（连接桥）
    for rr, bw in ((radius * inner, bar_w * 1.15), (radius * 0.9, bar_w * 1.3)):
        pts = [fr.p(math.cos(a0 + (a1 - a0) * k / 24) * rr,
                    math.sin(a0 + (a1 - a0) * k / 24) * rr, 0) for k in range(25)]
        ob = tube_along("GEO-%s_arc%d" % (name, int(rr)), pts, bw * 0.55, coll,
                        seg=10, mat=mat)
        out.append(ob)
    # 交点节点
    for i in range(count):
        t = i / max(1, count - 1)
        a = a0 + (a1 - a0) * t
        out.append(sphere("GEO-%s_node%d" % (name, i), coll,
                          tuple(fr.p(math.cos(a) * radius * 0.9,
                                     math.sin(a) * radius * 0.9, 0)),
                          bar_w * 0.75, seg=12, ring=8, mat=mat))
    return out


def pierced_plate(coll, M, fr, w, h, thickness, holes, mat=None, name="PP"):
    """真开孔饰片：板面位于局部 (左=y, 上=z) 平面，厚度沿 x(朝外)。
    holes: [(y, z, r), ...] 局部 mm。开孔用圆柱布尔，孔壁有厚度，再倒角。"""
    mat = mat or M["gold"]
    t = thickness * 0.5
    verts = []
    for sx in (-t, t):
        for (sy, sz) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            verts.append(fr.p(sx, sy * w * 0.5, sz * h * 0.5) * MM)
    faces = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2],
             [2, 6, 7, 3], [3, 7, 4, 0]]
    plate = mesh_from("GEO-%s_plate" % name, verts, faces, coll)
    plate.data.materials.append(mat)
    cutters = []
    for i, (hy, hz, hr) in enumerate(holes):
        me = bpy.data.meshes.new("CUT%d" % i)
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=hr * MM,
                              radius2=hr * MM, depth=(thickness * 2.6) * MM)
        bm.to_mesh(me); bm.free()
        ob = bpy.data.objects.new("CUT%d" % i, me)
        coll.objects.link(ob)
        ob.location = tuple(fr.p(0, hy, hz) * MM)
        n = fr.d(1, 0, 0)
        ob.rotation_euler = n.to_track_quat('Z', 'Y').to_euler()
        cutters.append(ob)
    for cut in cutters:
        mod = plate.modifiers.new("bool", 'BOOLEAN')
        mod.object = cut
        mod.operation = 'DIFFERENCE'
        mod.solver = 'EXACT'
        bpy.context.view_layer.objects.active = plate
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
        except Exception as ex:
            print("bool fail", ex)
    for cut in cutters:
        me = cut.data
        bpy.data.objects.remove(cut, do_unlink=True)
        bpy.data.meshes.remove(me)
    bm = bmesh.new(); bm.from_mesh(plate.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=0.008 * MM)
    bm.edges.ensure_lookup_table(); bm.verts.ensure_lookup_table()
    # 布尔后不再倒角（倒角会在孔口产生自交），改用三角化前清理
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.to_mesh(plate.data); bm.free(); plate.data.update()
    for p in plate.data.polygons:
        p.use_smooth = False
    return plate


# ---------------- 布料：带褶皱/垂坠/扭转的曲面片 ----------------
def cloth_sheet(coll, M, anchors, width_mm, folds=5, fold_amp=26.0, twist_deg=18.0,
                thickness=2.4, mat=None, name="CLOTH", flare=0.0, sag=0.0, wrap_r=0.0):
    """沿 anchors（3~5 个世界点，mm）成形的布片：
    - 横向按 folds 条正弦褶，振幅随下垂增大
    - 沿长度方向做 twist_deg 的扭转
    - flare：下摆额外展开量；sag：中段重力下垂量
    输出闭合薄壳（有真实厚度），褶皱是真曲面。"""
    mat = mat or M["cloth_white"]
    pts = catmull3([Vector(p) * MM for p in anchors], 40)
    n = len(pts)
    verts, faces, rows = [], [], []
    vs = res(28, 16)
    for i in range(n):
        u = i / (n - 1.0)
        C = pts[i]
        if i == 0:
            T = pts[1] - pts[0]
        elif i == n - 1:
            T = pts[-1] - pts[-2]
        else:
            T = pts[i + 1] - pts[i - 1]
        T.normalize()
        # 布面法线：取与 T 垂直、朝外（+Y 优先）
        up = Vector((0, 0, 1))
        A = T.cross(up)
        if A.length < 1e-6:
            A = T.cross(Vector((1, 0, 0)))
        A.normalize()                       # 横向
        N = T.cross(A).normalized()         # 面法向
        tw = math.radians(twist_deg) * u
        ca, sa = math.cos(tw), math.sin(tw)
        A2 = (A * ca + N * sa).normalized()
        N2 = T.cross(A2).normalized()
        w = width_mm * 0.5 * MM * (1.0 + flare * u)
        row = []
        for j in range(vs):
            v = -1.0 + 2.0 * j / (vs - 1)
            fold = fold_amp * math.sin(folds * math.pi * v + 1.7) * (0.15 + 0.85 * u)
            sagv = -sag * math.sin(math.pi * min(1.0, u * 1.2)) * (1.0 - abs(v) ** 2)
            if wrap_r > 1e-6:
                # 沿宽度方向绕半径 wrap_r 的竖轴包裹（裙层/纱贴合身体）
                th = (v * w) / wrap_r
                pos = (C + A2 * (wrap_r * math.sin(th))
                       + N2 * (wrap_r * (1.0 - math.cos(th)) + (fold + sagv) * MM))
            else:
                pos = C + A2 * (v * w) + N2 * (fold + sagv) * MM
            row.append(len(verts)); verts.append(pos)
        rows.append(row)
    for i in range(n - 1):
        A_, B_ = rows[i], rows[i + 1]
        for j in range(vs - 1):
            faces.append([A_[j], A_[j + 1], B_[j + 1], B_[j]])
    ob = mesh_from("GEO-%s" % name, verts, faces, coll, smooth=True)
    if mat:
        ob.data.materials.append(mat)
    # 真实厚度
    sol = ob.modifiers.new("sld", 'SOLIDIFY')
    sol.thickness = thickness * MM
    sol.offset = 0.0
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=sol.name)
    return ob


# ---------------- 真实链环（相互穿套） ----------------
def real_chain(coll, M, start_mm, dir_mm, count, link_len=26.0, link_r=3.2,
               mat=None, name="CHAIN"):
    """交错 90° 且中心距 0.72*link_len 的链环——环与环真实穿套。"""
    mat = mat or M["gold"]
    d = Vector(dir_mm).normalized()
    up = Vector((0, 0, 1))
    if abs(d.dot(up)) > 0.95:
        up = Vector((0, 1, 0))
    side = d.cross(up).normalized()
    out = []
    for i in range(count):
        c = Vector(start_mm) + d * (link_len * 0.72 * i)
        vertical = (i % 2 == 0)
        e1 = side if vertical else d.cross(side).normalized()
        e2 = d if vertical else side
        pts = []
        seg = 20
        for k in range(seg + 1):
            a = math.tau * (k / float(seg)) * 0.94
            pts.append(c + e1 * (math.cos(a) * link_len * 0.5)
                       + e2 * (math.sin(a) * link_len * 0.5))
        ob = tube_along("GEO-%s_link%d" % (name, i), [tuple(p) for p in pts],
                        link_r, coll, seg=8, closed=False, mat=mat)
        out.append(ob)
    return out


# ---------------- 宝石镶座（杯 + 爪 + 宝石） ----------------
def gem_mount(coll, M, fr, gem_r, gem_h, prongs=6, cup_h=None, mat=None,
              gem_mat=None, name="MOUNT"):
    """镶座：杯托（回转体）+ 若干爪 + 刻面宝石。返回 (cup, prongs, gem)。"""
    mat = mat or M["gold"]
    gem_mat = gem_mat or M["ruby"]
    cup_h = cup_h if cup_h is not None else gem_h * 0.55
    # 杯托：4 层截面回转
    verts, faces, rings = [], [], []
    prof = [(gem_r * 0.62, 0.0), (gem_r * 0.92, cup_h * 0.35),
            (gem_r * 1.08, cup_h * 0.78), (gem_r * 1.02, cup_h)]
    seg = res(32, 20)
    for (rr, hh) in prof:
        ring = []
        for k in range(seg):
            a = math.tau * k / seg
            p = fr.p(math.cos(a) * rr, math.sin(a) * rr, hh)
            ring.append(len(verts)); verts.append(p * MM)
        rings.append(ring)
    for i in range(len(rings) - 1):
        A_, B_ = rings[i], rings[i + 1]
        for k in range(seg):
            kn = (k + 1) % seg
            faces.append([A_[k], A_[kn], B_[kn], B_[k]])
    faces.append(list(reversed(rings[0])))
    faces.append(list(rings[-1]))
    cup = mesh_from("GEO-%s_cup" % name, verts, faces, coll, smooth=True)
    cup.data.materials.append(mat)
    # 爪（圆线爪，避免薄刃自交）
    claws = []
    for i in range(prongs):
        a = math.tau * i / prongs
        p0 = fr.p(math.cos(a) * gem_r * 0.95, math.sin(a) * gem_r * 0.95, cup_h * 0.40)
        p1 = fr.p(math.cos(a) * gem_r * 1.04, math.sin(a) * gem_r * 1.04,
                  cup_h + gem_h * 0.55)
        p2 = fr.p(math.cos(a) * gem_r * 0.78, math.sin(a) * gem_r * 0.78,
                  cup_h + gem_h * 0.98)
        ob = tube_along("GEO-%s_claw%d" % (name, i),
                        [tuple(p0), tuple(p1), tuple(p2)], gem_r * 0.055, coll,
                        seg=8, radii=[gem_r * 0.075, gem_r * 0.055, gem_r * 0.015],
                        mat=mat)
        claws.append(ob)
    gem = add_gem("GEO-%s_gem" % name, coll,
                  tuple(fr.p(0, 0, cup_h * 0.92)),
                  gem_r * 0.92, gem_r * 0.92, gem_h * 1.5, n=8, mat=gem_mat)
    return cup, claws, gem


def contact_report(coll, body_name, part_prefix, inside_probe=24, extra_bodies=()):
    """真实连接检查：对每个部件做
    ① 与主体的三角面相交计数（BVH.overlap）
    ② 部件基部顶点是否落在主体内部（射线奇偶）
    只有 overlap>0 或 inside>0 才算"有连接"，纯距离法会被"嵌入体内"骗过。"""
    import mathutils
    from mathutils.bvhtree import BVHTree
    names = ([body_name] if isinstance(body_name, str) else list(body_name))
    names += [n for n in extra_bodies]
    bm_all = bmesh.new()
    for n in names:
        o = bpy.data.objects.get(n)
        if o is None or o.type != 'MESH':
            continue
        tmp = bmesh.new()
        tmp.from_mesh(o.data)
        tmp.transform(o.matrix_world)
        me_tmp = bpy.data.meshes.new("tmp")
        tmp.to_mesh(me_tmp)
        tmp.free()
        bm_all.from_mesh(me_tmp)
        bpy.data.meshes.remove(me_tmp)
    if len(bm_all.faces) == 0:
        return {"error": "no body %s" % body_name}
    bvh_body = BVHTree.FromBMesh(bm_all)
    rows = []
    for ob in coll.objects:
        if not ob.name.startswith(part_prefix):
            continue
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bm.transform(ob.matrix_world)
        bvh_part = BVHTree.FromBMesh(bm)
        pairs = bvh_body.overlap(bvh_part)
        n_over = len(pairs)
        vs = sorted([v.co for v in bm.verts], key=lambda p: p.z)[:inside_probe]
        n_in = 0
        for p in vs:
            d = Vector((0.0137, 0.0211, 0.0079))
            hit = 0
            o = p.copy()
            for _ in range(24):
                loc, nor, idx, dist = bvh_body.ray_cast(o, d, 1e6)
                if loc is None:
                    break
                hit += 1
                o = loc + d * 0.00005
            if hit % 2 == 1:
                n_in += 1
        dmin = 1e9
        for p in vs:
            loc, nor, idx, dist = bvh_body.find_nearest(p)
            if dist is not None:
                dmin = min(dmin, dist)
        bm.free()
        rows.append({"part": ob.name, "overlap_pairs": n_over,
                     "base_inside_pts": n_in, "base_pts": len(vs),
                     "min_dist_mm": round(dmin * 1000, 2),
                     "connected": bool(n_over > 0 or n_in > 0)})
    return rows


def loft_shell(name, coll, sections, seg=72, thick=5.0, mat=None, wave=0.0, waven=6,
               smooth=True):
    """椭圆截面竖向放样薄壳：sections=[(z, rx, ry), ...] 自下而上；可带波浪下摆。"""
    verts, faces, rings = [], [], []
    nz = len(sections)
    seg = res(seg, 48)
    for si, (z, rx, ry) in enumerate(sections):
        row_o, row_i = [], []
        for k in range(seg):
            th = math.tau * k / seg
            wv = 0.0
            if si == 0 and wave:
                wv = wave * (0.5 + 0.5 * math.sin(waven * th + 0.7))
            ox, oy = rx * math.cos(th), ry * math.sin(th)
            oxi = (rx - thick) * math.cos(th)
            oyi = (ry - thick) * math.sin(th)
            row_o.append(len(verts)); verts.append(Vector((ox, oy, z + wv)) * MM)
            row_i.append(len(verts)); verts.append(Vector((oxi, oyi, z + wv)) * MM)
        rings.append((row_o, row_i))
    for i in range(nz - 1):
        Ao, Ai = rings[i]
        Bo, Bi = rings[i + 1]
        for k in range(seg):
            kn = (k + 1) % seg
            faces.append([Ao[k], Ao[kn], Bo[kn], Bo[k]])       # 外壁
            faces.append([Bi[k], Bi[kn], Ai[kn], Ai[k]])       # 内壁
    # 上下封边
    Ao, Ai = rings[0]
    for k in range(seg):
        kn = (k + 1) % seg
        faces.append([Ai[k], Ai[kn], Ao[kn], Ao[k]])
    Bo, Bi = rings[-1]
    for k in range(seg):
        kn = (k + 1) % seg
        faces.append([Bo[k], Bo[kn], Bi[kn], Bi[k]])
    ob = mesh_from(name, verts, faces, coll, smooth=smooth)
    if mat:
        ob.data.materials.append(mat)
    return ob
