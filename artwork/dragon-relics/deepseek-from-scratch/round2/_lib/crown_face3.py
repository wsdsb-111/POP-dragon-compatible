# -*- coding: utf-8 -*-
"""王冠正面龙面 v3：单一网格 + 等厚壳体（后表面 = 前表面 - 14mm，永不相交），
浮雕位移 5-10mm，眼窝内凹、眉脊外凸、鼻梁/口线，眼区上红。自检不过还原。"""
import bpy, sys, json, math, shutil
from mathutils import Vector
BASE = r"./artwork/dragon-relics/deepseek-from-scratch"
sys.path.insert(0, BASE + "/_lib"); sys.path.insert(0, BASE + "/round2/_lib")
import r2_geo as G2
import dsh_rt_kernel as K

rd = BASE + "/round2/black_crown"
BL = rd + "/black_crown_r2.blend"; BK = rd + "/black_crown_r2.f3_bak.blend"
shutil.copyfile(BL, BK)
bpy.ops.wm.open_mainfile(filepath=BL)
M = G2.std_materials()
coll = bpy.data.collections.get("COL_Crown")
for ob in list(bpy.data.objects):
    if ob.name.startswith(("GEO-head_", "GEO-eye", "GEO-gem_", "GEO-MASK", "GEO-FACE3")):
        me = ob.data if ob.type == 'MESH' else None
        bpy.data.objects.remove(ob, do_unlink=True)
        if me and me.users == 0:
            bpy.data.meshes.remove(me)

OX, OY, OZ = 0.0, -179.0, 150.0
W, H, TH = 200.0, 210.0, 14.0
NZ, NY = 30, 33
PROF = [(-1.0, 0.22), (-0.85, 0.26), (-0.70, 0.28), (-0.50, 0.41), (-0.30, 0.53),
        (-0.10, 0.63), (0.10, 0.69), (0.30, 0.73), (0.50, 0.70), (0.70, 0.61),
        (0.85, 0.47), (1.0, 0.22)]

def wf(t):
    for i in range(len(PROF) - 1):
        a, b = PROF[i], PROF[i + 1]
        if a[0] <= t <= b[0]:
            f = (t - a[0]) / (b[0] - a[0])
            return a[1] + (b[1] - a[1]) * f
    return PROF[-1][1]

def gauss(d, s):
    return math.exp(-(d * d) / (s * s))

verts, faces, front, back = [], [], [], []
for i in range(NZ):
    t = -1.0 + 2.0 * i / (NZ - 1.0)
    z = t * H * 0.5
    w = W * 0.5 * wf(t)
    rf, rb = [], []
    for j in range(NY):
        v = -1.0 + 2.0 * j / (NY - 1.0)
        y = v * w
        x = 12.0 * (1.0 - v * v) + 8.0 * (1.0 - abs(v)) ** 1.6
        # 眉脊（双侧带）
        x += 9.0 * gauss(abs(y) - 0.30 * W, 20.0) * gauss(z - 0.16 * H, 24.0)
        # 眼窝（内凹）
        x -= 7.0 * gauss(abs(y) - 0.185 * W, 28.0) * gauss(z - 0.02 * H, 22.0)
        # 鼻梁
        x += 5.0 * max(0.0, 1.0 - abs(y) / (0.10 * W)) * max(0.0, 1.0 - abs(z + 0.20 * H) / (0.30 * H))
        # 鼻口
        x -= 3.0 * gauss(abs(y) - 0.06 * W, 12.0) * gauss(z + 0.30 * H, 12.0)
        # 口线
        x -= 4.0 * gauss(z + 0.44 * H, 10.0) * max(0.0, 1.0 - abs(y) / (0.20 * W))
        rf.append(len(verts)); verts.append(Vector((OX + x * 0.001, OY, OZ + z * 0.001)))
        rb.append(len(verts))
        verts.append(Vector((OX + (x - TH) * 0.001, OY, OZ + z * 0.001)))
    front.append(rf); back.append(rb)
for i in range(NZ - 1):
    for j in range(NY - 1):
        faces.append([front[i][j], front[i][j + 1], front[i + 1][j + 1], front[i + 1][j]])
        faces.append([back[i][j + 1], back[i][j], back[i + 1][j], back[i + 1][j + 1]])
for i in range(NZ - 1):
    faces.append([front[i][0], back[i][0], back[i + 1][0], front[i + 1][0]])
    faces.append([back[i][NY - 1], front[i][NY - 1], front[i + 1][NY - 1], back[i + 1][NY - 1]])
for j in range(NY - 1):
    faces.append([front[0][j + 1], front[0][j], back[0][j], back[0][j + 1]])
    faces.append([back[NZ - 1][j + 1], back[NZ - 1][j], front[NZ - 1][j], front[NZ - 1][j + 1]])
face = G2.mesh_from("GEO-FACE3", verts, faces, coll, smooth=True)
import bmesh as _bm
_b = _bm.new(); _b.from_mesh(face.data)
_bm.ops.remove_doubles(_b, verts=list(_b.verts), dist=3.0e-5)
_bm.ops.recalc_face_normals(_b, faces=list(_b.faces))
_b.to_mesh(face.data); _b.free(); face.data.update()
gold = M.get("gold")
face.data.materials.append(gold)
eye = bpy.data.materials.get("M-eye_red")
if eye is None:
    eye = G2.flat_mat("M-eye_red", (0.42, 0.012, 0.008), 0.0, 0.10,
                      emission=(1.0, 0.10, 0.04), estr=0.55, transmission=0.30, ior=1.78)
face.data.materials.append(eye)
n_eye = 0
for p in face.data.polygons:
    c = p.center
    y = c.x * 1000.0
    z = c.z * 1000.0 - OZ
    for sy in (-1, 1):
        dy = (y - sy * 0.185 * W) / (0.090 * W)
        dz = (z - 0.02 * H) / (0.048 * H)
        if dy * dy + dz * dz < 1.0:
            p.material_index = 1
            n_eye += 1
            break
print("FACE3 tris", len(face.data.loop_triangles) if face.data.loop_triangles else sum(len(p.vertices) - 2 for p in face.data.polygons), "eye_faces", n_eye)
r = json.loads(K.dsh_audit_api['mesh'](scope='COL_Crown', self_intersect=True))
t = r['totals']
ok = (t['nonmanifold_edges'] == 0 and t['degenerate_faces'] == 0
      and t['self_intersections'] == 0 and t['boundary_edges'] == 0)
print("FACE3|%s|tris%d|bnd%d|nm%d|deg%d|si%d|ok=%s" % (r['state'], t['tris'],
      t['boundary_edges'], t['nonmanifold_edges'], t['degenerate_faces'],
      t['self_intersections'], ok))
if ok:
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = face; face.select_set(True)
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
    R2.render_ortho("COL_Crown", rd + "/render", "r2", views=("front", "side"),
                    res=800, ortho_scale=cams["ortho_front"], center=cams["center"])
    R1R.export_glb(rd + "/out/black_crown_r2.glb")
    print("KEPT")
else:
    shutil.copyfile(BK, BL)
    print("ROLLED_BACK")
