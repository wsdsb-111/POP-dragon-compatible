# -*- coding: utf-8 -*-
"""black_crown 阶段A：冠圈 + 弯曲冠刺 轮廓白模（v2）。
catalog 无"任意朝向叶片扫掠"算子，故用 bpy/bmesh 自写生成器（已查 catalog 记录在案）；
产出仍回 audit/qc 门验收。
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import crown_geo as G
from crown_geo import MM

OUT_DIR = os.path.dirname(HERE)
BLEND = OUT_DIR + "/black_crown_silhouette.blend"

# ---------------- SPEC（mm） ----------------
RING_A, RING_B, RING_WALL = 192.0, 176.0, 30.0
BAND_Z0, BAND_Z1 = 20.0, 108.0
SPIKE_BASE_Z = 96.0
P_K = 0.45          # 面法线：径向 vs 前方(-Y) 混合

H_PROF = [(0.0, 0.0), (0.15, 0.26), (0.35, 0.52), (0.58, 0.74), (0.78, 0.90),
          (0.92, 0.975), (1.0, 1.0)]
LAT_PROF = [(0.0, 0.0), (0.30, 0.05), (0.55, 0.14), (0.75, 0.40), (0.88, 0.70), (1.0, 1.0)]
W_OUT = [(0.0, 0.92), (0.15, 1.0), (0.35, 1.02), (0.55, 0.86), (0.72, 0.62),
         (0.86, 0.34), (0.95, 0.13), (1.0, 0.0)]
W_IN = [(0.0, 0.78), (0.15, 0.86), (0.35, 0.80), (0.55, 0.56), (0.72, 0.34),
        (0.86, 0.16), (1.0, 0.0)]
T_PROF = [(0.0, 9.0), (0.25, 7.0), (0.5, 4.5), (0.75, 2.4), (0.9, 1.0), (1.0, 0.2)]

# theta, 尖端高度(mm 从 z=0), 基部半宽, 外倾角, 侧向钩出(mm)
SPIKES = [
    dict(name="C0", theta=0.0,   h=380.0, wb=30.0, lean=1.0,  lat=0.0),
    dict(name="F1", theta=16.0,  h=264.0, wb=14.0, lean=-2.0, lat=30.0),
    dict(name="T2", theta=38.0,  h=340.0, wb=40.0, lean=-4.0, lat=40.0),
    dict(name="H3", theta=62.0,  h=272.0, wb=15.0, lean=-6.0, lat=44.0),
    dict(name="T4", theta=82.0,  h=226.0, wb=30.0, lean=8.0,  lat=28.0),
    dict(name="K5", theta=108.0, h=152.0, wb=14.0, lean=22.0, lat=24.0),
    dict(name="C6", theta=180.0, h=312.0, wb=28.0, lean=1.0,  lat=0.0),
]

# 金火焰舌：(theta0, z0, theta1, z1, 外凸mm, 半宽mm, 半厚mm)
FLAMES = [
    ( 9.0, 132.0,  13.0, 300.0,  4.0, 10.0, 6.0),
    (26.0, 108.0,  34.0, 246.0,  9.0, 13.0, 7.0),
    (44.0, 100.0,  58.0, 214.0, 12.0, 14.0, 7.0),
    (66.0,  96.0,  84.0, 186.0, 14.0, 16.0, 8.0),
    (92.0,  92.0, 112.0, 152.0, 10.0, 12.0, 7.0),
    (118.0, 90.0, 138.0, 120.0,  8.0,  9.0, 6.0),
]


def flame_pts(theta0, z0, theta1, z1, bulge):
    """沿冠圈表面升起的曲面脊线（mm）。"""
    pts = []
    for t in (0.0, 0.34, 0.68, 1.0):
        th = math.radians(theta0 + (theta1 - theta0) * t)
        z = z0 + (z1 - z0) * t
        b = 1.0 + (bulge / 100.0) * math.sin(math.pi * min(max(t, 0.0), 1.0))
        x = (RING_A - 4.0) * math.sin(th) * b
        y = -(RING_B - 4.0) * math.cos(th) * b
        pts.append((x, y, z))
    return pts


def z_top(theta_deg):
    """冠体顶缘高度（波浪形）：在冠刺根部隆起，刺间下凹。"""
    z = 118.0
    peaks = [(0.0, 132.0, 9.0), (38.0, 104.0, 15.0), (62.0, 74.0, 12.0),
             (82.0, 58.0, 11.0), (108.0, 32.0, 13.0), (180.0, 112.0, 13.0)]
    for c, amp, wid in peaks:
        cands = (c,) if c in (0.0, 180.0) else (c, -c)
        for cand in cands:
            d = ((theta_deg - cand + 180.0) % 360.0) - 180.0
            z += amp * math.exp(-(d / wid) ** 2)
    return z


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
    coll = bpy.data.collections.get("COL_Crown") or bpy.data.collections.new("COL_Crown")
    if coll.name not in sc.collection.children:
        sc.collection.children.link(coll)

    G.ring_wall("GEO-body", coll, RING_A, RING_B, RING_WALL, BAND_Z0, BAND_Z1, 160,
                z_top=lambda th: z_top(math.degrees(th)))

    defaults = dict(k=P_K, n=34,
                    prof=dict(h=H_PROF, lat=LAT_PROF, w_out=W_OUT, w_in=W_IN, t=T_PROF))
    for sp in SPIKES:
        th = math.radians(sp["theta"])
        bx = (RING_A - RING_WALL * 0.5) * math.sin(th)
        by = -(RING_B - RING_WALL * 0.5) * math.cos(th)
        bz = max(z_top(sp["theta"]) - 26.0, BAND_Z0 + 20.0)
        base = (bx * MM, by * MM, bz * MM)
        radial = Vector((math.sin(th), -math.cos(th), 0.0))
        sp2 = dict(sp)
        m = G.blade_from_spec("GEO-SPK_" + sp["name"], sp2, base, radial, coll, defaults)
        if abs(sp["theta"]) > 1e-6:
            G.mirror_x(m, "GEO-SPK_%sL" % sp["name"], coll)

    # 金火焰舌（细薄卷曲饰，构成镂空轮廓）
    for i, (t0, z0, t1, z1, bulge, w0, th0) in enumerate(FLAMES):
        thm = math.radians((t0 + t1) * 0.5)
        plane = Vector((math.sin(thm), -math.cos(thm), 0.0))
        m = G.curved_blade("GEO-FLM_%02d" % i, flame_pts(t0, z0, t1, z1, bulge),
                           w0, th0, coll, n=24, plane=plane)
        G.mirror_x(m, "GEO-FLM_%02dL" % i, coll)

    # 前后中心装饰牌（阶段A占位）
    for nm, yc, z0, z1, hw, ht in (("GEO-ORN_front", -170.0, -4.0, 178.0, 44.0, 20.0),
                                   ("GEO-ORN_back", 170.0, 4.0, 152.0, 32.0, 20.0)):
        A, U, P = G.blade_frame(Vector((0, 1, 0)), 0.0, 0.0)
        G.lens_blade(nm, (0.0, yc * MM, z0 * MM), A, U, P, z1 - z0,
                     [(0, 0), (1, 1)], [(0, 0), (1, 0)],
                     [(0, 0.0), (0.18, 0.62), (0.38, 1.0), (0.62, 0.74), (0.84, 0.3), (1.0, 0)],
                     [(0, 0.0), (0.18, 0.62), (0.38, 1.0), (0.62, 0.74), (0.84, 0.3), (1.0, 0)],
                     [(0, ht * 0.5), (0.5, ht), (0.82, ht * 0.62), (1, ht * 0.15)], n=22, coll=coll)

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
    print("BUILD obj=%d tris=%d  W=%.1f D=%.1f H=%.1f  x[%.1f,%.1f] y[%.1f,%.1f] z[%.1f,%.1f]" %
          (len(coll.objects), tris, dim.x, dim.y, dim.z,
           mn.x * 1000, mx.x * 1000, mn.y * 1000, mx.y * 1000, mn.z * 1000, mx.z * 1000))
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print("SAVED", BLEND)


main()
