# -*- coding: utf-8 -*-
"""石棺：分批细分至 >=52 万（一次细分+平滑，不做去退化），自检不过还原。"""
import bpy, bmesh, sys, json, shutil
BASE = r"./artwork/dragon-relics/deepseek-from-scratch"
sys.path.insert(0, BASE + "/_lib"); sys.path.insert(0, BASE + "/round2/_lib")
import dsh_rt_kernel as K, r2_render as R2, relic_render as R1R
aid, col, target = "earth_sarcophagus", "COL_Sarcophagus", 520000
rd = BASE + "/round2/" + aid
BL = rd + "/%s_r2.blend" % aid; BK = rd + "/%s_r2.sd_bak.blend" % aid
shutil.copyfile(BL, BK)
bpy.ops.wm.open_mainfile(filepath=BL)
coll = bpy.data.collections.get(col)
for rnd in range(5):
    r = json.loads(K.dsh_audit_api['mesh'](scope=col, self_intersect=True))
    if r['totals']['tris'] >= target:
        break
    cand = sorted([o for o in coll.objects if o.type == 'MESH'
                   and len(o.data.polygons) >= 200], key=lambda o: len(o.data.polygons))
    if not cand:
        break
    for ob in cand[:max(1, int(len(cand) * 0.12))]:
        me = ob.data
        bm = bmesh.new(); bm.from_mesh(me)
        bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=1, use_grid_fill=True)
        bmesh.ops.smooth_vert(bm, verts=list(bm.verts), factor=0.10,
                              use_axis_x=True, use_axis_y=True, use_axis_z=True)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(me); bm.free(); me.update()
        for p in me.polygons:
            p.use_smooth = True
r = json.loads(K.dsh_audit_api['mesh'](scope=col, self_intersect=True))
t = r['totals']
ok = (t['nonmanifold_edges'] == 0 and t['degenerate_faces'] == 0
      and t['self_intersections'] == 0 and t['boundary_edges'] == 0)
print("SARC|%s|tris%d|nm%d|deg%d|si%d|ok=%s" % (r['state'], t['tris'],
      t['nonmanifold_edges'], t['degenerate_faces'], t['self_intersections'], ok))
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
    cams = json.load(open(BASE + "/round2/baseline/cameras.json", encoding="utf-8"))[aid]
    R2.setup_workbench(res=800)
    R2.render_ortho(col, rd + "/render", "r2", views=("front", "side", "back", "top"),
                    res=800, ortho_scale=cams["ortho_front"], center=cams["center"])
    R1R.render_beauty(rd + "/render", col, views=2, res=900, tag="_r2")
    R1R.export_glb(rd + "/out/%s_r2.glb" % aid)
    print("KEPT", t['tris'])
else:
    shutil.copyfile(BK, BL)
    print("ROLLED_BACK")
