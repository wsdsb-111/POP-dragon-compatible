# -*- coding: utf-8 -*-
"""王冠正面：龙面特征做进面盘同一网格（眉脊外凸、眼窝内凹、眼区上红材质），
保留角/颊板；不叠独立眉/眼/爪 -> 结构上不可能自交。自检不过则还原。"""
import bpy, sys, json, math, shutil
from mathutils import Vector
BASE = r"./artwork/dragon-relics/deepseek-from-scratch"
sys.path.insert(0, BASE + "/_lib"); sys.path.insert(0, BASE + "/round2/_lib")
import r2_geo as G2
import dsh_rt_kernel as K

rd = BASE + "/round2/black_crown"
BL = rd + "/black_crown_r2.blend"; BK = rd + "/black_crown_r2.face_bak.blend"
shutil.copyfile(BL, BK)
bpy.ops.wm.open_mainfile(filepath=BL)
M = G2.std_materials()
coll = bpy.data.collections.get("COL_Crown")
# 清掉旧龙首与上轮残留
for ob in list(bpy.data.objects):
    if ob.name.startswith(("GEO-head_", "GEO-eye", "GEO-gem_", "GEO-MASK")):
        me = ob.data if ob.type == 'MESH' else None
        bpy.data.objects.remove(ob, do_unlink=True)
        if me and me.users == 0:
            bpy.data.meshes.remove(me)
fr = G2.Frame((0.0, -179.0, 150.0), forward=(0, -1, 0), up=(0, 0, 1))
obs = G2.dragon_mask(coll, M, fr, W=140.0, H=152.0, name="MASK", mat=M["gold"],
                     horn_scale=0.55, horn_out=1.10, gem=False, simpler=True)
# 删除叠件：眉/眼/眶/冠刺，只留面盘+角+獠牙
for ob in list(bpy.data.objects):
    if ob.name.startswith("GEO-MASK_") and not ob.name.endswith("_face"):
        me = ob.data
        bpy.data.objects.remove(ob, do_unlink=True)
        bpy.data.meshes.remove(me)
face = bpy.data.objects.get("GEO-MASK_face")
if face is None:
    print("NO_FACE"); sys.exit(0)
W, H = 140.0, 152.0
eye = M.get("eye_red")
if eye is None:
    eye = G2.flat_mat("M-eye_red", (0.42, 0.012, 0.008), 0.0, 0.10,
                      emission=(1.0, 0.10, 0.04), estr=0.55, transmission=0.30, ior=1.78)
face.data.materials.append(eye)          # slot 1
for v in face.data.vertices:
    y = v.co.x * 1000.0                  # 局部横向
    z = (v.co.z * 1000.0) - 150.0        # 局部纵向
    d = v.co.y * 1000.0 + 179.0          # 相对面盘基准的凸出量（负=靠外）
    # 眉脊：从中央斜向外上的一条带，外凸
    t = (z / (H * 0.5))
    s = (abs(y) / (W * 0.5))
    brow = math.exp(-((s - 0.34) ** 2) / 0.012 - ((t - 0.13) ** 2) / 0.02)
    # 眼窝：两处内凹
    sock = 0.0
    for sy in (-1, 1):
        dy = y - sy * W * 0.185
        dz = z - H * 0.02
        sock += math.exp(-(dy * dy) / 78.0 - (dz * dz) / 60.0)
    v.co.y += (brow * 0.0032 - sock * 0.0042)
for p in face.data.polygons:
    c = p.center
    ly = c.x * 1000.0
    lz = c.z * 1000.0 - 150.0
    for sy in (-1, 1):
        dy = (ly - sy * W * 0.185) / 0.5
        dz = (lz - H * 0.02) / 0.5
        if (dy * dy) / 260.0 + (dz * dz) / 150.0 < 1.0:
            p.material_index = 1
            break
face.data.update()
r = json.loads(K.dsh_audit_api['mesh'](scope='COL_Crown', self_intersect=True))
t = r['totals']
ok = (t['nonmanifold_edges'] == 0 and t['degenerate_faces'] == 0
      and t['self_intersections'] == 0 and t['boundary_edges'] == 0)
print("FACE2|%s|tris%d|bnd%d|nm%d|deg%d|si%d|keep=%s" % (r['state'], t['tris'],
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
    R2.render_ortho("COL_Crown", rd + "/render", "r2", views=("front", "top"),
                    res=800, ortho_scale=cams["ortho_front"], center=cams["center"])
    R1R.export_glb(rd + "/out/black_crown_r2.glb")
    print("KEPT")
else:
    shutil.copyfile(BK, BL)
    print("ROLLED_BACK")
