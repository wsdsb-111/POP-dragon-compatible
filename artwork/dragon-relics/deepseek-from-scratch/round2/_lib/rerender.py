# -*- coding: utf-8 -*-
"""按冻结机位重渲 r2 四视图 + 两张外观图（几何加密后必须重渲）。"""
import bpy, sys, json
BASE = r"./artwork/dragon-relics/deepseek-from-scratch"
sys.path.insert(0, BASE + "/_lib"); sys.path.insert(0, BASE + "/round2/_lib")
import r2_render as R2
import relic_render as R1R
CAMS = json.load(open(BASE + "/round2/baseline/cameras.json", encoding="utf-8"))
JOBS = [("black_crown", "COL_Crown"), ("black_regalia", "COL_Regalia"),
        ("white_book", "COL_Book"), ("fire_ring", "COL_Ring"),
        ("earth_sarcophagus", "COL_Sarcophagus"), ("sea_armor", "COL_Armor"),
        ("sky_spear", "COL_Spear")]
which = sys.argv[-1] if sys.argv else "all"
for aid, col in JOBS:
    if which != "all" and which[:3] not in aid:
        continue
    rd = BASE + "/round2/" + aid
    bpy.ops.wm.open_mainfile(filepath=rd + "/%s_r2.blend" % aid)
    c = CAMS[aid]
    R2.setup_workbench(res=800)
    R2.render_ortho(col, rd + "/render", "r2", views=("front", "side", "back", "top"),
                    res=800, ortho_scale=c["ortho_front"], center=c["center"])
    R1R.render_beauty(rd + "/render", col, views=2, res=900, tag="_r2")
    print("RERENDER", aid)
