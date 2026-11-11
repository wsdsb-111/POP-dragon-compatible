"""Material-separated native crown export, with CC0 maps and CK3 RRxG packing."""
from pathlib import Path
from types import SimpleNamespace
import json,hashlib,importlib.util
import numpy as np
from PIL import Image,ImageEnhance
from native_model_export import encode_mesh
from dragon_materials import save_dds_mips
ROOT=Path(__file__).resolve().parent.parent
ART=ROOT/'artwork/dragon-relics/crown-threeview-no-cushion'
OUT=ROOT/'.build/crown-pbr-native-candidate';OUT.mkdir(exist_ok=True)
SOURCE=ROOT/'artwork/dragon-relics/materials-cc0'
spec=importlib.util.spec_from_file_location('pdx_binary_base',ROOT/'scripts/build-wyvern-trophy-models.py');base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
meta=json.loads((ART/'black_crown-geometry.json').read_text());data=np.load(ART/'black_crown-geometry.npz')
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
name='mm_relic_black_crown';shape=name+'_shape'
blob=b'@@b@'+base.property_bytes('pdxasset',[1,0])+b'[object\0[['+shape.encode()+b'\0'+base.property_bytes('lod',[0])
parts=[];material_records=[]
for idx in np.unique(data['face_materials']):
    mat,rgb,rough,metal=meta['palette'][int(idx)];prefix='mm_crown_pbr_'+mat
    asset='Metal042A' if mat in ['gold','bronze'] else 'Metal042B' if mat=='darkgold' else 'Metal046A' if mat in ['obsidian','silver'] else None
    size=2048 if asset else 512
    if asset:
        folder=SOURCE/asset
        read=lambda suffix:Image.open(folder/(asset+'_2K-PNG_'+suffix+'.png'))
        color=read('Color').convert('RGB');normal=np.asarray(read('NormalGL').convert('RGB'));roughness=np.asarray(read('Roughness').convert('L'));metalness=np.asarray(read('Metalness').convert('L'))
        if mat=='darkgold':color=ImageEnhance.Brightness(color).enhance(.50)
        roughness=np.clip((.26 if mat=='obsidian' else .18)*255+roughness.astype(float)*.50,0,255).astype(np.uint8)
    else:
        srgb=np.where(np.array(rgb)<=.0031308,np.array(rgb)*12.92,1.055*np.array(rgb)**(1/2.4)-.055)
        color=Image.new('RGB',(size,size),tuple(np.clip(srgb*255,0,255).astype(int)))
        normal=np.zeros((size,size,3),np.uint8);normal[:]=[128,128,255]
        roughness=np.full((size,size),round((.13 if mat=='ruby' else rough)*255),np.uint8);metalness=np.full((size,size),0 if mat=='ruby' else round(metal*255),np.uint8)
    packed_normal=np.empty((size,size,4),np.uint8);packed_normal[:,:,0]=255;packed_normal[:,:,1]=normal[:,:,0];packed_normal[:,:,2]=55 if mat=='lava' else 0;packed_normal[:,:,3]=255-normal[:,:,1]
    properties=np.zeros_like(packed_normal);properties[:,:,1]=60 if mat=='ruby' else 28;properties[:,:,2]=metalness;properties[:,:,3]=roughness
    for suffix,image in [('diffuse',color.convert('RGBA')),('normal',Image.fromarray(packed_normal)),('properties',Image.fromarray(properties))]:
        image.save(OUT/(prefix+'_'+suffix+'.png'));save_dds_mips(image,OUT/(prefix+'_'+suffix+'.dds'))
    faces=data['faces'][data['face_materials']==idx];indices,inverse=np.unique(faces,return_inverse=True)
    mesh=SimpleNamespace(p=data['p'][indices],n=data['n'][indices],uv=data['uv'][indices],faces=inverse.reshape(-1,3))
    encoded,info=encode_mesh(mesh,shape,prefix,base.property_bytes)
    blob+=encoded[encoded.index(b'[[[mesh\0'):]
    for part in info['submeshes']:
        part.update(index=len(parts),texturePrefix=prefix,material=mat);parts.append(part)
    material_records.append({'material':mat,'source':asset or 'Model-authored optical approximation','license':'CC0-1.0' if asset else 'Project-authored','resolution':size,'triangles':len(faces),'prefix':prefix})
    print('MATERIAL_EXPORTED',mat,len(faces),len(info['submeshes']),flush=True)
(OUT/(name+'.mesh')).write_bytes(blob)
settings=[]
for part in parts:
    p=part['texturePrefix'];settings.append(f'''  meshsettings = {{
    name = "{shape}"
    index = {part['index']}
    texture_diffuse = "{p}_diffuse.dds"
    texture_normal = "{p}_normal.dds"
    texture_specular = "{p}_properties.dds"
    shader = "court"
    shader_file = "gfx/FX/court_scene.shader"
  }}''')
(OUT/'mm_dragon_relics.asset').write_text(f'''pdxmesh = {{
  name = "{name}_mesh"
  file = "{name}.mesh"
  scale = 1
{chr(10).join(settings)}
}}
entity = {{ name = "{name}_entity" pdxmesh = "{name}_mesh" }}
''',encoding='utf8')
assert max(p['vertices'] for p in parts)<=60000
manifest={'status':'CROWN_PBR_NATIVE_CANDIDATE_NOT_INSTALLED','materials':material_records,'triangles':len(data['faces']),'parts':parts,'bounds':meta['bounds'],'referenceSha256':meta['referenceSha256'],'uv':meta['uv'],'normalPacking':'RRxG: R=255, G=OpenGL X, B=emission mask, A=255-OpenGL Y','gameRuntime':'NOT_TESTED','files':{p.name:sha(p) for p in OUT.iterdir() if p.suffix in ['.dds','.mesh','.asset']}}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')
print('CROWN_PBR_NATIVE_READY',len(data['faces']),len(parts),flush=True)
