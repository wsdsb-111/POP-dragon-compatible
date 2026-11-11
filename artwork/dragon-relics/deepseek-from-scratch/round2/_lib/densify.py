# -*- coding: utf-8 -*-
"""曲面件真实细分+平滑：只对布片/大曲面/管件做一级 Catmull 式细分并轻度平滑，
面数×4，曲率真实提升（不是全局 RES 倍率）。细分后重算法线，再相交检查。"""
import bpy, bmesh, sys, os, json
BASE = r"./artwork/dragon-relics/deepseek-from-scratch"
sys.path.insert(0, BASE + "/_lib")
sys.path.insert(0, BASE + "/round2/_lib")
import dsh_rt_kernel as K
import relic_render as R1R

JOBS = {
    "sea_armor": ("COL_Armor", ["GEO-veil_cloth", "GEO-skirt", "GEO-bodice",
                                "GEO-apron", "GEO-corset"], 1),
    "white_book": ("COL_Book", ["GEO-cover", "GEO-pages", "GEO-spine", "GEO-dragon_"], 1),
    "black_regalia": ("COL_Regalia", ["GEO-coil_body", "GEO-ribbon", "GEO-shaft"], 1),
    "fire_ring": ("COL_Ring", ["GEO-band", "GEO-RHEAD"], 1),
    "earth_sarcophagus": ("COL_Sarcophagus", ["GEO-lid", "GEO-statue", "GEO-wall", "GEO-base"], 1),
    "sky_spear": ("COL_Spear", ["GEO-shaft", "GEO-blade", "GEO-WING"], 1),
}
rows = {}
for aid, (col, prefixes, levels) in JOBS.items():
    rd = BASE + "/round2/" + aid
    bpy.ops.wm.open_mainfile(filepath=rd + "/%s_r2.blend" % aid)
    coll = bpy.data.collections.get(col)
    n = 0
    for ob in list(coll.objects):
        if ob.type != 'MESH' or not any(ob.name.startswith(p) for p in prefixes):
            continue
        me = ob.data
        if len(me.polygons) < 40:
            continue
        bm = bmesh.new(); bm.from_mesh(me)
        for _ in range(levels):
            bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=1,
                                      use_grid_fill=True)
        bmesh.ops.smooth_vert(bm, verts=list(bm.verts), factor=0.18,
                              use_axis_x=True, use_axis_y=True, use_axis_z=True)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(me); bm.free(); me.update()
        for p in me.polygons:
            p.use_smooth = True
        n += 1
    bpy.ops.wm.save_as_mainfile(filepath=rd + "/%s_r2.blend" % aid)
    r = json.loads(K.dsh_audit_api['mesh'](scope=col, self_intersect=True))
    t = r['totals']
    print("DENS|%s|%s|refined%d|tris%d|si%d|bnd%d|nm%d" % (
        aid, r['state'], n, t['tris'], t['self_intersections'],
        t['boundary_edges'], t['nonmanifold_edges']))
    rows[aid] = dict(state=r['state'], refined=n, tris=t['tris'],
                     self_intersections=t['self_intersections'],
                     boundary=t['boundary_edges'], nonmanifold=t['nonmanifold_edges'])
json.dump(rows, open(BASE + "/round2/densify-report.json", "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
