"""CC0 surface setup and continuous planar UV projection for the crown revision."""
from pathlib import Path
import json
import numpy as np

def apply_materials(root,materials):
    import bpy
    folder=Path(root)/'artwork/dragon-relics/materials-cc0'
    origin=bpy.data.objects.new('PBR_WORLD_COORDINATES',None);bpy.context.scene.collection.objects.link(origin)
    for name,asset in [('gold','Metal042A'),('darkgold','Metal042B'),('bronze','Metal042A'),('obsidian','Metal046A'),('silver','Metal046A')]:
        mat=materials[name];nodes=mat.node_tree.nodes;links=mat.node_tree.links;nodes.clear()
        bs=nodes.new('ShaderNodeBsdfPrincipled');output=nodes.new('ShaderNodeOutputMaterial');links.new(bs.outputs['BSDF'],output.inputs['Surface'])
        coords=nodes.new('ShaderNodeTexCoord');coords.object=origin;mapping=nodes.new('ShaderNodeVectorMath');mapping.operation='SCALE';mapping.inputs[3].default_value=.125
        links.new(coords.outputs['Object'],mapping.inputs[0])
        images={}
        for suffix,color in [('Color',True),('Roughness',False),('Metalness',False),('Displacement',False)]:
            path=folder/asset/(asset+'_2K-PNG_'+suffix+'.png')
            node=nodes.new('ShaderNodeTexImage');node.image=bpy.data.images.load(str(path),check_existing=True)
            node.image.colorspace_settings.name='sRGB' if color else 'Non-Color';node.projection='BOX';node.projection_blend=.18
            links.new(mapping.outputs['Vector'],node.inputs['Vector']);images[suffix]=node
        if name=='darkgold':
            tint=nodes.new('ShaderNodeMixRGB');tint.blend_type='MULTIPLY';tint.inputs[0].default_value=1;tint.inputs[2].default_value=(.40,.32,.22,1)
            links.new(images['Color'].outputs['Color'],tint.inputs[1]);links.new(tint.outputs[0],bs.inputs['Base Color'])
        else:links.new(images['Color'].outputs['Color'],bs.inputs['Base Color'])
        rough=nodes.new('ShaderNodeMapRange');rough.inputs['From Min'].default_value=0;rough.inputs['From Max'].default_value=1;rough.inputs['To Min'].default_value=.26 if name=='obsidian' else .18;rough.inputs['To Max'].default_value=.76 if name=='obsidian' else .68
        links.new(images['Roughness'].outputs['Color'],rough.inputs['Value']);links.new(rough.outputs['Result'],bs.inputs['Roughness']);links.new(images['Metalness'].outputs['Color'],bs.inputs['Metallic'])
        bump=nodes.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.015;bump.inputs['Strength'].default_value=.25
        links.new(images['Displacement'].outputs['Color'],bump.inputs['Height']);links.new(bump.outputs['Normal'],bs.inputs['Normal'])
        mat['shader']='court';mat['source_asset']=asset;mat['source_license']='CC0-1.0'
    bs=next(n for n in materials['ruby'].node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    bs.inputs['Metallic'].default_value=0;bs.inputs['Roughness'].default_value=.13;bs.inputs['IOR'].default_value=1.78
    bs.inputs['Transmission Weight'].default_value=.25

def export_geometry(out,item,palette,features):
    import bpy
    out=Path(out);deps=bpy.context.evaluated_depsgraph_get();ids={name:i for i,(name,*_) in enumerate(palette)}
    pp=[];nn=[];tt=[];ff=[];mm=[];offset=0;counts={}
    for obj in bpy.context.scene.objects:
        if obj.type not in ['MESH','CURVE'] or 'relic_component' not in obj:continue
        ev=obj.evaluated_get(deps);mesh=ev.to_mesh();mesh.calc_loop_triangles()
        p=np.empty(len(mesh.vertices)*3);mesh.vertices.foreach_get('co',p);p=p.reshape(-1,3)
        n=np.empty_like(p).ravel();mesh.vertices.foreach_get('normal',n);n=n.reshape(-1,3)
        matrix=np.asarray(obj.matrix_world);p=p@matrix[:3,:3].T+matrix[:3,3];n=n@np.linalg.inv(matrix[:3,:3]);n/=np.maximum(np.linalg.norm(n,axis=1)[:,None],1e-8)
        faces=np.empty(len(mesh.loop_triangles)*3,dtype=np.int32);mesh.loop_triangles.foreach_get('vertices',faces);faces=faces.reshape(-1,3)
        # Choose an orthogonal plane per triangle. No modulo, random coordinates,
        # per-triangle palette cells or generated-colour atlas is involved.
        corners=p[faces];cross=np.cross(corners[:,1]-corners[:,0],corners[:,2]-corners[:,0]);axis=np.abs(cross).argmax(axis=1)
        uv=np.empty((len(faces),3,2))
        for a,plane in [(0,[1,2]),(1,[0,2]),(2,[0,1])]:uv[axis==a]=corners[axis==a][:,:,plane]*.125
        pn=corners.reshape(-1,3);norm=n[faces].reshape(-1,3);uv=uv.reshape(-1,2)
        # Split only where normals or UV projection differ, preserving actual seams.
        values=np.round(np.column_stack([pn,norm,uv]),6)
        unique,index=np.unique(values,axis=0,return_inverse=True)
        local=index.reshape(-1,3)
        p=unique[:,:3][:,[1,2,0]]*[1,1,-1];n=unique[:,3:6][:,[1,2,0]]*[1,1,-1]
        pp.append(p.astype(np.float32));nn.append(n.astype(np.float32));tt.append(unique[:,6:8].astype(np.float32));ff.append(local+offset);offset+=len(unique)
        mm.append(np.full(len(local),ids[obj.data.materials[0].name.split('.')[0]],dtype=np.uint8))
        name=obj['relic_component'].split(':')[0];counts[name]=counts.get(name,0)+len(local)
        ev.to_mesh_clear()
    p=np.concatenate(pp);n=np.concatenate(nn);uv=np.concatenate(tt);faces=np.concatenate(ff);materials=np.concatenate(mm)
    cross=np.cross(p[faces[:,1]]-p[faces[:,0]],p[faces[:,2]]-p[faces[:,0]]);keep=np.linalg.norm(cross,axis=1)>1e-8;faces=faces[keep];cross=cross[keep];materials=materials[keep]
    flip=np.einsum('ij,ij->i',cross,n[faces].mean(axis=1))<0;faces[flip]=faces[flip][:,[0,2,1]]
    np.savez_compressed(out/(item+'-geometry.npz'),p=p,n=n,uv=uv,faces=faces,face_materials=materials)
    info={'id':item,'status':'NO_CUSHION_PBR_REVIEW_PENDING','vertices':len(p),'triangles':len(faces),'components':features,'trianglesByStructure':counts,'bounds':[p.min(0).tolist(),p.max(0).tolist()],'palette':palette,'uv':'Continuous 8cm orthogonal projection; material-separated UV, no palette atlas','materials':'ambientCG Metal042B/Metal046A, CC0, 2K lossless PNG source maps'}
    (out/(item+'-geometry.json')).write_text(json.dumps(info,indent=2),encoding='utf8')
    print('PBR_GEOMETRY_EXPORTED',len(faces),flush=True)
