# -*- coding: utf-8 -*-
"""black_crown 几何库：透镜截面叶片（非对称半宽 + 外倾 + 尖端倒钩）。
用法：lens_blade(...) 返回闭合流形对象。
"""
import bpy, bmesh, math
from mathutils import Vector

MM = 0.001
Z = Vector((0, 0, 1))


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


def mesh_from(name, verts, faces, coll):
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
               w_in, w_out, ctrl_t, n=30, coll=None, return_edges=False):
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
    ob = mesh_from(name, verts, faces, coll)
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
                 w_prof=None, t_sharp=0.20):
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
    return mesh_from(name, verts, faces, coll)


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
def tube_along(name, pts, radius_mm, coll, seg=8, closed=False, radii=None, pts_mm=False):
    """沿折线扫掠圆截面。crown 侧调用传的是米，故默认 pts_mm=False。"""
    pts = [(Vector(p) * MM) if pts_mm else Vector(p) for p in pts]
    n = len(pts)
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
    return mesh_from(name, verts, faces, coll)


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
def scale_plate_geo(center, Td, Nd, w, L, lift, thick, dome=1.0):
    """单片鳞甲几何（世界坐标 mm→m 由调用方保证 center 已是 m 单位）。
    形状：尖端朝 Td 方向的水滴五边形，中心隆起 lift。返回 (verts, faces)。"""
    Td = Td.normalized()
    Nd = Nd.normalized()
    Vd = Td.cross(Nd).normalized()
    C = Vector(center)
    w, L, lift, thick = w * MM, L * MM, lift * MM, thick * MM
    hv = [(0.52, 0.0), (0.30, 0.42), (-0.34, 0.46), (-0.30, 0.0),
          (-0.34, -0.46), (0.30, -0.42)]
    top, bot = [], []
    for a, b in hv:
        p = C + Td * (a * L) + Vd * (b * w)
        top.append(p + Nd * (lift * 0.25))
        bot.append(p - Nd * (thick * 0.35))
    ct = C + Td * (0.02 * L) + Nd * (lift * dome)
    cb = C - Nd * thick
    verts = top + bot + [ct, cb]
    n = len(top)
    it, ib, ict, icb = 0, n, 2 * n, 2 * n + 1
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.append([ict, it + i, it + j])
        faces.append([icb, ib + j, ib + i])
        faces.append([it + i, ib + i, ib + j, it + j])
    return verts, faces


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
