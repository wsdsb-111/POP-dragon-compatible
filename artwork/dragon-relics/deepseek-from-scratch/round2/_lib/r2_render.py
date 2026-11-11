# -*- coding: utf-8 -*-
"""二轮渲染/拼图工具：组件四视图、同机位对照、对比表拼装（带色标）。"""
import bpy, os, math, json
import numpy as np
from mathutils import Vector

SHEET_BAR = {"ref": (0.55, 0.55, 0.58), "r1": (0.25, 0.45, 0.95),
             "r2": (0.95, 0.72, 0.20)}


def clear_scene():
    """清空对象与集合（组件车间每个组件从空场景开始）。"""
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)


def _bbox(coll_name):
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    col = bpy.data.collections.get(coll_name)
    if col is None or len(col.objects) == 0:
        cands = [c for c in bpy.data.collections
                 if c.name.split('.')[0] == coll_name and len(c.objects) > 0]
        col = cands[-1] if cands else col
    if col is None:
        return Vector((0, 0, 0)), Vector((1, 1, 1))
    for ob in col.objects:
        if ob.type != 'MESH':
            continue
        for v in ob.data.vertices:
            p = ob.matrix_world @ v.co
            for i in range(3):
                mn[i] = min(mn[i], p[i]); mx[i] = max(mx[i], p[i])
    return mn, mx


def setup_workbench(res=640, bg=(0.16, 0.16, 0.18)):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'SINGLE'
    sh.single_color = (0.66, 0.66, 0.70)
    sh.show_cavity = True
    sh.cavity_type = 'BOTH'
    sh.curvature_ridge_factor = 1.6
    sh.curvature_valley_factor = 1.3
    sh.show_object_outline = True
    sh.object_outline_color = (0.05, 0.05, 0.06)
    sh.show_shadows = False
    sc.display.render_aa = '8'
    sc.render.resolution_x = res
    sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    w = sc.world or bpy.data.worlds.new("W2")
    sc.world = w
    w.use_nodes = False
    w.color = bg
    sc.view_settings.view_transform = 'Standard'
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'


def render_ortho(coll_name, out_dir, prefix, views=("front", "side", "iso", "top"),
                 res=640, pad=1.18, ortho_scale=None, center=None):
    """正交/斜角多视：视图名 -> 方向。可传固定 ortho_scale/center 以便跨轮同机位。"""
    os.makedirs(out_dir, exist_ok=True)
    mn, mx = _bbox(coll_name)
    if center is None:
        center = (mn + mx) * 0.5
    else:
        center = Vector(center)
    dim = mx - mn
    DIRS = {"front": ((0, -1, 0), (math.radians(90), 0, 0)),
            "back": ((0, 1, 0), (math.radians(90), 0, math.radians(180))),
            "side": ((1, 0, 0), (math.radians(90), 0, math.radians(90))),
            "left": ((-1, 0, 0), (math.radians(90), 0, math.radians(-90))),
            "top": ((0, 0, 1), (0, 0, 0)),
            "iso": ((1, -1, 0.75), None)}
    cam = bpy.data.objects.get("CAM_r2")
    if cam is None:
        cd = bpy.data.cameras.new("CAM_r2")
        cam = bpy.data.objects.new("CAM_r2", cd)
        bpy.context.scene.collection.objects.link(cam)
    sc = bpy.context.scene
    sc.camera = cam
    cam.data.type = 'ORTHO' if True else 'PERSP'
    out = []
    for name in views:
        d, rot = DIRS[name]
        dv = Vector(d).normalized()
        span = ortho_scale
        if span is None:
            if name in ("front", "back"):
                span = max(dim.x, dim.z)
            elif name in ("side", "left"):
                span = max(dim.y, dim.z)
            elif name == "top":
                span = max(dim.x, dim.y)
            else:
                span = max(dim.x, dim.y, dim.z) * 1.15
        cam.data.ortho_scale = float(span) * pad
        dist = float(max(dim)) * 3.0 + 1.0
        cam.location = (center.x + dv.x * dist, center.y + dv.y * dist,
                        center.z + dv.z * dist)
        if rot is None:
            look = (center - Vector(cam.location)).normalized()
            cam.rotation_euler = look.to_track_quat('-Z', 'Y').to_euler()
        else:
            cam.rotation_euler = rot
        p = os.path.join(out_dir, "%s_%s.png" % (prefix, name))
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        out.append(p)
    return out


# ---------------- 读图/拼图 ----------------
def load_rgba(path):
    im = bpy.data.images.load(path, check_existing=False)
    w, h = im.size
    a = np.empty(w * h * 4, dtype=np.float32)
    im.pixels.foreach_get(a)
    a = a.reshape(h, w, 4)[::-1]
    bpy.data.images.remove(im)
    return a


def _center_square(a, S):
    h, w = a.shape[:2]
    side = min(h, w)
    y0 = (h - side) // 2; x0 = (w - side) // 2
    sq = a[y0:y0 + side, x0:x0 + side]
    idx = np.linspace(0, side - 1, S).astype(int)
    return sq[np.ix_(idx, idx)]


def compose(panels, out_path, S=460, bar=10, cols=None):
    """panels: [(path_or_array, kind)] kind ∈ ref/r1/r2（决定顶部色标）。"""
    cols = cols or len(panels)
    rows = int(math.ceil(len(panels) / float(cols)))
    canvas = np.zeros((rows * (S + bar), cols * S, 4), dtype=np.float32)
    canvas[..., 3] = 1.0
    for i, item in enumerate(panels):
        path, kind = item
        a = path if isinstance(path, np.ndarray) else load_rgba(path)
        sq = _center_square(a, S)
        r, c = divmod(i, cols)
        y0 = r * (S + bar) + bar
        canvas[y0:y0 + S, c * S:(c + 1) * S] = sq
        canvas[r * (S + bar):y0, c * S:(c + 1) * S, :3] = SHEET_BAR.get(kind, (0.3, 0.3, 0.3))
    im = bpy.data.images.new("sheet", cols * S, rows * (S + bar), alpha=True)
    im.pixels.foreach_set(canvas[::-1].ravel())
    im.filepath_raw = out_path
    im.file_format = 'PNG'
    im.save()
    bpy.data.images.remove(im)
    print("SHEET", out_path, os.path.getsize(out_path))
    return out_path


def sheet_with_ref(ref_path, r1_paths, r2_paths, out_path, S=440):
    """一行：参考 | 一轮（可多张） | 二轮（可多张）"""
    panels = [(ref_path, "ref")]
    for p in r1_paths:
        panels.append((p, "r1"))
    for p in r2_paths:
        panels.append((p, "r2"))
    return compose(panels, out_path, S=S, cols=len(panels))


def crop_save(src, out, x, y, w, h, scale=2):
    """从参考图裁一块并另存（x,y 为左上角像素；scale 为放大倍数）。"""
    a = load_rgba(src)
    H, W = a.shape[:2]
    x0 = max(0, min(W - 1, int(x))); y0 = max(0, min(H - 1, int(y)))
    x1 = max(x0 + 1, min(W, x0 + int(w))); y1 = max(y0 + 1, min(H, y0 + int(h)))
    sub = a[y0:y1, x0:x1]
    if scale > 1:
        step = 1.0 / scale
        ys = (np.arange(int(sub.shape[0] * scale)) * step).astype(int)
        xs = (np.arange(int(sub.shape[1] * scale)) * step).astype(int)
        sub = sub[np.clip(ys, 0, sub.shape[0] - 1)][:, np.clip(xs, 0, sub.shape[1] - 1)]
    im = bpy.data.images.new("crop", sub.shape[1], sub.shape[0], alpha=True)
    im.pixels.foreach_set(sub[::-1].ravel())
    im.filepath_raw = out
    im.file_format = 'PNG'
    im.save()
    bpy.data.images.remove(im)
    print("CROP", out, sub.shape[1], sub.shape[0])
    return out
