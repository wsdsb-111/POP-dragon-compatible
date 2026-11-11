# -*- coding: utf-8 -*-
"""收尾：①王冠缺 UV 的网格补 smart_project；②石棺拱券 GEO-arch* 换 Metal007（递归 glob 贴图）。"""
import bpy, os, sys, json, glob, shutil
BASE = r"./artwork/dragon-relics/deepseek-from-scratch"
CAND = r"./artwork/dragon-relics/materials-cc0/round2-candidates/Metal007"
sys.path.insert(0, BASE + "/_lib"); sys.path.insert(0, BASE + "/round2/_lib")
import dsh_rt_kernel as K, r2_render as R2, relic_render as R1R
CAMS = json.load(open(BASE + "/round2/baseline/cameras.json", encoding="utf-8"))

# ① 王冠补 UV
rd = BASE + "/round2/black_crown"
bpy.ops.wm.open_mainfile(filepath=rd + "/black_crown_r2.blend")
coll = bpy.data.collections.get("COL_Crown")
n = 0
for ob in list(coll.objects):
    if ob.type == 'MESH' and len(ob.data.uv_layers) == 0:
        bpy.ops.object.select_all(action='DESELECT')
        bpy.context.view_layer.objects.active = ob; ob.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        try:
            bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
        except Exception:
            pass
        bpy.ops.object.mode_set(mode='OBJECT'); ob.select_set(False)
        n += 1
bpy.ops.wm.save_as_mainfile(filepath=rd + "/black_crown_r2.blend")
ms = [o for o in coll.objects if o.type == 'MESH']
uv = sum(1 for o in ms if len(o.data.uv_layers) > 0)
print("CROWN_UV fixed", n, "->", uv, "/", len(ms))

# ② 石棺拱券换材质
aid, col = "earth_sarcophagus", "COL_Sarcophagus"
rd = BASE + "/round2/" + aid
shutil.copyfile(rd + "/%s_r2.blend" % aid, rd + "/%s_r2.arch_bak.blend" % aid)
bpy.ops.wm.open_mainfile(filepath=rd + "/%s_r2.blend" % aid)
def find(d, k):
    g = sorted(glob.glob(os.path.join(d, "**", "*%s*.png" % k), recursive=True))
    return g[0] if g else None
m = bpy.data.materials.new("M-Metal007")
m.use_nodes = True
nt = m.node_tree
b = nt.nodes["Principled BSDF"]
b.inputs["Metallic"].default_value = 0.95
b.inputs["Roughness"].default_value = 0.30
for key, cs, sock in (("Color", 'sRGB', "Base Color"), ("NormalGL", 'Non-Color', None)):
    p = find(CAND, key)
    print("  tex", key, os.path.basename(p) if p else None)
    if not p:
        continue
    node = nt.nodes.new("ShaderNodeTexImage")
    node.image = bpy.data.images.load(p, check_existing=True)
    node.image.colorspace_settings.name = cs
    if sock:
        nt.links.new(node.outputs["Color"], b.inputs[sock])
    else:
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(node.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
coll = bpy.data.collections.get(col)
hit = 0
for ob in list(coll.objects):
    if ob.type == 'MESH' and ob.name.startswith("GEO-arch"):
        for i, sm in enumerate(ob.data.materials):
            if sm and "gold" in sm.name.lower():
                ob.data.materials[i] = m; hit += 1
print("ARCH slots", hit)
bpy.ops.wm.save_as_mainfile(filepath=rd + "/%s_r2.blend" % aid)
c = CAMS[aid]
R2.setup_workbench(res=800)
R2.render_ortho(col, rd + "/render", "r2", views=("front", "side", "back", "top"),
                res=800, ortho_scale=c["ortho_front"], center=c["center"])
R1R.render_beauty(rd + "/render", col, views=2, res=900, tag="_r2")
R1R.export_glb(rd + "/out/%s_r2.glb" % aid)
r = json.loads(K.dsh_audit_api['mesh'](scope=col, self_intersect=True))
print("SARC", r['state'], r['totals']['tris'],
      "beauty_KB", os.path.getsize(rd + "/render/beauty_main_r2.png") // 1024)
