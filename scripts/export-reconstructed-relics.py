"""Export reviewed Blender geometry to a separate CK3 candidate, never installation."""
from pathlib import Path
from types import SimpleNamespace
import sys,json,hashlib,importlib.util
import numpy as np
from PIL import Image
from native_model_export import encode_mesh,asset_definition
from dragon_materials import save_dds_mips
ROOT=Path(__file__).resolve().parent.parent
ART=ROOT/'artwork/dragon-relics/blender-v1323'
OUT=ROOT/'.build/v1323-native-candidate'
if sys.argv[1:]==['--crown-threeview']:
    ART=ROOT/'artwork/dragon-relics/crown-threeview'
    OUT=ROOT/'.build/crown-threeview-native-candidate'
else:
    assert not sys.argv[1:], 'Use --crown-threeview for the crown-only revision'
OUT.mkdir(exist_ok=True)
PREFIX='mm_dragon_relics_v1323'
spec=importlib.util.spec_from_file_location('old_pdx_binary',ROOT/'scripts/build-wyvern-trophy-models.py')
old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def textures(palette):
    size=2048;tile=512
    for suffix in ['diffuse','normal','properties']:
        data=np.zeros((size,size,4),dtype=np.uint8)
        for i,(name,rgb,rough,metal) in enumerate(palette):
            rng=np.random.default_rng(1323+i);grain=rng.normal(0,.5,(tile,tile))
            yy,xx=np.mgrid[:tile,:tile];region=data[(i//4)*tile:(i//4+1)*tile,(i%4)*tile:(i%4+1)*tile]
            if suffix=='diffuse':
                linear=np.asarray(rgb);srgb=np.where(linear<=.0031308,linear*12.92,1.055*linear**(1/2.4)-.055)*255
                variation=grain+np.sin(xx*.31+np.sin(yy*.05))*.6
                region[:,:,:3]=np.clip(srgb[None,None,:]+variation[:,:,None],0,255).astype(np.uint8);region[:,:,3]=255
            elif suffix=='normal':
                region[:]=[255,128,0,128]
                region[:,:,1]=np.clip(127.5+grain*.8,120,136).astype(np.uint8)
                region[:,:,3]=np.clip(127.5+np.sin(yy*.7)*.6,120,136).astype(np.uint8)
            else:
                region[:,:,0]=0;region[:,:,1]=28 if name in ['ruby','sapphire','pearl','obsidian'] else 0
                region[:,:,2]=round(metal*255);region[:,:,3]=np.clip(rough*255+grain,28,245).astype(np.uint8)
        image=Image.fromarray(data);image.save(OUT/(PREFIX+'_'+suffix+'.png'));save_dds_mips(image,OUT/(PREFIX+'_'+suffix+'.dds'))
items=['black_crown','black_regalia','white_book','fire_ring','earth_sarcophagus','sea_armor','sky_spear']
if sys.argv[1:]:items=['black_crown']
definitions=[];manifest={'status':'NATIVE_CANDIDATE_NOT_INSTALLED','shader':'court','textureSize':[2048,2048],'models':{},'source':'Blender volumetric geometry; user images are non-rendered references only'}
for item in items:
    source=json.loads((ART/(item+'-geometry.json')).read_text())
    if item==items[0]:textures(source['palette'])
    arrays=np.load(ART/(item+'-geometry.npz'))
    mesh=SimpleNamespace(name='mm_relic_'+item,p=arrays['p'],n=arrays['n'],uv=arrays['uv'],faces=arrays['faces'])
    assert all(np.isfinite(a).all() for a in [mesh.p,mesh.n,mesh.uv])
    assert np.all(np.abs(np.linalg.norm(mesh.n,axis=1)-1)<.002)
    name=mesh.name
    blob,info=encode_mesh(mesh,name+'_shape',PREFIX,old.property_bytes)
    path=OUT/(name+'.mesh');path.write_bytes(blob)
    definitions.append(asset_definition(name+'_mesh',name+'_shape',name+'_entity',path.name,PREFIX,info['submeshes']))
    assert all(p['vertices']<=60000 for p in info['submeshes'])
    info.update(meshFile=path.name,meshSha256=sha(path),blenderFile=str(ART/(item+'-reconstructed.blend')),interchangeSha256=sha(ART/(item+'-geometry.npz')),components=source['components'])
    manifest['models'][name]=info
    print('NATIVE_READY',item,info['triangles'],len(info['submeshes']),flush=True)
    del mesh,blob,arrays
(OUT/'mm_dragon_relics.asset').write_text('\ufeff'+'\n'.join(definitions),encoding='utf8')
manifest['files']={p.name:sha(p) for p in OUT.iterdir() if p.is_file() and p.suffix in ['.mesh','.dds','.asset']}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')
print('NATIVE_CANDIDATES_READY_NOT_INSTALLED',len(items),flush=True)
