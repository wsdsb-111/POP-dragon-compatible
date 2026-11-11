"""Original dragon weapons with integrated court display racks.

Native Y-up mesh units and court shader follow shipped CK3 weapon displays.
Uses the existing checked mesh primitives and binary writer helpers; never reads
or modifies an installed Workshop asset. Requires NumPy and Pillow.
"""
from pathlib import Path
import hashlib
import importlib.util
import json
import math
import struct

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'artwork/dragon-weapons/models'
GAME = ROOT / 'patches/wyvern-capture/mod/gfx/models/artifacts/mm_dragon_weapons'
spec = importlib.util.spec_from_file_location('trophy_geometry', ROOT / 'scripts/build-wyvern-trophy-models.py')
geo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(geo)
PALETTE = [
    ('steel', (83, 103, 116), .28, .90), ('edge', (174, 191, 197), .19, .95),
    ('bone', (219, 200, 155), .45, .0), ('horn', (58, 45, 31), .40, .0),
    ('gold', (178, 133, 57), .29, .85), ('wood', (47, 25, 18), .58, .0),
    ('ruby', (129, 17, 28), .14, .10), ('leather', (27, 23, 21), .72, .0),
    ('silver', (205, 213, 210), .24, .90), ('recess', (27, 40, 47), .47, .75),
    ('scales', (31, 79, 57), .38, .10), ('bronze', (100, 69, 29), .40, .75),
    ('cord', (115, 95, 64), .71, .0), ('enamel', (18, 40, 36), .33, .1),
    ('ivory_dark', (161, 139, 99), .56, .0), ('brass', (216, 175, 87), .24, .85),
]
geo.PALETTE = PALETTE
unit = geo.unit


class WeaponMesh(geo.Mesh):
    curve_steps=6

    def tube(self,centers,radii,material,sides=18):
        super().tube(centers,radii,material,max(10,round(sides*1.35)))

    def ellipsoid(self,center,radius,material,segments=28,rings=14):
        super().ellipsoid(center,radius,material,round(segments*1.35),round(rings*1.35))

    def box(self, center, size, material):
        # Beveled posts and mouldings: softened vertical corners and top edges.
        center=np.array(center,float);sx,sy,sz=np.array(size)/2
        bevel=min(sx,sy,sz)*.30
        outline=[]
        for x,z,start in [(sx-bevel,-sz+bevel,-math.pi/2),(sx-bevel,sz-bevel,0),(-sx+bevel,sz-bevel,math.pi/2),(-sx+bevel,-sz+bevel,math.pi)]:
            outline.extend((x+bevel*math.cos(a),z+bevel*math.sin(a)) for a in np.linspace(start,start+math.pi/2,6))
        count=len(outline)
        levels=[(-sy,.90),(-sy+bevel*.3,.97),(-sy+bevel,1),(sy-bevel,1),(sy-bevel*.3,.97),(sy,.90)]
        for ring in range(len(levels)-1):
            for j in range(count):
                k=(j+1)%count
                p=[center+[outline[q][0]*r,y,outline[q][1]*r] for y,r,q in
                   [(levels[ring][0],levels[ring][1],j),(levels[ring][0],levels[ring][1],k),
                    (levels[ring+1][0],levels[ring+1][1],k),(levels[ring+1][0],levels[ring+1][1],j)]]
                n=unit(np.cross(p[1]-p[0],p[2]-p[0]))
                if np.dot(n,np.mean(p,axis=0)-center)<0:n=-n
                self.surface(p,[n]*4,[(0,0),(1,0),(1,1),(0,1)],[(0,1,2),(0,2,3)],material)
        for y,scale,sign in [(levels[0][0],.90,-1),(levels[-1][0],.90,1)]:
            p=[center+[0,y,0]]+[center+[x*scale,y,z*scale] for x,z in outline]
            self.surface(p,[(0,sign,0)]*len(p),[(.5,.5)]+[(.5+x/(sx*2),.5+z/(sz*2)) for x,z in outline],[(0,j+1,(j+1)%count+1) for j in range(count)],material)

    def leaf(self,x,y,z,size,material):
        from dragon_sculpt import plate
        plate(self,(x,y,z),size,material,rings=12,sides=40)

    def band(self, y, radius, height, material, center=(0, 0), sides=28):
        self.tube([(center[0],y-height/2,center[1]),(center[0],y+height/2,center[1])], [radius,radius], material, sides)

    def gem(self, center, size, material):
        # Faceted rather than a painted circle: octagonal girdle and raised crown.
        x,y,z = center; rx,ry,depth = size
        p = [(x,y,z-depth)]
        for scale,dz in [(.55,-depth*.8),(1,0),(.70,depth*.45)]:
            p += [(x+rx*scale*math.cos(a),y+ry*scale*math.sin(a),z+dz) for a in np.arange(8)*math.pi/4]
        p.append((x,y,z+depth*.6))
        for j in range(8):
            nxt=(j+1)%8
            faces=[(0,1+j,1+nxt),(1+j,9+j,9+nxt),(1+j,9+nxt,1+nxt),
                   (9+j,17+j,17+nxt),(9+j,17+nxt,9+nxt),(25,17+nxt,17+j)]
            for face in faces:
                pts=[p[i] for i in face]
                normal=unit(np.cross(np.subtract(pts[1],pts[0]),np.subtract(pts[2],pts[0])))
                # Face direction is away from the crystal's center.
                if np.dot(normal,np.mean(pts,axis=0)-center)<0: normal=-normal
                self.surface(pts,[normal]*3,[(.5,0),(0,1),(1,1)],[(0,1,2)],material)

    def oval_limb(self, centers, widths, depths, material, sides=18):
        p,n,uv,faces=[],[],[],[]
        for i,center in enumerate(centers):
            tangent=unit(np.subtract(centers[min(i+1,len(centers)-1)],centers[max(i-1,0)]))
            across=unit(np.cross((0,0,1),tangent))
            for j in range(sides+1):
                a=j/sides*2*math.pi
                point=np.array(center)+across*widths[i]*math.cos(a)+np.array([0,0,depths[i]*math.sin(a)])
                normal=unit(across*math.cos(a)/widths[i]+np.array([0,0,math.sin(a)/depths[i]]))
                p.append(point); n.append(normal); uv.append((j/sides,i/(len(centers)-1)))
        for i in range(len(centers)-1):
            for j in range(sides):
                a=i*(sides+1)+j; b=a+sides+1
                faces.extend([(a,b,a+1),(a+1,b,b+1)])
        for ring,direction in [(0,-1),(len(centers)-1,1)]:
            ci=len(p); p.append(centers[ring]); n.append(unit(np.subtract(centers[min(ring+1,len(centers)-1)],centers[max(ring-1,0)]))*direction); uv.append((.5,.5))
            for j in range(sides): faces.append((ci,ring*(sides+1)+j,ring*(sides+1)+j+1))
        self.surface(p,n,uv,faces,material)


def rack(m, wide=False):
    # All stand geometry is part of this asset; no second engine pedestal.
    width=40 if not wide else 44
    for y,w,h,d,mat in [(1.3,width+3,2.6,29,'bronze'),(3.4,width,1.7,27,'wood'),
                         (4.6,width+1,1,28,'gold'),(6.2,width-2,2.2,25,'wood')]:
        m.box((0,y,5),(w,h,d),mat)
    for x in [-13,13]:
        m.box((x,42,7),(3.0,70,3.5),'wood')
        m.box((x-1.35,42,5.1),(.35,68,.3),'gold')
        m.box((x+1.35,42,5.1),(.35,68,.3),'gold')
        for y in [12,31,51,73]:
            m.gem((x,y,4.9),(.7,.9,.35),'brass')
        m.ellipsoid((x,78,7),(2.0,2.6,2.0),'bronze',20,10)
    for y in [30,69]:
        m.box((0,y,7),(29,2,3),'wood')
        m.box((0,y,5.4),(29,.35,.3),'gold')
        for x in [-5,5]:
            m.tube([(x,y,7),(x,y,2),(x,y+1,-.2)],[.65,.65,.4],'bronze',12)
    m.shield((0,11,1),9,8,1.0,'gold')
    m.shield((0,11,.35),7.5,6.5,.5,'enamel')
    for sign in [-1,1]:
        m.tube([(0,10,-.1),(sign*2,11,-.3),(sign*1,13,-.3)],[.18,.18,.04],'brass',8)
    # Incised scrolling inlay follows the actual base and posts, with small pins.
    for offset in [0,math.pi]:
        points=[(x,1.35+.42*math.sin(x*.65+offset),-9.52) for x in np.linspace(-18,18,130)]
        m.tube(points,[.075]*len(points),'brass',8)
    for side in [-1,1]:
        for y in np.arange(18,68,7):
            path=[(side*13+.55*math.sin(t*math.pi*2),y+t*6,5.20) for t in np.linspace(0,1,22)]
            m.tube(path,[.065]*len(path),'bronze',8)
        for y in np.arange(15,74,3.8):m.ellipsoid((side*13,y,5.04),(.15,.15,.09),'brass',12,8)


def make_draxel():
    m=WeaponMesh('draxel'); rack(m)
    # Double-edged, faceted blade with a recessed central fuller and tapered point.
    stations=[(35,4.7,1.28),(40,4.5,1.25),(73,3.75,1.03),(99,2.7,.80),(108,1.50,.52),(116,.035,.035)]
    profile=[(-1,0),(-.74,-.67),(-.21,-1),(0,-.65),(.21,-1),(.74,-.67),(1,0),(.74,.67),(.21,1),(0,.65),(-.21,1),(-.74,.67)]
    cross=[]
    for i,point in enumerate(profile):
        point=np.array(point);a=point*.87+np.array(profile[i-1])*.13;b=point*.87+np.array(profile[(i+1)%len(profile)])*.13
        cross.extend(tuple((1-t)**2*a+2*(1-t)*t*point+t*t*b) for t in np.linspace(0,1,5))
    controls=np.array(stations)
    stations=[(y,np.interp(y,controls[:,0],controls[:,1]),np.interp(y,controls[:,0],controls[:,2])) for y in np.linspace(35,116,121)]
    for i in range(len(stations)-1):
        y,w,d=stations[i]; yy,ww,dd=stations[i+1]
        for j in range(len(cross)):
            a,b=cross[j],cross[(j+1)%len(cross)]
            p=[(a[0]*w,y,a[1]*d),(b[0]*w,y,b[1]*d),(b[0]*ww,yy,b[1]*dd),(a[0]*ww,yy,a[1]*dd)]
            normal=unit(np.cross(np.subtract(p[1],p[0]),np.subtract(p[2],p[0])))
            if np.dot(normal,[(a[0]+b[0])/2,0,(a[1]+b[1])/2])<0:normal=-normal
            m.surface(p,[normal]*4,[(j/len(cross),(y-35)/81),((j+1)/len(cross),(y-35)/81),((j+1)/len(cross),(yy-35)/81),(j/len(cross),(yy-35)/81)],[(0,1,2),(0,2,3)],'edge' if abs((a[0]+b[0])/2)>.88 else 'steel')
    # Inlaid ivory strip and two narrow gilded channels, on both faces.
    for face in [-1,1]:
        for y in np.arange(41,96,5):
            d=np.interp(y,[35,73,99],[1.28,1.03,.8])
            m.box((0,y,face*(d*.67+.025)),(.65,4.95,.045),'bone')
        for side in [-1,1]:
            points=[(side*(.95+.20*math.sin(y*.20)),y,face*(np.interp(y,[35,73,99],[1.28,1.03,.8])+.04)) for y in np.linspace(41,99,35)]
            m.tube(points,[.085]*len(points),'gold',6)
            for y in np.arange(45,95,7):
                points=[(side*(1.25+.3*math.sin(t*math.pi*2)),y+t*4,face*(np.interp(y+t*4,[35,73,99],[1.28,1.03,.8])+.065)) for t in np.linspace(0,1,18)]
                m.tube(points,[.047]*len(points),'brass',8)
    # Swept horn guard, with lighter inset ridges and tapered ivory talons.
    for side in [-1,1]:
        path=[(0,35,0),(side*7,34,0),(side*14,31,-.2),(side*20,33,-.5),(side*22,37,-.7)]
        m.tube(path,[2.15,1.9,1.5,.75,.035],'gold',22)
        m.tube([(side*5,34,-1.9),(side*11,32,-1.65),(side*17,32,-1.0),(side*21,36,-.8)],[.22,.20,.14,.02],'brass',10)
        m.tube([(side*6,33,-.6),(side*8,29,-1),(side*9,25,-1.1)],[.8,.55,.02],'bone',14)
    # A miniature sculpted dragon cranium replaces the primitive mask.
    from dragon_sculpt import dragon_cranium
    sourceNames=['hide','plates','ivory','horn','bronze','wood','amber','black','highlight','mouth','ridge','bronze_dark','red','green','bone','gold']
    savedPalette=geo.PALETTE
    geo.PALETTE=[(name,(0,0,0),.6,0) for name in sourceNames]
    sculpt=WeaponMesh('guard')
    try:dragon_cranium(sculpt)
    finally:geo.PALETTE=savedPalette
    mapping={'hide':'bronze','plates':'gold','ivory':'bone','horn':'ivory_dark','black':'recess','amber':'ruby','mouth':'recess','ridge':'brass'}
    offset=len(m.p)
    m.p.extend([[x*.17,35+y*.17,z*.17-.7] for x,y,z in sculpt.p]);m.n.extend(sculpt.n)
    for u,v in sculpt.uv:
        col,row=int(u*4),int(v*4);name=mapping.get(sourceNames[row*4+col],'bronze')
        idx=[entry[0] for entry in PALETTE].index(name)
        m.uv.append(((idx%4+u*4-col)/4,(idx//4+v*4-row)/4))
    m.faces.extend([tuple(i+offset for i in f) for f in sculpt.faces])
    m.materials.extend([mapping.get(name,'bronze') for name in sculpt.materials])
    # Leather grip with raised spiral wrapping and ring fittings.
    m.tube([(0,15,0),(0,31,0)],[1.65,1.85],'leather',28)
    turns=np.linspace(0,math.pi*2*11,220)
    m.tube([(1.76*math.cos(t),15+t/(math.pi*22)*16,1.76*math.sin(t)) for t in turns],[.13]*len(turns),'horn',6)
    for y in [14.4,15.5,30.7,31.5]:m.band(y,2.0,.7,'gold')
    m.ellipsoid((0,10,0),(3.0,4.0,1.7),'gold',28,14)
    for face in [-1,1]:m.gem((0,10,face*1.5),(1.6,2.4,.65),'ruby')
    m.band(6.5,1.3,.7,'brass')
    return m


def limb_path(sign, t):
    controls=np.array([(0,65),(-5,77),(-10,94),(-6,108),(7,118)],float)
    d=t*(len(controls)-1); i=min(int(d),len(controls)-2); u=d-i
    a,b,c,e=controls[max(0,i-1)],controls[i],controls[i+1],controls[min(i+2,len(controls)-1)]
    xy=.5*((2*b)+(-a+c)*u+(2*a-5*b+4*c-e)*u*u+(-a+3*b-3*c+e)*u*u*u)
    return [xy[0],65+sign*(xy[1]-65),0]


def make_serind():
    m=WeaponMesh('serind'); rack(m,True)
    for sign in [-1,1]:
        ts=np.linspace(0,1,161)
        centers=[limb_path(sign,t) for t in ts]
        widths=[2.35*(1-t)*.85+.40 for t in ts]
        depths=[1.15*(1-t)+.30 for t in ts]
        m.oval_limb(centers,widths,depths,'bone',48)
        # Gold edging follows the limbs rather than floating over a straight pole.
        for side in [-1,1]:
            line=[]
            for i,t in enumerate(ts):
                tangent=unit(np.subtract(centers[min(i+1,len(centers)-1)],centers[max(i-1,0)]))
                across=unit(np.cross((0,0,1),tangent))
                line.append(np.array(centers[i])+across*widths[i]*side*.77+np.array([0,0,-depths[i]*.66]))
            m.tube(line,[.13*(1-t)+.065 for t in ts],'gold',8)
        # Shingled individual dragon scales, with raised ridges and bronze sockets.
        for t in np.linspace(.15,.82,22):
            x,y,_=limb_path(sign,t); size=1.9*(1-t)*.7+.6
            m.leaf(x,y,-(1.15*(1-t)+.3),size,'scales')
            m.tube([(x,y-size*.55,-(1.15*(1-t)+.3)-size*.31),(x,y+size*.6,-(1.15*(1-t)+.3)-size*.31)],[.07,.035],'brass',6)
            for side in [-1,1]:
                vein=[(x+side*size*.44*math.sin(u*math.pi),y+size*(u-.45),-(1.15*(1-t)+.3)-size*(.30-.10*math.sin(u*math.pi))) for u in np.linspace(0,1,12)]
                m.tube(vein,[.038]*len(vein),'bronze',8)
        tip=limb_path(sign,1)
        m.ellipsoid((tip[0],tip[1]-sign*.7,0),(.8,1.5,.62),'gold',20,10)
        m.tube([(tip[0],tip[1],0),(tip[0]+1,tip[1]+sign*.4,0),(tip[0]+1.5,tip[1]-sign*1.1,0)],[.38,.26,.025],'horn',12)
        # Bronze bindings around the limb near the central grip.
        for t in [.11,.14,.87,.91]:
            x,y,_=limb_path(sign,t)
            m.ellipsoid((x,y,0),(2.35*(1-t)*.85+.49,.52,1.15*(1-t)+.36),'bronze',24,10)
    m.oval_limb([(0,59,0),(0,71,0)],[2.65,2.65],[1.4,1.4],'leather',28)
    turns=np.linspace(0,math.pi*2*10,180)
    m.tube([(2.7*math.cos(t),59+t/(math.pi*20)*12,1.4*math.sin(t)) for t in turns],[.13]*len(turns),'cord',6)
    for y in np.linspace(59.5,70.5,30):
        m.tube([(-.7,y,-1.43),(0,y+.2,-1.48),(.7,y,-1.43)],[.055,.055,.055],'ivory_dark',8)
    for y in [58.7,60,70,71.3]:
        m.ellipsoid((0,y,0),(2.88,.45,1.6),'gold',24,10)
    m.gem((0,65,-1.8),(1.4,2.0,.6),'ruby')
    # A real three-dimensional bowstring and center serving, visible from the side.
    m.tube([(7,12,-.15),(7,118,-.15)],[.13,.13],'cord',10)
    for y in np.linspace(61,69,16):
        m.tube([(6.83,y,-.15),(7.17,y,-.15)],[.19,.19],'leather',8)
    return m


def textures():
    from dragon_materials import build_material_atlas
    return build_material_atlas(ART,GAME,'mm_dragon_weapons',PALETTE,tile=1024)


def write_mesh(m):
    from native_model_export import encode_mesh
    blob,info=encode_mesh(m,'mm_dragon_'+m.name+'_shape','mm_dragon_weapons',geo.property_bytes)
    (GAME/f'mm_dragon_{m.name}.mesh').write_bytes(blob)
    return info


def export_editable(m):
    # Reuse the checked portable GLB/OBJ exporter with the new atlas.
    geo.ART=ART
    geo.write_obj(m)
    geo.write_glb(m)


def render(m, eye, size=900):
    from dragon_materials import shade_surface, PreviewTextures
    eye=unit(eye); right=unit(np.cross((0,1,0),eye)); up=np.cross(eye,right)
    p=np.array(m.p); q=p@np.array([right,up,eye]).T
    lo,hi=q[:,:2].min(0),q[:,:2].max(0); center=(lo+hi)/2
    scale=min(size*.84/(hi[0]-lo[0]),size*.88/(hi[1]-lo[1]))
    screen=(q[:,:2]-center)*[scale,-scale]+[size/2,size/2]
    color=np.full((size,size,3),(25,30,31),np.uint8); depth=np.full((size,size),-np.inf)
    normals=np.array(m.n); uv=np.array(m.uv); light=unit(np.array(eye)*.65+np.array([-.2,1,.3]))
    textures=PreviewTextures(ART,'mm_dragon_weapons')
    faces=np.array(m.faces)
    facing=np.cross(p[faces[:,1]]-p[faces[:,0]],p[faces[:,2]]-p[faces[:,0]])@eye>0
    visible=np.flatnonzero(facing)
    visible=visible[np.argsort(q[faces[visible],2].mean(axis=1))[::-1]]
    for face in faces[visible]:
        ids=np.array(face); xyz=screen[ids]; z=q[ids,2]
        low=np.maximum(np.floor(xyz.min(0)).astype(int),[0,0]); high=np.minimum(np.ceil(xyz.max(0)).astype(int),[size-1,size-1])
        if np.any(high<low):continue
        a,b,c=xyz; den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
        if abs(den)<1e-8:continue
        yy,xx=np.mgrid[low[1]:high[1]+1,low[0]:high[0]+1]
        w0=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den
        w1=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den;w2=1-w0-w1
        zz=w0*z[0]+w1*z[1]+w2*z[2];dst=depth[low[1]:high[1]+1,low[0]:high[0]+1]
        mask=(w0>=-1e-6)&(w1>=-1e-6)&(w2>=-1e-6)&(zz>dst)
        if not mask.any():continue
        n=w0[:,:,None]*normals[ids[0]]+w1[:,:,None]*normals[ids[1]]+w2[:,:,None]*normals[ids[2]];n/=np.maximum(np.linalg.norm(n,axis=2)[:,:,None],1e-8)
        tex=w0[:,:,None]*uv[ids[0]]+w1[:,:,None]*uv[ids[1]]+w2[:,:,None]*uv[ids[2]]
        color_sample,property_sample,normal_sample=textures.sample(tex,xyz,uv[ids])
        rgb=shade_surface(color_sample[:,:,:3],property_sample,normal_sample,n,p[ids[1]]-p[ids[0]],p[ids[2]]-p[ids[0]],uv[ids[1]]-uv[ids[0]],uv[ids[2]]-uv[ids[0]],light,eye)
        region=color[low[1]:high[1]+1,low[0]:high[0]+1];region[mask]=rgb[mask];dst[mask]=zz[mask]
    return Image.fromarray(color)


def main():
    ART.mkdir(parents=True,exist_ok=True);GAME.mkdir(parents=True,exist_ok=True);textures()
    metadata={'format':'PDX binary @@b@ 1.0','shader':'court','axis':'Y-up; outward native triangle winding','front':'-X','integratedDisplayRack':True,'models':{}}
    definitions=[];sheet=Image.new('RGB',(1800,960),(25,30,31));draw=ImageDraw.Draw(sheet)
    for i,m in enumerate([make_draxel(),make_serind()]):
        # Shipped court weapons face -X. Rotate authored front -Z to match.
        matrix=np.array([[0,0,1],[0,1,0],[-1,0,0]])
        m.p=(np.array(m.p)@matrix.T).tolist();m.n=(np.array(m.n)@matrix.T).tolist()
        metadata['models'][m.name]=write_mesh(m);export_editable(m)
        for j,(label,eye) in enumerate([('front',(-1,.08,0)),('angle',(-2.6,.8,1.5)),('back',(2.6,.6,-1.5))]):
            image=render(m,eye,1400).resize((900,900),Image.Resampling.LANCZOS);image.save(ART/f'{m.name}-{label}.png')
            if label=='angle':image.save(ART/f'{m.name}-preview.png')
            sheet.paste(image.resize((480,480)),(j*600+60,i*480))
            draw.text((j*600+15,i*480+18),f'{m.name.upper()} / {label.upper()}',fill=(219,199,151))
        from native_model_export import asset_definition
        definitions.append(asset_definition('mm_dragon_'+m.name+'_court_mesh','mm_dragon_'+m.name+'_shape','mm_dragon_'+m.name+'_court_entity','mm_dragon_'+m.name+'.mesh','mm_dragon_weapons',metadata['models'][m.name]['submeshes']))
        print(m.name,metadata['models'][m.name],flush=True)
    (GAME/'mm_dragon_weapons.asset').write_text('\ufeff'+'\n'.join(definitions),encoding='utf8')
    (ART/'trophies.mtl').write_text('newmtl trophies\nKd 1 1 1\nmap_Kd mm_dragon_weapons_diffuse.png\n',encoding='utf8')
    (ART/'models.json').write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf8')
    sheet.save(ART/'contact-sheet.png')


if __name__=='__main__':main()
