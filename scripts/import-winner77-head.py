"""Adapt winner_77's complete CC BY 4.0 dragon bust to a CK3 pedestal trophy.

Run with the original DragScream.fbx path. This one-asset importer accepts only
the fingerprinted FBX 7400 file: it does not evaluate scripts or external links.
Build-only dependencies: numpy, Pillow, fast-simplification, scipy and xatlas.
The optimized derivative and baked maps are checked in; a game install needs none.
"""
from pathlib import Path
import hashlib
import json
import struct
import sys
import zlib

ROOT = Path(__file__).resolve().parent.parent
import numpy as np
from PIL import Image, ImageFilter
from scipy.ndimage import distance_transform_edt
from scipy.spatial import cKDTree
import fast_simplification
import xatlas

from dragon_materials import save_dds_mips

ART = ROOT / 'artwork/wyvern-trophies/models'
GAME = ROOT / 'patches/wyvern-capture/mod/gfx/models/artifacts/mm_wyvern_trophies'
SOURCE_HASH = 'e101ea332eb230ace37813c11b5ac76ee3b70992997ce5890df3d287eccb5298'


def read_sculpt(path):
    data = Path(path).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != SOURCE_HASH:
        raise ValueError('Expected the credited DragScream.fbx fingerprint, got ' + digest)
    assert data[:23] == b'Kaydara FBX Binary  \0\x1a\0'
    assert struct.unpack_from('<I', data, 23)[0] == 7400

    def prop(at):
        kind = chr(data[at]); at += 1
        if kind in 'YCLFDI':
            fmt = {'Y':'h','C':'?','L':'q','F':'f','D':'d','I':'i'}[kind]
            return struct.unpack_from('<' + fmt, data, at)[0], at + struct.calcsize(fmt)
        if kind in 'SR':
            length = struct.unpack_from('<I', data, at)[0]; at += 4
            value = data[at:at + length]
            return value.decode('utf8') if kind == 'S' else value, at + length
        count, encoding, length = struct.unpack_from('<III', data, at); at += 12
        raw = data[at:at + length]
        if encoding: raw = zlib.decompress(raw)
        dtype = {'d':'<f8','f':'<f4','l':'<i8','i':'<i4','b':'u1','c':'u1'}[kind]
        return np.frombuffer(raw, dtype=dtype, count=count), at + length

    def node(at):
        end, count, _size = struct.unpack_from('<III', data, at)
        length = data[at + 12]; at += 13
        if not end: return None, at
        name = data[at:at + length].decode(); at += length
        values, children = [], []
        for _ in range(count):
            value, at = prop(at); values.append(value)
        while at < end - 13:
            child, at = node(at)
            if child: children.append(child)
        return (name, values, children), end

    nodes, at = [], 27
    while True:
        item, at = node(at)
        if item is None: break
        nodes.append(item)
    objects = next(n for n in nodes if n[0] == 'Objects')[2]
    geometry = [n for n in objects if n[0] == 'Geometry']
    assert len(geometry) == 1
    props = {n[0]:n[1] for n in geometry[0][2]}
    vertices = props['Vertices'][0].reshape(-1, 3).copy()
    indices = props['PolygonVertexIndex'][0]
    assert len(vertices) == 651443 and len(indices) == 1303950 * 3
    assert np.all(indices.reshape(-1, 3)[:, 2] < 0)
    assert np.all(indices.reshape(-1, 3)[:, :2] >= 0)
    faces = np.where(indices < 0, -indices - 1, indices).reshape(-1, 3).astype(np.int32)
    # Apply the FBX node's -90 X rotation, then turn the face toward native -Z.
    vertices = vertices[:, [0, 2, 1]]
    vertices[:, 0] *= -1
    return vertices, faces


def normals(p, f):
    n = np.zeros_like(p)
    fn = np.cross(p[f[:, 1]] - p[f[:, 0]], p[f[:, 2]] - p[f[:, 0]])
    fn /= np.maximum(np.linalg.norm(fn, axis=1)[:, None], 1e-12)
    for i in range(3): np.add.at(n, f[:, i], fn)
    n /= np.maximum(np.linalg.norm(n, axis=1)[:, None], 1e-12)
    return n


def main(source):
    albedo_only = '--albedo-only' in sys.argv
    p, f = read_sculpt(source)
    original_bounds=[p.min(axis=0).tolist(),p.max(axis=0).tolist()]
    print('COMPLETE_SCULPT', len(p), len(f), flush=True)
    high_n = normals(p, f)
    if '--materials-only' in sys.argv or albedo_only:
        existing=np.load(ART/'winner77-head.npz')
        center=(p.min(axis=0)+p.max(axis=0))/2
        v=existing['p'].astype(float)/.73+[center[0],p[:,1].min(),center[2]]
        n=existing['n'].astype(float);uv=existing['uv'].astype(float);triangles=existing['f'].astype(np.int32)
    else:
        v, triangles = fast_simplification.simplify(p, f, target_count=520000, agg=5)
        area=np.linalg.norm(np.cross(v[triangles[:,1]]-v[triangles[:,0]],v[triangles[:,2]]-v[triangles[:,0]]),axis=1)
        triangles=triangles[area>1e-10]
        n = normals(v, triangles)
        # A handful of sharply folded mouth/cap triangles need hard corner normals.
        fn = np.cross(v[triangles[:, 1]] - v[triangles[:, 0]], v[triangles[:, 2]] - v[triangles[:, 0]])
        bad = np.flatnonzero((np.einsum('ij,ij->i', fn, n[triangles].sum(axis=1)) <= 1e-10)|np.any(np.linalg.norm(n[triangles],axis=2)<.9,axis=1))
        for index in bad:
            face = triangles[index].copy(); offset = len(v)
            normal = fn[index] / np.linalg.norm(fn[index])
            v = np.vstack([v, v[face]]); n = np.vstack([n, [normal] * 3])
            triangles[index] = np.arange(offset, offset + 3)
        used,inverse=np.unique(triangles,return_inverse=True)
        v,n,triangles=v[used],n[used],inverse.reshape(-1,3)
        atlas = xatlas.Atlas(); atlas.add_mesh(v, triangles, n)
        chart = xatlas.ChartOptions(); chart.max_iterations = 2
        pack = xatlas.PackOptions(); pack.resolution = 4096; pack.padding = 8; pack.bilinear = True
        atlas.generate(chart, pack)
        mapping, triangles, uv = atlas[0]
        v, n = v[mapping], n[mapping]
        used,inverse=np.unique(triangles,return_inverse=True)
        v,n,uv,triangles=v[used],n[used],uv[used],inverse.reshape(-1,3)
        assert np.min(np.linalg.norm(n,axis=1))>.99, 'All exported normals must be unit length'
        uv = uv.astype(float) * .98 + .01
        print('UNWRAPPED', len(v), len(triangles), 'charts', atlas.chart_count, flush=True)

    size = 4096
    diffuse = np.zeros((size, size, 4), np.uint8); diffuse[:] = [22, 11, 9, 255]
    normal = np.zeros_like(diffuse); normal[:] = [255, 128, 0, 128]
    properties = np.zeros_like(diffuse); properties[:] = [0, 0, 0, 210]
    covered = np.zeros((size, size), bool)
    sample = Image.open(ROOT / 'artwork/dragon-weapons/head-materials-v121-source.png').convert('RGB')
    cells = [np.asarray(sample.crop((x*sample.width//2,y*sample.height//2,(x+1)*sample.width//2,(y+1)*sample.height//2)).resize((1024,1024))) for y in range(2) for x in range(2)]
    # The sculpt supplies scale relief. Suppress gritty albedo speckles instead of
    # painting competing large scales over its actual engraved surfaces.
    cells[0]=np.asarray(Image.fromarray(cells[0]).filter(ImageFilter.GaussianBlur(1.2)))
    # Calibrate the generated surface samples to the user's numeric palette anchors.
    for index,anchor in [(0,[88,99,71]),(1,[102,86,66]),(2,[210,195,159])]:
        cell=cells[index].astype(float)
        cells[index]=np.clip(cell*np.array(anchor)/cell.mean(axis=(0,1)),0,235).astype(np.uint8)
    tree = cKDTree(p)
    screen = uv * (size - 1)
    # Artist-selected material regions are measured in the original sculpt coordinates.
    for face_index, face in enumerate(triangles):
        xyz = screen[face]
        low = np.maximum(np.floor(xyz.min(axis=0)).astype(int), 0)
        high = np.minimum(np.ceil(xyz.max(axis=0)).astype(int), size - 1)
        a, b, c = xyz
        den = (b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
        if abs(den) < 1e-9: continue
        yy, xx = np.mgrid[low[1]:high[1]+1, low[0]:high[0]+1]
        w0 = ((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den
        w1 = ((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den
        w2 = 1-w0-w1
        mask = (w0>=0)&(w1>=0)&(w2>=0)
        if not mask.any(): continue
        weights = np.column_stack([w0[mask], w1[mask], w2[mask]])
        points = weights @ v[face]
        base_n = weights @ n[face]; base_n /= np.maximum(np.linalg.norm(base_n,axis=1)[:,None],1e-8)
        distances, nearest = tree.query(points,k=4,workers=1)
        good = np.maximum(np.einsum('ijk,ik->ij',high_n[nearest],base_n),0)**3
        blend = good/np.maximum(distances,.015)**2
        blend /= np.maximum(blend.sum(axis=1)[:,None],1e-10)
        detail_n = np.einsum('ij,ijk->ik',blend,high_n[nearest])
        detail_n /= np.maximum(np.linalg.norm(detail_n,axis=1)[:,None],1e-8)
        dp1, dp2 = v[face[1]]-v[face[0]],v[face[2]]-v[face[0]]
        du1, du2 = uv[face[1]]-uv[face[0]],uv[face[2]]-uv[face[0]]
        det = du1[0]*du2[1]-du2[0]*du1[1]
        tangent = (dp1*du2[1]-dp2*du1[1])/det
        bitangent = (dp2*du1[0]-dp1*du2[0])/det
        t = tangent-base_n*(base_n@tangent)[:,None];t/=np.maximum(np.linalg.norm(t,axis=1)[:,None],1e-8)
        bt = np.cross(base_n,t);bt*=np.sign(bt@bitangent)[:,None]
        nx = np.einsum('ij,ij->i',detail_n,t);ny=np.einsum('ij,ij->i',detail_n,bt)
        radius = np.sqrt(nx*nx+ny*ny);gain=np.minimum(1,.78/np.maximum(radius,1e-8))
        nx*=gain;ny*=gain

        # Triplanar material samples avoid stretching the hand-sculpted scales.
        coords = points * 27
        texels = np.mod(coords.astype(int),1024)
        axis = np.argmax(np.abs(base_n),axis=1)
        tx=np.where(axis==0,texels[:,2],texels[:,0]);ty=np.where(axis==1,texels[:,2],texels[:,1])
        # Broad anatomical color fields must survive court-distance mip levels.
        # The sculpt already has scales; a second noisy scale pattern hid them.
        color = np.array([88,99,71]) + (cells[0][ty,tx].astype(float)-[88,99,71])*.22
        # Horns: sweeping outer crown and tall rear spines; tooth tips remain old ivory.
        x,y,z=points.T
        # Feather each anatomical boundary rather than cutting dark horn color
        # across a horizontal plane through the lower neck spines.
        smooth=lambda value:np.clip(value*.5+.5,0,1)**2*(3-2*np.clip(value*.5+.5,0,1))
        horn=np.maximum.reduce([smooth((np.abs(x)-14)/3)*smooth((y-80)/3),smooth((y-55)/4)*smooth((z-12)/3),smooth((np.abs(x)-18)/3)*smooth((60-y)/5)*smooth((z+2)/7)])
        tooth = ((np.abs(x)>3)&(np.abs(x)<10)&(y>64)&(y<70)&(z<-14))|((np.abs(x)<10)&(y>54)&(y<62)&(z<-10)&(base_n[:,1]>.05))
        # Desaturated soft tissue remains distinct from the old ivory teeth.
        cavity = (np.abs(x)<8)&(y>63)&(y<80)&(z>-16)&(z<-5)
        secondary=np.clip(np.abs(x)/28*.6+np.clip((z+4)/30,0,1)*.4,0,1)
        color*=1-secondary[:,None]*(1-np.array([77,89,64])/np.array([88,99,71]))
        ventral=smooth((66-y)/10)*smooth((-z-2)/8)
        belly=[116,116,95]+(cells[0][ty,tx].astype(float)-[88,99,71])*.17
        color=color*(1-ventral[:,None])+belly*ventral[:,None]
        tip=np.clip(np.maximum((np.abs(x)-24)/13,(y-89)/11),0,1)**3
        middle=np.minimum(tip/.65,1)[:,None]
        horn_color=np.array([75,64,53])*(1-middle)+np.array([102,86,66])*middle
        tip_blend=np.clip((tip-.65)/.35,0,1)[:,None]
        horn_color=horn_color*(1-tip_blend)+np.array([145,129,106])*tip_blend
        horn_color+=(cells[1][ty,tx].astype(float)-[102,86,66])*.20
        color=color*(1-horn[:,None])+horn_color*horn[:,None]
        tooth_root=np.where(y>62,smooth((y-68)/2),smooth((56-y)/2))
        color[tooth] = ([210,195,159]+(cells[2][ty[tooth],tx[tooth]].astype(float)-[210,195,159])*.12)*(1-.10*tooth_root[tooth,None])
        tissue=cavity & ~tooth
        tissue_detail=np.mean(color[tissue],axis=1)/105
        color[tissue]=np.array([101,87,74])*np.clip(tissue_detail,.88,1.08)[:,None]
        # Eye positions are painted onto the sculpt's actual sockets, not added spheres.
        eyes=np.zeros(len(points),bool)
        for side in [-1,1]:
            eye=((x-side*9)/2.0)**2+((y-80)/1.5)**2+((z+14)/3.0)**2<1
            eyes |= eye
            ex=np.clip(((x[eye]-side*9)/4+.5)*1023,0,1023).astype(int)
            ey=np.clip(((y[eye]-80)/3+.5)*1023,0,1023).astype(int)
            cloud=cells[3][1023-ey,ex].astype(float)
            color[eye]=np.array([126,119,99])+(cloud-cloud.mean(axis=1)[:,None])*.12
        # Reuse existing sculpt variation for local grey-green separation, not global AO.
        bend=np.clip(np.einsum('ijk,ik->ij',high_n[nearest],detail_n).mean(axis=1),0,1)
        cavity_shade=np.clip((bend-.72)/.28,.68,1)
        skin=(1-horn)*(~tooth & ~tissue & ~eyes)
        groove=np.clip((1-cavity_shade)/.32,0,1)*.75*skin
        edge=np.clip((bend-.965)/.035,0,1)*.08*skin
        color=color*(1-groove[:,None])+np.array([48,57,45])*groove[:,None]
        color=color*(1-edge[:,None])+np.array([116,128,91])*edge[:,None]
        color*=np.where(skin>.5,1,cavity_shade)[:,None]
        px,py=xx[mask],yy[mask]
        diffuse[py,px,:3]=np.clip(color,0,225).astype(np.uint8)
        normal[py,px,1]=np.clip((nx*.5+.5)*255,0,255).astype(np.uint8)
        normal[py,px,3]=np.clip((.5-ny*.5)*255,0,255).astype(np.uint8)
        roughness=.60+.12*secondary+.08*ventral
        roughness=roughness*(1-horn)+.77*horn
        roughness[tooth]=.52
        roughness[tissue]=.68
        properties[py,px,1]=np.where(tooth,32,24)
        properties[py,px,3]=np.clip(roughness*255,0,255).astype(np.uint8)
        covered[py,px]=True
        if face_index and face_index%15000==0: print('BAKED',face_index,flush=True)
    # UV dilation is technical seam padding; source material images remain unchanged.
    distances, nearest = distance_transform_edt(~covered,return_indices=True)
    padding=(~covered)&(distances<=8)
    for image in [diffuse,normal,properties]:image[padding]=image[nearest[0][padding],nearest[1][padding]]
    for name,array in [('diffuse',diffuse),('normal',normal),('properties',properties)]:
        if albedo_only and name != 'diffuse': continue
        if name=='normal':array[:,:,2]=0
        image=Image.fromarray(array);image.save(ART/f'mm_wyvern_head_{name}.png')
        save_dds_mips(image,GAME/f'mm_wyvern_head_{name}.dds')

    # Retain the complete sculpt, including neck and original base; only center/scale.
    center=(p.min(axis=0)+p.max(axis=0))/2
    v=(v-[center[0],p[:,1].min(),center[2]])*.73
    if not albedo_only:
        np.savez_compressed(ART/'winner77-head.npz',p=v.astype(np.float32),n=n.astype(np.float32),uv=uv.astype(np.float32),f=triangles.astype(np.uint32))
    source_info={'author':'winner_77','title':'Screaming dragon head 3D print','url':'https://skfb.ly/6TrJ8','license':'CC BY 4.0','licenseUrl':'https://creativecommons.org/licenses/by/4.0/','sourceFile':'DragScream.fbx','originalSha256':SOURCE_HASH,'originalVertices':651443,'originalTriangles':1303950,'fullSculptRetained':True,'originalBounds':original_bounds,'uniformScale':.73,'optimizedTriangles':len(triangles),'exportedTriangles':len(triangles),'changes':['Preserved the complete head, neck and original base','Retained 520000 original-sculpt triangles and unwrapped UVs','Projected original sculpt normals','Revision 2 grey-olive organic hide, grey-brown throat and dark dry keratin; albedo-only update','Enlarged pedestal bust by 0.73/0.65 while keeping the base at Y=0']}
    source_info['palette']={'main':'#586347','raised':'#74805B','secondary':'#4D5940','grooves':'#30392D','horn':'#4B4035','hornMiddle':'#665642','hornTip':'#91816A','teeth':'#D2C39F','tissue':'#65574A','ventral':'#74745F'}
    source_info['materialRevision']=2
    source_info['materialSample']='artwork/dragon-weapons/head-materials-v121-source.png'
    (ART/'winner77-head-source.json').write_text(json.dumps(source_info,indent=2)+'\n',encoding='utf8')
    print(json.dumps(source_info),flush=True)


if __name__=='__main__':main(sys.argv[1])
