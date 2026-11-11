# -*- coding: utf-8 -*-
"""材质补全（已验证配方）：玄戒戒臂->Metal013，石棺金饰->Metal007，昆古尼尔翼/枪头->Metal007。"""
import bpy, os, sys, json, glob, shutil
BASE = r"./artwork/dragon-relics/deepseek-from-scratch"
CAND = r"./artwork/dragon-relics/materials-cc0/round2-candidates"
sys.path.insert(0, BASE + "/_lib"); sys.path.insert(0, BASE + "/round2/_lib")
import dsh_rt_kernel as K, r2_render as R2, relic_render as R1R
CAMS = json.load(open(BASE + "/round2/baseline/cameras.json", encoding="utf-8"))

def find(d, *keys):
    for k in keys:
        g = sorted(glob.glob(os.path.join(d, "**", "*%s*.png" % k), recursive=True))
        if g:
            return g[0]
    return None

def make(name, d, metallic, rough):
    m = bpy.data.materials.new("M-" + name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    for key, cs, sock in (("Color", 'sRGB', "Base Color"), ("NormalGL", 'Non-Color', None)):
        p = find(d, key)
        if not p:
            continue
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = bpy.data.images.load(p, check_existing=True)
        n.image.colorspace_settings.name = cs
        if sock:
            nt.links.new(n.outputs["Color"], b.inputs[sock])
        else:
            nm = nt.nodes.new("ShaderNodeNormalMap")
            nt.links.new(n.outputs["Color"], nm.inputs["Color"])
            nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    return m

JOBS = [
    ("fire_ring", "COL_Ring", ("GEO-band",), "Metal013", 0.92, 0.38),
    ("earth_sarcophagus", "COL_Sarcophagus", ("GEO-trim", "GEO-band", "GEO-bead"),
     "Metal007", 0.95, 0.30),
    ("sky_spear", "COL_Spear", ("GEO-WING", "GEO-blade"), "Metal007", 0.95, 0.28),
]
for aid, col, prefixes, cid, met, rgh in JOBS:
    rd = BASE + "/round2/" + aid
    BL = rd + "/%s_r2.blend" % aid
    shutil.copyfile(BL, rd + "/%s_r2.mat4_bak.blend" % aid)
    bpy.ops.wm.open_mainfile(filepath=BL)
    new = make(cid, os.path.join(CAND, cid), met, rgh)
    coll = bpy.data.collections.get(col)
    hit = 0
    for ob in list(coll.objects):
        if ob.type != 'MESH' or not ob.name.startswith(prefixes):
            continue
        for i, ms in enumerate(ob.data.materials):
            if ms and "gold" in ms.name.lower():
                ob.data.materials[i] = new
                hit += 1
    print("APPLY", aid, cid, "slots", hit)
    bpy.ops.wm.save_as_mainfile(filepath=BL)
    c = CAMS[aid]
    R2.setup_workbench(res=800)
    R2.render_ortho(col, rd + "/render", "r2", views=("front", "side", "back", "top"),
                    res=800, ortho_scale=c["ortho_front"], center=c["center"])
    R1R.render_beauty(rd + "/render", col, views=2, res=900, tag="_r2")
    R1R.export_glb(rd + "/out/%s_r2.glb" % aid)
    r = json.loads(K.dsh_audit_api['mesh'](scope=col, self_intersect=True))
    print("QA2", aid, r['state'], r['totals']['tris'])
