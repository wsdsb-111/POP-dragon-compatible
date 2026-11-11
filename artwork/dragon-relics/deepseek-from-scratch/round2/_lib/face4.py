# -*- coding: utf-8 -*-
"""王冠龙面 v4：透镜实体（厚度在轮廓处归零，前后表面共用边界顶点）——
无独立边界墙 => 不会出现退化四边形或壳体不闭合。浮雕 5-9mm，眼区上红。"""
import bpy, bmesh, sys, json, math, shutil
from mathutils import Vector
BASE = r"./artwork/dragon-relics/deepseek-from-scratch"
sys.path.insert(0, BASE + "/_lib"); sys.path.insert(0, BASE + "/round2/_lib")
import r2_geo as G2
import dsh_rt_kernel as K

rd = BASE + "/round2/black_crown"
BL = rd + "/black_crown_r2.blend"; BK = rd + "/black_crown_r2.f4_bak.blend"
shutil.copyfile(BL, BK)
bpy.ops.wm.open_mainfile(filepath=BL)
M = G2.std_materials()
coll = bpy.data.collections.get("COL_Crown")
for ob in list(bpy.data.objects):
    if ob.name.startswith(("GEO-head_", "GEO-eye", "GEO-gem_", "GEO-MASK", "GEO-FACE3", "GEO-FACE4")):
        me = ob.data if ob.type == 'MESH' else None
        bpy.data.objects.remove(ob, do_unlink=True)
        if me and me.users == 0:
            bpy.data.meshes.remove(me)

OY, OZ = -178.0, 150.0
W, H, TH = 190.0, 200.0, 15.0
NZ, NY = 26, 29
PROF = [(-1.0, 0.20), (-0.85, 0.30), (-0.70, 0.40), (-0.50, 0.52), (-0.30, 0.62),
        (-0.10, 0.70), (0.10, 0.74), (0.30, 0.76), (0.50, 0.72), (0.70, 0.62),
        (0.85, 0.48), (1.0, 0.24)]

def wf(t):
    for i in range(len(PROF) - 1):
        a, b = PROF[i], PROF[i + 1]
        if a[0] <= t <= b[0]:
            return a[1] + (b[1] - a[1]) * ((t - a[0]) / (b[0] - a[0]))
    return PROF[-1][1]

def g(d, s):
    return math.exp(-(d * d) / (s * s))

verts, faces, grid_f, grid_b = [], [], [], []
for i in range(NZ):
    t = -1.0 + 2.0 * i / (NZ - 1.0)
    z = t * H * 0.5
    w = W * 0.5 * wf(t)
    rf, rb = [], []
    for j in range(NY):
        v = -1.0 + 2.0 * j / (NY - 1.0)
        y = v * w
        relief = (16.0 * (1.0 - v * v) + 11.0 * (1.0 - abs(v)) ** 1.6
                  + 13.0 * g(abs(y) - 0.30 * W, 0.11 * W) * g(z - 0.15 * H, 0.13 * H)
                  - 9.0 * g(abs(y) - 0.185 * W, 0.080 * W) * g(z - 0.02 * H, 0.095 * H)
                  + 8.0 * max(0.0, 1.0 - abs(y) / (0.10 * W)) * max(0.0, 1.0 - abs(z + 0.18 * H) / (0.30 * H))
                  - 5.5 * g(z + 0.42 * H, 0.055 * H) * max(0.0, 1.0 - abs(y) / (0.20 * W))
                  + 6.0 * g(abs(y) - 0.40 * W, 0.10 * W) * g(z + 0.10 * H, 0.16 * H))
        th = TH * (1.0 - abs(v) ** 1.4) ** 0.55 * (1.0 - abs(t) ** 1.6) ** 0.55
        rf.append(len(verts)); verts.append(Vector((y * 0.001, (OY - relief) * 0.001, (OZ + z) * 0.001)))
        rb.append(len(verts)); verts.append(Vector((y * 0.001, (OY - relief + 2.0 * th) * 0.001, (OZ + z) * 0.001)))
    grid_f.append(rf); grid_b.append(rb)
for i in range(NZ - 1):
    for j in range(NY - 1):
        faces.append([grid_f[i][j], grid_f[i][j + 1], grid_f[i + 1][j + 1], grid_f[i + 1][j]])
        faces.append([grid_b[i][j + 1], grid_b[i][j], grid_b[i + 1][j], grid_b[i + 1][j + 1]])
ob = G2.mesh_from("GEO-FACE4", verts, faces, coll, smooth=True)
bm = bmesh.new(); bm.from_mesh(ob.data)
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
bm.to_mesh(ob.data); bm.free(); ob.data.update()
gold = M.get("gold")
ob.data.materials.append(gold)
eye = bpy.data.materials.get("M-eye_red")
if eye is None:
    eye = G2.flat_mat("M-eye_red", (0.42, 0.012, 0.008), 0.0, 0.10,
                      emission=(1.0, 0.10, 0.04), estr=0.55, transmission=0.30, ior=1.78)
ob.data.materials.append(eye)
n_eye = 0
for p in ob.data.polygons:
    c = p.center * 1000.0
    for sy in (-1, 1):
        dy = (c.x - sy * 0.185 * W) / (0.095 * W)
        dz = (c.z - OZ - 0.02 * H) / (0.050 * H)
        if dy * dy + dz * dz < 1.0 and c.y < OY:
            p.material_index = 1; n_eye += 1
            break
print("FACE4 verts", len(ob.data.vertices), "faces", len(ob.data.polygons), "eye_faces", n_eye)
r = json.loads(K.dsh_audit_api['mesh'](scope='COL_Crown', self_intersect=True))
t = r['totals']
ok = (t['nonmanifold_edges'] == 0 and t['degenerate_faces'] == 0
      and t['self_intersections'] == 0 and t['boundary_edges'] == 0)
print("FACE4|%s|tris%d|bnd%d|nm%d|deg%d|si%d|ok=%s" % (r['state'], t['tris'],
      t['boundary_edges'], t['nonmanifold_edges'], t['degenerate_faces'],
      t['self_intersections'], ok))
if ok:
    bpy.ops.wm.save_as_mainfile(filepath=BL)
    import r2_render as R2, relic_render as R1R
    cams = json.load(open(BASE + "/round2/baseline/cameras.json", encoding="utf-8"))["black_crown"]
    R2.setup_workbench(res=800)
    R2.render_ortho("COL_Crown", rd + "/render", "r2", views=("front", "side"),
                    res=800, ortho_scale=cams["ortho_front"], center=cams["center"])
    R1R.export_glb(rd + "/out/black_crown_r2.glb")
    print("KEPT")
else:
    shutil.copyfile(BK, BL)
    print("ROLLED_BACK")
