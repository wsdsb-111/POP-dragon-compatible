# -*- coding: utf-8 -*-
"""收尾二：清退化面 -> 全 7 件重做 UV -> 重导 GLB -> 终检"""
import bpy, bmesh, sys, json
BASE = r"./artwork/dragon-relics/deepseek-from-scratch"
sys.path.insert(0, BASE + "/_lib"); sys.path.insert(0, BASE + "/round2/_lib")
import dsh_rt_kernel as K
import relic_render as R1R

ASSETS = [("black_crown", "COL_Crown"), ("black_regalia", "COL_Regalia"),
          ("white_book", "COL_Book"), ("fire_ring", "COL_Ring"),
          ("earth_sarcophagus", "COL_Sarcophagus"), ("sea_armor", "COL_Armor"),
          ("sky_spear", "COL_Spear")]
res = []
for aid, col in ASSETS:
    rd = BASE + "/round2/" + aid
    bpy.ops.wm.open_mainfile(filepath=rd + "/%s_r2.blend" % aid)
    coll = bpy.data.collections.get(col)
    # 1) 清退化
    for ob in list(coll.objects):
        if ob.type != 'MESH':
            continue
        me = ob.data
        bm = bmesh.new(); bm.from_mesh(me)
        bmesh.ops.dissolve_degenerate(bm, dist=2.0e-5, edges=list(bm.edges))
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(me); bm.free(); me.update()
    # 2) 重做 UV
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
    meshes = [o for o in coll.objects if o.type == 'MESH']
    uv = sum(1 for o in meshes if len(o.data.uv_layers) > 0)
    print("FINAL2|%s|%s|tris%d|objs%d|bnd%d|nm%d|deg%d|si%d|nbad%d|uv%d/%d" % (
        aid, r['state'], t['tris'], t['objects'], t['boundary_edges'],
        t['nonmanifold_edges'], t['degenerate_faces'], t['self_intersections'],
        t['normals_inverted'], uv, len(meshes)))
    res.append(dict(asset=aid, state=r['state'], tris=t['tris'], objects=t['objects'],
                    boundary=t['boundary_edges'], nonmanifold=t['nonmanifold_edges'],
                    degenerate=t['degenerate_faces'], self_intersections=t['self_intersections'],
                    normals_inverted=t['normals_inverted'], uv=uv, meshes=len(meshes)))
json.dump(res, open(BASE + "/round2/qa-round2.json", "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
print("TOTAL", sum(x['tris'] for x in res), "PASS", sum(1 for x in res if x['state'] == 'pass'))
