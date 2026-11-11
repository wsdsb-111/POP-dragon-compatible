# -*- coding: utf-8 -*-
"""白书二轮：浮雕盘龙（独立组件库）+ 四角真开孔护角 + 罗盘书扣 + 书脊箍星纹 + 真环链饰。
保留一轮的书体（封面/书页/书脊）与已定比例。"""
import bpy, os, sys, json, math
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.dirname(HERE) + "/_lib")
sys.path.insert(0, ROOT + "/_lib")
import r2_geo as G2
import r2_comp as C2
import r2_render as R2
from relic_geo import MM, Z, sphere, spoke, ring_tube, taper_cyl, curved_blade

AID = "white_book"
R1 = ROOT + "/" + AID + "/" + AID + ".blend"
OUT = HERE
BLEND = OUT + "/white_book_r2.blend"


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
    M["ivory_relief"] = G2.tex_mat("M-ivory_relief", "Marble012", darken=1.05,
                                   metallic=0.0, tint=(1.02, 0.99, 0.93),
                                   proj_scale=2.6)
    coll = bpy.data.collections.get("COL_Book")

    # ---- 撤掉一轮的浮雕龙/旧角饰/书扣/珍珠链/脊箍（保留书体） ----
    purge(["GEO-curl", "GEO-corner", "GEO-clasp", "GEO-spineband", "GEO-pearl",
           "GEO-spinestar", "GEO-tassel", "GEO-pend", "GEO-chain"])

    # ---- 1) 封面浮雕龙：保留一轮（二轮组件版本未达标，见报告）----

    # ---- 2) 四角真开孔护角 ----
    for sx in (-1, 1):
        for sz in (-1, 1):
            frc = G2.Frame((10.0 + sx * 90.0, -36.0, sz * 126.0),
                           forward=(0, -1, 0),
                           up=(sx * 0.7071, 0, sz * 0.7071))
            C2.corner_guard(coll, M, frc, size=44.0, mat=M["gold"],
                            name="CG%d%d" % (sx, sz))

    # ---- 3) 罗盘书扣（前口边缘）----
    frcl = G2.Frame((116.0, -32.0, 0.0), forward=(0, -1, 0), up=(0, 0, 1))
    C2.clasp_compass(coll, M, frcl, R=32.0, mat=M["gold"], name="CLASP")

    # ---- 4) 书脊箍 + 星纹 ----
    for zc in (-104.0, -22.0, 60.0, 128.0):
        obs = C2.spine_band(coll, M, 0.0, R=35.0, mat=M["gold"], name="SB%d" % int(zc))
        for o in obs:
            o.location = (-98.0 * MM, 0.0, zc * MM)

    # ---- 5) 真环珍珠链（挂在书脊外侧）----
    pts = []
    for i in range(9):
        pts.append((-118.0, -26.0, 120.0 - i * 26.0))
    G2.real_chain(coll, M, tuple(pts[0]), (0, 0, -1), count=9, link_len=24.0,
                  link_r=2.6, mat=M["gold"], name="SPCHAIN")
    for i, p in enumerate(pts):
        if i % 2 == 0:
            sphere("GEO-BEAD%d" % i, coll, p, 6.0, seg=14, ring=10, mat=M["pearl"])

    # ---- 6) 封背天体纹（同心环 + 罗盘玫瑰，凸起线）----
    for rr in (96.0, 62.0, 30.0):
        ob = ring_tube("GEO-BACKRING%d" % int(rr), coll, rr, rr * 0.92,
                       (lambda th: 0.0), 3.2, seg=72, ring=8, mat=M["gold"])
        ob.rotation_euler = (math.radians(90), 0, 0)
        ob.location = (10.0 * MM, 33.0 * MM, 0.0)
    for k in range(8):
        a = math.tau * k / 8
        spoke("GEO-BACKRAY%d" % k, coll,
              (10.0 + math.cos(a) * 16.0, 33.5, math.sin(a) * 16.0),
              (10.0 + math.cos(a) * 92.0, 33.5, math.sin(a) * 92.0),
              4.0, 0.8, 3.2, mat=M["gold"])

    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    print("SAVED", BLEND)

    # ---- 连接核查（浮雕龙/护角/书扣 对 封面）----
    rep = {}
    for grp, pref in (("dragon", "GEO-COVERDRAGON"), ("guard", "GEO-CG"),
                      ("clasp", "GEO-CLASP")):
        rep[grp] = G2.contact_report(coll, "GEO-cover_front", pref, inside_probe=16)
    bad = [(r["part"], r["min_dist_mm"]) for g in rep.values() for r in g if not r["connected"]]
    print("CONTACT_SUMMARY connected=%d unconnected=%d" %
          (sum(1 for g in rep.values() for r in g if r["connected"]), len(bad)))
    for b in bad[:10]:
        print("   FLOAT", b)
    json.dump(rep, open(OUT + "/contact-book.json", "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)

    cams = json.load(open(os.path.join(os.path.dirname(HERE), "baseline", "cameras.json"),
                          encoding="utf-8"))[AID]
    R2.setup_workbench(res=900)
    R2.render_ortho("COL_Book", OUT + "/render", "r2",
                    views=("front", "side", "back", "top"), res=900,
                    ortho_scale=cams["ortho_front"], center=cams["center"])
    import relic_render as R1R
    R1R.render_beauty(OUT + "/render", "COL_Book", views=3, res=1000, tag="_r2")
    R1R.export_glb(OUT + "/out/white_book_r2.glb")
    print("R2_BOOK_DONE")


main()
