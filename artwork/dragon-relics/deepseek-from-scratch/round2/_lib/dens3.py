# -*- coding: utf-8 -*-
"""三件受控细分：只挑 200..6000 面的对象、最多 2 轮、每轮清退化；然后 UV + 终检。"""
import bpy, bmesh, sys, json
BASE = r"./artwork/dragon-relics/deepseek-from-scratch"
sys.path.insert(0, BASE + "/_lib"); sys.path.insert(0, BASE + "/round2/_lib")
import dsh_rt_kernel as K
import relic_render as R1R
JOBS = [("white_book", "COL_Book", 500000), ("fire_ring", "COL_Ring", 500000),
        ("sky_spear", "COL_Spear", 500000)]
for aid, col, target in JOBS:
    rd = BASE + "/round2/" + aid
    bpy.ops.wm.open_mainfile(filepath=rd + "/%s_r2.blend" % aid)
    coll = bpy.data.collections.get(col)
    for rnd in range(2):
        r = json.loads(K.dsh_audit_api['mesh'](scope=col, self_intersect=True))
        if r['totals']['tris'] >= target:
            break
        for ob in [o for o in coll.objects if o.type == 'MESH'
                   and 200 <= len(o.data.polygons) <= 6000]:
            me = ob.data
            bm = bmesh.new(); bm.from_mesh(me)
            bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=1,
                                      use_grid_fill=True)
            bmesh.ops.smooth_vert(bm, verts=list(bm.verts), factor=0.12,
                                  use_axis_x=True, use_axis_y=True, use_axis_z=True)
            bmesh.ops.dissolve_degenerate(bm, dist=3.0e-5, edges=list(bm.edges))
            bmesh.ops.triangulate(bm, faces=list(bm.faces))
            bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
            bm.to_mesh(me); bm.free(); me.update()
            for p in me.polygons:
                p.use_smooth = True
    bpy.ops.object.select_all(action='DESELECT')
    for ob in list(coll.objects):
        if ob.type != 'MESH':
            continue
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        try:
            bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
        except Exception as ex:
            print("uvfail", ob.name, ex)
        bpy.ops.object.mode_set(mode='OBJECT')
        ob.select_set(False)
    bpy.ops.wm.save_as_mainfile(filepath=rd + "/%s_r2.blend" % aid)
    R1R.export_glb(rd + "/out/%s_r2.glb" % aid)
    r = json.loads(K.dsh_audit_api['mesh'](scope=col, self_intersect=True))
    t = r['totals']
    print("D3|%s|%s|tris%d|bnd%d|nm%d|deg%d|si%d" % (aid, r['state'], t['tris'],
          t['boundary_edges'], t['nonmanifold_edges'], t['degenerate_faces'],
          t['self_intersections']))
