# -*- coding: utf-8 -*-
"""海妖之甲二轮：把六片"平板纱"换成有真实褶皱/垂坠/扭转/层间空隙的布片，
并加一层带褶的外裙（与内裙之间留空隙）。仅陈列件，不加人体与手臂。"""
import bpy, os, sys, json, math
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.dirname(HERE) + "/_lib")
sys.path.insert(0, ROOT + "/_lib")
import r2_geo as G2
import r2_comp as C2
import r2_render as R2
from relic_geo import MM, Z, sphere, taper_cyl, curved_blade, ring_tube, spoke

AID = "sea_armor"
R1 = ROOT + "/" + AID + "/" + AID + ".blend"
OUT = HERE
BLEND = OUT + "/sea_armor_r2.blend"


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


# 六片纱的挂点（与一轮一致）：x, z, 宽, 材质, 朝向角
VEILS = [(96.0, 1470.0, 120.0, "veil_blue", 0.30),
         (-96.0, 1470.0, 120.0, "veil_blue", -0.30),
         (150.0, 1462.0, 132.0, "veil_white", 0.70),
         (-150.0, 1462.0, 132.0, "veil_white", -0.70),
         (196.0, 1452.0, 126.0, "veil_blue", 1.15),
         (-196.0, 1452.0, 126.0, "veil_blue", -1.15)]


def main():
    bpy.ops.wm.open_mainfile(filepath=R1)
    M = G2.std_materials()
    # 复用一轮的纱材质（半透明、带布纹）
    for k in ("veil_blue", "veil_white", "cloth_white2", "cloth_blue"):
        ob = bpy.data.materials.get("M-" + k)
        if ob:
            M[k] = ob
    coll = bpy.data.collections.get("COL_Armor")

    purge(["GEO-veil"])

    # ---- 1) 六片真实褶皱纱：挂点 -> 下摆，褶皱振幅随下垂增大，含扭转 ----
    made = 0
    for k, (x0, z0, wd, matk, ang) in enumerate(VEILS):
        ca, sa = math.cos(ang), math.sin(ang)
        r0 = math.hypot(x0, 0.0)
        # 挂点沿甲肩外侧，下垂到 380 左右，末端外扩
        anchors = []
        for i, t in enumerate((0.0, 0.35, 0.7, 1.0)):
            zz = z0 - (z0 - 360.0) * t
            rr = r0 * (1.0 + 0.16 * t)
            xx = math.copysign(rr, x0) * (1.0 - 0.10 * t) + ca * 30.0 * t
            yy = 96.0 + 26.0 * t + sa * 46.0 * t
            anchors.append((xx, yy, zz))
        ob = G2.cloth_sheet(coll, M, anchors, width_mm=wd * 2.6, folds=5 + (k % 2),
                            fold_amp=22.0 + 6.0 * (k % 3), twist_deg=14.0 + 5.0 * k,
                            thickness=2.2, mat=M[matk], name="veil_cloth%d" % k,
                            flare=0.22, sag=24.0, wrap_r=250.0)
        made += 1
    print("VEILS", made)

    # ---- 2) 外裙层（带褶，与内裙之间留 18mm 空隙）----
    anchors = []
    for i, t in enumerate((0.0, 0.3, 0.6, 0.85, 1.0)):
        zz = 1030.0 - (1030.0 - 300.0) * t
        rr = 300.0 + 90.0 * t
        anchors.append((0.0, -rr * 0.92, zz))
    # 外裙：用与内裙同一 loft_wall 生成器做两层真实裙层（半径外扩 20-26mm，留空隙）
    G2.loft_shell("GEO-skirt_layerA", coll,
                 [(430.0, 404.0, 348.0), (700.0, 336.0, 290.0), (1010.0, 196.0, 168.0)],
                 seg=72, thick=4.0, mat=M["cloth_blue"], wave=30.0, waven=8)
    G2.loft_shell("GEO-skirt_layerB", coll,
                 [(760.0, 306.0, 266.0), (940.0, 250.0, 218.0), (1020.0, 208.0, 180.0)],
                 seg=64, thick=3.5, mat=M["cloth_white2"], wave=18.0, waven=10)
    print("SKIRT_LAYERS")

    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print("SAVED", BLEND)

    # 布片对甲体的干涉/空隙检查
    rep = G2.contact_report(coll, "GEO-bodice", "GEO-veil_cloth", inside_probe=12)
    for r in rep:
        print("   veil", r["part"], "overlap", r["overlap_pairs"], "dist",
              r["min_dist_mm"], "connected", r["connected"])
    json.dump(rep, open(OUT + "/contact-armor.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)

    cams = json.load(open(os.path.join(os.path.dirname(HERE), "baseline", "cameras.json"),
                          encoding="utf-8"))[AID]
    R2.setup_workbench(res=900)
    R2.render_ortho("COL_Armor", OUT + "/render", "r2",
                    views=("front", "side", "back", "top"), res=900,
                    ortho_scale=cams["ortho_front"], center=cams["center"])
    import relic_render as R1R
    R1R.render_beauty(OUT + "/render", "COL_Armor", views=3, res=1000, tag="_r2")
    R1R.export_glb(OUT + "/out/sea_armor_r2.glb")
    print("R2_ARMOR_DONE")


main()
