# -*- coding: utf-8 -*-
"""4 正交视图白模渲染（Workbench + cavity，灰件硬光），用于轮廓对照。"""
import bpy, os, math
from mathutils import Vector

OUT = r"./artwork/dragon-relics/deepseek-from-scratch/black_crown/render"

VIEWS = [
    ("front", (0.0, -2.0, 0.19), (math.radians(90), 0, 0)),
    ("side",  (2.0, 0.0, 0.19), (math.radians(90), 0, math.radians(90))),
    ("back",  (0.0, 2.0, 0.19), (math.radians(90), 0, math.radians(180))),
    ("top",   (0.0, 0.0, 2.0), (0, 0, 0)),
]


def setup(ortho=0.55, res=900):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'SINGLE'
    sh.single_color = (0.62, 0.62, 0.66)
    sh.show_cavity = True
    sh.cavity_type = 'BOTH'
    sh.curvature_ridge_factor = 1.5
    sh.curvature_valley_factor = 1.2
    sh.show_object_outline = True
    sh.object_outline_color = (0.05, 0.05, 0.05)
    sh.show_shadows = False
    sc.display.render_aa = '8'
    sc.render.resolution_x = res
    sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.world = sc.world or bpy.data.worlds.new("W")
    sc.world.use_nodes = False
    sc.world.color = (0.08, 0.09, 0.11)
    sc.view_settings.view_transform = 'Standard'
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'


def make_cam(name):
    cam = bpy.data.objects.get(name)
    if cam is None:
        cd = bpy.data.cameras.new(name)
        cam = bpy.data.objects.new(name, cd)
        bpy.context.scene.collection.objects.link(cam)
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 0.55
    cam.data.clip_start = 0.01
    cam.data.clip_end = 50.0
    return cam


def render_views(ortho=0.55, res=900, tag=""):
    os.makedirs(OUT, exist_ok=True)
    setup(ortho, res)
    sc = bpy.context.scene
    paths = []
    for name, loc, rot in VIEWS:
        cam = make_cam("CAM_" + name)
        cam.location = loc
        cam.rotation_euler = rot
        cam.data.ortho_scale = ortho
        sc.camera = cam
        p = os.path.join(OUT, "%s%s.png" % (name, tag))
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        paths.append(p)
        print("RENDER", p)
    return paths


if __name__ == "__main__":
    render_views()
