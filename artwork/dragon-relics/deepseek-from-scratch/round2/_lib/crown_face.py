# -*- coding: utf-8 -*-
"""王冠：用独立龙面组件替换 r1 椭圆板（先备份，可随时回退）。"""
import bpy, sys, json
BASE = r"./artwork/dragon-relics/deepseek-from-scratch"
sys.path.insert(0, BASE + "/_lib"); sys.path.insert(0, BASE + "/round2/_lib")
import r2_geo as G2
import dsh_rt_kernel as K
import r2_render as R2
import relic_render as R1R

rd = BASE + "/round2/black_crown"
bpy.ops.wm.open_mainfile(filepath=rd + "/black_crown_r2.blend")
M = G2.std_materials()
coll = bpy.data.collections.get("COL_Crown")
n = 0
for ob in list(bpy.data.objects):
    if ob.name.startswith(("GEO-head_", "GEO-eye", "GEO-gem_")):
        me = ob.data if ob.type == 'MESH' else None
        bpy.data.objects.remove(ob, do_unlink=True)
        if me and me.users == 0:
            bpy.data.meshes.remove(me)
        n += 1
print("REMOVED", n)
fr = G2.Frame((0.0, -179.0, 152.0), forward=(0, -1, 0), up=(0, 0, 1))
G2.dragon_mask(coll, M, fr, W=136.0, H=150.0, name="MASK", mat=M["gold"],
               horn_scale=0.5, horn_out=1.12, gem_z=-150.0 * 0.62 - 10.0)
bpy.ops.wm.save_as_mainfile(filepath=rd + "/black_crown_r2.blend")
r = json.loads(K.dsh_audit_api['mesh'](scope='COL_Crown', self_intersect=True))
t = r['totals']
print("FACE|%s|tris%d|bnd%d|nm%d|deg%d|si%d" % (r['state'], t['tris'],
      t['boundary_edges'], t['nonmanifold_edges'], t['degenerate_faces'], t['self_intersections']))
cams = json.load(open(BASE + "/round2/baseline/cameras.json", encoding="utf-8"))["black_crown"]
R2.setup_workbench(res=800)
R2.render_ortho("COL_Crown", rd + "/render", "r2", views=("front", "side"),
                res=800, ortho_scale=cams["ortho_front"], center=cams["center"])
print("FACE_DONE")
