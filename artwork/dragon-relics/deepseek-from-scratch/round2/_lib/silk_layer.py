# -*- coding: utf-8 -*-
"""权柄红绸：加第二层布（错相扭转、留层间空隙）。不合格则删除新增对象回退。"""
import bpy, sys, json
BASE = r"./artwork/dragon-relics/deepseek-from-scratch"
sys.path.insert(0, BASE + "/_lib"); sys.path.insert(0, BASE + "/round2/_lib")
import r2_geo as G2
import dsh_rt_kernel as K
rd = BASE + "/round2/black_regalia"
bpy.ops.wm.open_mainfile(filepath=rd + "/black_regalia_r2.blend")
M = G2.std_materials()
for k in ("ribbon_red", "silk_red"):
    ob = bpy.data.materials.get("M-" + k)
    if ob:
        M[k] = ob
red = M.get("ribbon_red") or M.get("silk_red") or M["gold"]
coll = bpy.data.collections.get("COL_Regalia")
added = []
for sgn in (-1, 1):
    aa = [(sgn * 34.0, -18.0, 1992.0), (sgn * 70.0, -34.0, 1808.0),
          (sgn * 54.0, -58.0, 1628.0), (sgn * 80.0, -40.0, 1466.0)]
    ob = G2.cloth_sheet(coll, M, aa, width_mm=64.0, folds=1, fold_amp=5.0,
                        twist_deg=-6.0, thickness=1.2, mat=red,
                        name="silk2_%d" % sgn, flare=0.10, sag=8.0)
    added.append(ob.name)
r = json.loads(K.dsh_audit_api['mesh'](scope='COL_Regalia', self_intersect=True))
t = r['totals']
ok = (r['state'] == 'pass' and t['nonmanifold_edges'] == 0 and t['degenerate_faces'] == 0
      and t['self_intersections'] == 0)
print("SILK2|%s|tris%d|si%d|nm%d|deg%d|keep=%s" % (r['state'], t['tris'],
      t['self_intersections'], t['nonmanifold_edges'], t['degenerate_faces'], ok))
if ok:
    for nm in added:
        ob = bpy.data.objects[nm]
        bpy.ops.object.select_all(action='DESELECT')
        bpy.context.view_layer.objects.active = ob; ob.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        try:
            bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
        except Exception:
            pass
        bpy.ops.object.mode_set(mode='OBJECT'); ob.select_set(False)
    bpy.ops.wm.save_as_mainfile(filepath=rd + "/black_regalia_r2.blend")
    import relic_render as R1R
    R1R.export_glb(rd + "/out/black_regalia_r2.glb")
    print("SAVED_SILK2")
else:
    for nm in added:
        ob = bpy.data.objects.get(nm)
        if ob:
            me = ob.data
            bpy.data.objects.remove(ob, do_unlink=True)
            bpy.data.meshes.remove(me)
    print("ROLLED_BACK")
