# -*- coding: utf-8 -*-
"""重出三向对照总表 + 七件总览 + manifest（几何/渲染更新后）"""
import bpy, os, sys, json, hashlib
import numpy as np
BASE = r"./artwork/dragon-relics/deepseek-from-scratch"
A = ["black_crown", "black_regalia", "white_book", "fire_ring",
     "earth_sarcophagus", "sea_armor", "sky_spear"]

def load(p):
    im = bpy.data.images.load(p, check_existing=False)
    w, h = im.size
    a = np.empty(w * h * 4, dtype=np.float32); im.pixels.foreach_get(a)
    a = a.reshape(h, w, 4)[::-1]
    bpy.data.images.remove(im); return a

def fit(a, S, bg=0.13):
    h, w = a.shape[:2]
    sc = min(S / float(w), S / float(h))
    nw, nh = max(1, int(w * sc)), max(1, int(h * sc))
    ys = (np.arange(nh) / sc).astype(int).clip(0, h - 1)
    xs = (np.arange(nw) / sc).astype(int).clip(0, w - 1)
    out = np.zeros((S, S, 4), dtype=np.float32); out[..., :3] = bg; out[..., 3] = 1.0
    y0 = (S - nh) // 2; x0 = (S - nw) // 2
    out[y0:y0 + nh, x0:x0 + nw] = a[ys][:, xs]
    return out

S, bar = 380, 8
cv = np.zeros((len(A) * (S + bar), 3 * S, 4), dtype=np.float32)
cv[..., :3] = 0.13; cv[..., 3] = 1.0
BARS = [(0.55, 0.55, 0.58), (0.25, 0.45, 0.95), (0.95, 0.72, 0.20)]
for i, aid in enumerate(A):
    ps = [BASE + "/" + aid + "/ref/threeview.png",
          BASE + "/" + aid + "/render/beauty_front.png",
          BASE + "/round2/" + aid + "/render/r2_front.png"]
    for j, p in enumerate(ps):
        if not os.path.exists(p):
            continue
        y0 = i * (S + bar) + bar
        cv[y0:y0 + S, j * S:(j + 1) * S] = fit(load(p), S)
        cv[i * (S + bar):y0, j * S:(j + 1) * S, :3] = BARS[j]
o = bpy.data.images.new("cmp2", 3 * S, len(A) * (S + bar), alpha=True)
o.pixels.foreach_set(cv[::-1].ravel())
o.filepath_raw = BASE + "/round2/00-二轮对照总表.png"; o.file_format = 'PNG'; o.save()
print("SHEET", os.path.getsize(BASE + "/round2/00-二轮对照总表.png"))

S2, cols = 440, 4
c2 = np.zeros((2 * S2, cols * S2, 4), dtype=np.float32)
c2[..., :3] = 0.13; c2[..., 3] = 1.0
for i, aid in enumerate(A):
    p = BASE + "/round2/" + aid + "/render/beauty_main_r2.png"
    if os.path.exists(p):
        r, cc = divmod(i, cols)
        c2[r * S2:(r + 1) * S2, cc * S2:(cc + 1) * S2] = fit(load(p), S2)
o2 = bpy.data.images.new("mon3", cols * S2, 2 * S2, alpha=True)
o2.pixels.foreach_set(c2[::-1].ravel())
o2.filepath_raw = BASE + "/round2/00-二轮七件总览.png"; o2.file_format = 'PNG'; o2.save()
print("MON", os.path.getsize(BASE + "/round2/00-二轮七件总览.png"))

def md5(p):
    h = hashlib.md5()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()
man = {"note": "round2 最终交付清单（一轮原件未覆盖）", "assets": []}
for aid in A:
    rec = {"id": aid}
    for k, rel in (("blend", "/round2/%s/%s_r2.blend" % (aid, aid)),
                   ("glb", "/round2/%s/out/%s_r2.glb" % (aid, aid))):
        p = BASE + rel
        if os.path.exists(p):
            rec[k] = {"path": rel, "bytes": os.path.getsize(p), "md5": md5(p)}
    man["assets"].append(rec)
json.dump(man, open(BASE + "/round2/manifest-round2.json", "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
print("MANIFEST", sum(a["glb"]["bytes"] for a in man["assets"]) // 1048576, "MiB glb")
