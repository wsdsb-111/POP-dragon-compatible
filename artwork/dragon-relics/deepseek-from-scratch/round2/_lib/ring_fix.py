# -*- coding: utf-8 -*-
"""玄戒：重建 -> 只对 500..2500 面对象做一级细分（不清退化）-> UV/终检；
若仍 fail 则回退到干净重建版。"""
import bpy, bmesh, sys, json, runpy
BASE = r"./artwork/dragon-relics/deepseek-from-scratch"
sys.path.insert(0, BASE + "/_lib"); sys.path.insert(0, BASE + "/round2/_lib")
import dsh_rt_kernel as K
import relic_render as R1R

def rebuild():
    for m in list(sys.modules):
        if m.startswith(('relic_', 'render_', 'r2_', 'mk_')):
            sys.modules.pop(m)
    sys.path.insert(0, BASE + "/_lib"); sys.path.insert(0, BASE + "/round2/_lib")
    sys.argv = ["mk_rest.py", "ring"]
    runpy.run_path(BASE + "/round2/_lib/mk_rest.py", run_name="__main__")

def uv_export():
    aid, col = "fire_ring", "COL_Ring"
    rd = BASE + "/round2/" + aid
    coll = bpy.data.collections.get(col)
    bpy.ops.object.select_all(action='DESELECT')
    for ob in list(coll.objects):
        if ob.type != 'MESH':
            continue
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        try:
            bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
        except Exception:
            pass
        bpy.ops.object.mode_set(mode='OBJECT')
        ob.select_set(False)
    bpy.ops.wm.save_as_mainfile(filepath=rd + "/%s_r2.blend" % aid)
    R1R.export_glb(rd + "/out/%s_r2.glb" % aid)
    r = json.loads(K.dsh_audit_api['mesh'](scope=col, self_intersect=True))
    t = r['totals']
    print("RING|%s|tris%d|nm%d|deg%d|si%d" % (r['state'], t['tris'],
          t['nonmanifold_edges'], t['degenerate_faces'], t['self_intersections']))
    return r['state'], t['tris']

rebuild()
aid, col = "fire_ring", "COL_Ring"
rd = BASE + "/round2/" + aid
bpy.ops.wm.open_mainfile(filepath=rd + "/fire_ring_r2.blend")
coll = bpy.data.collections.get(col)
for ob in [o for o in coll.objects if o.type == 'MESH' and 500 <= len(o.data.polygons) <= 2500]:
    me = ob.data
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=1, use_grid_fill=True)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(me); bm.free(); me.update()
    for p in me.polygons:
        p.use_smooth = True
st, tris = uv_export()
if st != "pass":
    print("FALLBACK_CLEAN")
    rebuild()
    bpy.ops.wm.open_mainfile(filepath=rd + "/fire_ring_r2.blend")
    uv_export()
