import bpy, json, sys, hashlib
from pathlib import Path
from mathutils import Vector

root = Path(__file__).resolve().parent.parent
source = root/'artwork/dragon-relics/deepseek-from-scratch'
out = root/'artwork/dragon-relics/codex-round2'
out.mkdir(exist_ok=True)
ids = ['black_crown','black_regalia','white_book','fire_ring','earth_sarcophagus','sea_armor','sky_spear']
results = {}
for item in ids:
    path = source/item/(item+'.blend')
    bpy.ops.wm.open_mainfile(filepath=str(path))
    objects = []
    for ob in bpy.context.scene.objects:
        if ob.type != 'MESH': continue
        me = ob.data
        me.calc_loop_triangles()
        coords = [ob.matrix_world@v.co for v in me.vertices]
        lo = [min(p[i] for p in coords)*1000 for i in range(3)]
        hi = [max(p[i] for p in coords)*1000 for i in range(3)]
        objects.append({'name':ob.name,'vertices':len(me.vertices),'triangles':len(me.loop_triangles),
                        'boundsMm':[lo,hi],'uvLayers':list(me.uv_layers.keys()),
                        'materials':[m.name if m else None for m in me.materials]})
    results[item] = {'source':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                     'objects':objects,'triangles':sum(o['triangles'] for o in objects),
                     'unitScale':bpy.context.scene.unit_settings.scale_length}
(out/'baseline-inspection.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf8')
print('BASELINE_INSPECTION', {k:(v['triangles'],len(v['objects']),sum(not o['uvLayers'] for o in v['objects'])) for k,v in results.items()})
