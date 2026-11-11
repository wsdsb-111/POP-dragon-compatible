# -*- coding: utf-8 -*-
"""收尾：给改动过的两件补 UV -> 全 7 件终检 -> 三向对照表 + 七件总览 + manifest"""
import bpy, os, sys, json, hashlib
import numpy as np
BASE = r"./artwork/dragon-relics/deepseek-from-scratch"
sys.path.insert(0, BASE + "/_lib")
sys.path.insert(0, BASE + "/round2/_lib")
import relic_render as R1R
import r2_render as R2
import dsh_rt_kernel as K

ASSETS = [("black_crown", "COL_Crown"), ("black_regalia", "COL_Regalia"),
          ("white_book", "COL_Book"), ("fire_ring", "COL_Ring"),
          ("earth_sarcophagus", "COL_Sarcophagus"), ("sea_armor", "COL_Armor"),
          ("sky_spear", "COL_Spear")]

# ---- 1) 补 UV（权柄/玄戒几何改过）----
for aid in ("black_regalia", "fire_ring"):
    col = [c for a, c in ASSETS if a == aid][0]
    rd = BASE + "/round2/" + aid
    bpy.ops.wm.open_mainfile(filepath=rd + "/%s_r2.blend" % aid)
    coll = bpy.data.collections.get(col)
    for ob in coll.objects:
        if ob.type != 'MESH' or len(ob.data.uv_layers) > 0:
            continue
        bpy.ops.object.select_all(action='DESELECT')
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        try:
            bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
        except Exception as ex:
            print("uvfail", ob.name, ex)
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.wm.save_as_mainfile(filepath=rd + "/%s_r2.blend" % aid)
    R1R.export_glb(rd + "/out/%s_r2.glb" % aid)
    print("UV_REDO", aid)

# ---- 2) 终检 ----
rows = []
for aid, col in ASSETS:
    bpy.ops.wm.open_mainfile(filepath=BASE + "/round2/%s/%s_r2.blend" % (aid, aid))
    r = json.loads(K.dsh_audit_api['mesh'](scope=col, self_intersect=True))
    t = r['totals']
    meshes = [o for o in bpy.data.collections[col].objects if o.type == 'MESH']
    uv = sum(1 for o in meshes if len(o.data.uv_layers) > 0)
    mn = [1e9] * 3; mx = [-1e9] * 3
    for ob in meshes:
        for v in ob.data.vertices:
            q = ob.matrix_world @ v.co
            for i in range(3):
                mn[i] = min(mn[i], q[i]); mx[i] = max(mx[i], q[i])
    rows.append(dict(asset=aid, state=r['state'], tris=t['tris'], objects=t['objects'],
                     boundary=t['boundary_edges'], nonmanifold=t['nonmanifold_edges'],
                     degenerate=t['degenerate_faces'], self_intersections=t['self_intersections'],
                     normals_inverted=t['normals_inverted'],
                     uv_unwrapped=uv, meshes=len(meshes),
                     W=round((mx[0]-mn[0])*1000, 1), D=round((mx[1]-mn[1])*1000, 1),
                     H=round((mx[2]-mn[2])*1000, 1)))
    print("FINAL|%s|%s|%d|%d|uv%d/%d" % (aid, r['state'], t['tris'], t['objects'], uv, len(meshes)))
json.dump(rows, open(BASE + "/round2/qa-round2.json", "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)

# ---- 3) 对照表（参考整图 fit 到方格 | 一轮 | 二轮）----
def load(path):
    im = bpy.data.images.load(path, check_existing=False)
    w, h = im.size
    a = np.empty(w * h * 4, dtype=np.float32)
    im.pixels.foreach_get(a)
    a = a.reshape(h, w, 4)[::-1]
    bpy.data.images.remove(im)
    return a

def fit_sq(a, S, bg=0.13):
    h, w = a.shape[:2]
    sc = min(S / float(w), S / float(h))
    nw, nh = max(1, int(w * sc)), max(1, int(h * sc))
    ys = (np.arange(nh) / sc).astype(int).clip(0, h - 1)
    xs = (np.arange(nw) / sc).astype(int).clip(0, w - 1)
    small = a[ys][:, xs]
    out = np.zeros((S, S, 4), dtype=np.float32)
    out[..., :3] = bg; out[..., 3] = 1.0
    y0 = (S - nh) // 2; x0 = (S - nw) // 2
    out[y0:y0 + nh, x0:x0 + nw] = small
    return out

S = 400; bar = 8
canvas = np.zeros((len(ASSETS) * (S + bar), 3 * S, 4), dtype=np.float32)
canvas[..., :3] = 0.13; canvas[..., 3] = 1.0
BARS = [(0.55, 0.55, 0.58), (0.25, 0.45, 0.95), (0.95, 0.72, 0.20)]
for i, (aid, col) in enumerate(ASSETS):
    panels = [BASE + "/" + aid + "/ref/threeview.png",
              BASE + "/" + aid + "/render/beauty_front.png",
              BASE + "/round2/" + aid + "/render/r2_front.png"]
    for j, p in enumerate(panels):
        if not os.path.exists(p):
            continue
        img = fit_sq(load(p), S)
        y0 = i * (S + bar) + bar
        canvas[y0:y0 + S, j * S:(j + 1) * S] = img
        canvas[i * (S + bar):y0, j * S:(j + 1) * S, :3] = BARS[j]
out = bpy.data.images.new("cmp", 3 * S, len(ASSETS) * (S + bar), alpha=True)
out.pixels.foreach_set(canvas[::-1].ravel())
out.filepath_raw = BASE + "/round2/00-二轮对照总表.png"
out.file_format = 'PNG'; out.save()
print("SHEET_ALL", os.path.getsize(BASE + "/round2/00-二轮对照总表.png"))

# ---- 4) 七件二轮外观总览 ----
S2 = 460; cols = 4
c2 = np.zeros((2 * S2, cols * S2, 4), dtype=np.float32)
c2[..., :3] = 0.13; c2[..., 3] = 1.0
for i, (aid, col) in enumerate(ASSETS):
    p = BASE + "/round2/" + aid + "/render/beauty_main_r2.png"
    if os.path.exists(p):
        r, cc = divmod(i, cols)
        c2[r * S2:(r + 1) * S2, cc * S2:(cc + 1) * S2] = fit_sq(load(p), S2)
o2 = bpy.data.images.new("mon2", cols * S2, 2 * S2, alpha=True)
o2.pixels.foreach_set(c2[::-1].ravel())
o2.filepath_raw = BASE + "/round2/00-二轮七件总览.png"
o2.file_format = 'PNG'; o2.save()
print("MON_ALL", os.path.getsize(BASE + "/round2/00-二轮七件总览.png"))

# ---- 5) manifest ----
def md5(p):
    h = hashlib.md5()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()
man = {"note": "round2 交付清单（一轮原件保留在上级目录，未覆盖）", "assets": []}
for aid, col in ASSETS:
    rec = {"id": aid}
    for k, rel in (("blend", "/round2/%s/%s_r2.blend" % (aid, aid)),
                   ("glb", "/round2/%s/out/%s_r2.glb" % (aid, aid))):
        p = BASE + rel
        if os.path.exists(p):
            rec[k] = {"path": rel, "bytes": os.path.getsize(p), "md5": md5(p)}
    man["assets"].append(rec)
json.dump(man, open(BASE + "/round2/manifest-round2.json", "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
print("MANIFEST_OK", sum(a["blend"]["bytes"] for a in man["assets"]) // 1048576, "MiB")
