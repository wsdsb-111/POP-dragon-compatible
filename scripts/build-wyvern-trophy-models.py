"""Original static trophy geometry; PDX binary mesh, editable OBJ/GLB and previews.

Build dependency: numpy and Pillow. No Blender or third-party exporter is required.
PDX layout is checked against ross-g/io_pdx_mesh and shipped CK3 artifact meshes.
Geometry is authored directly in native Y-up coordinates, with the outward
triangle winding verified against shipped court meshes. All models have opaque backs.
"""
from pathlib import Path
import hashlib
import io
import json
import math
import struct
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'artwork/wyvern-trophies/models'
GAME = ROOT / 'patches/wyvern-capture/mod/gfx/models/artifacts/mm_wyvern_trophies'
PALETTE = [
    ('hide', (67, 83, 44), .80, .0), ('plates', (92, 108, 56), .68, .0),
    ('ivory', (213, 197, 151), .45, .0), ('horn', (63, 58, 42), .52, .0),
    ('bronze', (151, 114, 54), .33, .75), ('wood', (61, 35, 22), .75, .0),
    ('amber', (204, 117, 22), .19, .0), ('black', (14, 15, 10), .25, .0),
    ('highlight', (239, 222, 169), .17, .0), ('mouth', (45, 25, 23), .85, .0),
    ('ridge', (119, 126, 69), .72, .0), ('bronze_dark', (89, 65, 30), .48, .7),
    ('red', (91, 46, 28), .7, .0), ('green', (40, 64, 41), .7, .0),
    ('bone', (176, 157, 119), .55, .0), ('gold', (188, 153, 78), .32, .8)
]


def unit(v):
    v = np.asarray(v, dtype=float)
    return v / max(float(np.linalg.norm(v)), 1e-10)


class Mesh:
    def __init__(self, name):
        self.name, self.p, self.n, self.uv, self.faces, self.materials = name, [], [], [], [], []

    def surface(self, points, normals, uvs, faces, material):
        offset = len(self.p)
        index = [x[0] for x in PALETTE].index(material)
        col, row = index % 4, index // 4
        self.p.extend(points)
        self.n.extend([unit(n).tolist() for n in normals])
        self.uv.extend([((col + .07 + .86 * u) / 4, (row + .07 + .86 * v) / 4) for u, v in uvs])
        for a, b, c in faces:
            cross = np.cross(np.subtract(points[b], points[a]), np.subtract(points[c], points[a]))
            if np.linalg.norm(cross) < 1e-8:
                continue
            if np.dot(cross, np.add(np.add(normals[a], normals[b]), normals[c])) < 0:
                b, c = c, b
            self.faces.append((a + offset, b + offset, c + offset))
            self.materials.append(material)

    def ellipsoid(self, center, radius, material, segments=28, rings=14):
        points, normals, uv, faces = [], [], [], []
        center, radius = np.array(center), np.array(radius)
        for i in range(rings + 1):
            lat = math.pi * i / rings
            for j in range(segments + 1):
                lon = 2 * math.pi * j / segments
                d = np.array([math.sin(lat) * math.cos(lon), math.cos(lat), math.sin(lat) * math.sin(lon)])
                points.append((center + radius * d).tolist())
                normals.append(unit(d / radius))
                uv.append((j / segments, i / rings))
        for i in range(rings):
            for j in range(segments):
                a = i * (segments + 1) + j
                b = a + segments + 1
                faces.extend([(a, b, a + 1), (a + 1, b, b + 1)])
        self.surface(points, normals, uv, faces, material)

    def tube(self, centers, radii, material, sides=18):
        points, normals, uvs, faces = [], [], [], []
        centers = np.array(centers, float)
        if len(centers) >= 3:
            smooth, sizes = [], []
            for i in range(len(centers)-1):
                a,b,c,d=centers[max(0,i-1)],centers[i],centers[i+1],centers[min(i+2,len(centers)-1)]
                steps=getattr(self,'curve_steps',4)
                for t in np.arange(steps)/steps:
                    smooth.append(.5*((2*b)+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t))
                    sizes.append(radii[i]*(1-t)+radii[i+1]*t)
            centers=np.array([*smooth,centers[-1]]); radii=[*sizes,radii[-1]]
        previous_side=None
        for i, (center, radius) in enumerate(zip(centers, radii)):
            tangent = unit(centers[min(i + 1, len(centers) - 1)] - centers[max(i - 1, 0)])
            side = unit(np.cross(tangent, (0, 0, 1) if abs(tangent[2]) < .85 else (0, 1, 0))) if previous_side is None else unit(previous_side-np.dot(previous_side,tangent)*tangent)
            previous_side=side
            other = unit(np.cross(tangent, side))
            for j in range(sides + 1):
                a = 2 * math.pi * j / sides
                normal = side * math.cos(a) + other * math.sin(a)
                points.append((center + normal * radius).tolist())
                normals.append(normal)
                uvs.append((j / sides, i / (len(centers) - 1)))
        for i in range(len(centers) - 1):
            for j in range(sides):
                a = i * (sides + 1) + j
                b = a + sides + 1
                faces.extend([(a, b, a + 1), (a + 1, b, b + 1)])
        # Closed root and tip prevent missing surfaces from other camera angles.
        for ring, normal in [(0, unit(centers[0] - centers[1])), (len(centers) - 1, unit(centers[-1] - centers[-2]))]:
            ci = len(points)
            points.append(centers[ring].tolist())
            normals.append(normal)
            uvs.append((.5, .5))
            for j in range(sides):
                faces.append((ci, ring * (sides + 1) + j, ring * (sides + 1) + j + 1))
        self.surface(points, normals, uvs, faces, material)

    def shield(self, center, width, height, thickness, material):
        outline = [(0, -1), (-.75, -.65), (-1, .3), (-.8, .88), (0, 1), (.8, .88), (1, .3), (.75, -.65)]
        for sign in [-1, 1]:
            p = [list(center)] + [[center[0] + x * width / 2, center[1] + y * height / 2, center[2] + sign * thickness / 2] for x, y in outline]
            p[0][2] += sign * thickness / 2
            self.surface(p, [(0, 0, sign)] * len(p), [(.5, .5)] + [(.5 + x / 2, .5 - y / 2) for x, y in outline], [(0, j + 1, (j + 1) % len(outline) + 1) for j in range(len(outline))], material)
        for j in range(len(outline)):
            a, b = outline[j], outline[(j + 1) % len(outline)]
            p = [[center[0] + xy[0] * width / 2, center[1] + xy[1] * height / 2, center[2] + z] for xy, z in [(a, -thickness / 2), (b, -thickness / 2), (b, thickness / 2), (a, thickness / 2)]]
            n = unit([a[0] + b[0], a[1] + b[1], 0])
            self.surface(p, [n] * 4, [(0, 0), (1, 0), (1, 1), (0, 1)], [(0, 1, 2), (0, 2, 3)], material)

    def leaf(self, x, y, z, size, material):
        outline = [(0, -1), (-.65, -.35), (-.7, .25), (-.45, .8), (0, 1), (.45, .8), (.7, .25), (.65, -.35)]
        boundary=[]
        for i,a in enumerate(outline):
            b=outline[(i+1)%len(outline)]
            boundary.extend([(a[0]*(1-t)+b[0]*t,a[1]*(1-t)+b[1]*t) for t in [0,1/3,2/3]])
        points=[[x,y,z-size*.30]]; normals=[(0,0,-1)]; uv=[(.5,.5)]; faces=[]
        count=len(boundary)
        for ring,r in enumerate([.25,.5,.75,1]):
            for a,b in boundary:
                points.append([x+a*r*size,y+b*r*size,z-size*.30*(1-r*r)])
                normals.append(unit((a*r*.60,b*r*.40,-1)))
                uv.append((.5+a*r/2,.5-b*r/2))
            for j in range(count):
                a=1+ring*count+j; b=1+ring*count+(j+1)%count
                if ring==0: faces.append((0,a,b))
                else:
                    faces.extend([(a-count,a,b),(a-count,b,b-count)])
        self.surface(points,normals,uv,faces,material)
        self.shield((x,y,z+.35),size*1.39,size*2,.7,material)

    def muzzle(self, sections=None, material='hide'):
        points=[]; normals=[]; uv=[]; faces=[]; sides=32
        sections=sections or [(-8,11,8,-1),(-17,10,6,-2),(-28,7,3.8,-4.6),(-38,5.7,3,-5.5),(-41,4.8,2.8,-5.5)]
        for i,(z,w,h,y) in enumerate(sections):
            for j in range(sides+1):
                a=2*math.pi*j/sides
                points.append([w*math.cos(a),y+h*math.sin(a),z])
                normals.append(unit((math.cos(a)/w,math.sin(a)/h,-.025)))
                uv.append((j/sides,i/(len(sections)-1)))
        for i in range(len(sections)-1):
            for j in range(sides):
                a=i*(sides+1)+j; b=a+sides+1
                faces.extend([(a,b,a+1),(a+1,b,b+1)])
        self.surface(points,normals,uv,faces,material)
        z,w,h,y=sections[-1]
        self.shield((0,y,z-.25),w*2,h*2,.5,material)


def make_head():
    from licensed_dragon_head import make_head as imported_head
    return imported_head(Mesh)


def make_eye():
    from dragon_sculpt import make_trophy
    return make_trophy(Mesh, 'eye')


def make_fang():
    from dragon_sculpt import make_trophy
    return make_trophy(Mesh, 'fang')


def make_scale():
    from dragon_sculpt import make_trophy
    return make_trophy(Mesh, 'scale')


def make_claw():
    from dragon_sculpt import make_trophy
    return make_trophy(Mesh, 'claw')


def make_textures():
    from dragon_materials import build_material_atlas
    return build_material_atlas(ART, GAME, 'mm_wyvern_trophies', PALETTE)


def property_bytes(name, values):
    name=name.encode('ascii')
    if isinstance(values[0],str):
        value=values[0].encode('ascii')+b'\0'
        data=b's'+struct.pack('<II',1,len(value))+value
    else:
        kind='i' if isinstance(values[0],int) else 'f'
        data=kind.encode()+struct.pack('<I',len(values))+struct.pack('<'+kind*len(values),*values)
    return b'!'+bytes([len(name)])+name+data


def write_pdx(m):
    from native_model_export import encode_mesh
    blob,info=encode_mesh(m,'mm_wyvern_'+m.name+'_shape',getattr(m,'texture_prefix','mm_wyvern_trophies'),property_bytes)
    (GAME/('mm_wyvern_trophy_'+m.name+'.mesh')).write_bytes(blob)
    return info


def write_obj(m):
    prefix=getattr(m,'texture_prefix','mm_wyvern_trophies')
    lines=['# CK3 trophy; Y up; right-handed; see winner77-head-source.json for head credit', 'mtllib '+('head.mtl' if m.name=='head' else 'trophies.mtl'), 'o mm_wyvern_'+m.name]
    lines += ['v %.6f %.6f %.6f'%tuple(v) for v in m.p]
    lines += ['vt %.6f %.6f'%(u,1-v) for u,v in m.uv]
    lines += ['vn %.6f %.6f %.6f'%tuple(v) for v in m.n]
    lines += ['usemtl trophies']
    lines += ['f '+' '.join('%d/%d/%d'%(v+1,v+1,v+1) for v in face) for face in m.faces]
    (ART/(m.name+'.obj')).write_text('\n'.join(lines)+'\n',encoding='utf8')


def write_glb(m):
    # Embed base color plus converted metallic/roughness and RRxG normals for editors.
    chunks=[]; views=[]; accessors=[]
    def add(data,target=None):
        offset=sum(len(chunk) for chunk in chunks)
        chunks.append(data+b'\0'*((-len(data))%4))
        view={'buffer':0,'byteOffset':offset,'byteLength':len(data)}
        if target: view['target']=target
        views.append(view); return len(views)-1
    def accessor(array,kind,component=5126):
        array=np.asarray(array,dtype='<f4' if component==5126 else '<u4')
        index=add(array.tobytes(),34963 if kind=='SCALAR' else 34962)
        item={'bufferView':index,'componentType':component,'count':len(array),'type':kind}
        if kind=='VEC3' and not accessors: item.update(min=array.min(0).tolist(),max=array.max(0).tolist())
        accessors.append(item); return len(accessors)-1
    pos=accessor(m.p,'VEC3'); norm=accessor(m.n,'VEC3'); uv=accessor(m.uv,'VEC2'); tri=accessor(np.array(m.faces).flatten(),'SCALAR',5125)
    prefix=getattr(m,'texture_prefix','mm_dragon_weapons' if (ART/'mm_dragon_weapons_properties.png').exists() else 'mm_wyvern_trophies')
    images=[{'bufferView':add((ART/(prefix+'_diffuse.png')).read_bytes()),'mimeType':'image/png'}]
    props=np.array(Image.open(ART/(prefix+'_properties.png')))
    mr=np.full_like(props,255);mr[:,:,1]=props[:,:,3];mr[:,:,2]=props[:,:,2]
    encoded=np.array(Image.open(ART/(prefix+'_normal.png')))
    nx=encoded[:,:,1].astype(np.float32)/255*2-1;ny=1-encoded[:,:,3].astype(np.float32)/255*2
    nz=np.sqrt(np.maximum(0,1-nx*nx-ny*ny))
    decoded=np.dstack(((nx*.5+.5)*255,(ny*.5+.5)*255,(nz*.5+.5)*255,np.full_like(nx,255))).astype(np.uint8)
    for data in [mr,decoded]:
        stream=io.BytesIO();Image.fromarray(data).save(stream,format='PNG')
        images.append({'bufferView':add(stream.getvalue()),'mimeType':'image/png'})
    binary=b''.join(chunks)
    doc={'asset':{'version':'2.0','generator':'CK3 compatibility trophy exporter'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0,'name':m.name}],
         'meshes':[{'primitives':[{'attributes':{'POSITION':pos,'NORMAL':norm,'TEXCOORD_0':uv},'indices':tri,'material':0}]}],
         'materials':[{'pbrMetallicRoughness':{'baseColorTexture':{'index':0},'metallicRoughnessTexture':{'index':1},'metallicFactor':1,'roughnessFactor':1},'normalTexture':{'index':2}}],
         'textures':[{'source':i} for i in range(3)],'images':images,'buffers':[{'byteLength':len(binary)}],'bufferViews':views,'accessors':accessors}
    if hasattr(m,'source'):doc['asset']['copyright']='Screaming dragon head 3D print by winner_77, CC BY 4.0; adapted for CK3. https://skfb.ly/6TrJ8'
    text=json.dumps(doc,separators=(',',':')).encode(); text+=b' '*((-len(text))%4)
    total=12+8+len(text)+8+len(binary)
    (ART/(m.name+'.glb')).write_bytes(struct.pack('<III',0x46546c67,2,total)+struct.pack('<II',len(text),0x4e4f534a)+text+struct.pack('<II',len(binary),0x004e4942)+binary)


def render(m, width=600, height=600, transparent=False, view=(1.1,.65,-2.1)):
    from dragon_materials import shade_surface, PreviewTextures
    # Software render uses the actual generated triangles, not an illustration.
    eye=unit(view); right=unit(np.cross((0,1,0),eye)); up=np.cross(eye,right)
    basis=np.array([right,up,eye]); p=np.array(m.p); q=p@basis.T
    lo,hi=q[:,:2].min(0),q[:,:2].max(0); center=(lo+hi)/2
    scale=min((width*.82)/(hi[0]-lo[0]),(height*.82)/(hi[1]-lo[1]))
    screen=(q[:,:2]-center)*[scale,-scale]+[width/2,height/2]
    color=np.zeros((height,width,4),np.uint8)
    if not transparent: color[:]=[34,38,31,255]
    depth=np.full((height,width),-np.inf)
    normals=np.array(m.n); light=unit((-.5,1,-1))
    prefix=getattr(m,'texture_prefix','mm_wyvern_trophies')
    textures=PreviewTextures(ART,prefix)
    uv=np.array(m.uv)
    faces=np.array(m.faces)
    facing=np.cross(p[faces[:,1]]-p[faces[:,0]],p[faces[:,2]]-p[faces[:,0]])@eye>0
    visible=np.flatnonzero(facing)
    visible=visible[np.argsort(q[faces[visible],2].mean(axis=1))[::-1]]
    for face in faces[visible]:
        ids=np.array(face); xyz=screen[ids]; z=q[ids,2]
        low=np.maximum(np.floor(xyz.min(0)).astype(int),[0,0]); high=np.minimum(np.ceil(xyz.max(0)).astype(int),[width-1,height-1])
        if np.any(high<low):continue
        a,b,c=xyz; den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
        if abs(den)<1e-8:continue
        yy,xx=np.mgrid[low[1]:high[1]+1,low[0]:high[0]+1]
        w0=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den
        w1=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den; w2=1-w0-w1
        zz=w0*z[0]+w1*z[1]+w2*z[2]; dst=depth[low[1]:high[1]+1,low[0]:high[0]+1]
        mask=(w0>=-1e-6)&(w1>=-1e-6)&(w2>=-1e-6)&(zz>dst)
        if not mask.any():continue
        n=w0[:,:,None]*normals[ids[0]]+w1[:,:,None]*normals[ids[1]]+w2[:,:,None]*normals[ids[2]]
        n/=np.maximum(np.linalg.norm(n,axis=2)[:,:,None],1e-8)
        tex=w0[:,:,None]*uv[ids[0]]+w1[:,:,None]*uv[ids[1]]+w2[:,:,None]*uv[ids[2]]
        color_sample,property_sample,normal_sample=textures.sample(tex,xyz,uv[ids])
        rgb=shade_surface(color_sample[:,:,:3],property_sample,normal_sample,n,p[ids[1]]-p[ids[0]],p[ids[2]]-p[ids[0]],uv[ids[1]]-uv[ids[0]],uv[ids[2]]-uv[ids[0]],light,eye)
        region=color[low[1]:high[1]+1,low[0]:high[0]+1]; region[mask,:3]=rgb[mask]; region[mask,3]=255; dst[mask]=zz[mask]
    return Image.fromarray(color)


def main():
    ART.mkdir(parents=True,exist_ok=True); GAME.mkdir(parents=True,exist_ok=True)
    head_only='--head-only' in sys.argv
    if not head_only:make_textures()
    models=[make_head()] if head_only else [make_fang(),make_eye(),make_scale(),make_head(),make_claw()]
    definitions=[]; metadata=json.loads((ART/'models.json').read_text(encoding='utf8')) if head_only else {'models':{},'format':'PDX binary @@b@ 1.0','shader':'court','axis':'Y-up; outward native triangle winding','build':'python scripts/build-wyvern-trophy-models.py'}
    sheet=Image.new('RGB',(1500,690),(34,38,31)); draw=ImageDraw.Draw(sheet)
    for m in models:
        i=['fang','eye','scale','head','claw'].index(m.name)
        metadata['models'][m.name]=write_pdx(m); write_obj(m); write_glb(m)
        preview=render(m,1200,1200).resize((900,900),Image.Resampling.LANCZOS) if m.name=='head' else render(m)
        preview.save(ART/(m.name+'-preview.png'))
        if m.name == 'head':
            render(m,1200,1200,view=(2.8,.15,-.3)).save(ART/(m.name+'-profile.png'))
            render(m,1200,1200,view=(0,.15,-1)).save(ART/(m.name+'-front.png'))
        sheet.paste(preview.resize((300,300)),((i%3)*500+(100 if i<3 else 350),(i//3)*345))
        draw.text(((i%3)*500+(215 if i<3 else 460),(i//3)*345+305),m.name.upper(),fill=(217,202,160))
    from native_model_export import asset_definition
    for name in ['fang','eye','scale','head','claw']:
        prefix='mm_wyvern_head' if name=='head' else 'mm_wyvern_trophies'
        definitions.append(asset_definition('mm_wyvern_trophy_'+name+'_mesh','mm_wyvern_'+name+'_shape','mm_wyvern_trophy_'+name+'_entity','mm_wyvern_trophy_'+name+'.mesh',prefix,metadata['models'][name]['submeshes']))
        if head_only and name!='head':
            i=['fang','eye','scale','head','claw'].index(name)
            sheet.paste(Image.open(ART/(name+'-preview.png')).resize((300,300)),((i%3)*500+(100 if i<3 else 350),(i//3)*345))
            draw.text(((i%3)*500+(215 if i<3 else 460),(i//3)*345+305),name.upper(),fill=(217,202,160))
    (GAME/'mm_wyvern_trophies.asset').write_text('\ufeff'+'\n'.join(definitions),encoding='utf8')
    (ART/'trophies.mtl').write_text('newmtl trophies\nKd 1 1 1\nmap_Kd mm_wyvern_trophies_diffuse.png\n',encoding='utf8')
    (ART/'head.mtl').write_text('newmtl trophies\nKd 1 1 1\nmap_Kd mm_wyvern_head_diffuse.png\n',encoding='utf8')
    (ART/'models.json').write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf8')
    sheet.save(ART/'contact-sheet.png')
    if not head_only:
        claw=render(models[-1],1254,1254,True)
        claw.save(ROOT/'artwork/wyvern-trophies/claw.png')
        claw.resize((240,240),Image.Resampling.LANCZOS).save(ROOT/'patches/wyvern-capture/mod/gfx/interface/icons/artifact/mm_wyvern_trophy_claw.dds',pixel_format='DXT5')
    print(json.dumps(metadata))


if __name__=='__main__':main()
