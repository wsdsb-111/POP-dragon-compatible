# -*- coding: utf-8 -*-
"""四套二轮材质候选小样：同光照同机位的半球/球体对照，供逐件替换前判断。"""
import bpy, os, sys, glob, json, math
import numpy as np
BASE = r"./artwork/dragon-relics/deepseek-from-scratch"
CAND = BASE.replace("artwork", "artwork") + "/../materials-cc0/round2-candidates"
CAND = r"./artwork/dragon-relics/materials-cc0/round2-candidates"
sys.path.insert(0, BASE + "/_lib"); sys.path.insert(0, BASE + "/round2/_lib")
import r2_render as R2

def find(d, *keys):
    for k in keys:
        for ext in ("png", "PNG", "jpg"):
            g = sorted(glob.glob(os.path.join(d, "**", "*%s*.%s" % (k, ext)), recursive=True))
            if g:
                return g[0]
    return None

def build_mat(name, d, metallic=0.9, rough=0.35, tint=(1, 1, 1, 1)):
    m = bpy.data.materials.new("M-" + name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    col = find(d, "Color", "_Color", "")
    nrm = find(d, "NormalGL", "Normal")
    rgh = find(d, "Roughness")
    def img(path, cs):
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = bpy.data.images.load(path, check_existing=True)
        n.image.colorspace_settings.name = cs
        return n
    if col:
        t = img(col, 'sRGB')
        nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    if nrm:
        t = img(nrm, 'Non-Color')
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(t.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    if rgh:
        t = img(rgh, 'Non-Color')
        nt.links.new(t.outputs["Color"], b.inputs["Roughness"])
    return m

R2.clear_scene()
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE'
sc.render.resolution_x = sc.render.resolution_y = 380
sc.render.film_transparent = False
w = sc.world or bpy.data.worlds.new("W")
sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.05, 0.06, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 1.0

CAND_SET = [("Metal007", 0.95, 0.28), ("Metal013", 0.92, 0.40),
            ("Onyx013", 0.10, 0.22), ("crepe_satin", 0.0, 0.55)]
panels = []
for i, (cid, met, rgh) in enumerate(CAND_SET):
    d = os.path.join(CAND, cid)
    if not os.path.isdir(d):
        print("MISSING", cid); continue
    m = build_mat(cid, d, met, rgh)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32,
                                         radius=0.05, location=(i * 0.13, 0, 0))
    ob = bpy.context.active_object
    ob.data.materials.append(m)
    bpy.ops.object.shade_smooth()
    panels.append(cid)
print("MATS", panels)
# 灯光 + 相机
bpy.ops.object.light_add(type='AREA', location=(-0.25, -0.30, 0.34))
k = bpy.context.active_object; k.data.energy = 90; k.data.size = 0.32
bpy.ops.object.light_add(type='AREA', location=(0.34, -0.18, 0.10))
f = bpy.context.active_object; f.data.energy = 34; f.data.size = 0.42
bpy.ops.object.camera_add(location=(0.195, -0.80, 0.0))
cam = bpy.context.active_object
cam.rotation_euler = (math.radians(90), 0, 0)
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 0.64
sc.camera = cam
sc.view_settings.view_transform = 'AgX'
out = BASE + "/round2/sheets/mat-samples.png"
sc.render.filepath = out
sc.render.image_settings.file_format = 'PNG'
bpy.ops.render.render(write_still=True)
print("SAMPLE", os.path.getsize(out))
