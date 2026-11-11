# -*- coding: utf-8 -*-
"""王冠：宽实心弧板开真孔（布尔减，孔壁有厚度），保留外缘与连接桥。"""
import bpy, bmesh, sys, json, math
from mathutils import Vector
BASE = r"./artwork/dragon-relics/deepseek-from-scratch"
sys.path.insert(0, BASE + "/_lib"); sys.path.insert(0, BASE + "/round2/_lib")
import dsh_rt_kernel as K
import r2_render as R2
import relic_render as R1R

rd = BASE + "/round2/black_crown"
bpy.ops.wm.open_mainfile(filepath=rd + "/black_crown_r2.blend")
coll = bpy.data.collections.get("COL_Crown")
done = 0
for ob in list(coll.objects):
    if not ob.name.startswith("GEO-SPK_") or ob.name.endswith("L"):
        continue
    vs = [ob.matrix_world @ v.co for v in ob.data.vertices]
    zmin = min(v.z for v in vs); zmax = max(v.z for v in vs)
    band = [v for v in vs if abs(v.z - (zmin + (zmax - zmin) * 0.2)) < (zmax - zmin) * 0.08]
    if len(band) < 3:
        continue
    wd = max(max(v.x for v in band) - min(v.x for v in band),
             max(v.y for v in band) - min(v.y for v in band))
    if wd < 0.045:                      # 只处理宽板（>45mm）
        continue
    cx = sum(v.x for v in band) / len(band)
    cy = sum(v.y for v in band) / len(band)
    radial = Vector((cx, cy, 0.0))
    radial = radial.normalized() if radial.length > 1e-6 else Vector((0, -1, 0))
    cutters = []
    n = 3
    for i in range(n):
        t = 0.22 + 0.42 * i / (n - 1.0)
        zz = zmin + (zmax - zmin) * t
        me = bpy.data.meshes.new("CUT_%s_%d" % (ob.name, i))
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=12,
                              radius1=wd * 0.16, radius2=wd * 0.16,
                              depth=max(wd * 0.9, 0.05))
        bm.to_mesh(me); bm.free()
        cut = bpy.data.objects.new("CUT_%s_%d" % (ob.name, i), me)
        coll.objects.link(cut)
        cut.location = (cx, cy, zz)
        cut.rotation_euler = radial.to_track_quat('Z', 'Y').to_euler()
        cut.scale = (1.0, 0.55, 1.0)      # 椭圆孔（竖向拉长）
        cutters.append(cut)
    bpy.context.view_layer.update()
    for cut in cutters:
        md = ob.modifiers.new("bool", 'BOOLEAN')
        md.object = cut; md.operation = 'DIFFERENCE'; md.solver = 'EXACT'
        bpy.context.view_layer.objects.active = ob
        try:
            bpy.ops.object.modifier_apply(modifier=md.name)
        except Exception as ex:
            print("bool fail", ob.name, ex)
    for cut in cutters:
        me = cut.data; bpy.data.objects.remove(cut, do_unlink=True)
        bpy.data.meshes.remove(me)
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1.0e-5)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(ob.data); bm.free(); ob.data.update()
    for p in ob.data.polygons:
        p.use_smooth = True
    # 补 UV
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = ob; ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    try:
        bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
    except Exception:
        pass
    bpy.ops.object.mode_set(mode='OBJECT'); ob.select_set(False)
    done += 1
    print("PIERCED", ob.name, "width_mm", round(wd * 1000, 1))
bpy.ops.wm.save_as_mainfile(filepath=rd + "/black_crown_r2.blend")
r = json.loads(K.dsh_audit_api['mesh'](scope='COL_Crown', self_intersect=True))
t = r['totals']
print("CROWN_OW|%s|pierced%d|tris%d|bnd%d|nm%d|deg%d|si%d" % (r['state'], done, t['tris'],
      t['boundary_edges'], t['nonmanifold_edges'], t['degenerate_faces'], t['self_intersections']))
