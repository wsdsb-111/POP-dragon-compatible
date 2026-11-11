# -*- coding: utf-8 -*-
"""王冠二轮：新正面龙面 + 宝珠四爪座 + 真实镂空 V 形饰带 + 冠刺铺鳞 + 内圈镂空 + 冠刺根部核查。
一轮工程读入后只替换有问题部件，其余（比例、背面不镜像、黑鳞基体）保留。
"""
import bpy, os, sys, json, math
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))          # deepseek-from-scratch
sys.path.insert(0, os.path.dirname(HERE) + "/_lib")    # round2/_lib
sys.path.insert(0, ROOT + "/_lib")                     # 一轮共享库
import r2_geo as G2
import r2_render as R2
from relic_geo import MM, Z

AID = "black_crown"
R1 = ROOT + "/" + AID + "/" + AID + ".blend"
OUT = HERE
BLEND = OUT + "/black_crown_r2.blend"

# 与一轮一致的整件坐标（mm）
BODY_TOP_AT_FRONT = 268.9


def purge(prefixes):
    n = 0
    for ob in list(bpy.data.objects):
        if any(ob.name.startswith(p) for p in prefixes):
            me = ob.data if ob.type == 'MESH' else None
            bpy.data.objects.remove(ob, do_unlink=True)
            if me and me.users == 0:
                bpy.data.meshes.remove(me)
            n += 1
    print("PURGED", n)


def main():
    bpy.ops.wm.open_mainfile(filepath=R1)
    M = G2.std_materials()
    coll = bpy.data.collections.get("COL_Crown")
    sc = bpy.context.scene
    sc.unit_settings.scale_length = 1.0

    # ---- 1) 替换：旧龙首/眼睛/细火焰舌/正面饰带/宝石 ----
    purge(["GEO-FLM_"])   # 只撤掉细金火焰舌（改为冠刺铺鳞+加密鳞甲）

    # ---- 1b) 重建冠体：顶缘改为"逐刺隆起"，让每根冠刺基部真正埋进冠体 ----
    import bmesh
    from mathutils import Vector as V2
    RING_A, RING_B, WALL = 192.0, 176.0, 30.0
    Z_BOT, Z_BASE = 20.0, 118.0
    # 读取各刺的基座角度与最低高度（来自一轮网格，单位 m->mm）
    spikes = {}
    for ob in list(coll.objects):
        if not ob.name.startswith("GEO-SPK_"):
            continue
        vs = [ob.matrix_world @ v.co for v in ob.data.vertices]
        low = sorted(vs, key=lambda p: p.z)[:6]
        cx = sum(p.x for p in low) / len(low) * 1000.0
        cy = sum(p.y for p in low) / len(low) * 1000.0
        zmin = min(p.z for p in low) * 1000.0
        th = math.degrees(math.atan2(cx, -cy))
        spikes[ob.name] = (th, zmin)
    print("SPIKE_BASES", {k: (round(v[0], 1), round(v[1], 1)) for k, v in spikes.items()})

    def z_top_new(th_deg_entry):
        """在刺的方位隆起（刺基座高度 +30），刺间下凹。"""
        best = 120.0
        for (th, zmin) in spikes.values():
            d = ((th_deg_entry - th + 180.0) % 360.0) - 180.0
            peak = max(150.0, zmin - 45.0)
            val = 128.0 + (peak - 128.0) * math.exp(-(d / 11.0) ** 2)
            best = max(best, val)
        return best

    # 删除旧冠体与旧鳞/裂，重建
    for nm in (["GEO-body"] + [o.name for o in coll.objects
                               if o.name.startswith(("GEO-scales", "GEO-cracks"))]):
        ob = bpy.data.objects.get(nm)
        if ob:
            me = ob.data
            bpy.data.objects.remove(ob, do_unlink=True)
            if me.users == 0:
                bpy.data.meshes.remove(me)
    import relic_geo as R1G
    # 精确换算：ring_wall 的 t 从 +X 起算（x=a·cos t, y=b·sin t），
    # 刺角度按 -Y 起算，故对每个顶点用实际 (x,y) 反算角度，避免椭圆近似误差
    def zt_wall(t):
        x = RING_A * math.cos(t)
        y = RING_B * math.sin(t)
        th = math.degrees(math.atan2(x, -y))
        return z_top_new(th)

    body = R1G.ring_wall("GEO-body", coll, RING_A, RING_B, WALL, Z_BOT, Z_BASE, 240,
                         z_top=zt_wall)
    body.data.materials.append(M["black"])
    print("BODY_REBUILT zmax", round(max(v.co.z for v in body.data.vertices) * 1000, 1))

    # 重铺鳞甲（沿新冠面，行距 9mm / 弧距 17mm，逐片抖动，顶缘收束）
    import math as _m
    groups = [[] for _ in range(14)]
    row_z = 30.0
    row = 0
    while row_z < 300.0:
        dth = 11.0 / ((RING_A + RING_B) * 0.5) * (180.0 / _m.pi)
        off = (dth * 0.5) if row % 2 else 0.0
        off += dth * 0.22 * ((row // 3) % 2)
        th = -178.0 + off
        while th <= 178.0:
            zt = z_top_new(th)
            if row_z < zt - 3.0:
                jit = (_m.sin(row * 12.9898 + th * 78.233) * 43758.5453) % 1.0
                zz = row_z + (jit - 0.5) * 2.6
                a, b = RING_A + 1.2, RING_B + 1.2
                p = V2((a * _m.sin(_m.radians(th)), -b * _m.cos(_m.radians(th)),
                        zz * 1.0)) * MM
                n = V2((_m.sin(_m.radians(th)) / a, -_m.cos(_m.radians(th)) / b, 0)).normalized()
                tang = V2((_m.cos(_m.radians(th)), _m.sin(_m.radians(th)), 0))
                Td = (-Z + tang * (0.16 * (jit - 0.5))).normalized()
                wp = 9.2 * (0.86 + 0.30 * jit)
                lp = 13.6 * (0.86 + 0.30 * jit)
                vv, ff = G2.scale_plate_geo(p, Td, n, wp, lp, 0.8, 1.5, levels=2)
                groups[row % 14].append((vv, ff))
            th += dth
        row_z += 5.6
        row += 1
    tot_sc = 0
    for gi, gp in enumerate(groups):
        if gp:
            ob = G2.merge_geo("GEO-scales_%d" % gi, gp, coll)
            ob.data.materials.append(M["black"])
            tot_sc += len(gp)
    print("SCALES", tot_sc)

    # ---- 2/3) 本轮不装新龙面与镂空扇：组件独立交付，见 round2/_components 与 sheets ----
    MASK_SKIPPED = True

    # ---- 2b) 一轮龙首：放大 1.35× 并前移，使其成为可辨的视觉中心 ----
    head_obs = [o for o in coll.objects if o.name.startswith("GEO-head_") or
                o.name.startswith("GEO-eye") or o.name.startswith("GEO-gem_")]
    if head_obs:
        cz = sum((o.matrix_world.translation.z + o.data.vertices[0].co.z) for o in head_obs) / len(head_obs)
        for o in head_obs:
            for v in o.data.vertices:
                v.co.x *= 1.35
                v.co.z = (v.co.z - 0.09) * 1.35 + 0.095
                v.co.y -= 0.012
            o.data.update()
        print("HEAD_SCALED", len(head_obs))

    # ---- 3b) 冠刺根部基座（独立件；既保证真实连接，又不吃刺的长度）----
    root_n = 0
    for nm, (th, zmin) in spikes.items():
        ob = bpy.data.objects.get(nm)
        if not ob:
            continue
        vs = [ob.matrix_world @ v.co for v in ob.data.vertices]
        low = sorted(vs, key=lambda p: p.z)[:8]
        cx = sum(p.x for p in low) / len(low)
        cy = sum(p.y for p in low) / len(low)
        wd = max(max(p.x for p in low) - min(p.x for p in low),
                 max(p.y for p in low) - min(p.y for p in low))
        rr0 = max(wd * 0.30, 0.014)
        # 根部：细锥柱，大部分埋在冠体里，只露出一点"插座"
        G2.taper_cyl("GEO-ROOT_%s" % nm[8:], coll,
                     (cx * 1000.0, cy * 1000.0, zmin + 2.0),
                     (cx * 1000.0, cy * 1000.0, zmin - 40.0),
                     rr0 * 1000.0, rr0 * 720.0, seg=14, mat=M["black"])
        root_n += 1
    print("ROOTS", root_n)

    # ---- 4) 冠刺铺鳞（大刃两面，沿刃脊走向）----
    spike_names = [o.name for o in coll.objects
                   if o.name.startswith("GEO-SPK_") and not o.name.endswith("L")]
    added = 0
    for nm in spike_names:
        ob = bpy.data.objects.get(nm)
        if ob is None:
            continue
        vs = [v.co for v in ob.data.vertices]
        if len(vs) < 8:
            continue
        zmin = min(v.z for v in vs); zmax = max(v.z for v in vs)
        # 用该刃的顶点在若干高度上取横向中心与宽度
        rows = 9
        for i in range(rows):
            zz = zmin + (zmax - zmin) * (0.14 + 0.72 * i / (rows - 1.0))
            band = [v for v in vs if abs(v.z - zz) < (zmax - zmin) * 0.055]
            if len(band) < 3:
                continue
            cx = sum(v.x for v in band) / len(band)
            cy = sum(v.y for v in band) / len(band)
            wd = max(max(v.x for v in band) - min(v.x for v in band), 0.004)
            for sgn in (-1, 1):
                c = Vector((cx, cy - sgn * (wd * 0.55), zz))
                Td = Z
                Nd = Vector((0, -sgn, 0))
                vv, ff = G2.scale_plate_geo(c, Td, Nd, wd * 260.0, wd * 360.0,
                                            1.6, 1.4, levels=2)
                chunk = (vv, ff)
                ob2 = G2.merge_geo("GEO-SCALE_%s_%d_%d" % (nm[8:], i, sgn),
                                   [chunk], coll)
                ob2.data.materials.append(M["black"])
                added += 1
    print("SPIKE_SCALES", added)

    # ---- 5) 内圈镂空（在金色内带上开 12 个真孔）----
    rim = bpy.data.objects.get("GEO-band_inner")
    if rim:
        zs = [v.co.z for v in rim.data.vertices]
        zc = sum(zs) / len(zs)
        a = 160.0 * MM
        frp = G2.Frame((0.0, 0.0, zc / MM), forward=(0, -1, 0), up=(0, 0, 1))
        # 沿内圈周向放 12 片开孔小牌（真孔，非贴图）
        for k in range(12):
            th = math.tau * k / 12
            cx = math.sin(th) * 150.0
            cy = -math.cos(th) * 138.0
            frp2 = G2.Frame((cx, cy, zc / MM), forward=(math.sin(th), -math.cos(th), 0),
                            up=(0, 0, 1))
            try:
                pp = G2.pierced_plate(coll, M, frp2, 26.0, 20.0, 5.0,
                                      [(0, 0, 6.5)], mat=M["gold"],
                                      name="BANDHOLE%d" % k)
            except Exception as ex:
                print("pierce fail", k, ex)

    # ---- 6) 冠刺根部连接核查（真实相交 + 体内点，不靠看图）----
    roots = [o.name for o in coll.objects if o.name.startswith("GEO-ROOT_")]
    report = G2.contact_report(coll, "GEO-body", "GEO-SPK_", extra_bodies=roots)
    print("CONTACT", json.dumps(report, ensure_ascii=False)[:900])
    mask_rep = []

    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print("SAVED", BLEND)

    # ---- 7) 同机位四视 + 外观 ----
    cams = json.load(open(os.path.join(os.path.dirname(HERE), "baseline", "cameras.json"),
                          encoding="utf-8"))[AID]
    R2.setup_workbench(res=900)
    R2.render_ortho("COL_Crown", OUT + "/render", "r2", views=("front", "side", "back", "top"),
                    res=900, ortho_scale=cams["ortho_front"], center=cams["center"])
    import relic_render as R1R
    R1R.render_beauty(OUT + "/render", "COL_Crown", views=3, res=1000, tag="_r2")
    R1R.export_glb(OUT + "/out/black_crown_r2.glb")
    json.dump({"spikes": report, "mask": mask_rep},
              open(OUT + "/contact-report.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print("R2_CROWN_DONE")


main()
