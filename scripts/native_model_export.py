"""Native multi-material mesh layout, with shared tangents and bounded draw parts.

CK3's papal throne uses multiple mesh children under one shape, selected by
meshsettings.index. Compute tangent frames before splitting so seams stay smooth.
"""
import hashlib
import numpy as np


def encode_mesh(model, shape, prefix, prop):
    p=np.asarray(model.p,dtype=float);n=np.asarray(model.n,dtype=float)
    uv=np.asarray(model.uv,dtype=float);faces=np.asarray(model.faces,dtype=np.int32)
    dp1=p[faces[:,1]]-p[faces[:,0]];dp2=p[faces[:,2]]-p[faces[:,0]]
    du1=uv[faces[:,1]]-uv[faces[:,0]];du2=uv[faces[:,2]]-uv[faces[:,0]]
    den=du1[:,0]*du2[:,1]-du2[:,0]*du1[:,1]
    valid=np.abs(den)>1e-10
    t=np.zeros_like(dp1);b=np.zeros_like(dp1)
    t[valid]=(dp1[valid]*du2[valid,1,None]-dp2[valid]*du1[valid,1,None])/den[valid,None]
    b[valid]=(dp2[valid]*du1[valid,0,None]-dp1[valid]*du2[valid,0,None])/den[valid,None]
    tsum=np.zeros_like(p);bsum=np.zeros_like(p)
    for corner in range(3):
        np.add.at(tsum,faces[:,corner],t);np.add.at(bsum,faces[:,corner],b)
    tangent=tsum-n*np.einsum('ij,ij->i',n,tsum)[:,None]
    length=np.linalg.norm(tangent,axis=1)
    bad=length<1e-8
    fallback=np.where((np.abs(n[:,1])<.9)[:,None],[0,1,0],[0,0,1])
    tangent[bad]=np.cross(fallback[bad],n[bad])
    tangent/=np.maximum(np.linalg.norm(tangent,axis=1)[:,None],1e-10)
    handed=np.where(np.einsum('ij,ij->i',np.cross(n,tangent),bsum)<0,-1.,1.)
    tangent=np.column_stack([tangent,handed])
    # Keep neighboring triangles together: source FBX face order is spatially
    # scattered and otherwise duplicates most vertices across many draw parts.
    if len(p)>60000:
        centers=p[faces].mean(axis=1)
        quant=np.clip((centers-p.min(axis=0))/np.maximum(p.max(axis=0)-p.min(axis=0),1e-8)*1023,0,1023).astype(np.uint32)
        morton=np.zeros(len(faces),dtype=np.uint64)
        for bit in range(10):
            for axis in range(3):morton|=((quant[:,axis].astype(np.uint64)>>bit)&1)<<(bit*3+axis)
        faces=faces[np.argsort(morton,kind='stable')]
    partitions=[];start=0;used=set()
    for index,face in enumerate(faces):
        additional=set(int(x) for x in face)-used
        if len(used)+len(additional)>60000:
            partitions.append(faces[start:index]);start=index;used=set()
        used.update(int(x) for x in face)
    partitions.append(faces[start:])
    blob=b'@@b@'+prop('pdxasset',[1,0])+b'[object\0[['+shape.encode()+b'\0'+prop('lod',[0])
    parts=[]
    for index,part in enumerate(partitions):
        vertices,local=np.unique(part,return_inverse=True)
        pp=p[vertices];lo,hi=pp.min(axis=0),pp.max(axis=0);center=(lo+hi)/2
        blob+=b'[[[mesh\0'
        values=[('p',pp.ravel()),('n',n[vertices].ravel()),('ta',tangent[vertices].ravel()),('u0',uv[vertices].ravel()),('tri',local.ravel()),('boundingsphere',np.r_[center,np.linalg.norm(pp-center,axis=1).max()])]
        for key,value in values:blob+=prop(key,value.tolist())
        blob+=b'[[[[aabb\0'+prop('min',lo.tolist())+prop('max',hi.tolist())+b'[[[[material\0'
        for key,value in [('shader','court'),('diff',prefix+'_diffuse.dds'),('n',prefix+'_normal.dds'),('spec',prefix+'_properties.dds')]:blob+=prop(key,[value])
        parts.append({'index':index,'vertices':len(vertices),'triangles':len(part),'min':lo.tolist(),'max':hi.tolist()})
    info={'vertices':sum(part['vertices'] for part in parts),'editableVertices':len(p),'triangles':len(faces),'min':p.min(axis=0).tolist(),'max':p.max(axis=0).tolist(),'submeshes':parts,'sha256':hashlib.sha256(blob).hexdigest()}
    if hasattr(model,'source'):info['source']=model.source
    return blob,info


def asset_definition(mesh,shape,entity,file,prefix,parts):
    settings=[]
    for part in parts:
        settings.append(f'''  meshsettings = {{
    name = "{shape}"
    index = {part['index']}
    texture_diffuse = "{prefix}_diffuse.dds"
    texture_normal = "{prefix}_normal.dds"
    texture_specular = "{prefix}_properties.dds"
    shader = "court"
    shader_file = "gfx/FX/court_scene.shader"
  }}''')
    return f'''pdxmesh = {{
  name = "{mesh}"
  file = "{file}"
  scale = 1
{chr(10).join(settings)}
}}
entity = {{ name = "{entity}" pdxmesh = "{mesh}" }}
'''
