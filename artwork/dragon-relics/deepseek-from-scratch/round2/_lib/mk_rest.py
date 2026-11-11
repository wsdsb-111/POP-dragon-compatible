# -*- coding: utf-8 -*-
"""其余四件（权柄/玄戒/石棺/昆古尼尔）二轮：组件化替换 + 真连接检查 + 同机位出图。"""
import bpy, os, sys, json, math
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))          # round2/_lib
R2D = os.path.dirname(HERE)
ROOT = os.path.dirname(R2D)
sys.path.insert(0, ROOT + "/_lib")
sys.path.insert(0, HERE)
import r2_geo as G2
import r2_comp as C2
import r2_render as R2
from relic_geo import MM, Z, sphere, spoke, ring_tube, taper_cyl, curved_blade, torus, add_gem

CAMS = json.load(open(R2D + "/baseline/cameras.json", encoding="utf-8"))


def purge(coll, prefixes):
    n = 0
    for ob in list(bpy.data.objects):
        if any(ob.name.startswith(p) for p in prefixes):
            me = ob.data if ob.type == 'MESH' else None
            bpy.data.objects.remove(ob, do_unlink=True)
            if me and me.users == 0:
                bpy.data.meshes.remove(me)
            n += 1
    print("  PURGED", n)


def finish(aid, col, blend, out, extra=None):
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    cams = CAMS[aid]
    R2.setup_workbench(res=900)
    R2.render_ortho(col, out + "/render", "r2", views=("front", "side", "back", "top"),
                    res=900, ortho_scale=cams["ortho_front"], center=cams["center"])
    import relic_render as R1R
    R1R.render_beauty(out + "/render", col, views=3, res=1000, tag="_r2")
    R1R.export_glb(out + "/out/%s_r2.glb" % aid)
    print("  DONE", aid)


# ---------------- 权柄 ----------------
def build_regalia():
    aid = "black_regalia"
    out = R2D + "/" + aid
    bpy.ops.wm.open_mainfile(filepath=ROOT + "/" + aid + "/" + aid + ".blend")
    M = G2.std_materials()
    coll = bpy.data.collections.get("COL_Regalia")
    print("[regalia]")
    purge(coll, ["GEO-wheel", "GEO-orb_", "GEO-dragon_", "GEO-coil", "GEO-ribbon",
                 "GEO-chain", "GEO-tassel"])
    # 头部重构：开窗星轮（真开孔）+ 盘龙 + 宝珠
    fr = G2.Frame((0.0, 0.0, 2090.0), forward=(1, 0, 0), up=(0, 0, 1))
    # 星轮：8 根真肋 + 内外环（负空间真实）
    for k in range(8):
        a = math.tau * k / 8
        p0 = (0.0, math.cos(a) * 62.0, math.sin(a) * 62.0 + 2090.0)
        p1 = (0.0, math.cos(a) * 118.0, math.sin(a) * 118.0 + 2090.0)
        p2 = (0.0, math.cos(a + 0.20) * 150.0, math.sin(a + 0.20) * 150.0 + 2090.0)
        rib = curved_blade("GEO-wheel_rib%d" % k, [p0, p1, p2], 13.0, 9.0, coll, n=14,
                           plane=(1, 0, 0), smooth=True)
        rib.data.materials.append(M["gold"])
    for rr, tt in ((156.0, 7.0), (60.0, 5.5)):
        ob = ring_tube("GEO-wheel_ring%d" % int(rr), coll, rr, rr,
                       (lambda th: 0.0), tt, seg=64, ring=10, mat=M["gold"])
        ob.rotation_euler = (math.radians(90), 0, 0)
        ob.location = (0.0, 0.0, 2090.0 * MM)
    # 宝珠 + 六爪
    cup, claws, gem = G2.gem_mount(coll, M, G2.Frame((0.0, 0.0, 2090.0),
                                                    forward=(0, -1, 0), up=(0, 0, 1)),
                                   46.0, 60.0, prongs=6, mat=M["gold"],
                                   gem_mat=M["ruby"], name="ORB")
    # 盘龙：绕珠一圈的扁平身
    ctrl = []
    for i in range(13):
        t = i / 12.0
        a = math.tau * 0.92 * t - 1.2
        ctrl.append((0.0, math.cos(a) * 96.0, math.sin(a) * 96.0 + 2090.0 + 25.0 * math.sin(math.pi * t)))
    body = curved_blade("GEO-coil_body", ctrl, 20.0, 16.0, coll, n=44, plane=(1, 0, 0),
                        w_prof=[(0, 0.5), (0.08, 0.95), (0.5, 1.0), (0.9, 0.7), (1, 0.12)],
                        smooth=True)
    body.data.materials.append(M["gold"])
    end = ctrl[-1]
    frh = G2.Frame((0.0, end[1] + 12.0, end[2] + 8.0), forward=(0, 1, 0.2), up=(1, 0, 0))
    G2.dragon_head(coll, M, frh, style="regalia_coil", mat=M["gold"], name="COILHEAD",
                   bulk=0.42)
    # 红绸：带褶皱的布条
    for sgn in (-1, 1):
        aa = [(sgn * 26.0, -10.0, 2000.0), (sgn * 58.0, -26.0, 1820.0),
              (sgn * 44.0, -46.0, 1640.0), (sgn * 66.0, -30.0, 1480.0)]
        G2.cloth_sheet(coll, M, aa, width_mm=104.0, folds=2, fold_amp=7.0, twist_deg=8.0,
                       thickness=1.6, mat=M.get("ribbon_red") or M.get("silk_red") or M["gold"], name="ribbon%d" % sgn,
                       flare=0.10, sag=10.0)
    # 链环（真穿套）
    for sgn in (-1, 1):
        G2.real_chain(coll, M, (sgn * 96.0, -34.0, 2010.0), (sgn * 0.35, 0.0, -1.0), 9,
                      link_len=30.0, link_r=3.4, mat=M["gold"], name="HEADCHAIN%d" % sgn)
    finish(aid, "COL_Regalia", out + "/%s_r2.blend" % aid, out)


# ---------------- 玄戒 ----------------
def build_ring():
    aid = "fire_ring"
    out = R2D + "/" + aid
    bpy.ops.wm.open_mainfile(filepath=ROOT + "/" + aid + "/" + aid + ".blend")
    M = G2.std_materials()
    coll = bpy.data.collections.get("COL_Ring")
    print("[ring]")
    purge(coll, ["GEO-gem", "GEO-mount", "GEO-dragon_", "GEO-head", "GEO-orb"])
    # 主宝石重做：镶座 + 爪 + 刻面
    cup, claws, gem = G2.gem_mount(coll, M,
                                   G2.Frame((0.0, -12.0, 30.0), forward=(0, 1, 0),
                                            up=(0, 0, 1)),
                                   26.0, 34.0, prongs=6, mat=M["gold"],
                                   gem_mat=M["ruby"], name="MAINGEM")
    # 两侧小龙头（ring_pair，短吻、角后掠）
    for sgn in (-1, 1):
        fr = G2.Frame((sgn * 20.0, 2.0, 20.0), forward=(sgn * 0.35, -1.0, 0.25),
                      up=(0, 0, 1))
        G2.dragon_head(coll, M, fr, style="ring_pair", mat=M["gold"],
                       name="RHEAD%d" % sgn, bulk=1.0, jaw_open=18)
    finish(aid, "COL_Ring", out + "/%s_r2.blend" % aid, out)


# ---------------- 石棺 ----------------
def build_sarc():
    aid = "earth_sarcophagus"
    out = R2D + "/" + aid
    bpy.ops.wm.open_mainfile(filepath=ROOT + "/" + aid + "/" + aid + ".blend")
    M = G2.std_materials()
    coll = bpy.data.collections.get("COL_Sarcophagus")
    print("[sarcophagus]")
    purge(coll, ["GEO-lid_dragon", "GEO-ldragon", "GEO-niche"])
    # 盖面两条浮雕龙（石质），一左一右，姿态不同
    for sgn, zz in ((1, 842.0), (-1, 842.0)):
        fr = G2.Frame((sgn * 700.0, 0.0, zz), forward=(0, 0, 1), up=(0, sgn * 1.0, 0))
        C2.relief_dragon(coll, M, fr, S=1.55, mat=M.get("stone_light") or M.get("marble") or bpy.data.materials.get("M-stone_light") or M["gold"],
                         name="LIDDRAGON%d" % sgn, coil=1.2, r0=150.0, r1=80.0,
                         body_w=30.0, relief=12.0)
    finish(aid, "COL_Sarcophagus", out + "/%s_r2.blend" % aid, out)


# ---------------- 昆古尼尔 ----------------
def build_spear():
    aid = "sky_spear"
    out = R2D + "/" + aid
    bpy.ops.wm.open_mainfile(filepath=ROOT + "/" + aid + "/" + aid + ".blend")
    M = G2.std_materials()
    coll = bpy.data.collections.get("COL_Spear")
    print("[spear]")
    purge(coll, ["GEO-wing", "GEO-feather", "GEO-blade"])
    # 翼饰：每侧 10 片羽刃，层叠张开
    for sgn in (-1, 1):
        fr = G2.Frame((0.0, 0.0, 1995.0), forward=(0, -1, 0), up=(0, 0, 1))
        C2.wing_fan(coll, M, fr, sgn=sgn, count=10, size=150.0, mat=M["gold"],
                    name="WING%d" % sgn)
    # 枪头：长叶形刃 + 中脊 + 血槽
    frb = G2.Frame((0.0, 0.0, 2130.0), forward=(0, 0, 1), up=(0, -1, 0))
    bl = curved_blade("GEO-blade_main",
                      [tuple(frb.p(0, 0, -60)), tuple(frb.p(0, -6, 60)),
                       tuple(frb.p(0, 0, 190))], 52.0, 16.0, coll, n=26,
                      plane=frb.d(0, 1, 0), smooth=True)
    bl.data.materials.append(M.get("glow_gold") or M["gold"])
    finish(aid, "COL_Spear", out + "/%s_r2.blend" % aid, out)


if __name__ == "__main__":
    which = sys.argv[-1] if len(sys.argv) else "all"
    if which in ("regalia", "all"):
        build_regalia()
    if which in ("ring", "all"):
        build_ring()
    if which in ("sarc", "all"):
        build_sarc()
    if which in ("spear", "all"):
        build_spear()
