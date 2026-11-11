# -*- coding: utf-8 -*-
"""玄戒：对 >=200 面的对象做一次细分+平滑（不做去退化/三角化），自检不过则还原。"""
import bpy, bmesh, sys, json, shutil
BASE = r"./artwork/dragon-relics/deepseek-from-scratch"
sys.path.insert(0, BASE + "/_lib"); sys.path.insert(0, BASE + "/round2/_lib")
import dsh_rt_kernel as K
rd = BASE + "/round2/fire_ring"
BL = rd + "/fire_ring_r2.blend"; BK = rd + "/fire_ring_r2.d2_bak.blend"
shutil.copyfile(BL, BK)
bpy.ops.wm.open_mainfile(filepath=BL)
coll = bpy.data.collections.get("COL_Ring")
n = 0
for ob in [o for o in coll.objects if o.type == 'MESH' and len(o.data.polygons) >= 200]:
    me = ob.data
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=1, use_grid_fill=True)
    bmesh.ops.smooth_vert(bm, verts=list(bm.verts), factor=0.10,
                          use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(me); bm.free(); me.update()
    for p in me.polygons:
        p.use_smooth = True
    n += 1
r = json.loads(K.dsh_audit_api['mesh'](scope='COL_Ring', self_intersect=True))
t = r['totals']
ok = (t['nonmanifold_edges'] == 0 and t['degenerate_faces'] == 0
      and t['self_intersections'] == 0 and t['boundary_edges'] == 0)
print("RING2|%s|refined%d|tris%d|bnd%d|nm%d|deg%d|si%d|keep=%s" % (r['state'], n, t['tris'],
      t['boundary_edges'], t['nonmanifold_edges'], t['degenerate_faces'],
      t['self_intersections'], ok))
if ok:
    bpy.ops.object.select_all(action='DESELECT')
    for ob in [o for o in coll.objects if o.type == 'MESH' and len(o.data.uv_layers) == 0]:
        bpy.context.view_layer.objects.active = ob; ob.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        try:
            bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
        except Exception:
            pass
        bpy.ops.object.mode_set(mode='OBJECT'); ob.select_set(False)
    bpy.ops.wm.save_as_mainfile(filepath=BL)
    import r2_render as R2, relic_render as R1R
    cams = json.load(open(BASE + "/round2/baseline/cameras.json", encoding="utf-8"))["fire_ring"]
    R2.setup_workbench(res=800)
    R2.render_ortho("COL_Ring", rd + "/render", "r2", views=("front", "top"),
                    res=800, ortho_scale=cams["ortho_front"], center=cams["center"])
    R1R.render_beauty(rd + "/render", "COL_Ring", views=2, res=900, tag="_r2")
    R1R.export_glb(rd + "/out/fire_ring_r2.glb")
    print("KEPT")
else:
    shutil.copyfile(BK, BL)
    print("ROLLED_BACK")
