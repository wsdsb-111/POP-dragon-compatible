"""Illustration-led, fully volumetric court relic reconstruction in Blender.

Run one artifact per background process. Image boards are references only.
"""
import bpy, math, sys, json
from pathlib import Path
from mathutils import Vector
import numpy as np

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'artwork/dragon-relics/blender-v1323'
OUT.mkdir(exist_ok=True)
ITEM=sys.argv[sys.argv.index('--')+1]
TAU=math.tau
PALETTE=[('gold',(0.69,.40,.105),.25,.85),('darkgold',(.24,.12,.035),.36,.8),
 ('obsidian',(.025,.029,.042),.27,.45),('ruby',(.29,.006,.009),.19,.25),
 ('ivory',(.78,.73,.61),.32,.05),('silver',(.65,.73,.81),.23,.85),
 ('blue',(.025,.09,.22),.35,.25),('redcloth',(.29,.012,.019),.53,0),
 ('velvet',(.12,.008,.016),.7,0),('stone',(.055,.06,.071),.65,.15),
 ('pearl',(.84,.78,.66),.2,.1),('sapphire',(.012,.12,.37),.18,.3),
 ('bronze',(.34,.16,.045),.31,.8),('smoke',(.23,.37,.36),.46,.1),
 ('bluecloth',(.005,.025,.075),.6,0),('lava',(.53,.035,.002),.25,.15)]
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for c in list(bpy.data.collections):
    if c.name!='Collection' and c.users==0: bpy.data.collections.remove(c)
MATS={}
for name,rgb,rough,metal in PALETTE:
    m=bpy.data.materials.new(name); m.use_nodes=True
    m.node_tree.nodes.clear()
    bs=m.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
    output=m.node_tree.nodes.new('ShaderNodeOutputMaterial')
    m.node_tree.links.new(bs.outputs['BSDF'],output.inputs['Surface'])
    bs.inputs['Base Color'].default_value=(*rgb,1)
    bs.inputs['Metallic'].default_value=metal; bs.inputs['Roughness'].default_value=rough
    noise=m.node_tree.nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value=90
    bump=m.node_tree.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=.12; bump.inputs['Distance'].default_value=.025
    m.node_tree.links.new(noise.outputs['Fac'],bump.inputs['Height']); m.node_tree.links.new(bump.outputs['Normal'],bs.inputs['Normal'])
    MATS[name]=m
FEATURES={}
def tag(obj,name,mat):
    obj.name=name; obj.data.materials.append(MATS[mat]); obj['relic_component']=name
    FEATURES[name.split(':')[0]]=FEATURES.get(name.split(':')[0],0)+1
    if obj.type=='MESH':
        for p in obj.data.polygons:p.use_smooth=True
    return obj
def sphere(name,p,scale,mat,seg=48,rings=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg,ring_count=rings,location=p)
    o=bpy.context.object; o.scale=scale;return tag(o,name,mat)
def box(name,p,size,mat,bevel=.18):
    bpy.ops.mesh.primitive_cube_add(size=1,location=p); o=bpy.context.object;o.scale=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        b=o.modifiers.new('Carved rounded edges','BEVEL');b.width=bevel;b.segments=4
    return tag(o,name,mat)
def curve(name,points,r,mat,res=3):
    c=bpy.data.curves.new(name,'CURVE'); c.dimensions='3D'; c.resolution_u=2
    c.bevel_depth=r; c.bevel_resolution=res; c.use_fill_caps=True
    s=c.splines.new('POLY');s.points.add(len(points)-1)
    for pt,p in zip(s.points,points):pt.co=(*p,1)
    o=bpy.data.objects.new(name,c);bpy.context.collection.objects.link(o);return tag(o,name,mat)
def circle(name,p,rx,rz,r,mat,plane='XZ',n=128):
    pts=[]
    for a in np.linspace(0,TAU,n+1):
        q=(rx*math.cos(a),0,rz*math.sin(a)) if plane=='XZ' else (rx*math.cos(a),rz*math.sin(a),0)
        pts.append(q)
    o=curve(name,pts,r,mat);o.location=p
    return o
def surface(name,verts,faces,mat,thickness=0,subd=0):
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);tag(o,name,mat)
    if subd:
        m=o.modifiers.new('Sculpted curved surface','SUBSURF');m.levels=subd;m.render_levels=subd
    if thickness:
        m=o.modifiers.new('Actual material thickness','SOLIDIFY');m.thickness=thickness
    return o
def leaf(name,p,w,h,depth,mat):
    # Closed convex lancet plate; its outline, ridge and bevel are geometry.
    v=[];f=[];nx=8;ny=20
    if ':ray' in name: nx,ny=4,10
    if ':scale' in name or '-scale' in name:nx,ny=6,14
    for i in range(ny+1):
        t=i/ny; half=max(.012,math.sin(math.pi*t)**.85)*w
        for j in range(nx+1):
            s=2*j/nx-1;v.append((s*half,-depth*(1-s*s)*math.sin(math.pi*t),h*(t-.5)))
    for i in range(ny):
        for j in range(nx):
            a=i*(nx+1)+j;f.append((a,a+1,a+nx+2,a+nx+1))
    o=surface(name,v,f,mat,.09,0 if ':ray' in name else 1)
    o.location=p
    return o
def star(name,p,size,mat):
    # Raised compass rose, eight long/short diamond rays.
    for i in range(8):
        a=i*TAU/8;length=size*(1 if i%2==0 else .57)
        o=leaf(name+':ray',p,length*.12,length*2,.25,mat)
        o.rotation_euler[1]=a
def chain(name,points,r=.18,mat='gold'):
    # Alternate real interlocking oval links, not an opaque ribbon.
    for i,p in enumerate(points):
        o=circle(name+':link',p,r,r*1.42,r*.24,mat,n=24)
        if i%2:o.rotation_euler[2]=math.pi/2
def pearl_line(name,points,r=.22):
    curve(name+':thread',points,r*.22,'gold',1)
    for p in points:sphere(name+':pearl',p,(r,r,r),'pearl',32,16)
def bez(points,n=75):
    p=np.asarray(points);return [(sum(math.comb(len(p)-1,i)*t**i*(1-t)**(len(p)-1-i)*p[i] for i in range(len(p)))).tolist() for t in np.linspace(0,1,n)]
def scroll(name,p,w,h,mat='gold',reverse=1):
    pts=[(p[0]+reverse*w*(1-t)*math.cos(t*TAU*1.5),p[1]-.12*math.sin(t*math.pi),p[2]+h*(1-t)*math.sin(t*TAU*1.5)) for t in np.linspace(0,1,100)]
    curve(name,pts,.075,mat,2)
def dragon(name,points,r,mat='gold',scales=True):
    controls=np.array(points);pts=[]
    for i in range(len(controls)-1):
        a,b,c,d=controls[max(0,i-1)],controls[i],controls[i+1],controls[min(len(controls)-1,i+2)]
        for t in np.linspace(0,1,25,endpoint=False):pts.append((.5*(2*b+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t)).tolist())
    pts.append(list(points[-1]));body=curve(name+':serpentine-body',pts,r,mat,4)
    for i,pt in enumerate(body.data.splines[0].points):pt.radius=min(1,.08+i/14)
    # Applied scales follow the actual body centerline.
    if scales:
        for i in range(10,len(pts)-5,2):
            p=Vector(pts[i]);t=(Vector(pts[i+1])-Vector(pts[i-1])).normalized()
            for j in [-1,0,1]:
                q=p+Vector((j*r*.60,-math.sqrt(r*r-(j*r*.6)**2)-r*.04,0))
                angle=math.atan2(t.x,t.z)
                o=leaf(name+':scale',q,r*.37,r*1.1,r*.13,mat)
                o.rotation_euler[1]=angle
                from mathutils import Matrix
                rot=Matrix.Rotation(angle,3,'Y')
                outline=[q+rot@Vector((r*.37*math.sin(a),-r*.025,r*.55*math.cos(a))) for a in np.linspace(0,TAU,26)]
                curve(name+':scale-gilded-edge',outline,r*.025,'gold',1)
    p=Vector(pts[-1]);t=(p-Vector(pts[-4])).normalized()
    head=sphere(name+':dragon-head',p,(r*1.2,r*.85,r*1.7),mat,64,32)
    head.rotation_euler[1]=math.atan2(t.x,t.z)
    snout=p+t*r*1.4+Vector((0,-r*.25,0))
    nose=sphere(name+':snout',snout,(r*.72,r*.55,r*1.05),mat);nose.rotation_euler[1]=math.atan2(t.x,t.z)
    curve(name+':mouth-line',[snout+Vector((-r*.6,-r*.55,-r*.35)),snout+Vector((0,-r*.65,-r*.45)),snout+Vector((r*.6,-r*.55,-r*.35))],r*.055,'obsidian',2)
    for side in [-1,1]:
        sphere(name+':nostril',snout+Vector((side*r*.35,-r*.50,r*.28)),(r*.11,r*.06,r*.16),'obsidian',24,12)
        curve(name+':brow-ridge',bez([p+Vector((side*r*.25,-r*.8,r*.9)),p+Vector((side*r*1.1,-r*.8,r*.75)),p+Vector((side*r*1.4,-r*.6,0))],30),r*.15,'gold' if mat=='ivory' else mat)
        curve(name+':whisker',bez([snout+Vector((side*r*.55,-r*.4,0)),snout+Vector((side*r*1.8,-r*.6,-r)),snout+Vector((side*r*2.5,-r*.3,r*.8))],45),r*.045,mat,2)
    for side in [-1,1]:
        q=p+Vector((side*r*.65,-r*.65,r*.5))
        sphere(name+':eye',q,(r*.16,r*.13,r*.16),'ruby',32,16)
        horn=bez([p+Vector((side*r*.7,0,r*.8)),p+Vector((side*r*1.9,.1,r*1.9)),p+Vector((side*r*.9,.2,r*3.1))],32)
        curve(name+':swept-metal-horn',horn,r*.15,mat)
        for j in range(3):
            q=p+Vector((side*(r*.8+j*r*.3),.05,-j*r*.5))
            leaf(name+':cheek-fin',q,r*.25,r*1.8,r*.12,mat)
def ribbon(name,points,width,mat='redcloth',folds=2):
    pts=bez(points,100);v=[];f=[];cols=14
    for i,p in enumerate(pts):
        t=i/(len(pts)-1)
        for j in range(cols+1):
            s=j/cols*2-1
            v.append((p[0]+width*s,p[1]+.25*math.sin(s*math.pi*folds+t*9),p[2]+.2*math.sin(t*8+s*2)))
    for i in range(len(pts)-1):
        for j in range(cols):
            a=i*(cols+1)+j;f.append((a,a+1,a+cols+2,a+cols+1))
    surface(name+':woven-fabric',v,f,mat,.045,1)
    for edge in [-1,1]:
        curve(name+':gold-embroidered-edge',[(p[0]+edge*width,p[1],p[2]) for p in pts],.035,'gold',1)
    for i in range(10,len(pts)-5,10):
        p=pts[i];star(name+':embroidered-sun',(p[0],p[1]-.3,p[2]),width*.38,'gold')
def base(width,depth):
    for z,w,d,h,mat in [(1,width,depth,2,'stone'),(2.25,width*.96,depth*.96,.5,'gold'),(2.9,width*.90,depth*.9,.8,'obsidian')]:box('display-base:stepped', (0,0,z),(w,d,h),mat,.16)
    for side in [-1,1]:
        curve('display-base:scroll-border',[(x,-depth*.46,1.4+.20*math.sin(x*.8)) for x in np.linspace(-width*.43,width*.43,180)],.075,'gold')
def pillow(w,d,z):
    sphere('velvet-cushion',(0,0,z),(w,d,1.4),'velvet',96,48)
    circle('cushion:gold-cord',(0,0,z),w*.98,d*.98,.12,'gold','XY')
    for side in [-1,1]:
        for x in np.linspace(-w*.75,w*.75,7): scroll('cushion:embroidered-scroll',(x,side*d*.78,z+.5),.9,.45)

def crown():
    base(28,22);pillow(11,8,4.6)
    circle('crown:black-band',(0,0,7),8.8,7.0,1.0,'obsidian','XY')
    for z in [6.5,8.0]:circle('crown:gold-band',(0,0,z),9,7.3,.17,'gold','XY')
    # Radial high lancet panels: the high black/gold silhouette in the painting.
    for j in range(11):
        a=j*TAU/11; front=max(0,-math.sin(a));height=8+10*front**4
        x,y=8.6*math.cos(a),7*math.sin(a)
        o=leaf('crown:tall-obsidian-panel',(x,y,7+height/2),2.5,height,.65,'obsidian')
        o.rotation_euler[2]=a+math.pi/2
        for side in [-1,1]:
            pts=[]
            for t in np.linspace(0,1,75):
                w=math.sin(math.pi*t)**.85*2.5*side
                pts.append((x-w*math.sin(a)+.08*math.cos(a),y+w*math.cos(a)+.08*math.sin(a),7+height*t))
            curve('crown:panel-gilded-outline',pts,.115,'gold')
        for row in range(9):
            t=(row+.5)/10;ww=2.2*math.sin(math.pi*t)
            for column in [-1,0,1]:
                relief=.68*math.sin(math.pi*t)
                px=x-column*ww*.58*math.sin(a)+relief*math.cos(a);py=y+column*ww*.58*math.cos(a)+relief*math.sin(a)
                o=leaf('crown:overlapping-black-scale',(px,py,7+height*t),.65,height*.17,.16,'obsidian');o.rotation_euler[2]=a+math.pi/2
        sphere('crown:inset-ruby',(x,y-.55,8.7),(0.45,.30,.8),'ruby')
        for side in [-1,1]:
            points=[]
            for t in np.linspace(.08,.92,110):
                w=side*(.45+.45*math.sin(t*math.pi*3))*math.sin(math.pi*t)
                radial=.70*math.sin(math.pi*t)+.11
                points.append((x-w*math.sin(a)+radial*math.cos(a),y+w*math.cos(a)+radial*math.sin(a),7+height*t))
            curve('crown:gilded-flame-filigree',points,.065,'gold')
    dragon('crown:central-dragon',[(0,-8.0,7),(0,-8.5,8),(.15,-8.4,9),(0,-8.3,10.0)],.72,'gold',False)
    for side in [-1,1]:
        dragon('crown:band-dragon',[(side*6,-5.6,8.0),(side*5,-7.5,7.9),(side*3,-8.1,9),(side*1.8,-8.5,9.2)],.5,'gold',False)
        sphere('crown:lower-ruby',(side*3.5,-7.8,7.6),(.50,.32,.9),'ruby')

def book():
    base(33,23)
    box('book:lectern',(0,2,6),(21,10,4),'darkgold',.5)
    box('book:page-block',(0,0,23),(23,5.4,32),'ivory',.45)
    for y in [-3.25,3.25]:box('book:solid-cover',(0,y,23),(25.0,1,34),'ivory',.40)
    # Gilded rounded spine with real raised ribs and layered page edge.
    sphere('book:rounded-spine',(-12,0,23),(1.5,3.7,17),'ivory',64,64)
    for z in np.linspace(8,38,9):circle('book:spine-band',(-12,0,z),1.6,3.8,.14,'gold','XY',80)
    for z in np.linspace(8,38,80):curve('book:individual-gilded-page',[(11.55,-2.3,z),(11.7,0,z+.03),(11.55,2.3,z)],.025,'darkgold',1)
    for x in [-11,11]:curve('book:gold-cover-frame',[(x,-3.86,z) for z in np.linspace(7,39,100)],.14,'gold')
    for z in [7,39]:curve('book:gold-cover-frame',[(x,-3.86,z) for x in np.linspace(-11,11,100)],.14,'gold')
    for side in [-1,1]:
        for row in range(12):
            z=9.5+row*2.35
            scroll('book:illuminated-border',(side*10.2,-4.04,z),.55,.85,'gold',side)
            sphere('book:border-seed-pearl',(side*10.25,-4.13,z),(.095,.07,.095),'pearl',24,12)
    for side in [-1,1]:
        for z in [9,37]:
            p=(side*9.6,-4.1,z);star('book:openwork-corner',p,2.15,'gold');sphere('book:corner-pearl',(p[0],-4.65,z),(.75,.42,.75),'pearl')
            scroll('book:corner-filigree',(side*8.8,-4.0,z),2.3,1.7,reverse=side)
    for rad in [5.3,6.4]:circle('book:compass-ring',(0,-4.1,22),rad,rad,.10,'gold')
    star('book:raised-compass',(0,-4.5,22),6.7,'gold')
    dragon('book:white-dragon',[(-6,-4.0,12),(5,-4,15),(5,-4,20),(-6,-4,25),(-4,-4,33),(3,-4,34),(7,-4,31)],1.0,'ivory')
    for side in [-1,1]:
        for z in [13,17,29,33]:scroll('book:cloud-relief',(side*7,-4.05,z),2.5,1.3,'gold',side)
    pts=[(-13.6,-3.2,36-i*.75) for i in range(35)]
    chain('book:attached-bookmark-chain',pts,.31)
    for i in range(3,33,5):sphere('book:bookmark-pearls',pts[i],(.45,.45,.45),'pearl')
    star('book:bookmark-pendant',(-13.6,-3.3,8),1.4,'gold')
    mirror_decorations(('book:compass','book:raised','book:cloud','book:openwork','book:corner-pearl','book:corner-filigree','book:illuminated-border'))

def armor():
    base(32,25)
    # Hollow dress volume, narrowed at the waist and flared at the floor.
    zs=np.linspace(5,38,100);v=[];f=[];n=160
    for z in zs:
        t=(z-5)/48;rx=np.interp(z,[5,15,27,35,44,53],[13.0,11.0,6.2,5.0,7.8,7.2]);ry=rx*.56
        for j in range(n):
            a=j/n*TAU;pleat=(.32+.35*(1-t))*math.cos(a*18+z*.035)
            v.append(((rx+pleat)*math.cos(a),(ry+pleat*.55)*math.sin(a),z))
    for i in range(len(zs)-1):
        for j in range(n):a=i*n+j;b=i*n+(j+1)%n;f.append((a,b,b+n,a+n))
    surface('armor:full-blue-pleated-gown',v,f,'bluecloth',.16,1)
    v=[];f=[];zs=np.linspace(32,52,90)
    for z in zs:
        rx=np.interp(z,[32,36,43,46,50,52],[5.1,5.3,7.9,8.1,5.0,3.6]);ry=np.interp(z,[32,37,43,47,52],[3.8,4,5.2,4.5,2.6])
        for j in range(n):
            a=j/n*TAU;x=rx*math.cos(a);y=ry*math.sin(a)
            if y<0:y-=.65*math.exp(-((z-43)/3.5)**2)*(math.exp(-((x-3)/2)**2)+math.exp(-((x+3)/2)**2))
            v.append((x,y,z))
    for i in range(len(zs)-1):
        for j in range(n):a=i*n+j;b=i*n+(j+1)%n;f.append((a,b,b+n,a+n))
    surface('armor:continuous-tailored-cuirass',v,f,'ivory',.20,1)
    # Silver-white breastplate, waist and collar are separately modeled solids.
    for side in [-1,1]:
        curve('armor:cuirass-gold-seam',bez([(side*7.5,-3.9,46),(side*8.1,-5.4,40),(side*4,-4.4,38),(side*1.1,-4.3,34)],110),.14,'gold')
        sphere('armor:shoulder-plate',(side*8,0,49),(3.7,3.6,2.7),'silver',64,32)
        scroll('armor:gold-shoulder-scroll',(side*8,-3.1,49),2.3,2,'gold',side)
        # Front white panels fall to the floor with visible wavy edges.
        ribbon('armor:ivory-front-panel',[(side*2,-4.5,39),(side*3,-4,28),(side*4,-5,14),(side*9,-7,5)],2.0,'ivory')
        for layer in range(3):
            ribbon('armor:cascading-sleeve',[(side*9,0,49),(side*(10+layer*2),-1,37),(side*(13+layer*2),0,20),(side*(16-layer),-3,8+layer)],2.0-layer*.3,'ivory' if layer==1 else 'bluecloth')
        pts=bez([(side*8,-3.8,49),(side*12,-5,42),(side*11,-4,28)],35)
        pearl_line('armor:sleeve-pearl-chain',pts[::2],.23)
        for z in [37,34,31]:scroll('armor:waist-filigree',(side*3.6,-4.1,z),2,1.7,'gold',side)
    circle('armor:standing-collar',(0,0,52),3.8,2.6,.25,'gold','XY')
    for z in [51,49]:pearl_line('armor:neckline-pearls',[(-7+14*t,-3.2-.4*math.sin(math.pi*t),z-1.7*math.sin(math.pi*t)) for t in np.linspace(0,1,25)],.19)
    for z in [43,37,32]:
        star('armor:gold-jewel-setting',(0,-6.35,z),1.2,'gold');sphere('armor:inset-blue-jewel',(0,-6.65,z),(.5,.30,.75),'sapphire')
    for side in [-1,1]:
        for i in range(8):scroll('armor:hem-gold-embroidery',(side*(1.5+i*1.5),-6.7,6.5),.65,.7)
        for z in [35,38,41,44,47]:scroll('armor:back-gilded-seam',(side*2.8,4.0,z),1.4,.9,'gold',side)
    panel=leaf('armor:blue-back-inset',(0,4.5,43),2.5,15,.3,'bluecloth');panel.rotation_euler[2]=math.pi
    for side in [-1,1]:
        curve('armor:back-panel-gold-border',bez([(side*.5,3.3,51),(side*3.5,4.6,45),(side*3.2,4.8,39),(side*.5,4.0,35)],90),.11,'gold')

def regalia():
    base(27,22)
    curve('regalia:black-carved-shaft',[(0,0,z) for z in np.linspace(7,70,120)],.83,'obsidian',5)
    for z in np.linspace(8,69,16):circle('regalia:engraved-ferrule',(0,0,z),.96,.96,.16,'gold','XY',64)
    for sign in [-1,1]:
        pts=[(1.0*math.cos(t*TAU*5),1.0*math.sin(t*TAU*5),9+t*59) for t in np.linspace(0,1,360)]
        curve('regalia:spiral-inlay',pts,.075,'gold')
    for rad in [7,8.2]:circle('regalia:circular-star-halo',(0,0,76),rad,rad,.3,'gold')
    sphere('regalia:great-ruby',(0,-.4,76),(3.3,1.7,4.2),'ruby',96,64)
    star('regalia:orb-star',(0,-2,76),6.4,'gold')
    for side in [-1,1]:
        dragon('regalia:paired-dragon',[(side*.8,0,68),(side*7,-.5,70),(side*8,-.5,80),(side*3,-1,82)],.7,'gold')
        ribbon('regalia:red-silk',[(side*3,0,73),(side*7,-1,61),(side*4,-1,44),(side*9,-2,31)],1.4)
        pts=[(side*(3+2.8*math.sin(math.pi*t)),-.5,72-t*13) for t in np.linspace(0,1,30)]
        chain('regalia:hanging-gold-chain',pts,.23)
        star('regalia:chain-star-pendant',(side*3,-.5,58),1.4,'gold')
    # Slanted artifact on a separate narrow rear display support.
    tilt_subject(-.34,7)
    contact=-math.tan(.34)*(45-7)
    curve('display-support:regalia',[(0,2,3),(-7,2,24),(contact,1.3,45),(contact,.35,45)],.6,'darkgold')
    curve('display-support:regalia-cradle',[(contact-1.2,.8,45),(contact,.4,44.6),(contact+1.2,.8,45)],.24,'gold')

def ring():
    base(29,22);pillow(10,8,5)
    before=set(bpy.context.scene.objects)
    circle('ring:thick-bronze-annulus',(0,0,14),6,6,1.35,'bronze',n=200)
    for y in [-1,1]:circle('ring:band-gold-rim',(0,y,14),6,6,.21,'gold',n=160)
    sphere('ring:great-molten-ruby',(0,-1,20),(3.2,1.75,3.3),'ruby',128,80)
    star('ring:star-setting',(0,-2.4,20),4.4,'gold')
    for side in [-1,1]:
        dragon('ring:shoulder-dragon',[(side*5,-.6,11),(side*8,-.5,17),(side*4,-.6,22),(side*2.4,-1.2,22)],.65,'gold')
        for i in range(6):scroll('ring:openwork-scroll',(side*(2+i*.6),-1.35,10+i*1.3),.6,1.0,'gold',side)
    for i in range(27):
        a=i*TAU/27;p=(6*math.cos(a),-1.4,14+6*math.sin(a))
        leaf('ring:bronze-scale',p,.38,.9,.18,'bronze')
        curve('ring:molten-inlay',[(p[0],p[1]-.05,p[2]),(p[0]+.19,p[1]-.1,p[2]+.25),(p[0]-.05,p[1]-.1,p[2]+.6)],.04,'lava',2)
    for o in set(bpy.context.scene.objects)-before:o.location.z-=.5

def coffin():
    base(43,28)
    box('coffin:massive-stone-body',(0,0,13),(35,20,14),'stone',.5)
    for z in [6.5,19.5,21.0]:box('coffin:gilded-step',(0,0,z),(37+(z<7)*2,22,.65),'gold',.25)
    box('coffin:thick-stone-lid',(0,0,21),(36,21,2.2),'obsidian',.6)
    for side in [-1,1]:
        for x in np.linspace(-14,14,7):
            curve('coffin:gothic-vault',bez([(x-2.1,side*10.1,7),(x-2.1,side*10.2,18),(x,side*10.25,19.2),(x+2.1,side*10.1,17),(x+2.1,side*10.1,7)],100),.16,'gold')
            sphere('coffin:figure-relief',(x,side*10.25,13),(.55,.30,2.7),'darkgold')
        for x in [-17,17]:curve('coffin:corner-pilaster',[(x,side*9.7,z) for z in np.linspace(6.5,22,80)],.37,'gold')
    # Carved lid relief is built flat in XZ and turned onto the top plane.
    before=set(bpy.context.scene.objects)
    for side in [-1,1]:dragon('coffin:paired-lid-dragon',[(side*14,0,0),(side*16,0,9),(side*3,0,6),(side*7,0,2)],.7,'ivory')
    circle('coffin:lid-star-ring',(0,-.25,3),3.2,3.2,.12,'gold');star('coffin:lid-compass',(0,-.5,3),4.5,'gold')
    for o in set(bpy.context.scene.objects)-before:
        from mathutils import Matrix
        o.matrix_world=Matrix.Translation((0,4,22.4))@Matrix.Rotation(math.pi/2,4,'X')@o.matrix_world
    for side in [-1,1]:
        for i in range(8):
            a=i*TAU/8
            p=(side*(20+math.sin(a)*1.2),6*math.cos(a),9+i*1.35)
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4,radius=1,location=p);o=bpy.context.object;o.scale=(1.1,.9,2.7);o.rotation_euler=(i*.2,i*.4,i*.31);tag(o,'coffin:floating-geode','stone')
            curve('coffin:geode-gold-vein',[(p[0]-.4,p[1]-.8,p[2]-2),(p[0]+.15,p[1]-.9,p[2]),(p[0]-.25,p[1]-.7,p[2]+2)],.065,'gold')

def spear():
    base(27,22)
    curve('spear:ivory-shaft',[(0,0,z) for z in np.linspace(7,78,220)],.68,'ivory',5)
    for z in np.linspace(9,77,20):circle('spear:gilded-shaft-binding',(0,0,z),.77,.77,.1,'gold','XY',64)
    leaf('spear:silver-cutting-blade',(0,0,86),3.5,24,.85,'silver')
    leaf('spear:blue-blade-inlay',(0,-.55,84),1.15,15,.35,'sapphire')
    for side in [-1,1]:
        curve('spear:blade-gold-edge',bez([(0,-.1,99),(side*4,-.2,88),(side*4,-.3,80),(side*1,-.5,76)],120),.13,'gold')
        for i in range(7):
            o=leaf('spear:golden-wing-feather',(side*(1+i*.55),-.2,76+i*.5),.43,4+i*.2,.24,'gold');o.rotation_euler[1]=side*(.3+i*.07)
        ribbon('spear:red-woven-banner',[(side*.8,0,75),(side*12,-.6,68),(side*8,-1,46),(side*14,-1.2,33)],1.5)
    star('spear:winged-hilt-seal',(0,-1,76),2.1,'gold')
    sphere('spear:hilt-blue-gem',(0,-1.4,76),(.65,.4,.9),'sapphire')
    leaf('spear:butt-leaf',(0,0,7),1.25,5,.45,'silver')
    for side in [-1,1]:
        curve('spear:helical-gold-etching',[(.78*math.cos(t*TAU*10),.78*math.sin(t*TAU*10),10+t*63) for t in np.linspace(0,1,500)],.055,'gold')
        for z in np.linspace(13,69,15):
            scroll('spear:shaft-carved-filigree',(side*.45,-.74,z),.45,1.4,'gold',side)
        for i in range(8):
            o=leaf('spear:reverse-wing-feather',(side*(1+i*.48),.35,76+i*.48),.39,4+i*.18,.18,'gold');o.rotation_euler[1]=side*(.3+i*.07)
    tilt_subject(.39,6)
    for foot,z in [(-7,27),(7,61)]:
        x=math.tan(.39)*(z-6)
        curve('display-support:spear-rack',[(foot,2,3),(foot,2,z*.55),(x,1.2,z),(x,.35,z)],.65,'darkgold')
        curve('display-support:spear-cradle',[(x-1.1,.8,z),(x,.3,z-.45),(x+1.1,.8,z)],.24,'gold')

def mirror_decorations(prefixes):
    from mathutils import Matrix
    mirror=Matrix.Diagonal((1,-1,1,1))
    for o in list(bpy.context.scene.objects):
        if o.get('relic_component','').startswith(prefixes):
            copy=o.copy();copy.data=o.data.copy();copy.name=o.name+'-back';bpy.context.collection.objects.link(copy);copy.matrix_world=mirror@o.matrix_world

def tilt_subject(angle,z0):
    from mathutils import Matrix
    rot=Matrix.Rotation(angle,4,'Y')
    pivot=Vector((0,0,z0))
    for o in list(bpy.context.scene.objects):
        if o.get('relic_component','').startswith(('display-base','velvet','cushion')):continue
        o.matrix_world=__import__('mathutils').Matrix.Translation(pivot)@rot@__import__('mathutils').Matrix.Translation(-pivot)@o.matrix_world

{'black_crown':crown,'white_book':book,'sea_armor':armor,'black_regalia':regalia,'fire_ring':ring,'earth_sarcophagus':coffin,'sky_spear':spear}[ITEM]()
print('GEOMETRY_AUTHORED',ITEM,len(bpy.context.scene.objects),flush=True)

def export_interchange():
    deps=bpy.context.evaluated_depsgraph_get();positions=[];normals=[];uvs=[];triangles=[];offset=0
    ids={name:i for i,(name,*_) in enumerate(PALETTE)}
    counts={}
    for obj in bpy.context.scene.objects:
        if obj.type not in ['MESH','CURVE'] or 'relic_component' not in obj:continue
        ev=obj.evaluated_get(deps);mesh=ev.to_mesh();mesh.calc_loop_triangles()
        p=np.empty(len(mesh.vertices)*3);mesh.vertices.foreach_get('co',p);p=p.reshape(-1,3)
        n=np.empty(len(mesh.vertices)*3);mesh.vertices.foreach_get('normal',n);n=n.reshape(-1,3)
        mat=np.asarray(obj.matrix_world);p=p@mat[:3,:3].T+mat[:3,3];normal_mat=np.linalg.inv(mat[:3,:3]).T;n=n@normal_mat.T;n/=np.maximum(np.linalg.norm(n,axis=1)[:,None],1e-8)
        # Blender X/right,-Y/front,Z/up -> CK3 -X/front,Y/up,-Z/right.
        p=p[:,[1,2,0]]*[1,1,-1];n=n[:,[1,2,0]]*[1,1,-1]
        faces=np.empty(len(mesh.loop_triangles)*3,dtype=np.int32);mesh.loop_triangles.foreach_get('vertices',faces);faces=faces.reshape(-1,3)
        idx=ids[obj.data.materials[0].name.split('.')[0]]
        uv=np.column_stack([((idx%4)+.15+.7*((p[:,2]*.113)%1))/4,((idx//4)+.15+.7*((p[:,1]*.113)%1))/4])
        positions.append(p.astype(np.float32));normals.append(n.astype(np.float32));uvs.append(uv.astype(np.float32));triangles.append(faces+offset);offset+=len(p)
        key=obj['relic_component'].split(':')[0];counts[key]=counts.get(key,0)+len(faces)
        ev.to_mesh_clear()
    p=np.concatenate(positions);n=np.concatenate(normals);uv=np.concatenate(uvs);faces=np.concatenate(triangles)
    cross=np.cross(p[faces[:,1]]-p[faces[:,0]],p[faces[:,2]]-p[faces[:,0]])
    keep=np.linalg.norm(cross,axis=1)>1e-8;faces=faces[keep];cross=cross[keep]
    inward=np.einsum('ij,ij->i',cross,n[faces].mean(axis=1))<0;faces[inward]=faces[inward][:,[0,2,1]]
    np.savez_compressed(OUT/(ITEM+'-geometry.npz'),p=p,n=n,uv=uv,faces=faces)
    info={'id':ITEM,'status':'GEOMETRY_AUTHORED_REVIEW_PENDING','vertices':len(p),'triangles':len(faces),'components':FEATURES,'trianglesByStructure':counts,'bounds':[p.min(0).tolist(),p.max(0).tolist()],'palette':PALETTE,'backDesign':'Extrapolated from the visible front ornament and material; reference provides one view.'}
    (OUT/(ITEM+'-geometry.json')).write_text(json.dumps(info,indent=2),encoding='utf8')
    print('GEOMETRY_EXPORTED',ITEM,len(p),len(faces),flush=True)
export_interchange()
# References are separate image empties, excluded from render/export.
ref=bpy.data.collections.new('Reference illustration - not geometry');bpy.context.scene.collection.children.link(ref)
manifest=json.loads((ROOT/'artwork/dragon-relics/illustrations/manifest.json').read_text(encoding='utf8'))
source=next(a for a in manifest['assets'] if a['id']==ITEM)
board=bpy.data.objects.new('USER_ILLUSTRATION',None);ref.objects.link(board);board.empty_display_type='IMAGE';board.data=bpy.data.images.load(str(ROOT/source['original']));board.empty_display_size=60;board.location=(65,5,35);board.rotation_euler[0]=math.pi/2;board.hide_render=True
bpy.context.scene['construction_status']='GEOMETRY_AUTHORED_REVIEW_PENDING'
bpy.context.scene['reference_id']=ITEM
bpy.context.scene.io_pdx_settings.setup_engine='crusader_kings_3'
# Lighting/camera use actual objects, no image planes or painted background.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
scene.render.resolution_x=900;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.world.color=(.14,.14,.14)
def area(name,p,power,size):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size
    o=bpy.data.objects.new(name,data);scene.collection.objects.link(o);o.location=p;o.rotation_euler=(Vector((0,0,30))-o.location).to_track_quat('-Z','Y').to_euler()
area('Large warm softbox',(-35,-45,85),180000,45);area('Cool fill',(35,-10,50),100000,35);area('Rear rim',(0,35,75),180000,30)
camera=bpy.data.objects.new('Presentation camera',bpy.data.cameras.new('Presentation camera'));scene.collection.objects.link(camera);scene.camera=camera;camera.data.type='ORTHO'
geo=json.loads((OUT/(ITEM+'-geometry.json')).read_text());height=geo['bounds'][1][1];width=geo['bounds'][1][2]-geo['bounds'][0][2]
target=Vector((0,0,height*.50));camera.data.ortho_scale=max(height*1.20,width*1.45,35)
def position_camera(direction):
    camera.location=target+Vector(direction)*130;camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
position_camera((.6,-1,.42))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(ITEM+'-reconstructed.blend')),compress=True)
for label,direction in [('angle',(.65,-1,.48)),('front',(0,-1,.16)),('back',(.5,1,.3))]:
    position_camera(direction);scene.render.filepath=str(OUT/(ITEM+'-'+label+'.png'));bpy.ops.render.render(write_still=True)
    print('RENDER_READY',ITEM,label,flush=True)
