# -*- coding: utf-8 -*-
"""black_crown 几何库：透镜截面叶片（非对称半宽 + 外倾 + 尖端倒钩）。
用法：lens_blade(...) 返回闭合流形对象。
"""
import bpy, bmesh, math
from mathutils import Vector

MM = 0.001
Z = Vector((0, 0, 1))
RES = 2.2          # 全局细分倍率（用户 2026-10-30：面数不是约束）


def res(v, lo=4):
    return max(lo, int(round(v * RES)))


def cr_sample(ctrl, u):
    if u <= ctrl[0][0]:
        return ctrl[0][1]
    if u >= ctrl[-1][0]:
        return ctrl[-1][1]
    i = 0
    while i < len(ctrl) - 2 and u > ctrl[i + 1][0]:
        i += 1
    x0, y0 = ctrl[max(i - 1, 0)]
    x1, y1 = ctrl[i]
    x2, y2 = ctrl[i + 1]
    x3, y3 = ctrl[min(i + 2, len(ctrl) - 1)]
    t = (u - x1) / max(x2 - x1, 1e-9)
    t2, t3 = t * t, t * t * t
    return 0.5 * ((2 * y1) + (-y0 + y2) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2
                  + (-y0 + 3 * y1 - 3 * y2 + y3) * t3)


def mesh_from(name, verts, faces, coll, smooth=False):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.validate()
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    me.update()
    return ob


def blade_frame(radial, k_front=0.45, lean_deg=0.0):
    """返回 (A=面内水平宽度轴, U=面内上轴(已外倾), P=面法线)。"""
    radial = Vector(radial).normalized()
    P0 = (radial * (1.0 - k_front) + Vector((0, -1.0, 0)) * k_front)
    if P0.length < 1e-6:
        P0 = radial
    P0.normalize()
    A = P0.cross(Z)
    if A.length < 1e-6:
        A = Vector((1, 0, 0))
    A.normalize()
    U = A.cross(P0)
    # 外倾：绕 A 轴旋转 (U, P0)
    ln = math.radians(lean_deg)
    c, s = math.cos(ln), math.sin(ln)
    U2 = (U * c - A.cross(U) * s).normalized()
    P2 = (P0 * c - A.cross(P0) * s).normalized()
    return A, U2, P2


def lens_blade(name, base, A, U, P, h_local_mm, ctrl_h, ctrl_lat,
               w_in, w_out, ctrl_t, n=30, coll=None, return_edges=False, smooth=True):
    n = res(n, 8)
    """沿面内脊线扫掠：截面 = 4 点透镜（±A 两侧不同半宽 w_in/w_out，±P 厚度 t）。"""
    verts, faces = [], []
    rings = []
    ctrl_h = ctrl_h or [(0.0, 0.0), (1.0, 1.0)]
    for i in range(n):
        u = i / float(n)
        h = cr_sample(ctrl_h, u)
        lat = cr_sample(ctrl_lat, u)
        wi = cr_sample(w_in, u)
        wo = cr_sample(w_out, u)
        t = cr_sample(ctrl_t, u)
        C = Vector(base) + U * (h * h_local_mm * MM) + A * (lat * MM)
        wmin = max(min(wi, wo), 0.05)
        t = min(t, 0.55 * wmin)
        rings.append((C, wi * MM, wo * MM, t * MM))
    verts = []
    ring_idx = []
    edge_out, edge_in = [], []
    for k, (C, wi, wo, t) in enumerate(rings):
        if k == 0:
            T = (rings[1][0] - C)
        elif k == len(rings) - 1:
            T = (C - rings[k - 1][0])
        else:
            T = (rings[k + 1][0] - rings[k - 1][0])
        T.normalize()
        A2 = (A - T * A.dot(T))
        if A2.length < 1e-9:
            A2 = T.cross(Z).normalized()
        A2.normalize()
        N = T.cross(A2).normalized()
        ring = [C + A2 * wo, C + N * t, C - A2 * wi, C - N * t]
        edge_out.append(C + A2 * wo)
        edge_in.append(C - A2 * wi)
        idx = []
        for v in ring:
            idx.append(len(verts))
            verts.append(v)
        ring_idx.append(idx)
    # 尖端
    h = cr_sample(ctrl_h, 1.0)
    lat = cr_sample(ctrl_lat, 1.0)
    tipC = Vector(base) + U * (h * h_local_mm * MM) + A * (lat * MM)
    tip_i = len(verts)
    verts.append(tipC)
    for k in range(len(ring_idx) - 1):
        a, b = ring_idx[k], ring_idx[k + 1]
        for j in range(4):
            jn = (j + 1) % 4
            faces.append([a[j], a[jn], b[jn], b[j]])
    last = ring_idx[-1]
    for j in range(4):
        jn = (j + 1) % 4
        faces.append([last[j], last[jn], tip_i])
    b0 = ring_idx[0]
    faces.append([b0[3], b0[2], b0[1], b0[0]])
    ob = mesh_from(name, verts, faces, coll, smooth=smooth)
    if return_edges:
        return ob, dict(out=[p for p in edge_out], inn=[p for p in edge_in], tip=tipC)
    return ob


def catmull3(pts, n):
    """3D Catmull-Rom 通过控制点，返回 n+1 个点（mm→m 由调用方处理）。"""
    P = [Vector(p) for p in pts]
    out = []
    m = len(P) - 1
    for i in range(n + 1):
        s = m * i / float(n)
        k = min(int(s), m - 1)
        t = s - k
        p0 = P[max(k - 1, 0)]
        p1 = P[k]
        p2 = P[k + 1]
        p3 = P[min(k + 2, m)]
        t2, t3 = t * t, t * t * t
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                          + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    return out


def curved_blade(name, ctrl_pts_mm, w0_mm, t0_mm, coll, n=26, plane=None,
                 w_prof=None, t_sharp=0.20, smooth=False):
    n = res(n, 8)
    """沿任意 3D 脊线（mm 控制点）成形的薄刃/火焰舌。
    plane: 期望面法线方向（世界向量）；None 则用脊线首末与 Z 估平面。
    """
    pts = catmull3([Vector(p) * MM for p in ctrl_pts_mm], n)
    if plane is None:
        Pn = (pts[-1] - pts[0]).cross(Z)
        if Pn.length < 1e-9:
            Pn = Z.cross(Vector((0, 1, 0)))
        plane = Pn
    P = Vector(plane).normalized()
    w_prof = w_prof or [(0.0, 0.95), (0.12, 1.0), (0.4, 0.80), (0.62, 0.50),
                        (0.80, 0.22), (0.92, 0.09), (1.0, 0.0)]
    verts, faces = [], []
    idx = []
    for i, C in enumerate(pts):
        u = i / float(n)
        if i == 0:
            T = pts[1] - pts[0]
        elif i == n:
            T = pts[-1] - pts[-2]
        else:
            T = pts[i + 1] - pts[i - 1]
        T.normalize()
        A = (P - T * P.dot(T))
        if A.length < 1e-9:
            A = T.cross(Z)
        A.normalize()
        N = T.cross(A).normalized()
        w = cr_sample(w_prof, u) * w0_mm * MM
        t = (cr_sample([(0, 1.0), (0.6, 0.72), (1.0, t_sharp)], u)) * t0_mm * MM
        t = min(t, 0.55 * max(w, 0.05 * MM))
        if u >= 1.0:
            break
        ring = [C + A * w, C + N * t, C - A * w, C - N * t]
        row = []
        for v in ring:
            row.append(len(verts))
            verts.append(v)
        idx.append(row)
    tip_i = len(verts)
    verts.append(pts[-1])
    for k in range(len(idx) - 1):
        a, b = idx[k], idx[k + 1]
        for j in range(4):
            jn = (j + 1) % 4
            faces.append([a[j], a[jn], b[jn], b[j]])
    last = idx[-1]
    for j in range(4):
        jn = (j + 1) % 4
        faces.append([last[j], last[jn], tip_i])
    b0 = idx[0]
    faces.append([b0[3], b0[2], b0[1], b0[0]])
    return mesh_from(name, verts, faces, coll, smooth=smooth)


def blade_from_spec(name, spec, base, radial, coll, defaults):
    """按 spec 字典 + defaults 建单片冠刺。返回对象。"""
    A, U, P = blade_frame(radial, spec.get("k", defaults["k"]), spec["lean"])
    h_abs = spec["h"]
    h_local = h_abs - base[2] / MM
    h_local = max(h_local, 10.0)
    wb = spec["wb"]
    prof = defaults["prof"]
    w_in = [(u, v * wb * spec.get("w_scale", 1.0)) for u, v in prof["w_in"]]
    w_out = [(u, v * wb * spec.get("w_scale", 1.0)) for u, v in prof["w_out"]]
    t = [(u, v * spec.get("t_scale", 1.0)) for u, v in prof["t"]]
    lat = [(u, v * spec.get("lat", 0.0)) for u, v in prof["lat"]]
    return lens_blade(name, base, A, U, P, h_local, prof["h"], lat,
                      w_in, w_out, t, n=defaults.get("n", 30), coll=coll)


def mirror_x(ob, name=None, coll=None):
    """复制并镜像到 -X（用于左右对称）。"""
    me = ob.data.copy()
    new = bpy.data.objects.new(name or (ob.name + "_L"), me)
    (coll or ob.users_collection[0]).objects.link(new)
    bm = bmesh.new()
    bm.from_mesh(me)
    for v in bm.verts:
        v.co.x = -v.co.x
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # 镜像会翻转绕序：按有符号体积校正为朝外
    bmesh.ops.triangulate(bm, faces=bm.faces)
    vol = 0.0
    for f in bm.faces:
        a, b, c = [v.co for v in f.verts]
        vol += a.dot(b.cross(c)) / 6.0
    if vol < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.update()
    return new


# ---------------- 冠圈 ----------------
def ring_wall(name, coll, a_out, b_out, wall, z0, z1, nseg=128, z_top=None, z_bot=None,
              taper_top=0.0):
    verts, faces = [], []
    loops = []
    for k in range(nseg):
        th = math.tau * k / nseg
        cx, sy = math.cos(th), math.sin(th)
        zt = z1 if z_top is None else z_top(th)
        zb = z0 if z_bot is None else z_bot(th)
        a_t = a_out * (1.0 - taper_top)
        b_t = b_out * (1.0 - taper_top)
        v = [
            (a_out * cx, b_out * sy, zb),
            (a_t * cx, b_t * sy, zt),
            ((a_t - wall) * cx, (b_t - wall) * sy, zt),
            ((a_out - wall) * cx, (b_out - wall) * sy, zb),
        ]
        idx = []
        for p in v:
            idx.append(len(verts))
            verts.append(Vector((p[0] * MM, p[1] * MM, p[2] * MM)))
        loops.append(idx)
    for k in range(nseg):
        Ap, Bp = loops[k], loops[(k + 1) % nseg]
        for j in range(4):
            jn = (j + 1) % 4
            faces.append([Ap[j], Ap[jn], Bp[jn], Bp[j]])
    return mesh_from(name, verts, faces, coll)


# ---------------- 通用扫掠（管/绳/环） ----------------
def tube_along(name, pts, radius_mm, coll, seg=8, closed=False, radii=None, pts_mm=True,
               mat=None, smooth=True):
    """沿折线扫掠圆截面（简单平行移动框架）。pts 默认按 mm 给（本库统一 mm 口径）。"""
    pts = [(Vector(p) * MM) if pts_mm else Vector(p) for p in pts]
    # 路径再采样（让扫掠更顺，不改变整体走向）
    if len(pts) >= 3 and not closed:
        target = max(len(pts), int(len(pts) * RES))
        pts = catmull3([tuple(q / MM) for q in pts], target - 1)
        pts = [Vector(q) * MM for q in pts]
        if radii is not None:
            rr = []
            for i in range(len(pts)):
                u = i / (len(pts) - 1.0)
                k = u * (len(radii) - 1)
                i0 = int(math.floor(k)); i1 = min(i0 + 1, len(radii) - 1)
                f = k - i0
                rr.append(radii[i0] * (1 - f) + radii[i1] * f)
            radii = rr
    n = len(pts)
    seg = res(seg, 6)
    verts, faces = [], []
    rings = []
    prevN = None
    for i in range(n):
        if i == 0:
            T = (pts[1] - pts[0])
        elif i == n - 1:
            T = (pts[-1] - pts[-2])
        else:
            T = (pts[i + 1] - pts[i - 1])
        T.normalize()
        if prevN is None:
            up = Z if abs(T.dot(Z)) < 0.95 else Vector((0, 1, 0))
            N = (up - T * up.dot(T)).normalized()
        else:
            N = (prevN - T * prevN.dot(T))
            if N.length < 1e-6:
                up = Z if abs(T.dot(Z)) < 0.95 else Vector((0, 1, 0))
                N = (up - T * up.dot(T))
            N.normalize()
        prevN = N
        B = T.cross(N).normalized()
        r = radius_mm if radii is None else radii[i]
        idx = []
        for j in range(seg):
            ang = math.tau * j / seg
            v = pts[i] + (N * math.cos(ang) + B * math.sin(ang)) * (r * MM)
            idx.append(len(verts))
            verts.append(v)
        rings.append(idx)
    for k in range(n - 1):
        a, b = rings[k], rings[k + 1]
        for j in range(seg):
            jn = (j + 1) % seg
            faces.append([a[j], a[jn], b[jn], b[j]])
    if closed:
        a, b = rings[-1], rings[0]
        for j in range(seg):
            jn = (j + 1) % seg
            faces.append([a[j], a[jn], b[jn], b[j]])
    else:
        faces.append(list(reversed(rings[0])))
        faces.append(list(rings[-1]))
    ob = mesh_from(name, verts, faces, coll, smooth=smooth)
    if mat:
        ob.data.materials.append(mat)
    return ob


def torus_ellipse(name, coll, a_mm, b_mm, z_mm, r_mm, seg=96, ring=10, scale_z=1.0):
    """椭圆环（实心环体）。"""
    verts, faces = [], []
    idxs = []
    for i in range(seg):
        th = math.tau * i / seg
        C = Vector((a_mm * math.cos(th) * MM, b_mm * math.sin(th) * MM, z_mm * MM))
        Tn = Vector((-a_mm * math.sin(th), b_mm * math.cos(th), 0)).normalized()
        Nr = Vector((math.cos(th) , math.sin(th), 0))
        Bv = Z
        row = []
        for j in range(ring):
            ang = math.tau * j / ring
            v = C + Nr * (math.cos(ang) * r_mm * MM) + Bv * (math.sin(ang) * r_mm * MM * scale_z)
            row.append(len(verts))
            verts.append(v)
        idxs.append(row)
    for i in range(seg):
        A_, B_ = idxs[i], idxs[(i + 1) % seg]
        for j in range(ring):
            jn = (j + 1) % ring
            faces.append([A_[j], A_[jn], B_[jn], B_[j]])
    return mesh_from(name, verts, faces, coll)


def box_bevel(name, coll, size_mm, center_mm, rot=(0, 0, 0), bevel_mm=0.0, seg=1, taper=1.0):
    """倒角盒（用 bmesh bevel）。size/center 单位 mm。"""
    verts = []
    sx, sy, sz = [s * 0.5 for s in size_mm]
    tx, ty, tz = sx * taper, sy * taper, sz
    for zs, k in ((-1, 1.0), (1, taper)):
        for xs, ys in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            verts.append(Vector((xs * sx * k * MM, ys * sy * k * MM, zs * sz * MM)))
    faces = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.validate()
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    if bevel_mm > 0:
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=bevel_mm * MM,
                        segments=seg, affect='EDGES', clamp_overlap=True)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        me.update()
    ob.location = tuple(c * MM for c in center_mm)
    ob.rotation_euler = rot
    return ob


# ---------------- 鳞片 ----------------
def scale_plate_geo(center, Td, Nd, w, L, lift, thick, dome=1.0, detail=True,
                    levels=1):
    """单片鳞甲几何。center 世界坐标(m)；w/L/lift/thick 为 mm。
    detail=True：穹面 + 内圈抬升（中脊）+ 卷边外沿，约 30 面/片；False 退回 12 面平板。"""
    Td = Td.normalized()
    Nd = Nd.normalized()
    Vd = Td.cross(Nd).normalized()
    C = Vector(center)
    w, L, lift, thick = w * MM, L * MM, lift * MM, thick * MM
    hv = [(0.52, 0.0), (0.30, 0.42), (-0.34, 0.46), (-0.30, 0.0),
          (-0.34, -0.46), (0.30, -0.42)]
    n = len(hv)
    if not detail:
        top, bot = [], []
        for a, b in hv:
            q = C + Td * (a * L) + Vd * (b * w)
            top.append(q + Nd * (lift * 0.25))
            bot.append(q - Nd * (thick * 0.35))
        ct = C + Td * (0.02 * L) + Nd * (lift * dome)
        cb = C - Nd * thick
        verts = top + bot + [ct, cb]
        it, ib, ict, icb = 0, n, 2 * n, 2 * n + 1
        faces = []
        for i in range(n):
            j = (i + 1) % n
            faces.append([ict, it + i, it + j])
            faces.append([icb, ib + j, ib + i])
            faces.append([it + i, ib + i, ib + j, it + j])
        return _subdiv_scale(verts, faces, center, Td, Vd, Nd, w, L, lift, levels)
    # --- 高细节：外沿(卷边) / 内圈(抬升) / 中心脊 ---
    rim_t, mid_t, bot = [], [], []
    for a, b in hv:
        q = C + Td * (a * L) + Vd * (b * w)
        rim_t.append(q + Nd * (lift * 0.15))
        mid_t.append(C + Td * (a * L * 0.62) + Vd * (b * w * 0.62) + Nd * (lift * 0.85))
        bot.append(q - Nd * (thick * 0.45))
    ct = C + Td * (0.06 * L) + Nd * (lift * 1.15 * dome)
    cb = C - Nd * thick
    verts = rim_t + mid_t + bot + [ct, cb]
    R0, M0, B0 = 0, n, 2 * n
    ict, icb = 3 * n, 3 * n + 1
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.append([R0 + i, R0 + j, M0 + j, M0 + i])     # 卷边
        faces.append([M0 + i, M0 + j, ict])                # 内圈->脊
        faces.append([R0 + i, B0 + i, B0 + j, R0 + j])     # 侧壁
        faces.append([icb, B0 + j, B0 + i])                # 底
    return _subdiv_scale(verts, faces, center, Td, Vd, Nd, w, L, lift, levels)


def _subdiv_scale(verts, faces, center, Td, Vd, Nd, w, L, lift, levels):
    """鳞板再细分 + 沿法线真实穹起（levels>=2 时面数 ×4^(n-1)，形态更圆）。"""
    if levels <= 1:
        return verts, faces
    ob = mesh_from("_tmp_scale", verts, faces, bpy.context.scene.collection)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for _ in range(levels - 1):
        bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=1,
                                  use_grid_fill=True)
    Cw = Vector(center)
    R = 0.5 * max(w * MM, L * MM)
    for v in bm.verts:
        d = v.co - Cw
        if d.dot(Nd) > 0:
            rr = math.hypot(d.dot(Td), d.dot(Vd)) / max(R, 1e-9)
            v.co = v.co + Nd * (lift * MM * 0.22 * max(0.0, 1.0 - rr * rr) ** 1.5)
    bm.to_mesh(ob.data)
    bm.free()
    out_v = [tuple(v.co) for v in ob.data.vertices]
    out_f = [list(f.vertices) for f in ob.data.polygons]
    me = ob.data
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.meshes.remove(me)
    return out_v, out_f


def fluted_robe(name, coll, x, y, z0, z1, r0, r1, ribs=10, amp=0.14, seg=48,
                mat=None):
    """竖棱袍身（哥特石像的衣褶）：带 ribs 条竖棱的锥台，mm 输入。"""
    seg = res(seg, 24)
    verts, faces, rows = [], [], []
    levels = [(z0, r0), (z0 + (z1 - z0) * 0.35, (r0 + r1) * 0.5),
              (z0 + (z1 - z0) * 0.72, r1 * 1.04), (z1, r1)]
    for (zz, rr) in levels:
        row = []
        for k in range(seg):
            th = math.tau * k / seg
            rad = rr * (1.0 + amp * math.cos(ribs * th))
            row.append(len(verts))
            verts.append(Vector((x + math.cos(th) * rad,
                                 y + math.sin(th) * rad, zz)) * MM)
        rows.append(row)
    for i in range(len(rows) - 1):
        A_, B_ = rows[i], rows[i + 1]
        for k in range(seg):
            kn = (k + 1) % seg
            faces.append([A_[k], A_[kn], B_[kn], B_[k]])
    faces.append(list(reversed(rows[0])))
    faces.append(list(rows[-1]))
    ob = mesh_from(name, verts, faces, coll, smooth=True)
    if mat:
        ob.data.materials.append(mat)
    return ob


def merge_geo(name, chunks, coll):
    """把多块 (verts, faces) 合成一个网格对象。"""
    verts, faces = [], []
    for vs, fs in chunks:
        off = len(verts)
        verts.extend(vs)
        for f in fs:
            faces.append([i + off for i in f])
    return mesh_from(name, verts, faces, coll)


# ---------------- 宝石 ----------------
def gem_geo(center, sx, sy, h, n=8, table=0.45, crown_h=0.34):
    """刻面宝石：腰围多边形 + 冠部斜面 + 台面 + 亭部尖。center 为腰围中心(m)。"""
    C = Vector(center)
    girdle, tabs = [], []
    for i in range(n):
        a = math.tau * i / n
        girdle.append(C + Vector((math.cos(a) * sx, math.sin(a) * sy, 0.0)))
        tabs.append(C + Vector((math.cos(a) * sx * table, math.sin(a) * sy * table,
                                h * crown_h)))
    pav = C + Vector((0, 0, -h * (1.0 - crown_h)))
    verts = girdle + tabs + [pav]
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.append([i, j, n + j, n + i])
    faces.append(list(range(n, 2 * n)))
    for i in range(n):
        j = (i + 1) % n
        faces.append([i, 2 * n, j])
    return verts, faces


def add_gem(name, coll, center_mm, sx, sy, h, rot_z=0.0, n=8, mat=None):
    v, f = gem_geo((center_mm[0] * MM, center_mm[1] * MM, center_mm[2] * MM),
                   sx * MM, sy * MM, h * MM, n=n)
    if abs(rot_z) > 1e-9:
        ca, sa = math.cos(rot_z), math.sin(rot_z)
        cx, cy, cz = center_mm[0] * MM, center_mm[1] * MM, center_mm[2] * MM
        C = Vector((cx, cy, cz))
        v = [C + Vector((ca * (p.x - cx) - sa * (p.y - cy),
                         sa * (p.x - cx) + ca * (p.y - cy), p.z - cz)) for p in v]
    ob = mesh_from(name, v, f, coll)
    if mat:
        ob.data.materials.append(mat)
    return ob


# ---------------- 通用零件（七件共用） ----------------
def sphere(name, coll, center_mm, r_mm, seg=24, ring=16, mat=None):
    seg = res(seg, 8); ring = res(ring, 6)
    bm = bmesh.new()
    try:
        bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=ring, radius=r_mm * MM)
    except TypeError:
        bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=ring, diameter=r_mm * MM)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    ob.location = tuple(c * MM for c in center_mm)
    for p in me.polygons:
        p.use_smooth = True
    if mat:
        me.materials.append(mat)
    return ob


def torus(name, coll, center_mm, R_mm, r_mm, plane='XZ', seg=64, ring=10, mat=None,
          rscale=(1.0, 1.0), smooth=True):
    seg = res(seg, 12); ring = res(ring, 6)
    """任意平面内的圆环（实心环体）。plane: XY/XZ/YZ。"""
    verts, faces, idxs = [], [], []
    for i in range(seg):
        th = math.tau * i / seg
        c = math.cos(th); s = math.sin(th)
        if plane == 'XZ':
            C = Vector((R_mm * c, 0.0, R_mm * s))
            Nr = Vector((c, 0.0, s)); Bv = Vector((0, 1, 0))
        elif plane == 'YZ':
            C = Vector((0.0, R_mm * c, R_mm * s))
            Nr = Vector((0.0, c, s)); Bv = Vector((1, 0, 0))
        else:
            C = Vector((R_mm * c, R_mm * s, 0.0))
            Nr = Vector((c, s, 0.0)); Bv = Vector((0, 0, 1))
        C = C + Vector(center_mm)
        row = []
        for j in range(ring):
            a = math.tau * j / ring
            v = C + (Nr * (math.cos(a) * r_mm * rscale[0]) + Bv * (math.sin(a) * r_mm * rscale[1]))
            row.append(len(verts)); verts.append(v * MM)
        idxs.append(row)
    for i in range(seg):
        A_, B_ = idxs[i], idxs[(i + 1) % seg]
        for j in range(ring):
            jn = (j + 1) % ring
            faces.append([A_[j], A_[jn], B_[jn], B_[j]])
    ob = mesh_from(name, verts, faces, coll, smooth=smooth)
    if mat:
        ob.data.materials.append(mat)
    return ob


def chain(name, coll, start_mm, dir_mm, link_len_mm, link_r_mm, count, mat=None):
    """链：交替 90° 的小环。start 起点、dir 方向（归一化前）。"""
    NL = res(16, 10)
    d = Vector(dir_mm).normalized()
    up = Vector((0, 0, 1))
    if abs(d.dot(up)) > 0.95:
        up = Vector((0, 1, 0))
    side = d.cross(up).normalized()
    verts, faces = [], []
    for i in range(count):
        c = Vector(start_mm) + d * (link_len_mm * (i + 0.5))
        plane = side if i % 2 == 0 else d.cross(side).normalized()
        # 小环：在 plane 与 d 张成的平面内
        e1 = plane
        e2 = d.cross(e1).normalized()
        row_prev = None
        rows = []
        for k in range(NL):
            a = math.tau * k / NL
            C = c + e1 * math.cos(a) * link_len_mm * 0.5 + e2 * math.sin(a) * link_len_mm * 0.5
            # 环体断面
            Tn = (-e1 * math.sin(a) + e2 * math.cos(a)).normalized()
            Nn = Tn.cross(d).normalized()
            rows.append((C, Nn, Tn))
        loop = []
        for (C, Nn, Tn) in rows:
            rr = []
            for j in range(6):
                b = math.tau * j / 6
                v = C + (Nn * math.cos(b) + d * math.sin(b)) * link_r_mm
                rr.append(len(verts)); verts.append(v * MM)
            loop.append(rr)
        for k in range(NL):
            A_, B_ = loop[k], loop[(k + 1) % NL]
            for j in range(6):
                jn = (j + 1) % 6
                faces.append([A_[j], A_[jn], B_[jn], B_[j]])
    ob = mesh_from(name, verts, faces, coll, smooth=True)
    if mat:
        ob.data.materials.append(mat)
    return ob


def taper_cyl(name, coll, p0_mm, p1_mm, r0_mm, r1_mm, seg=20, mat=None, cap=True):
    """两点之间的锥形圆柱。"""
    seg = res(seg, 8)
    p0 = Vector(p0_mm); p1 = Vector(p1_mm)
    d = (p1 - p0)
    L = d.length
    d.normalize()
    up = Vector((0, 0, 1))
    if abs(d.dot(up)) > 0.95:
        up = Vector((0, 1, 0))
    e1 = d.cross(up).normalized()
    e2 = d.cross(e1).normalized()
    verts, faces = [], []
    rings = []
    for (p, r) in ((p0, r0_mm), (p1, r1_mm)):
        row = []
        for j in range(seg):
            a = math.tau * j / seg
            v = p + (e1 * math.cos(a) + e2 * math.sin(a)) * r
            row.append(len(verts)); verts.append(v * MM)
        rings.append(row)
    for j in range(seg):
        jn = (j + 1) % seg
        faces.append([rings[0][j], rings[0][jn], rings[1][jn], rings[1][j]])
    if cap:
        faces.append(list(reversed(rings[0])))
        faces.append(list(rings[1]))
    ob = mesh_from(name, verts, faces, coll, smooth=True)
    if mat:
        ob.data.materials.append(mat)
    return ob


def spoke(name, coll, base_mm, tip_mm, w0_mm, w1_mm, thick_mm, mat=None, seg=4):
    """星芒尖刺：从 base 到 tip 的锥形四棱尖。"""
    b = Vector(base_mm); t = Vector(tip_mm)
    d = (t - b).normalized()
    up = Vector((0, 0, 1))
    if abs(d.dot(up)) > 0.95:
        up = Vector((0, 1, 0))
    e1 = d.cross(up).normalized()
    e2 = d.cross(e1).normalized()
    verts = []
    for e, w, th in ((b, w0_mm, thick_mm),):
        verts += [b + e1 * w + e2 * th, b - e1 * w + e2 * th,
                  b - e1 * w - e2 * th, b + e1 * w - e2 * th]
    verts += [t + e1 * w1_mm + e2 * w1_mm, t - e1 * w1_mm + e2 * w1_mm,
              t - e1 * w1_mm - e2 * w1_mm, t + e1 * w1_mm - e2 * w1_mm]
    faces = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]
    ob = mesh_from(name, [v * MM for v in verts], faces, coll)
    if mat:
        ob.data.materials.append(mat)
    return ob


def ribbon(name, coll, ctrl_mm, width_mm, thick_mm, mat=None, n=26, jag=0.0, seed=1):
    """布料飘带：沿控制点成形的薄片（宽基本恒定，末端可锯边）。"""
    pts = catmull3([Vector(p) * MM for p in ctrl_mm], n)
    verts, faces, idxs = [], [], []
    for i, C in enumerate(pts):
        u = i / float(n)
        if i == 0:
            T = pts[1] - pts[0]
        elif i == n:
            T = pts[-1] - pts[-2]
        else:
            T = pts[i + 1] - pts[i - 1]
        T.normalize()
        A = T.cross(Vector((0, 1, 0)))
        if A.length < 1e-6:
            A = T.cross(Vector((1, 0, 0)))
        A.normalize()
        N = T.cross(A).normalized()
        w = width_mm * 0.5 * MM * (1.0 - 0.15 * u)
        row = [C + A * w, C + N * thick_mm * 0.5 * MM, C - A * w, C - N * thick_mm * 0.5 * MM]
        rr = []
        for v in row:
            rr.append(len(verts)); verts.append(v)
        idxs.append(rr)
    for k in range(len(idxs) - 1):
        A_, B_ = idxs[k], idxs[k + 1]
        for j in range(4):
            jn = (j + 1) % 4
            faces.append([A_[j], A_[jn], B_[jn], B_[j]])
    faces.append(list(reversed(idxs[0])))
    faces.append(list(idxs[-1]))
    ob = mesh_from(name, verts, faces, coll)
    if mat:
        ob.data.materials.append(mat)
    return ob


# ---------------- 材质库（ambientCG CC0 贴图，来源见 materials-cc0/manifest*.json） ----------------
MAT_ROOT = str(__import__("pathlib").Path(__file__).resolve().parents[4] / "artwork/dragon-relics/materials-cc0")


def _tex_node(mat, path, non_color, proj_scale):
    nt = mat.node_tree
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (proj_scale,) * 3
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(path, check_existing=True)
    tex.projection = 'BOX'
    tex.projection_blend = 0.25
    if non_color:
        tex.image.colorspace_settings.name = 'Non-Color'
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    nt.links.new(mp.outputs["Vector"], tex.inputs["Vector"])
    return tex


def tex_mat(name, mid, darken=1.0, metallic=1.0, tint=(1, 1, 1), proj_scale=7.0,
            rough_mul=1.0):
    """用 materials-cc0/<mid>/<mid>_2K-PNG_*.png 建 PBR 材质（缺贴图自动省略）。"""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != 'OUTPUT_MATERIAL':
            nt.nodes.remove(n)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    out = [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    base = MAT_ROOT + "/" + mid + "/" + mid + "_2K-PNG_%s.png"
    import os
    def has(t):
        return os.path.exists(base % t)
    if has("Color"):
        c = _tex_node(m, base % "Color", False, proj_scale)
        hs = nt.nodes.new("ShaderNodeHueSaturation")
        hs.inputs["Value"].default_value = darken
        nt.links.new(c.outputs["Color"], hs.inputs["Color"])
        src = hs.outputs["Color"]
        if abs(tint[0] - 1.0) + abs(tint[1] - 1.0) + abs(tint[2] - 1.0) > 1e-4:
            vm = nt.nodes.new("ShaderNodeVectorMath")
            vm.operation = 'MULTIPLY'
            vm.inputs[1].default_value = (tint[0], tint[1], tint[2])
            nt.links.new(src, vm.inputs[0])
            src = vm.outputs["Vector"]
        nt.links.new(src, bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = (darken * tint[0], darken * tint[1],
                                                   darken * tint[2], 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    if has("Roughness") and rough_mul == 1.0:
        r = _tex_node(m, base % "Roughness", True, proj_scale)
        nt.links.new(r.outputs["Color"], bsdf.inputs["Roughness"])
    else:
        bsdf.inputs["Roughness"].default_value = min(1.0, 0.5 * rough_mul)
    if has("Metalness") and metallic >= 0.99:
        me = _tex_node(m, base % "Metalness", True, proj_scale)
        nt.links.new(me.outputs["Color"], bsdf.inputs["Metallic"])
    if has("NormalGL"):
        n = _tex_node(m, base % "NormalGL", True, proj_scale)
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(n.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def flat_mat(name, color, metallic=0.0, rough=0.4, emission=None, estr=0.0,
             transmission=0.0, ior=1.45):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1.0)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    if "IOR" in b.inputs:
        b.inputs["IOR"].default_value = ior
    if transmission and "Transmission Weight" in b.inputs:
        b.inputs["Transmission Weight"].default_value = transmission
    if emission:
        b.inputs["Emission Color"].default_value = (emission[0], emission[1], emission[2], 1.0)
        b.inputs["Emission Strength"].default_value = estr
    return m


def std_materials():
    """七件圣物常用材质集（名字固定，便于各件复用）。"""
    M = {}
    M["gold"] = tex_mat("M-gold", "Metal042A")
    M["darkgold"] = tex_mat("M-darkgold", "Metal042B")
    M["black"] = tex_mat("M-blackscale", "Metal046A", darken=0.075, metallic=0.32,
                         tint=(1.0, 1.02, 1.1))
    M["steel"] = tex_mat("M-steel", "Metal032", darken=1.0)
    M["black_rough"] = tex_mat("M-black_rough", "Metal046A", darken=0.10, metallic=0.45,
                               tint=(1.0, 1.03, 1.12), rough_mul=2.4)
    M["bronze"] = tex_mat("M-bronze", "Metal042B", darken=0.55)
    M["ruby"] = flat_mat("M-ruby", (0.42, 0.012, 0.008), 0.0, 0.08,
                         emission=(0.55, 0.02, 0.01), estr=0.55, transmission=0.55, ior=1.78)
    M["orb_red"] = flat_mat("M-orb_red", (0.34, 0.008, 0.006), 0.0, 0.12,
                            emission=(0.65, 0.03, 0.02), estr=0.9, transmission=0.25, ior=1.78)
    M["crack"] = flat_mat("M-crack", (0.6, 0.05, 0.01), 0.0, 0.5,
                          emission=(1.0, 0.12, 0.03), estr=14.0)
    M["cloth_white"] = tex_mat("M-cloth_white", "Fabric030", darken=1.0, metallic=0.0,
                               tint=(1.0, 1.0, 1.0), proj_scale=4.0)
    M["cloth_blue"] = tex_mat("M-cloth_blue", "Fabric026", darken=0.9, metallic=0.0,
                              tint=(0.32, 0.46, 0.85), proj_scale=4.0)
    M["marble"] = tex_mat("M-marble", "Marble012", metallic=0.0, proj_scale=3.0)
    M["stone"] = tex_mat("M-stone", "Rock030", darken=0.55, metallic=0.0, proj_scale=2.0)
    M["stone_dark"] = tex_mat("M-stone_dark", "Rock030", darken=0.18, metallic=0.0,
                              rough_mul=1.1, proj_scale=3.0)
    M["ivory"] = flat_mat("M-ivory", (0.86, 0.83, 0.74), 0.0, 0.35)
    M["pearl"] = flat_mat("M-pearl", (0.92, 0.90, 0.86), 0.0, 0.16)
    M["silk_red"] = tex_mat("M-silk_red", "Fabric030", darken=0.85, metallic=0.0,
                            tint=(0.72, 0.12, 0.14), proj_scale=4.0)
    M["crystal_blue"] = flat_mat("M-crystal_blue", (0.12, 0.35, 0.85), 0.0, 0.10,
                                 emission=(0.15, 0.45, 1.0), estr=1.2,
                                 transmission=0.5, ior=1.55)
    M["glow_blue"] = flat_mat("M-glow_blue", (0.2, 0.5, 1.0), 0.0, 0.4,
                              emission=(0.25, 0.6, 1.0), estr=6.0)
    return M


def asset_bbox(coll):
    bpy.context.view_layer.update()
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    tris = 0
    for ob in coll.objects:
        if ob.type != 'MESH':
            continue
        ob.data.calc_loop_triangles()
        tris += len(ob.data.loop_triangles)
        for v in ob.data.vertices:
            p = ob.matrix_world @ v.co
            for i in range(3):
                mn[i] = min(mn[i], p[i]); mx[i] = max(mx[i], p[i])
    return mn, mx, tris


def ring_tube(name, coll, rx_mm, ry_mm, z_fn, tube_r_mm, seg=180, ring=10, mat=None,
              smooth=True):
    """水平闭合环管（帧=径向/竖直，稳定不扭转）。z_fn(th)->z(mm)。"""
    seg = res(seg, 24); ring = max(6, int(round(ring * 1.4)))
    verts, faces, idxs = [], [], []
    for i in range(seg):
        th = math.tau * i / seg
        cx, sy = math.cos(th), math.sin(th)
        C = Vector((rx_mm * cx, ry_mm * sy, z_fn(th)))
        N = Vector((cx / max(rx_mm, 1e-6), sy / max(ry_mm, 1e-6), 0.0)).normalized()
        B = Vector((0, 0, 1))
        row = []
        for j in range(ring):
            a = math.tau * j / ring
            v = C + N * (math.cos(a) * tube_r_mm) + B * (math.sin(a) * tube_r_mm)
            row.append(len(verts)); verts.append(v * MM)
        idxs.append(row)
    for i in range(seg):
        A_, B_ = idxs[i], idxs[(i + 1) % seg]
        for j in range(ring):
            jn = (j + 1) % ring
            faces.append([A_[j], A_[jn], B_[jn], B_[j]])
    ob = mesh_from(name, verts, faces, coll, smooth=smooth)
    if mat:
        ob.data.materials.append(mat)
    return ob
