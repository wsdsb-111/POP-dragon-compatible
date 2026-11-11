# -*- coding: utf-8 -*-
"""昆古尼尔：翼下加第二排短羽（层叠），自检不合格则还原。"""
import bpy, sys, json, shutil
BASE = r"./artwork/dragon-relics/deepseek-from-scratch"
sys.path.insert(0, BASE + "/_lib"); sys.path.insert(0, BASE + "/round2/_lib")
import r2_geo as G2, r2_comp as C2
import dsh_rt_kernel as K
rd = BASE + "/round2/sky_spear"
BL = rd + "/sky_spear_r2.blend"; BK = rd + "/sky_spear_r2.wing_bak.blend"
shutil.copyfile(BL, BK)
bpy.ops.wm.open_mainfile(filepath=BL)
M = G2.std_materials()
coll = bpy.data.collections.get("COL_Spear")
added = []
for sgn in (-1, 1):
    fr = G2.Frame((0.0, 0.0, 1995.0 - 22.0), forward=(0, -1, 0), up=(0, 0, 1))
    obs = C2.wing_fan(coll, M, fr, sgn=sgn, count=14, size=150.0 * 0.58,
                      mat=M["gold"], name="WING2_%d" % sgn)
    added += [o.name for o in obs]
r = json.loads(K.dsh_audit_api['mesh'](scope='COL_Spear', self_intersect=True))
t = r['totals']
ok = (t['nonmanifold_edges'] == 0 and t['degenerate_faces'] == 0
      and t['self_intersections'] == 0 and t['boundary_edges'] == 0)
print("WING2|%s|tris%d|bnd%d|nm%d|deg%d|si%d|keep=%s" % (r['state'], t['tris'],
      t['boundary_edges'], t['nonmanifold_edges'], t['degenerate_faces'],
      t['self_intersections'], ok))
if ok:
    bpy.ops.object.select_all(action='DESELECT')
    for nm in added:
        ob = bpy.data.objects[nm]
        bpy.context.view_layer.objects.active = ob; ob.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        try:
            bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
        except Exception:
            pass
        bpy.ops.object.mode_set(mode='OBJECT'); ob.select_set(False)
    bpy.ops.wm.save_as_mainfile(filepath=BL)
    import relic_render as R1R
    R1R.export_glb(rd + "/out/sky_spear_r2.glb")
    print("KEPT")
else:
    shutil.copyfile(BK, BL)
    print("ROLLED_BACK")
