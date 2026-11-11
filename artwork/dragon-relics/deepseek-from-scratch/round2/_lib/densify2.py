# -*- coding: utf-8 -*-
"""目标驱动细分：从面数最少的对象开始逐个细分+平滑，直到该件 ≥ 目标面数或对象用尽。
每批后复检；若出现自交则停止该件并记录（保留最后一个无自交状态需外部回滚，故只记录）。"""
import bpy, bmesh, sys, json
BASE = r"./artwork/dragon-relics/deepseek-from-scratch"
sys.path.insert(0, BASE + "/_lib"); sys.path.insert(0, BASE + "/round2/_lib")
import dsh_rt_kernel as K

JOBS = [("black_crown", "COL_Crown", 500000),
        ("white_book", "COL_Book", 500000),
        ("sky_spear", "COL_Spear", 500000),
        ("fire_ring", "COL_Ring", 500000),
        ("black_regalia", "COL_Regalia", 500000),
        ("sea_armor", "COL_Armor", 500000)]
out = {}
for aid, col, target in JOBS:
    rd = BASE + "/round2/" + aid
    bpy.ops.wm.open_mainfile(filepath=rd + "/%s_r2.blend" % aid)
    coll = bpy.data.collections.get(col)
    r = json.loads(K.dsh_audit_api['mesh'](scope=col, self_intersect=True))
    tris = r['totals']['tris']
    rounds = 0
    while tris < target and rounds < 8:
        cand = sorted([o for o in coll.objects if o.type == 'MESH'
                       and len(o.data.polygons) >= 20],
                      key=lambda o: len(o.data.polygons))
        if not cand:
            break
        batch = cand[:max(1, len(cand) // 3)]
        for ob in batch:
            me = ob.data
            bm = bmesh.new(); bm.from_mesh(me)
            bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=1,
                                      use_grid_fill=True)
            bmesh.ops.smooth_vert(bm, verts=list(bm.verts), factor=0.15,
                                  use_axis_x=True, use_axis_y=True, use_axis_z=True)
            bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
            bm.to_mesh(me); bm.free(); me.update()
            for p in me.polygons:
                p.use_smooth = True
        r = json.loads(K.dsh_audit_api['mesh'](scope=col, self_intersect=True))
        tris = r['totals']['tris']
        rounds += 1
        if r['totals']['self_intersections'] > 0:
            print("  SI_APPEARED", aid, r['totals']['self_intersections'])
            break
    bpy.ops.wm.save_as_mainfile(filepath=rd + "/%s_r2.blend" % aid)
    r = json.loads(K.dsh_audit_api['mesh'](scope=col, self_intersect=True))
    t = r['totals']
    print("DENS2|%s|%s|tris%d|objs%d|si%d|bnd%d|nm%d|deg%d|rounds%d" % (
        aid, r['state'], t['tris'], t['objects'], t['self_intersections'],
        t['boundary_edges'], t['nonmanifold_edges'], t['degenerate_faces'], rounds))
    out[aid] = dict(state=r['state'], tris=t['tris'], objects=t['objects'],
                    si=t['self_intersections'], bnd=t['boundary_edges'],
                    nm=t['nonmanifold_edges'], deg=t['degenerate_faces'], rounds=rounds)
json.dump(out, open(BASE + "/round2/densify2-report.json", "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
