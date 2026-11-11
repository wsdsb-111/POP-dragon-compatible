# -*- coding: utf-8 -*-
"""给 round2 七件加 UV（smart project）并重新导出 GLB。"""
import bpy, os, sys, json
BASE = r"./artwork/dragon-relics/deepseek-from-scratch"
sys.path.insert(0, BASE + "/_lib")
import relic_render as R1R

ASSETS = [("black_crown", "COL_Crown"), ("black_regalia", "COL_Regalia"),
          ("white_book", "COL_Book"), ("fire_ring", "COL_Ring"),
          ("earth_sarcophagus", "COL_Sarcophagus"), ("sea_armor", "COL_Armor"),
          ("sky_spear", "COL_Spear")]

res = {}
for aid, col in ASSETS:
    rd = BASE + "/round2/" + aid
    bpy.ops.wm.open_mainfile(filepath=rd + "/%s_r2.blend" % aid)
    coll = bpy.data.collections.get(col)
    bpy.ops.object.select_all(action='DESELECT')
    n = 0
    for ob in list(coll.objects):
        if ob.type != 'MESH':
            continue
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        try:
            bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
        except Exception as ex:
            print("  uv fail", ob.name, ex)
        bpy.ops.object.mode_set(mode='OBJECT')
        ob.select_set(False)
        n += 1
    withuv = sum(1 for ob in coll.objects if ob.type == 'MESH' and len(ob.data.uv_layers) > 0)
    tot = sum(1 for ob in coll.objects if ob.type == 'MESH')
    print("UV %s meshes=%d unwrapped=%d/%d" % (aid, n, withuv, tot))
    res[aid] = {"meshes": tot, "unwrapped": withuv}
    bpy.ops.wm.save_as_mainfile(filepath=rd + "/%s_r2.blend" % aid)
    R1R.export_glb(rd + "/out/%s_r2.glb" % aid)
json.dump(res, open(BASE + "/round2/uv-report.json", "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
print("UV_ALL_DONE")
