"""Original rigid portrait attachments; native bone nodes, no borrowed geometry."""
from pathlib import Path
import importlib.util
import json
import copy
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('trophy',ROOT/'scripts/build-wyvern-trophy-models.py')
trophy=importlib.util.module_from_spec(spec);spec.loader.exec_module(trophy)
from native_model_export import encode_mesh
from dragon_materials import save_dds_mips

GAME=ROOT/'patches/wyvern-human-form/mod/gfx/models/portraits/mm_dragon_decor'
ART=ROOT/'artwork/dragon-lineage/portrait-models'
GAME.mkdir(parents=True,exist_ok=True);ART.mkdir(parents=True,exist_ok=True)

def models():
    horns=trophy.Mesh('horns')
    for side in [-1,1]:
        horns.tube([[side*5,11,0],[side*6,13,1],[side*6.5,15,3],[side*6,17,5]], [1.25,1.0,.55,.03],'horn',sides=24)
    tail=trophy.Mesh('tail')
    tail.tube([[0,0,8],[0,-5,13],[3,-14,17],[10,-23,18],[18,-26,14],[23,-22,8],[24,-17,5]], [2.3,2.0,1.6,1.25,.8,.4,.03],'hide',sides=24)
    for i in range(9):
        t=i/8;tail.ellipsoid([t*19,-5-t*20,13+t*3],[.8-t*.5,.9-t*.4,.35],'ridge',segments=12,rings=6)
    scales=trophy.Mesh('scales')
    for side in [-1,1]:
        for row in range(3):
            for column in range(4-row):
                scales.ellipsoid([side*(5.7+row*.2),4.0+column*.55+row*.15,-6.7+row*.45],[.10,.24,.22],'plates',segments=10,rings=6)
    return [horns,tail,scales]

# Match the existing exporter UV material cells, with organic nonmetallic maps.
size=1024;tile=size//4
diff=np.full((size,size,4),255,np.uint8)
norm=np.zeros_like(diff);norm[:]=[255,128,0,128]
props=np.zeros_like(diff);props[:]=[0,28,0,195]
yy,xx=np.mgrid[:tile,:tile]
for index,(name,color,rough,metal) in enumerate(trophy.PALETTE):
    base={'horn':[76,63,48],'hide':[100,110,76],'plates':[116,122,90],'ridge':[113,104,75]}.get(name,color)
    grain=(np.sin(xx*.12)*np.sin(yy*.13)+np.sin(xx*.46+yy*.21))*.018
    y,x=index//4*tile,index%4*tile
    diff[y:y+tile,x:x+tile,:3]=np.clip(np.array(base)[None,None,:]*(1+grain[:,:,None]),0,255)
for name,array in [('diffuse',diff),('normal',norm),('properties',props)]:
    image=Image.fromarray(array);image.save(ART/f'mm_dragon_decor_{name}.png');save_dds_mips(image,GAME/f'mm_dragon_decor_{name}.dds')

metadata={};definitions=[]
adult_models=models()
child_models=[]
for adult in adult_models:
    child=copy.deepcopy(adult)
    child.name=adult.name+'_child'
    child.p=(np.asarray(child.p)*.55).tolist()
    child_models.append(child)
for model in adult_models+child_models:
    shape='mm_dragon_'+model.name+'_shape'
    blob,info=encode_mesh(model,shape,'mm_dragon_decor',trophy.property_bytes)
    blob=blob.replace(trophy.property_bytes('shader',['court']),trophy.property_bytes('shader',['portrait_attachment']))
    (GAME/f'mm_dragon_{model.name}.mesh').write_bytes(blob)
    import hashlib
    info['sha256']=hashlib.sha256(blob).hexdigest();metadata[model.name]=info
    definitions.append(f'''pdxmesh = {{
  name = "mm_dragon_{model.name}_mesh"
  file = "mm_dragon_{model.name}.mesh"
  meshsettings = {{
    name = "{shape}"
    index = 0
    texture_diffuse = "mm_dragon_decor_diffuse.dds"
    texture_normal = "mm_dragon_decor_normal.dds"
    texture_specular = "mm_dragon_decor_properties.dds"
    shader = "portrait_attachment"
    shader_file = "gfx/FX/jomini/portrait.shader"
  }}
}}
entity = {{ name = "mm_dragon_{model.name}_entity" pdxmesh = "mm_dragon_{model.name}_mesh" }}
''')

(GAME/'mm_dragon_decor.asset').write_text('\n'.join(definitions),encoding='utf8')
(ART/'models.json').write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf8')
print('Original portrait attachments: horns, tail, temple scales')
