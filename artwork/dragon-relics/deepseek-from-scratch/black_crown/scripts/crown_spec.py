# -*- coding: utf-8 -*-
"""black_crown SPEC (frozen). 全部尺寸单位 = mm；建模时 *MM 转米。
参考：ref/threeview.png（SHA256 7a34a5d5...）。标注 WIDTH 42cm / DEPTH 38cm / HEIGHT 38cm。
坐标：Blender Z-up，前方 = -Y，右侧 = +X，theta 从 -Y（正前）起算，向 +X 为正。
"""

MM = 0.001

# ---------------- 总体 ----------------
W_MM, D_MM, H_MM = 420.0, 380.0, 380.0

# 冠圈（椭圆壁，空心）
RING_A = 195.0        # 外半径 X
RING_B = 180.0        # 外半径 Y
RING_WALL = 32.0      # 壁厚（内圈金带吃在这层里）
BAND_Z0 = 22.0        # 冠圈底
BAND_Z1 = 112.0       # 冠圈顶（冠刺从这里起）
RING_SEG = 128

# 冠刺平面倾角：径向朝外 与 前方(-Y) 的混合系数（0=全径向，1=全朝前）
P_FRONT_BLEND = 0.45

# ---------------- 冠刺表 ----------------
# style: thorn(厚刃冠刺) / flame(金火焰细卷) / hook(小钩)
# theta: 度；h: 尖端高度(mm, 从 z=0 起)；wb: 基部半宽(mm)；lat: 侧向漂移幅度；
# lean: 整体后倾角(度)
SPIKES = [
    dict(name="C0",  theta=0.0,   h=380.0, wb=36.0, style="center", lean=6.0,  lat=0.0),
    dict(name="F1L", theta=-16.0, h=250.0, wb=15.0, style="flame",  lean=14.0, lat=-16.0),
    dict(name="F1R", theta=16.0,  h=250.0, wb=15.0, style="flame",  lean=14.0, lat=16.0),
    dict(name="T2L", theta=-38.0, h=330.0, wb=42.0, style="thorn",  lean=16.0, lat=-26.0),
    dict(name="T2R", theta=38.0,  h=330.0, wb=42.0, style="thorn",  lean=16.0, lat=26.0),
    dict(name="H3L", theta=-62.0, h=258.0, wb=17.0, style="flame",  lean=20.0, lat=-18.0),
    dict(name="H3R", theta=62.0,  h=258.0, wb=17.0, style="flame",  lean=20.0, lat=18.0),
    dict(name="T4L", theta=-82.0, h=205.0, wb=34.0, style="thorn",  lean=24.0, lat=-20.0),
    dict(name="T4R", theta=82.0,  h=205.0, wb=34.0, style="thorn",  lean=24.0, lat=20.0),
    dict(name="K5L", theta=-108.0, h=125.0, wb=13.0, style="hook",  lean=26.0, lat=-14.0),
    dict(name="K5R", theta=108.0, h=125.0, wb=13.0, style="hook",  lean=26.0, lat=14.0),
    dict(name="C6",  theta=180.0, h=300.0, wb=30.0, style="center", lean=-10.0, lat=0.0),
]

# ---------------- 冠刺型谱（u, 值） ----------------
# 高度剖面（0..1 由基部到尖端）
H_PROF = [(0.0, 0.0), (0.18, 0.30), (0.42, 0.60), (0.68, 0.82), (0.88, 0.955), (1.0, 1.0)]
# 侧向漂移剖面（mm 倍率 * lat）
LAT_PROF_THORN = [(0.0, 0.0), (0.22, 0.35), (0.5, 0.78), (0.72, 1.0), (0.87, 0.72), (1.0, 0.18)]
LAT_PROF_FLAME = [(0.0, 0.0), (0.25, -0.30), (0.5, 0.35), (0.72, 1.0), (0.88, 0.62), (1.0, -0.10)]
LAT_PROF_HOOK = [(0.0, 0.0), (0.3, 0.45), (0.6, 1.0), (0.85, 1.05), (1.0, 0.55)]
LAT_PROF_CENTER = [(0.0, 0.0), (0.5, 0.0), (1.0, 0.0)]

# 半宽剖面（相对 wb 的倍率）
W_PROF_THORN = [(0.0, 1.0), (0.18, 1.08), (0.42, 0.92), (0.68, 0.62), (0.86, 0.30), (0.96, 0.11), (1.0, 0.0)]
W_PROF_FLAME = [(0.0, 0.55), (0.16, 1.0), (0.45, 0.85), (0.7, 0.55), (0.88, 0.26), (1.0, 0.0)]
W_PROF_HOOK = [(0.0, 1.0), (0.3, 0.95), (0.6, 0.70), (0.85, 0.36), (1.0, 0.0)]
W_PROF_CENTER = [(0.0, 1.0), (0.10, 1.25), (0.22, 0.80), (0.45, 0.55), (0.72, 0.36), (0.9, 0.17), (1.0, 0.0)]

# 半厚剖面（mm，未乘 wb）
T_PROF_THICK = [(0.0, 9.0), (0.3, 6.5), (0.6, 4.0), (0.85, 1.8), (1.0, 0.25)]
T_PROF_FLAME = [(0.0, 6.0), (0.3, 4.2), (0.6, 2.6), (0.85, 1.2), (1.0, 0.2)]

PROF = {
    "thorn":  dict(h=H_PROF, lat=LAT_PROF_THORN,  w=W_PROF_THORN,  t=T_PROF_THICK),
    "flame":  dict(h=H_PROF, lat=LAT_PROF_FLAME,  w=W_PROF_FLAME,  t=T_PROF_FLAME),
    "hook":   dict(h=H_PROF, lat=LAT_PROF_HOOK,   w=W_PROF_HOOK,   t=T_PROF_FLAME),
    "center": dict(h=H_PROF, lat=LAT_PROF_CENTER, w=W_PROF_CENTER, t=T_PROF_THICK),
}

# ---------------- 前后中心装饰牌（阶段A占位；阶段B换龙首+宝石组） ----------------
ORN_FRONT = dict(ymm=-RING_B + 6.0, z0=-2.0, z1=175.0, half_w=46.0, half_t=20.0)
ORN_BACK = dict(ymm=RING_B - 6.0, z0=6.0, z1=150.0, half_w=34.0, half_t=17.0)

OUT_DIR = r"./artwork/dragon-relics/deepseek-from-scratch/black_crown"
BLEND = OUT_DIR + "/black_crown_silhouette.blend"
