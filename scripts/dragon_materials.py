"""CK3 court material baking. RRxG normal B is emissive, never normal Z."""
from pathlib import Path
import io
import struct

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'artwork/dragon-weapons/materials-v117-source.png'
MATERIAL_TILE = {
    'hide':0,'plates':1,'ivory':2,'horn':3,'bronze':4,'wood':5,'amber':6,'black':7,
    'highlight':8,'mouth':9,'ridge':10,'bronze_dark':11,'red':12,'green':13,'bone':14,'gold':15,
    'steel':8,'edge':8,'ruby':12,'leather':7,'silver':8,'recess':3,'scales':10,
    'cord':2,'enamel':13,'ivory_dark':14,'brass':15,
}


class PreviewTextures:
    """Use filtered texture mip levels, as the game does, rather than point noise."""
    def __init__(self,folder,prefix):
        self.maps=[]
        for suffix in ['diffuse','properties','normal']:
            image=Image.open(Path(folder)/(prefix+'_'+suffix+'.png')).convert('RGBA')
            levels=[]
            while True:
                levels.append(np.asarray(image))
                if image.width==1:break
                image=image.resize((max(1,image.width//2),max(1,image.height//2)),Image.Resampling.BOX)
            self.maps.append(levels)

    def sample(self,uv,screen,triangle_uv):
        a,b,c=screen
        den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
        dx=np.array([b[1]-c[1],c[1]-a[1],a[1]-b[1]])/den@triangle_uv
        dy=np.array([c[0]-b[0],a[0]-c[0],b[0]-a[0]])/den@triangle_uv
        footprint=max(np.linalg.norm(dx),np.linalg.norm(dy))*self.maps[0][0].shape[0]
        level=min(len(self.maps[0])-1,max(0,round(np.log2(max(1,footprint)))))
        samples=[]
        for levels in self.maps:
            image=levels[level];height,width=image.shape[:2]
            xy=np.clip(uv,0,1)*[width-1,height-1]
            lo=xy.astype(int);hi=np.minimum(lo+[1,1],[width-1,height-1]);fraction=xy-lo
            fx,fy=fraction[:,:,0,None],fraction[:,:,1,None]
            samples.append((image[lo[:,:,1],lo[:,:,0]]*(1-fx)+image[lo[:,:,1],hi[:,:,0]]*fx)*(1-fy)+(image[hi[:,:,1],lo[:,:,0]]*(1-fx)+image[hi[:,:,1],hi[:,:,0]]*fx)*fy)
        return samples


def shade_surface(color,props,encoded,n,dp1,dp2,du1,du2,light,eye):
    """Offline preview of the baked roughness/metalness and RRxG normal data."""
    den=du1[0]*du2[1]-du2[0]*du1[1]
    if abs(den)>1e-10:
        tangent=(dp1*du2[1]-dp2*du1[1])/den
        bitangent=(dp2*du1[0]-dp1*du2[0])/den
        t=tangent-n*(n@tangent)[:,:,None]
        t/=np.maximum(np.linalg.norm(t,axis=2)[:,:,None],1e-8)
        bt=np.cross(n,t);bt*=np.where(bt@bitangent<0,-1,1)[:,:,None]
        nx=encoded[:,:,1]/127.5-1;ny=1-encoded[:,:,3]/127.5
        nz=np.sqrt(np.maximum(0,1-nx*nx-ny*ny))
        n=t*nx[:,:,None]+bt*ny[:,:,None]+n*nz[:,:,None]
        n/=np.maximum(np.linalg.norm(n,axis=2)[:,:,None],1e-8)
    albedo=(color.astype(float)/255)**2.2
    rough=np.clip(props[:,:,3]/255,.15,.98);metal=props[:,:,2]/255
    f0=(props[:,:,1]/255*.25*(1-metal))[:,:,None]+albedo*metal[:,:,None]
    half=light+eye;half/=np.linalg.norm(half)
    ndl=np.maximum(n@light,0)
    highlight=np.maximum(n@half,0)**np.maximum(2,2/rough**4-2)
    linear=albedo*(.40+.65*ndl[:,:,None])*(1-metal[:,:,None]*.25)
    linear+=f0*highlight[:,:,None]*(1-rough[:,:,None])*.45
    return np.clip(linear**(1/2.2)*255,0,255).astype(np.uint8)


def save_dds_mips(image, file):
    levels=[]
    current=image
    while True:
        stream=io.BytesIO();current.save(stream,format='DDS',pixel_format='DXT5')
        data=stream.getvalue();levels.append(data[128:])
        if len(levels)==1:header=bytearray(data[:128])
        if current.width==1 and current.height==1:break
        current=current.resize((max(1,current.width//2),max(1,current.height//2)),Image.Resampling.BOX)
    struct.pack_into('<I',header,8,struct.unpack_from('<I',header,8)[0]|0x20000)
    struct.pack_into('<I',header,28,len(levels))
    struct.pack_into('<I',header,108,0x1000|0x8|0x400000)
    Path(file).write_bytes(header+b''.join(levels))


def build_material_atlas(art, game, prefix, palette, tile=512):
    """UV-pack source material cells and derive nonemissive normal/PBR maps."""
    source=Image.open(SOURCE).convert('RGB');size=tile*4
    diffuse=np.zeros((size,size,4),dtype=np.uint8)
    normal=np.zeros_like(diffuse);properties=np.zeros_like(diffuse)
    for index,(name,_rgb,rough,metal) in enumerate(palette):
        cell=MATERIAL_TILE[name];cx,cy=cell%4,cell//4
        crop=source.crop((round(cx*source.width/4),round(cy*source.height/4),round((cx+1)*source.width/4),round((cy+1)*source.height/4)))
        if name=='amber':
            crop=Image.open(ROOT/'artwork/dragon-weapons/iris-v117-source.png').convert('RGB')
        crop=crop.resize((tile,tile),Image.Resampling.LANCZOS)
        color=np.array(crop,dtype=np.float32)
        # Material levels are physical calibration, not baked directional lighting.
        if name in ['black','recess']:color*=.22
        if name in ['highlight','silver','edge']:color=np.clip(color*1.12,0,210)
        if name=='cord':color*=.58
        if name in ['bone','ivory','ivory_dark']:rough=max(rough,.66)
        if name in ['hide','plates','ridge','scales','mouth','leather','wood','horn']:rough=max(rough,.72)
        if name in ['gold','brass','bronze','bronze_dark']:rough=max(rough,.53)
        y,x=(index//4)*tile,(index%4)*tile
        diffuse[y:y+tile,x:x+tile,:3]=np.clip(color,0,255).astype(np.uint8)
        diffuse[y:y+tile,x:x+tile,3]=255
        gray=Image.fromarray(np.clip(color,0,255).astype(np.uint8)).convert('L')
        height=np.array(gray.filter(ImageFilter.GaussianBlur(.65)),dtype=np.float32)/255
        smooth=np.array(gray.filter(ImageFilter.GaussianBlur(12)),dtype=np.float32)/255
        height-=smooth
        gy,gx=np.gradient(height)
        strength=3.5 if name in ['hide','plates','ridge','scales','wood','horn'] else 1.5
        nx=-gx*strength;ny=-gy*strength
        inv=1/np.sqrt(nx*nx+ny*ny+1)
        normal[y:y+tile,x:x+tile,0]=255
        normal[y:y+tile,x:x+tile,1]=np.clip((nx*inv*.5+.5)*255,0,255)
        normal[y:y+tile,x:x+tile,2]=0  # court_scene.shader EMISSIVE mask
        normal[y:y+tile,x:x+tile,3]=np.clip((.5-ny*inv*.5)*255,0,255)
        props=properties[y:y+tile,x:x+tile]
        props[:,:,0]=0  # scattering
        props[:,:,1]=48 if name in ['ruby','red','amber','enamel'] else 0
        metal_map=np.full((tile,tile),metal,dtype=np.float32)
        if metal>.4:
            # Dark oxidation and exposed metal have different reflectance.
            metal_map*=np.clip(np.mean(color,axis=2)/90,.25,1)
        props[:,:,2]=np.clip(metal_map*255,0,255)
        props[:,:,3]=np.clip((rough+height*.16)*255,24,245)
    images={'diffuse':Image.fromarray(diffuse),'normal':Image.fromarray(normal),'properties':Image.fromarray(properties)}
    for name,image in images.items():
        image.save(Path(art)/f'{prefix}_{name}.png')
        save_dds_mips(image,Path(game)/f'{prefix}_{name}.dds')
    return images
