# -*- coding: utf-8 -*-
"""材质外观渲染（EEVEE，三点硬光 + 深底），2 个机位 + 1 张四视对照拼图数据。"""
import bpy, os, math
from mathutils import Vector

OUT = r"./artwork/dragon-relics/deepseek-from-scratch/black_crown/render"


def _light(name, loc, energy, size=2.0, color=(1, 1, 1)):
    ld = bpy.data.lights.get(name) or bpy.data.lights.new(name, 'AREA')
    ld.energy = energy
    ld.size = size
    ld.color = color
    ob = bpy.data.objects.get(name)
    if ob is None:
        ob = bpy.data.objects.new(name, ld)
        bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    d = (Vector((0, 0, 0.19)) - Vector(loc)).normalized()
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return ob


def setup():
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in \
        [i.identifier for i in sc.bl_rna.properties['render'].fixed_type.properties['engine'].enum_items] else 'BLENDER_EEVEE'
    sc.render.resolution_x = 1100
    sc.render.resolution_y = 1100
    sc.render.film_transparent = False
    try:
        sc.eevee.taa_render_samples = 64
    except Exception:
        pass
    w = sc.world or bpy.data.worlds.new("W")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.015, 0.018, 0.024, 1)
    bg.inputs[1].default_value = 1.0
    for i, (loc, e, s, c) in enumerate([
            ((1.4, -1.7, 1.5), 420, 2.5, (1.0, 0.93, 0.82)),      # key 暖
            ((-1.6, -1.2, 0.6), 130, 3.0, (0.72, 0.82, 1.0)),     # fill 冷
            ((0.0, 1.6, 1.2), 260, 2.0, (0.85, 0.90, 1.0)),       # rim
    ]):
        _light("LGT_%d" % i, loc, e, s, c)
    # 底色板（不要阴影吃画面）
    cam = bpy.data.objects.get("CAM_beauty")
    if cam is None:
        cd = bpy.data.cameras.new("CAM_beauty")
        cam = bpy.data.objects.new("CAM_beauty", cd)
        sc.collection.objects.link(cam)
    cam.data.lens = 70
    cam.data.clip_start = 0.05
    sc.camera = cam
    return sc, cam


def bbox_center_radius():
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    for ob in bpy.data.objects:
        if ob.type != 'MESH':
            continue
        for c in ob.bound_box:
            p = ob.matrix_world @ Vector(c)
            for i in range(3):
                mn[i] = min(mn[i], p[i]); mx[i] = max(mx[i], p[i])
    ctr = (mn + mx) * 0.5
    rad = (mx - mn).length * 0.5
    return ctr, rad


def shoot(sc, cam, dirv, path, margin=1.05):
    ctr, rad = bbox_center_radius()
    d = Vector(dirv).normalized()
    fov = 2 * math.atan(18.0 / cam.data.lens)
    dist = rad * margin / math.tan(fov * 0.5)
    cam.location = ctr + d * dist
    tgt = (ctr - cam.location).normalized()
    cam.rotation_euler = tgt.to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("BEAUTY", path, "dist=%.3f rad=%.3f" % (dist, rad))


def run():
    sc, cam = setup()
    shoot(sc, cam, (0.55, -1.0, 0.55), OUT + "/beauty_front34.png")
    shoot(sc, cam, (-1.0, -0.45, 0.30), OUT + "/beauty_side34.png")
    shoot(sc, cam, (0.0, -1.0, 0.10), OUT + "/beauty_front.png")


if __name__ == "__main__":
    run()
