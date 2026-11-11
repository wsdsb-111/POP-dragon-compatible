"""Black-scale crown: sculptural reconstruction from the user's three-view sheet.

The shared file supplies mesh primitives/export only; none of its relic factories
are run. The remaining six relics are deliberately untouched.
"""
from pathlib import Path
import math,json,sys,hashlib
ROOT=Path(__file__).resolve().parent.parent
shared=(ROOT/'scripts/blender-rebuild-relics.py').read_text(encoding='utf8')
exec(compile(shared[:shared.index("{'black_crown':crown")],str(ROOT/'scripts/blender-rebuild-relics.py'),'exec'))
OUT=ROOT/'artwork/dragon-relics/crown-threeview'
NO_CUSHION='--no-cushion' in sys.argv
if NO_CUSHION:OUT=ROOT/'artwork/dragon-relics/crown-threeview-no-cushion'
OUT.mkdir(exist_ok=True)
ITEM='black_crown'
from mathutils import Matrix

def metal(name,points,width=.18,depth=.12,material='gold',taper=False):
    """Beveled angular metal strap, with a real central ridge rather than a rope."""
    points=np.asarray(points);v=[];f=[]
    for i,p in enumerate(points):
        tangent=Vector(points[min(i+1,len(points)-1)]-points[max(0,i-1)]).normalized()
        across=tangent.cross(Vector((0,-1,0))).normalized()
        if across.length<.1:across=Vector((1,0,0))
        w=width*(max(.06,max(0,math.sin(math.pi*i/(len(points)-1)))**.35) if taper else 1)
        for x,y in [(-1,0),(-.65,-.75),(0,-1),(.65,-.75),(1,0),(.65,.25),(-.65,.25)]:
            v.append((Vector(p)+across*(x*w)+Vector((0,depth*y,0))).to_tuple())
    n=7
    for i in range(len(points)-1):
        for j in range(n):a=i*n+j;b=i*n+(j+1)%n;f.append((a,b,b+n,a+n))
    f.extend([tuple(range(n-1,-1,-1)),tuple((len(points)-1)*n+j for j in range(n))])
    return surface(name,v,f,material)

def relief(name,outline,y,depth,material='gold'):
    """Closed sculpted plate with outline, bevel rings and a raised face ridge."""
    outline=np.asarray(outline);center=outline.mean(0);v=[];f=[];n=len(outline)
    for factor,d in [(1,0),(.94,.3),(.72,.75),(.26,1)]:
        for x,z in center+(outline-center)*factor:v.append((x,y-depth*d,z))
    for ring in range(3):
        for j in range(n):a=ring*n+j;b=ring*n+(j+1)%n;f.append((a,b,b+n,a+n))
    v.append((center[0],y-depth,center[1]));ci=len(v)-1
    for j in range(n):f.append((ci,3*n+j,3*n+(j+1)%n))
    back=len(v)
    for x,z in outline:v.append((x,y+.12,z))
    f.append(tuple(back+j for j in range(n-1,-1,-1)))
    for j in range(n):f.append((j,back+j,back+(j+1)%n,(j+1)%n))
    return surface(name,v,f,material,subd=1)

def diamond(name,x,y,z,w,h):
    # Kite-cut stone with independently modeled dark bezel, prongs and facets.
    outline=[(x,z-h),(x-w,z),(x,z+h),(x+w,z)]
    relief(name+':bezel',outline,y+.06,.24,'darkgold')
    for a,b in zip(outline,outline[1:]+outline[:1]):metal(name+':beveled-setting',[(a[0],y-.1,a[1]),(b[0],y-.1,b[1])],.12,.10)
    v=[(x,y-.66,z)]
    for factor,dy in [(.50,-.56),(.85,-.26),(.89,.02)]:
        for px,pz in outline:v.append((x+(px-x)*factor,y+dy,z+(pz-z)*factor))
    faces=[]
    for i in range(4):
        j=(i+1)%4;faces.append((0,1+i,1+j))
        faces.extend([(1+i,5+i,5+j),(1+i,5+j,1+j),(5+i,9+i,9+j),(5+i,9+j,5+j)])
    faces.append((9,12,11,10))
    o=surface(name+':cut-ruby',v,faces,'ruby')
    for p in o.data.polygons:p.use_smooth=False
    for side in [-1,1]:
        curve(name+':gem-internal-lava',[(x+side*w*.30,y-.68,z+h*.35),(x-side*w*.12,y-.69,z),(x+side*w*.15,y-.64,z-h*.40)],.025,'lava',2)

def ornate_pillow():
    verts=[];faces=[];n=192
    levels=[(.06,.77),(.40,.97),(1.2,1.0),(2.1,.99),(3.2,.93),(4.0,.76),(4.3,.04)]
    for z,r in levels:
        for a in np.linspace(0,TAU,n,endpoint=False):
            x=15.2*math.copysign(abs(math.cos(a))**.46,math.cos(a))*r
            y=10.4*math.copysign(abs(math.sin(a))**.46,math.sin(a))*r
            wave=.10*math.cos(a*15)+.05*math.sin(a*27)
            verts.append((x,y,z+wave*r))
    for i in range(len(levels)-1):
        for j in range(n):a=i*n+j;b=i*n+(j+1)%n;faces.append((a,b,b+n,a+n))
    faces.extend([tuple(range(n-1,-1,-1)),tuple((len(levels)-1)*n+j for j in range(n))])
    surface('cushion:rectangular-brocade',verts,faces,'velvet',subd=2)
    edge=[]
    for a in np.linspace(0,TAU,800):edge.append((15.15*math.copysign(abs(math.cos(a))**.46,math.cos(a)),10.4*math.copysign(abs(math.sin(a))**.46,math.sin(a)),1.9))
    # Two real intertwined strands follow the pillow seam.
    for phase in [0,math.pi]:curve('cushion:twisted-gold-rope',[(x+.045*math.cos(i*.9+phase),y+.045*math.sin(i*.9+phase),z+.06*math.cos(i*.9+phase)) for i,(x,y,z) in enumerate(edge)],.055,'gold',2)
    for side in [-1,1]:
        for x in [-11.5,-8,-4.5,4.5,8,11.5]:
            scroll('cushion:acanthus-embroidery',(x,side*9.7,2.8),1.15,.70,'gold',1 if side<0 else -1)
    for sx in [-1,1]:
        for sy in [-1,1]:
            x,y=sx*14.3,sy*9.5
            for z,r in [(1.7,.24),(1.2,.20),(.85,.26)]:sphere('cushion:tassel-knots',(x,y,z),(r,r,r),'gold',32,16)
            for j in range(18):
                a=j*TAU/18
                curve('cushion:gold-tassel-strand',[(x+.15*math.cos(a),y+.15*math.sin(a),.8),(x+.33*math.cos(a),y+.33*math.sin(a),-.55),(x+.4*math.cos(a),y+.4*math.sin(a),-.9)],.035,'gold',2)

def on_band(u,z,radial=0,theta=0):
    # Tangent offset along an ellipse; ornamental panels sit on the curved ring.
    a=theta+u/13.2
    return (math.sin(a)*(13.2+radial),-math.cos(a)*(9.1+radial),z)

def blade(theta,height,width,identifier):
    v=[];faces=[];rows=100;cols=20
    def form(t,s):
        w=np.interp(t,[0,.10,.26,.42,.58,.76,.9,1],[.48,.82,1,.83,.59,.32,.12,.005])*width
        # Distinct concave barbs and a thin swept point, matching the side detail.
        w*=1+.10*math.sin(t*math.pi*8)*(1-t)
        lean=.9*t*t
        return on_band(s*w,4.3+t*height,lean+.22*(1-s*s),theta)
    for i in range(rows+1):
        for j in range(cols+1):v.append(form(i/rows,2*j/cols-1))
    for i in range(rows):
        for j in range(cols):a=i*(cols+1)+j;faces.append((a,a+1,a+cols+2,a+cols+1))
    surface('crown:'+identifier+'-forged-black-plate',v,faces,'obsidian',.20,1)
    for side in [-1,1]:
        pts=[form(t,side) for t in np.linspace(0,1,120)]
        metal('crown:'+identifier+'-blade-bevel',pts,.13 if 'central' in identifier else .08,.11,material='gold' if 'central' in identifier else 'silver',taper=True)
    # Physically layered pointed scales. Black metallic cells have gold-aged rims.
    for row in range(17):
        t=.07+row*.047
        ww=np.interp(t,[0,.26,.58,.9],[.48,1,.59,.12])*width
        count=5 if ww>1.8 else 3 if ww>1 else 1
        for j in range(count):
            u=(j-(count-1)/2)*ww*1.55/max(count-1,1)
            x,y,z=on_band(u,4.3+t*height,.35+.9*t*t,theta)
            w=min(.55,ww*.44);h=height*.085
            o=relief('crown:'+identifier+'-black-scale',[(-w,-h*.12),(-w,h*.28),(0,h*.50),(w,h*.28),(w,-h*.12),(0,-h*.5)],0,.12,'obsidian')
            o.location=(x,y,z);o.rotation_euler[2]=theta
    # Branching red fissures are fine inlays following the plate, not bone spikes.
    trunk=[]
    for t in np.linspace(.12,.88,100):trunk.append(on_band(.13*math.sin(t*33),4.3+t*height,.39+.9*t*t,theta))
    curve('crown:'+identifier+'-molten-fissure',trunk,.028,'lava',2)
    for j,t in enumerate([.26,.43,.61,.75]):
        side=-1 if j%2 else 1
        curve('crown:'+identifier+'-fissure-branch',[on_band(0,4.3+t*height,.41+.9*t*t,theta),on_band(side*width*.12,4.3+(t+.04)*height,.44+.9*t*t,theta),on_band(side*width*.17,4.3+(t+.06)*height,.44+.9*t*t,theta)],.018,'lava',2)

def flame_strap(theta,side,z0=5.3):
    # Openwork S-blades have empty space between their swept metal boundaries.
    paths=[[(0,0),(.9,1.4),(2.1,3.3),(1.1,4.8),(.5,6.3),(1.7,8.0),(2.7,10.5)],
           [(0,0),(2.4,1.4),(3.1,3.4),(1.1,4.8)],
           [(2.1,3.3),(3.3,4.5),(2.7,6.6),(3.4,8.7)]]
    for k,controls in enumerate(paths):
        local=bez([(side*x,0,z0+z) for x,z in controls],120)
        pts=[on_band(p[0],p[2],1.35,theta) for p in local]
        metal('crown:openwork-swept-flame',pts,.43 if k==0 else .28,.25,taper=True)

def front_dragon(back=False):
    before=set(bpy.context.scene.objects)
    y=-10.1
    outline=[(0,9.1),(-.62,9.7),(-.95,10.8),(-1.55,11.8),(-1.35,12.9),(-2.65,14.9),(-1.4,14.1),(-.62,13.4),(0,13.9),(.62,13.4),(1.4,14.1),(2.65,14.9),(1.35,12.9),(1.55,11.8),(.95,10.8),(.62,9.7)]
    relief('crown:dragon-face-sculpt',outline,y,.85)
    relief('crown:dragon-nose-ridge',[(-.3,10.0),(-.48,11.7),(0,13.5),(.48,11.7),(.3,10.0),(0,9.7)],y-.6,.42)
    for side in [-1,1]:
        relief('crown:dragon-eye-socket',[(side*.35,12.1),(side*1.35,12.75),(side*1.1,11.95),(side*.60,11.65)],y-.42,.12,'obsidian')
        relief('crown:dragon-ruby-eye',[(side*.55,12.1),(side*1.17,12.5),(side*.9,12.05)],y-.6,.17,'ruby')
        # Heavy swept brow and long cheek horns form the heraldic face.
        for pts,w in [([(side*.3,y-.5,12.8),(side*1.25,y-.3,13.9),(side*2.4,y-.1,15.3),(side*2.6,y,18.0),(side*3.2,y,19.4)],.28),
                      ([(side*.4,y-.5,10.2),(side*1.35,y-.3,10.8),(side*2.1,y-.12,12.4),(side*3.1,y,13.2)],.20)]:
            metal('crown:dragon-swept-horn',bez(pts,100),w,.18,taper=True)
        metal('crown:dragon-jaw-edge',[(side*.2,y-.7,9.4),(side*.7,y-.6,10.0),(side*.75,y-.62,10.6)],.12,.1)
        sphere('crown:dragon-nostril',(side*.25,y-1.12,10.5),(.1,.06,.15),'obsidian',24,12)
    diamond('crown:main-kite-ruby',0,y-.2,6.9,1.35,2.35)
    for side in [-1,1]:diamond('crown:flanking-kite-ruby',side*3.5,y+.24,6.9,.50,.95)
    # Shield-like gold V and paired lateral dragon reliefs belong to the band.
    for side in [-1,1]:
        metal('crown:great-V-front',bez([(0,y,4.35),(side*2,y+.2,7.7),(side*5.5,y+.4,8.6),(side*9,y+1.5,8.4),(side*12,y+3.8,7.0)],150),.32,.21)
        metal('crown:lateral-dragon-body',bez([(side*2.3,y-.1,8.1),(side*4,y-.1,10.0),(side*7.5,y+1,10.0),(side*9.6,y+2.5,8.4)],140),.22,.16)
        relief('crown:lateral-dragon-head',[(side*4.1,8.2),(side*4.9,9.1),(side*6.1,9.2),(side*5.6,8.5),(side*4.9,8.1)],y+.05,.45)
        for i in range(13):
            u=side*(4+i*.38);p=on_band(u,8.8+.5*math.sin(i*.25),.35)
            o=leaf('crown:lateral-dragon-scale',p,.22,.62,.07,'gold');o.rotation_euler[1]=side*.9
    if back:
        bpy.context.view_layer.update()
        for o in set(bpy.context.scene.objects)-before:
            # Back has geometric filigree instead of a second literal dragon face.
            if 'dragon-face-sculpt' in o.name or 'ruby-eye' in o.name or 'nostril' in o.name:
                bpy.data.objects.remove(o,do_unlink=True)
            else:o.matrix_world=Matrix.Rotation(math.pi,4,'Z')@o.matrix_world

if not NO_CUSHION:ornate_pillow()
# A continuous hollow metal band has both inner and outer walls.
v=[];f=[];n=256
for rx,ry,z in [(13.3,9.2,4.1),(13.35,9.25,6.1),(12.85,8.75,6.1),(12.8,8.7,4.1)]:
    for a in np.linspace(0,TAU,n,endpoint=False):v.append((rx*math.sin(a),-ry*math.cos(a),z))
for ring in range(4):
    for j in range(n):f.append((ring*n+j,ring*n+(j+1)%n,((ring+1)%4)*n+(j+1)%n,((ring+1)%4)*n+j))
surface('crown:continuous-hollow-band',v,f,'darkgold')
for z in [4.2,5.7]:circle('crown:band-moulding',(0,0,z),13.35,9.25,.12,'gold','XY',256)
panels=[(0,25.5,3.1,'front-central'),(.62,23.5,2.65,'front-right'),(-.62,23.5,2.65,'front-left'),(1.24,17,2.25,'right-side'),(-1.24,17,2.25,'left-side'),(math.pi,25.5,3.1,'back-central'),(math.pi+.62,23,2.65,'back-left'),(math.pi-.62,23,2.65,'back-right'),(math.pi+1.24,17,2.25,'left-rear'),(math.pi-1.24,17,2.25,'right-rear')]
for theta,height,width,name in panels:blade(theta,height,width,name)
for theta in [0,.65,-.65,1.12,-1.12,math.pi,math.pi+.65,math.pi-.65,math.pi/2,-math.pi/2]:
    for side in [-1,1]:flame_strap(theta,side)
for theta in [0,math.pi]:
    # The central gold lancet terminates in a slender pointed spear with open eyes.
    for side in [-1,1]:
        pts=[on_band(side*x,z,1.2,theta) for x,z in [(0,18),(.95,21),(1.0,24.0),(.5,26.5),(0,29.8)]]
        metal('crown:central-open-lancet',bez(pts,160),.18,.18,taper=True)
    p=on_band(0,22.3,1.5,theta)
    before=set(bpy.context.scene.objects);diamond('crown:upper-lancet-ruby',0,-10.6,22.3,.44,1.1)
    if theta:
        for o in set(bpy.context.scene.objects)-before:o.matrix_world=Matrix.Rotation(theta,4,'Z')@o.matrix_world
front_dragon();front_dragon(True)
# Interior ornament sits inside the band, independently modeled from the inset.
for j in range(20):
    theta=j*TAU/20
    pts=[on_band(.45*math.sin(t*TAU),5.0+t*4,-.38,theta) for t in np.linspace(0,1,65)]
    metal('crown:inner-band-engraved-arch',pts,.055,.05)
if NO_CUSHION:
    bpy.context.view_layer.update();deps=bpy.context.evaluated_depsgraph_get()
    corners=[]
    for obj in bpy.context.scene.objects:
        ev=obj.evaluated_get(deps)
        if obj.type in ['MESH','CURVE']:corners.extend([ev.matrix_world@Vector(p) for p in ev.bound_box])
    bounds=np.asarray(corners);lo=bounds.min(0);hi=bounds.max(0);scale=np.array([42,38,38])/(hi-lo)
    transform=Matrix.Diagonal((*scale,1))@Matrix.Translation((-float((lo[0]+hi[0])/2),-float((lo[1]+hi[1])/2),-float(lo[2])))
    for obj in bpy.context.scene.objects:obj.matrix_world=transform@obj.matrix_world
    sys.path.insert(0,str(ROOT/'scripts'))
    import crown_pbr
    crown_pbr.apply_materials(ROOT,MATS)
else:
    for obj in bpy.context.scene.objects:obj.location.z+=.95

# Archive the new sheet as the only modeling reference in this scene.
reference=OUT/'reference.png'
assert reference.exists()
export_def=shared[shared.index('def export_interchange():'):shared.index('\nexport_interchange()')]
exec(compile(export_def,'shared_geometry_export','exec'))
if NO_CUSHION:crown_pbr.export_geometry(OUT,ITEM,PALETTE,FEATURES)
else:export_interchange()
info=json.loads((OUT/'black_crown-geometry.json').read_text())
info['referenceSha256']=hashlib.sha256(reference.read_bytes()).hexdigest()
info['backDesign']='Back follows the provided back view; oval ring depth inferred from side and interior details.'
info['status']='NO_CUSHION_PBR_REVIEW_PENDING' if NO_CUSHION else 'THREE_VIEW_CROWN_REVIEW_PENDING'
(OUT/'black_crown-geometry.json').write_text(json.dumps(info,indent=2),encoding='utf8')
# Use the proven scene setup with this new reference and additional orthographic views.
presentation=shared[shared.index('# References are separate image empties'):]
presentation=presentation.replace("source=next(a for a in manifest['assets'] if a['id']==ITEM)","source={'original':reference.relative_to(ROOT).as_posix()}")
presentation=presentation.replace("[('angle',(.65,-1,.48)),('front',(0,-1,.16)),('back',(.5,1,.3))]","[('angle',(.65,-1,.40)),('front',(0,-1,0)),('side',(-1,0,0)),('back',(0,1,0)),('interior',(.30,-.50,1.4))]")
exec(compile(presentation,'crown_presentation','exec'))
