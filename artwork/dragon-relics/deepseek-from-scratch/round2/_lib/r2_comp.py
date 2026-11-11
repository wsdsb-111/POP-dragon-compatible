# -*- coding: utf-8 -*-
"""二轮组件库 2：浮雕盘龙、护角镂空片、罗盘书扣、珍珠链、书脊箍、翼羽列、盘龙（立体系）。
每个函数把对象建到指定 collection，返回对象列表；可单独保存为组件工程并出四视图。
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE) + "/_lib")
sys.path.insert(0, HERE)
import r2_geo as G2
from relic_geo import (MM, Z, mesh_from, lens_blade, curved_blade, tube_along,
                       taper_cyl, spoke, sphere, torus, add_gem, catmull3, res,
                       scale_plate_geo, merge_geo, ring_tube)


# ---------------- 浮雕盘龙（书封面用） ----------------
def relief_dragon(coll, M, fr, S=1.0, mat=None, name="RLF", coil=1.55, r0=95.0,
                  r1=42.0, body_w=17.0, relief=7.0):
    """浮雕盘龙：扁平脊线（透镜截面）盘绕 + 头 + 四肢爪 + 鬃 + 鳞。
    fr 的 +X=朝外(凸起方向), +Y=横向, +Z=纵向；S 为整体缩放。"""
    mat = mat or M["ivory"]
    out = []
    # ---- 身体脊线：螺旋盘绕 + 起伏 ----
    ctrl = []
    N = 11
    for i in range(N):
        t = i / (N - 1.0)
        a = math.tau * coil * t - 1.45
        r = (r0 + (r1 - r0) * t) * S
        zz = math.sin(t * math.pi * 3.0) * r0 * 0.14 * S
        ctrl.append((0.0, math.cos(a) * r * 1.25, math.sin(a) * r + zz))
    w_prof = [(0, 0.55), (0.06, 0.95), (0.35, 1.0), (0.7, 0.92), (0.88, 0.6),
              (1.0, 0.12)]
    body = curved_blade("GEO-%s_body" % name,
                        [tuple(fr.p(*c)) for c in ctrl], body_w * S, relief * S, coll,
                        n=40, plane=fr.d(1, 0, 0), w_prof=w_prof, smooth=True)
    body.data.materials.append(mat)
    out.append(body)
    # ---- 龙首（侧脸）----
    end = ctrl[-1]
    fwd = Vector((end[1] - ctrl[-2][1], end[2] - ctrl[-2][2], 0))
    fwd = Vector((0, fwd.x, fwd.y)).normalized()
    frh = G2.Frame(tuple(fr.p(end[0] + relief * 0.5 * S, end[1] + fwd.y * body_w * 1.1 * S,
                              end[2] + fwd.z * body_w * 1.1 * S)),
                   forward=tuple(fr.d(0, fwd.y, fwd.z)), up=tuple(fr.d(1, 0, 0)))
    hobs = G2.dragon_head(coll, M, frh, style="book_white", mat=mat,
                          name="%s_HEAD" % name, bulk=0.32 * S)
    out += hobs
    # ---- 四爪 ----
    for k, t in enumerate((0.18, 0.40, 0.62, 0.82)):
        idx = int(t * (len(ctrl) - 1))
        c = ctrl[idx]
        side = 1 if k % 2 == 0 else -1
        base = fr.p(c[0] + relief * 0.3 * S, c[1], c[2])
        knee = fr.p(c[0] + relief * 0.9 * S, c[1] + side * body_w * 1.5 * S,
                    c[2] - body_w * 0.6 * S)
        foot = fr.p(c[0] + relief * 0.2 * S, c[1] + side * body_w * 2.4 * S,
                    c[2] - body_w * 1.4 * S)
        leg = tube_along("GEO-%s_leg%d" % (name, k), [tuple(base), tuple(knee), tuple(foot)],
                         body_w * 0.30 * S, coll, seg=10, mat=mat)
        out.append(leg)
        for j in range(3):
            a = (j - 1) * 0.5
            cl = spoke("GEO-%s_claw%d_%d" % (name, k, j), coll,
                       tuple(foot), tuple(foot + fr.d(0, math.sin(a) * body_w * 0.55 * S,
                                                      -math.cos(a) * body_w * 0.55 * S)
                                          * (body_w * 0.8 * S)),
                       body_w * 0.10 * S, body_w * 0.012 * S, body_w * 0.09 * S, mat=mat)
            out.append(cl)
    # ---- 鬃（头后一排火焰片）----
    for k in range(5):
        t = 0.86 + 0.028 * k
        idx = min(int(t * (len(ctrl) - 1)), len(ctrl) - 1)
        c = ctrl[idx]
        h = (body_w * (1.5 - 0.16 * k)) * S
        p0 = fr.p(c[0], c[1], c[2])
        p1 = fr.p(c[0] + relief * 0.6 * S, c[1] + h * 0.5, c[2] + h * 0.9)
        mane = curved_blade("GEO-%s_mane%d" % (name, k), [tuple(p0), tuple(p1)],
                            body_w * 0.42 * S, relief * 0.5 * S, coll, n=10,
                            plane=fr.d(1, 0, 0), smooth=True)
        mane.data.materials.append(mat)
        out.append(mane)
    # ---- 鳞 ----
    chunks = []
    for i, c in enumerate(ctrl):
        if i == 0 or i == len(ctrl) - 1:
            continue
        nxt = ctrl[i + 1]
        Td = Vector((0, nxt[1] - c[1], nxt[2] - c[2]))
        if Td.length < 1e-6:
            continue
        Td.normalize()
        vv, ff = scale_plate_geo(fr.p(c[0] + relief * 0.85 * S, c[1], c[2]),
                                 Td, fr.d(1, 0, 0), body_w * 0.9 * S, body_w * 1.3 * S,
                                 1.2 * S, 1.0 * S)
        chunks.append((vv, ff))
    if chunks:
        ob = merge_geo("GEO-%s_scales" % name, chunks, coll)
        ob.data.materials.append(mat)
        out.append(ob)
    return out


# ---------------- 护角（真开孔镂空片 + 卷草 + 珍珠） ----------------
def corner_guard(coll, M, fr, size=54.0, mat=None, name="CG", pearl=True,
                 holes=3):
    """护角：三角底板（真开孔）+ 三根卷草肋 + 角珠。fr 的 +X 朝外。"""
    mat = mat or M["gold"]
    out = []
    # 三角底板（开孔）
    hs = []
    for k in range(holes):
        a = math.radians(30 + 120 * k)
        hs.append((math.cos(a) * size * 0.28, math.sin(a) * size * 0.28, size * 0.10))
    try:
        plate = G2.pierced_plate(coll, M, fr, size * 0.9, size * 0.9, 3.2, hs,
                                 mat=mat, name=name)
    except Exception as ex:
        print("guard pierce fail", ex)
        plate = None
    if plate:
        out.append(plate)
    # 三根卷草肋
    for k in range(3):
        a = math.radians(35 + 125 * k)
        p0 = fr.p(size * 0.06, math.cos(a) * size * 0.10, math.sin(a) * size * 0.10)
        p1 = fr.p(size * 0.045, math.cos(a) * size * 0.30, math.sin(a) * size * 0.30)
        p2 = fr.p(size * 0.035, math.cos(a + 0.42) * size * 0.40,
                  math.sin(a + 0.42) * size * 0.40)
        rib = curved_blade("GEO-%s_rib%d" % (name, k), [tuple(p0), tuple(p1), tuple(p2)],
                           size * 0.075, size * 0.035, coll, n=14,
                           plane=fr.d(1, 0, 0), smooth=True)
        rib.data.materials.append(mat)
        out.append(rib)
    # 角珠
    if pearl:
        p = fr.p(size * 0.24, 0, 0)
        out.append(sphere("GEO-%s_pearl" % name, coll, tuple(p), size * 0.13,
                          seg=16, ring=12, mat=M["pearl"]))
    return out


# ---------------- 罗盘书扣（环 + 8 芒 + 铰 + 珠） ----------------
def clasp_compass(coll, M, fr, R=34.0, mat=None, name="CLASP"):
    mat = mat or M["gold"]
    out = []
    for rr, tt in ((R, 4.2), (R * 0.58, 2.6)):
        out.append(ring_tube("GEO-%s_ring%d" % (name, int(rr)), coll, rr, rr,
                             (lambda th: 0.0), tt, seg=64, ring=8, mat=mat))
        # ring_tube 在 XY 平面；旋转到目标平面
        out[-1].rotation_euler = (math.radians(90), 0, 0)
    for k in range(8):
        a = math.tau * k / 8
        L = R * (0.94 if k % 2 == 0 else 0.90)
        out.append(spoke("GEO-%s_ray%d" % (name, k), coll,
                         (0, math.cos(a) * R * 0.64, math.sin(a) * R * 0.64),
                         (0, math.cos(a) * L, math.sin(a) * L),
                         R * 0.085, R * 0.02, R * 0.055, mat=mat))
    out.append(sphere("GEO-%s_hub" % name, coll, (0, 0, 0), R * 0.20, seg=16, ring=12,
                      mat=M["pearl"]))
    # 铰链与搭扣舌
    out.append(taper_cyl("GEO-%s_hinge" % name, coll, (0, -R * 1.15, 0),
                         (0, -R * 1.15, -R * 0.55), R * 0.16, R * 0.14, seg=12, mat=mat))
    out.append(curved_blade("GEO-%s_keeper" % name,
                            [(0, -R * 1.15, -R * 0.5), (0, -R * 0.7, -R * 0.95),
                             (0, -R * 0.1, -R * 0.85)], R * 0.16, R * 0.10, coll, n=12,
                            plane=(1, 0, 0), smooth=True))
    for o in out:
        o.location = tuple(fr.p(0, 0, 0) * MM)
    return out


# ---------------- 书脊箍（真环形 + 星纹） ----------------
def spine_band(coll, M, zc, R=34.0, mat=None, name="BAND"):
    mat = mat or M["gold"]
    out = []
    ob = ring_tube("GEO-%s_tube" % name, coll, R, R, (lambda th: zc), 6.5,
                   seg=48, ring=10, mat=mat)
    out.append(ob)
    for k in range(4):
        a = math.tau * k / 4
        out.append(spoke("GEO-%s_star%d" % (name, k), coll,
                         (math.cos(a) * R * 0.5, math.sin(a) * R * 0.5, zc),
                         (math.cos(a) * R * 0.95, math.sin(a) * R * 0.95, zc),
                         5.0, 1.0, 4.0, mat=mat))
    return out


# ---------------- 翼羽列（昆古尼尔） ----------------
def wing_fan(coll, M, fr, sgn=1, count=10, size=110.0, mat=None, name="WING"):
    """每侧 count 片羽刃，扇形张开、层叠、带中脊。"""
    mat = mat or M["gold"]
    out = []
    for k in range(count):
        t = k / max(1, count - 1.0)
        ang = math.radians(12.0 + 76.0 * t)
        L = size * (1.0 - 0.42 * t)
        p0 = fr.p(0.0, sgn * 10.0, 0.0)
        p1 = fr.p(0.0, sgn * math.cos(ang * 0.5) * L * 0.5,
                 math.sin(ang * 0.5) * L * 0.5)
        p2 = fr.p(0.0, sgn * math.cos(ang) * L, math.sin(ang) * L)
        p3 = fr.p(0.0, sgn * math.cos(ang + 0.18) * L * 1.06,
                  math.sin(ang + 0.18) * L * 1.06)
        fe = curved_blade("GEO-%s_%d" % (name, k), [tuple(p0), tuple(p1), tuple(p2), tuple(p3)],
                          size * 0.075 * (1 - 0.35 * t), size * 0.045, coll, n=16,
                          plane=fr.d(1, 0, 0), smooth=True)
        fe.data.materials.append(mat)
        out.append(fe)
    return out
