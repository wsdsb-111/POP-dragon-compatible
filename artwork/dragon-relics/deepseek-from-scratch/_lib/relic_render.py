# -*- coding: utf-8 -*-
"""七件通用渲染：正交四视（Workbench+cavity）+ 材质外观（EEVEE 三点光）。"""
import bpy, os, math
from mathutils import Vector


def _coll_bbox(coll_name):
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    col = bpy.data.collections.get(coll_name)
    if col is None:
        for ob in bpy.data.objects:
            if ob.type == 'MESH':
                for c in ob.bound_box:
                    p = ob.matrix_world @ Vector(c)
                    for i in range(3):
                        mn[i] = min(mn[i], p[i]); mx[i] = max(mx[i], p[i])
        return mn, mx
    for ob in col.objects:
        if ob.type != 'MESH':
            continue
        for v in ob.data.vertices:
            p = ob.matrix_world @ v.co
            for i in range(3):
                mn[i] = min(mn[i], p[i]); mx[i] = max(mx[i], p[i])
    return mn, mx


def render_ortho(out_dir, coll_name, res=900, tag="", pad=1.12):
    os.makedirs(out_dir, exist_ok=True)
    mn, mx = _coll_bbox(coll_name)
    ctr = (mn + mx) * 0.5
    dim = mx - mn
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
    sh.object_outline_color = (0.04, 0.04, 0.05)
    sh.show_shadows = False
    sc.display.render_aa = '8'
    sc.render.resolution_x = res
    sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.world = sc.world or bpy.data.worlds.new("W")
    sc.world.use_nodes = False
    sc.world.color = (0.075, 0.085, 0.10)
    sc.view_settings.view_transform = 'Standard'
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    views = [
        ("front", (0.0, -1.0, 0.0), (math.radians(90), 0, 0), max(dim.x, dim.z)),
        ("side",  (1.0, 0.0, 0.0), (math.radians(90), 0, math.radians(90)), max(dim.y, dim.z)),
        ("back",  (0.0, 1.0, 0.0), (math.radians(90), 0, math.radians(180)), max(dim.x, dim.z)),
        ("top",   (0.0, 0.0, 1.0), (0, 0, 0), max(dim.x, dim.y)),
    ]
    out = []
    for name, d, rot, span in views:
        cam = bpy.data.objects.get("CAM_ortho")
        if cam is None:
            cd = bpy.data.cameras.new("CAM_ortho")
            cam = bpy.data.objects.new("CAM_ortho", cd)
            sc.collection.objects.link(cam)
        cam.data.type = 'ORTHO'
        cam.data.clip_start = 0.01
        cam.data.clip_end = 100.0
        cam.data.ortho_scale = float(span) * pad
        dist = float(max(dim)) * 3.0 + 1.0
        cam.location = (ctr.x + d[0] * dist, ctr.y + d[1] * dist, ctr.z + d[2] * dist)
        cam.rotation_euler = rot
        sc.camera = cam
        p = os.path.join(out_dir, "%s%s.png" % (name, tag))
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        out.append(p)
        print("ORTHO", p)
    return out


def render_beauty(out_dir, coll_name, views=3, res=1000, tag=""):
    os.makedirs(out_dir, exist_ok=True)
    mn, mx = _coll_bbox(coll_name)
    ctr = (mn + mx) * 0.5
    rad = (mx - mn).length * 0.5
    sc = bpy.context.scene
    try:
        sc.render.engine = 'BLENDER_EEVEE_NEXT'
    except Exception:
        sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = res
    sc.render.resolution_y = res
    sc.render.film_transparent = False
    try:
        sc.eevee.taa_render_samples = 48
    except Exception:
        pass
    w = sc.world or bpy.data.worlds.new("W")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.014, 0.016, 0.021, 1)
        bg.inputs[1].default_value = 1.0
    sc.view_settings.view_transform = 'AgX'
    # 三点光，随物体尺度缩放
    s = max(rad, 0.2)
    lights = [((1.6, -1.9, 1.7), 260.0, s * 4), ((-1.8, -1.3, 0.6), 90.0, s * 6),
              ((0.0, 1.8, 1.4), 180.0, s * 5), ((-1.2, 1.4, -0.8), 60.0, s * 5)]
    for i, (d, e, size) in enumerate(lights):
        nm = "LGT_%d" % i
        ld = bpy.data.lights.get(nm) or bpy.data.lights.new(nm, 'AREA')
        ld.energy = e * (s * s) * 6.0
        ld.size = size
        ob = bpy.data.objects.get(nm)
        if ob is None:
            ob = bpy.data.objects.new(nm, ld)
            sc.collection.objects.link(ob)
        ob.location = (ctr.x + d[0] * s * 2.2, ctr.y + d[1] * s * 2.2, ctr.z + d[2] * s * 2.2)
        dd = (ctr - Vector(ob.location)).normalized()
        ob.rotation_euler = dd.to_track_quat('-Z', 'Y').to_euler()
    cam = bpy.data.objects.get("CAM_beauty")
    if cam is None:
        cd = bpy.data.cameras.new("CAM_beauty")
        cam = bpy.data.objects.new("CAM_beauty", cd)
        sc.collection.objects.link(cam)
    cam.data.lens = 80
    cam.data.clip_start = 0.01
    cam.data.clip_end = 200.0
    sc.camera = cam
    dirs = [((0.55, -1.0, 0.45), "beauty_main"), ((-1.0, -0.5, 0.30), "beauty_side"),
            ((0.0, -1.0, 0.06), "beauty_front")]
    out = []
    fov = 2 * math.atan(18.0 / cam.data.lens)
    for d, nm in dirs[:views]:
        dv = Vector(d).normalized()
        dist = rad * 1.02 / math.tan(fov * 0.5)
        cam.location = ctr + dv * dist
        tv = (ctr - cam.location).normalized()
        cam.rotation_euler = tv.to_track_quat('-Z', 'Y').to_euler()
        p = os.path.join(out_dir, nm + tag + ".png")
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        out.append(p)
        print("BEAUTY", p)
    return out


def export_glb(path, coll_name=None):
    import logging, io, contextlib
    logging.getLogger().setLevel(logging.ERROR)
    with contextlib.redirect_stdout(io.StringIO()):
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False,
                                  export_apply=True, export_yup=True)
    print("GLB", path, os.path.getsize(path))
    return path
