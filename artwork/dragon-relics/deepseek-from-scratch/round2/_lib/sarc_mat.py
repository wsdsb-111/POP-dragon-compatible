# -*- coding: utf-8 -*-
"""石棺：把全部"金色"材质槽替换为 Metal007（石材槽不动）。"""
import bpy, os, sys, json, glob, shutil
BASE = r"./artwork/dragon-relics/deepseek-from-scratch"
CAND = r"./artwork/dragon-relics/materials-cc0/round2-candidates/Metal007"
sys.path.insert(0, BASE + "/_lib"); sys.path.insert(0, BASE + "/round2/_lib")
import dsh_rt_kernel as K, r2_render as R2, relic_render as R1R
aid, col = "earth_sarcophagus", "COL_Sarcophagus"
rd = BASE + "/round2/" + aid
BL = rd + "/%s_r2.blend" % aid
shutil.copyfile(BL, rd + "/%s_r2.sm_bak.blend" % aid)
bpy.ops.wm.open_mainfile(filepath=BL)
def find(d, *keys):
    for k in keys:
        g = sorted(glob.glob(os.path.join(d, "*%s*.png" % k)))
        if g:
            return g[0]
    return None
m = bpy.data.materials.new("M-Metal007")
m.use_nodes = True
nt = m.node_tree
b = nt.nodes["Principled BSDF"]
b.inputs["Metallic"].default_value = 0.95
b.inputs["Roughness"].default_value = 0.30
p = find(CAND, "Color")
if p:
    n = nt.nodes.new("ShaderNodeTexImage")
    n.image = bpy.data.images.load(p, check_existing=True)
    nt.links.new(n.outputs["Color"], b.inputs["Base Color"])
coll = bpy.data.collections.get(col)
names, hit = [], 0
for ob in list(coll.objects):
    if ob.type != 'MESH':
        continue
    for i, ms in enumerate(ob.data.materials):
        if ms and "gold" in ms.name.lower():
            ob.data.materials[i] = m
            hit += 1
            names.append(ob.name)
print("SLOTS", hit, "OBJS", len(set(names)))
print("SAMPLE", sorted(set(names))[:8])
bpy.ops.wm.save_as_mainfile(filepath=BL)
cams = json.load(open(BASE + "/round2/baseline/cameras.json", encoding="utf-8"))[aid]
R2.setup_workbench(res=800)
R2.render_ortho(col, rd + "/render", "r2", views=("front", "side", "back", "top"),
                res=800, ortho_scale=cams["ortho_front"], center=cams["center"])
R1R.render_beauty(rd + "/render", col, views=2, res=900, tag="_r2")
R1R.export_glb(rd + "/out/%s_r2.glb" % aid)
r = json.loads(K.dsh_audit_api['mesh'](scope=col, self_intersect=True))
print("QA2", r['state'], r['totals']['tris'])
