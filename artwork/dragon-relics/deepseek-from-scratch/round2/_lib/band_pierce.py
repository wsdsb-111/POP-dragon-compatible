# -*- coding: utf-8 -*-
"""王冠内圈开孔：沿周向布尔打 12*2 个孔；自检不合格则还原备份。"""
import bpy, bmesh, sys, json, math, shutil
from mathutils import Vector
BASE = r"./artwork/dragon-relics/deepseek-from-scratch"
sys.path.insert(0, BASE + "/_lib"); sys.path.insert(0, BASE + "/round2/_lib")
import dsh_rt_kernel as K
rd = BASE + "/round2/black_crown"
BL = rd + "/black_crown_r2.blend"; BK = rd + "/black_crown_r2.pierce_bak.blend"
shutil.copyfile(BL, BK)
bpy.ops.wm.open_mainfile(filepath=BL)
coll = bpy.data.collections.get("COL_Crown")
ob = bpy.data.objects.get("GEO-band_inner")
if ob is None:
    print("NO_BAND"); sys.exit(0)
vs = [ob.matrix_world @ v.co for v in ob.data.vertices]
zc = sum(v.z for v in vs) / len(vs)
rz = (max(v.z for v in vs) - min(v.z for v in vs)) * 0.5
cutters = []
for k in range(12):
    a = math.tau * k / 12
    cx = math.cos(a) * 0.156
    cy = math.sin(a) * 0.156
    me = bpy.data.meshes.new("CUTB%d" % k)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=12,
                          radius1=rz * 0.55, radius2=rz * 0.55, depth=0.06)
    bm.to_mesh(me); bm.free()
    cut = bpy.data.objects.new("CUTB%d" % k, me)
    coll.objects.link(cut)
    cut.location = (cx, cy, zc)
    cut.rotation_euler = (math.radians(90), 0, a)
    cutters.append(cut)
bpy.context.view_layer.update()
for cut in cutters:
    md = ob.modifiers.new("bool", 'BOOLEAN')
    md.object = cut; md.operation = 'DIFFERENCE'; md.solver = 'EXACT'
    bpy.context.view_layer.objects.active = ob
    try:
        bpy.ops.object.modifier_apply(modifier=md.name)
    except Exception as ex:
        print("boolfail", ex)
for cut in cutters:
    me = cut.data; bpy.data.objects.remove(cut, do_unlink=True); bpy.data.meshes.remove(me)
bm = bmesh.new(); bm.from_mesh(ob.data)
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1.0e-5)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
bm.to_mesh(ob.data); bm.free(); ob.data.update()
r = json.loads(K.dsh_audit_api['mesh'](scope='COL_Crown', self_intersect=True))
t = r['totals']
ok = (t['nonmanifold_edges'] == 0 and t['degenerate_faces'] == 0 and t['self_intersections'] == 0
      and t['boundary_edges'] == 0)
print("BAND|%s|tris%d|bnd%d|nm%d|deg%d|si%d|keep=%s" % (r['state'], t['tris'],
      t['boundary_edges'], t['nonmanifold_edges'], t['degenerate_faces'],
      t['self_intersections'], ok))
if ok:
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = ob; ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    try:
        bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
    except Exception:
        pass
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.wm.save_as_mainfile(filepath=BL)
    import r2_render as R2, relic_render as R1R
    cams = json.load(open(BASE + "/round2/baseline/cameras.json", encoding="utf-8"))["black_crown"]
    R2.setup_workbench(res=800)
    R2.render_ortho("COL_Crown", rd + "/render", "r2", views=("front", "top"),
                    res=800, ortho_scale=cams["ortho_front"], center=cams["center"])
    R1R.export_glb(rd + "/out/black_crown_r2.glb")
    print("KEPT")
else:
    shutil.copyfile(BK, BL)
    print("ROLLED_BACK")
