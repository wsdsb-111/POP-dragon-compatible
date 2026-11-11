# -*- coding: utf-8 -*-
"""重建白书/玄戒/昆古尼尔（回到干净状态），只对较大对象做保守细分，再 UV + 终检。"""
import bpy, bmesh, sys, json, runpy
BASE = r"./artwork/dragon-relics/deepseek-from-scratch"
sys.path.insert(0, BASE + "/_lib"); sys.path.insert(0, BASE + "/round2/_lib")
import dsh_rt_kernel as K
import relic_render as R1R

# ---- 1) 重建三件（脚本各自从一轮工程重建）----
for m in list(sys.modules):
    if m.startswith(('relic_', 'render_', 'r2_', 'mk_')):
        sys.modules.pop(m)
sys.path.insert(0, BASE + "/_lib"); sys.path.insert(0, BASE + "/round2/_lib")
runpy.run_path(BASE + "/round2/white_book/build_book_r2.py", run_name="__main__")
for which in ("ring", "spear"):
    for m in list(sys.modules):
        if m.startswith(('relic_', 'render_', 'r2_', 'mk_')):
            sys.modules.pop(m)
    sys.path.insert(0, BASE + "/_lib"); sys.path.insert(0, BASE + "/round2/_lib")
    sys.argv = ["mk_rest.py", which]
    runpy.run_path(BASE + "/round2/_lib/mk_rest.py", run_name="__main__")

# ---- 2) 保守细分 + UV + 终检 ----
JOBS = [("white_book", "COL_Book"), ("fire_ring", "COL_Ring"), ("sky_spear", "COL_Spear")]
res = []
for aid, col in JOBS:
    rd = BASE + "/round2/" + aid
    bpy.ops.wm.open_mainfile(filepath=rd + "/%s_r2.blend" % aid)
    coll = bpy.data.collections.get(col)
    for _ in range(3):
        cand = [o for o in coll.objects if o.type == 'MESH' and len(o.data.polygons) >= 200]
        if not cand:
            break
        for ob in cand:
            me = ob.data
            bm = bmesh.new(); bm.from_mesh(me)
            bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=1,
                                      use_grid_fill=True)
            bmesh.ops.smooth_vert(bm, verts=list(bm.verts), factor=0.12,
                                  use_axis_x=True, use_axis_y=True, use_axis_z=True)
            bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
            bm.to_mesh(me); bm.free(); me.update()
            for p in me.polygons:
                p.use_smooth = True
        r = json.loads(K.dsh_audit_api['mesh'](scope=col, self_intersect=True))
        if r['totals']['degenerate_faces'] or r['totals']['nonmanifold_edges']:
            break
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
        except Exception as ex:
            print("uvfail", ob.name, ex)
        bpy.ops.object.mode_set(mode='OBJECT')
        ob.select_set(False)
    bpy.ops.wm.save_as_mainfile(filepath=rd + "/%s_r2.blend" % aid)
    R1R.export_glb(rd + "/out/%s_r2.glb" % aid)
    r = json.loads(K.dsh_audit_api['mesh'](scope=col, self_intersect=True))
    t = r['totals']
    meshes = [o for o in coll.objects if o.type == 'MESH']
    uv = sum(1 for o in meshes if len(o.data.uv_layers) > 0)
    print("REDO|%s|%s|tris%d|bnd%d|nm%d|deg%d|si%d|uv%d/%d" % (
        aid, r['state'], t['tris'], t['boundary_edges'], t['nonmanifold_edges'],
        t['degenerate_faces'], t['self_intersections'], uv, len(meshes)))
    res.append(dict(asset=aid, state=r['state'], tris=t['tris'], objects=t['objects'],
                    boundary=t['boundary_edges'], nonmanifold=t['nonmanifold_edges'],
                    degenerate=t['degenerate_faces'], self_intersections=t['self_intersections'],
                    normals_inverted=t['normals_inverted'], uv=uv, meshes=len(meshes)))
q = json.load(open(BASE + "/round2/qa-round2.json", encoding="utf-8"))
byid = {x['asset']: x for x in q}
for x in res:
    byid[x['asset']] = x
final = [byid[k] for k in ("black_crown", "black_regalia", "white_book", "fire_ring",
                           "earth_sarcophagus", "sea_armor", "sky_spear")]
json.dump(final, open(BASE + "/round2/qa-round2.json", "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
print("TOTAL", sum(x['tris'] for x in final), "PASS", sum(1 for x in final if x['state'] == 'pass'))
