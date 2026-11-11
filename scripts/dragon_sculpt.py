"""Anatomical trophy surfaces authored for the compatibility mod by the main agent."""
import math
import numpy as np


def unit(v):
    v=np.asarray(v,float)
    return v/max(np.linalg.norm(v),1e-9)


def plate(m, center, size, material, normal=(0,0,-1), long=(0,1,0), rings=6, sides=32):
    center=np.array(center,float);normal=unit(normal);long=unit(np.array(long)-normal*np.dot(long,normal));across=unit(np.cross(long,normal))
    p=[center+normal*size*.17];n=[normal];uv=[(.5,.5)];faces=[]
    for ring in range(1,rings+1):
        r=ring/rings
        for j in range(sides):
            a=j/sides*2*math.pi
            # Narrow distal tip, irregular convex edge, asymmetric natural wear.
            x=math.sin(a)*(.73+.18*math.cos(a));y=math.cos(a)
            wear=1-.023*math.sin(j*2.3+center[1]*1.7)
            p.append(center+across*x*r*size*wear+long*y*r*size+normal*size*(.17*(1-r*r)+.025*math.sin(a*3)*r*r))
            n.append(unit(normal+across*x*r*.34+long*y*r*.24))
            uv.append((.5+x*r*.40,.5-y*r*.42))
        for j in range(sides):
            a=1+(ring-1)*sides+j;b=1+(ring-1)*sides+(j+1)%sides
            if ring==1:faces.append((0,a,b))
            else:faces.extend([(a-sides,a,b),(a-sides,b,b-sides)])
    m.surface(p,n,uv,faces,material)
    # Separate normals on the underside avoid a falsely inward-facing back cap.
    outer=np.array(p[-sides:]);bottom=outer-normal*size*.08
    bp=[center-normal*size*.055,*bottom];bn=[-normal]*(sides+1)
    bf=[(0,j+1,(j+1)%sides+1) for j in range(sides)]
    m.surface(bp,bn,[(.5,.5)]+[(j/sides,.5) for j in range(sides)],bf,material)
    for j in range(sides):
        k=(j+1)%sides;edge=unit((outer[j]+outer[k])/2-center)
        m.surface([outer[j],outer[k],bottom[k],bottom[j]],[edge]*4,[(0,0),(1,0),(1,1),(0,1)],[(0,1,2),(0,2,3)],material)


def loft(m, controls, material, sides=64, samples=7, angular=False):
    # Controls: z,width,height,vertical center. Catmull-Rom keeps skull masses continuous.
    controls=np.asarray(controls,float);sections=[]
    for i in range(len(controls)-1):
        a,b,c,d=controls[max(0,i-1)],controls[i],controls[i+1],controls[min(i+2,len(controls)-1)]
        for t in np.arange(samples)/samples:
            sections.append(.5*(2*b+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t))
    sections.append(controls[-1]);p=[];uv=[]
    for i,(z,w,h,y) in enumerate(sections):
        for j in range(sides+1):
            a=j/sides*2*math.pi
            ridge=1+.025*math.sin(3*a+z*.1)+.012*math.sin(7*a-z*.17)
            lateral=math.cos(a)*w*ridge
            vertical=math.sin(a)*h*ridge
            if angular:
                lateral*=.80+.20*math.sin(a)
                vertical+=h*.10*max(0,math.sin(a))**10
            p.append([lateral,y+vertical,z]);uv.append((j/sides,i/(len(sections)-1)))
    n=[];faces=[];p=np.array(p)
    for i in range(len(sections)):
        for j in range(sides+1):
            prev=i*(sides+1)+(j-1)%sides;nxt=i*(sides+1)+(j+1)%sides
            before=max(i-1,0)*(sides+1)+j;after=min(i+1,len(sections)-1)*(sides+1)+j
            normal=unit(np.cross(p[nxt]-p[prev],p[after]-p[before]))
            radial=np.array([p[i*(sides+1)+j,0],p[i*(sides+1)+j,1]-sections[i][3],0])
            if np.dot(normal,radial)<0:normal=-normal
            n.append(normal)
    p=p.tolist()
    for i in range(len(sections)-1):
        for j in range(sides):
            a=i*(sides+1)+j;b=a+sides+1;faces.extend([(a,b,a+1),(a+1,b,b+1)])
    for ring,sign in [(0,1),(len(sections)-1,-1)]:
        z,_,_,y=sections[ring];idx=len(p);p.append([0,y,z]);n.append([0,0,sign]);uv.append((.5,.5))
        for j in range(sides):faces.append((idx,ring*(sides+1)+j,ring*(sides+1)+j+1))
    m.surface(p,n,uv,faces,material)


def torus(m, center, radius, tube, material, axis=(0,1,0), segments=64, sides=10):
    axis=unit(axis);u=unit(np.cross(axis,(0,0,1) if abs(axis[2])<.9 else (0,1,0)));v=np.cross(axis,u)
    p=[];n=[];uv=[];faces=[];center=np.array(center)
    for i in range(segments+1):
        a=i/segments*math.pi*2;rad=u*math.cos(a)+v*math.sin(a)
        for j in range(sides+1):
            b=j/sides*math.pi*2;normal=rad*math.cos(b)+axis*math.sin(b)
            p.append(center+rad*radius+normal*tube);n.append(normal);uv.append((i/segments,j/sides))
    for i in range(segments):
        for j in range(sides):
            a=i*(sides+1)+j;b=a+sides+1;faces.extend([(a,b,a+1),(a+1,b,b+1)])
    m.surface(p,n,uv,faces,material)


def stand(m,radius=11):
    # A turned stepped antique-bronze reliquary foot, with concentric carved mouldings.
    for y,r,h,mat in [(1.2,radius,1.2,'bronze_dark'),(2.0,radius*.95,.55,'bronze'),(2.8,radius*.85,.45,'wood'),(3.25,radius*.81,.22,'gold')]:
        m.ellipsoid((0,y,0),(r,h,r*.74),mat,64,12)
    for y,r in [(1.3,radius*.98),(2.45,radius*.86)]:torus(m,(0,y,0),r,.16,'bronze',segments=64,sides=8)
    for j in range(16):
        a=j/16*2*math.pi
        m.ellipsoid((math.cos(a)*radius*.91,1.8,math.sin(a)*radius*.66),(.25,.24,.25),'gold',12,6)


def dragon_cranium(m):
    # Reference-led western dragon: narrow wedge skull, high brow and swept crown.
    # Deep tyrannosaur-like upper jaw: high arched nasal bones and a tall rostrum.
    loft(m,[(12,4.8,5.8,-3),(4,6.4,7,0),(-5,7.6,8.8,2.5),(-12,5.7,7.5,3.8),(-21,4.5,6.2,4.0),(-29,3.8,5.2,2.5)],'hide',72,10,angular=True)
    loft(m,[(5,4.8,3,-5.5),(-5,5.8,3,-7.5),(-17,4.8,2.5,-8),(-28,3.7,1.8,-7.2)],'hide',56,9,angular=True)
    loft(m,[(-3,4.6,1.1,-5.2),(-15,4.3,1.0,-5.0),(-26,3.3,.7,-4.2)],'mouth',40,7)
    m.tube([(0,11.0,-9),(0,12.3,-16),(0,11.0,-23),(0,8.5,-28)],[.38,.65,.50,.10],'ridge',32)
    for side in [-1,1]:
        # The dominant horns sweep backwards; smaller horns create a directional crown.
        m.tube([(side*4.8,6.7,3),(side*5.4,12.5,8),(side*6.2,19,11),(side*6.5,23,6)],[1.65,1.2,.6,.018],'horn',40)
        m.tube([(side*5.5,4,7),(side*8,8,14),(side*9,12,17)],[1.4,.8,.018],'horn',32)
        m.tube([(side*4,7.7,-2),(side*4.5,12,1),(side*5,14,3)],[1,.6,.018],'horn',32)
        # Thin, layered cheek fins and swept temporal spines.
        for j in range(4):
            m.tube([(side*(5.9-j*.35),2.6-j*1.6,-1+j*2),(side*(9.0-j*.2),4-j*1.0,7+j*2),(side*(11-j*.3),5-j*.9,11+j*2)],[1.15,.65,.018],'plates',28)
        m.ellipsoid((side*5.8,5.5,-8.5),(1.05,.9,1.7),'black',36,20)
        m.ellipsoid((side*6.35,5.5,-9.3),(.48,.65,1.0),'amber',40,24)
        m.ellipsoid((side*6.72,5.5,-9.6),(.07,.55,.28),'black',24,16)
        m.tube([(side*2.6,10.2,-16),(side*5.2,9.2,-10),(side*6.7,7.3,-3)],[.35,1.1,.16],'ridge',28)
        # Faceted nasal ridges rather than a round crocodile snout.
        m.tube([(side*1.1,8.1,-27),(side*1.8,10.1,-22),(side*2.2,11.1,-17)],[.22,.4,.08],'ridge',24)
        m.ellipsoid((side*2.1,4.6,-29.05),(.5,.42,.24),'black',28,14)
        for j in range(11):
            z=-5-j*2.1;x=side*np.interp(-z,[5,12,21,28],[5.7,4.9,4.0,3.3])
            top=np.interp(-z,[5,12,21,28],[-5.0,-3.7,-2.3,-2.8])
            length=1.35+(.65 if j in [2,6] else 0)
            m.tube([(x,top,z),(x*.98,top-length*.6,z-.15),(x*.91,top-length,z-.5)],[.34,.22,.012],'ivory',20)
            if j%2==0:m.tube([(x*.88,-5.3,z),(x*.88,-4.2,z-.1)],[.23,.012],'ivory',16)
        m.tube([(side*4.9,-3.7,-11),(side*4.9,-5.5,-11.7),(side*4.2,-6.8,-12.5)],[.68,.45,.012],'ivory',28)
        # Fine scales follow skull planes, with larger armor along the crown.
        for row in range(4):
            for col in range(7):
                z=5-col*4.2-row*.3;x=side*(.8+row*1.25)
                width=np.interp(-z,[-5,5,12,21,29],[6.4,7.6,5.7,4.5,3.8])
                if abs(x)>width*.78:continue
                height=np.interp(-z,[-5,5,12,21,29],[7,8.8,7.5,6.2,5.2])
                center=np.interp(-z,[-5,5,12,21,29],[0,2.5,3.8,4,2.5])
                y=center+height*math.sqrt(max(.03,1-(x/width)**2))
                plate(m,(x,y+.15,z),1.15,'plates',normal=(x/width,.9,-.12),long=(0,0,-1),rings=5,sides=22)
        for j in range(5):
            plate(m,(side*3.7,-2-j*1.5,7+j*1.3),1.7,'plates',normal=(side*.7,-.1,-.5),long=(0,1,0),rings=5,sides=24)
    for j in range(7):
        z=-1+j*2.4
        m.tube([(0,8.5-j*.55,z),(0,12-j*.4,z+3),(0,12.5-j*.35,z+6)],[.9,.55,.012],'horn',28)


def make_trophy(factory,kind):
    m=factory(kind)
    if kind=='head':
        # A carved walnut shield with inset bronze edge rather than a flat yellow outline.
        m.shield((0,0,7.5),38,55,3.2,'wood')
        m.shield((0,0,5.9),35.5,52.5,.7,'bronze_dark')
        m.shield((0,0,5.45),33.8,50.7,.6,'wood')
        for side in [-1,1]:
            for y in [-18,-7,5,17]:m.ellipsoid((side*(13 if abs(y)<15 else 9),y,4.9),(.5,.5,.3),'bronze',20,10)
        start=len(m.p)
        dragon_cranium(m)
        m.p[start:]=[[x,y,z-13] for x,y,z in m.p[start:]]
        loft(m,[(6,4.5,6,-3),(-1,4.8,5.8,-3)],'hide',56,8)
        m.p=[[x,y-27,z] for x,y,z in m.p]
    elif kind=='fang':
        stand(m,10)
        m.tube([(0,4,0),(-3,11,0),(-4,20,-1),(-1,29,-4),(5,35,-8),(9,36,-12)],[4.4,4.1,3.5,2.3,1.0,.025],'ivory',64)
        m.ellipsoid((0,5,0),(4.6,2.0,4.0),'bone',48,18)
        for y,r in [(4.4,4.8),(5.4,4.9)]:torus(m,(0,y,0),r,.22,'bronze',segments=64)
        for side in [-1,1]:m.tube([(side*6,3.5,2),(side*5,8,1),(side*4,10,0)],[.6,.45,.15],'bronze_dark',24)
        for j in range(9):
            a=j/9*2*math.pi
            m.tube([(math.cos(a)*4,7,math.sin(a)*3.5),(math.cos(a)*3.7-2,12,math.sin(a)*3.2),(math.cos(a)*2.9-3.6,19,math.sin(a)*2.7-.5)],[.035,.05,.015],'bone',8)
    elif kind=='eye':
        stand(m,11)
        m.ellipsoid((0,14.5,0),(7.6,7.7,6.4),'ivory',80,48)
        p=[(0,14.5,-6.8)];n=[(0,0,-1)];uv=[(.5,.5)];faces=[]
        rings=16;sides=112
        for ring in range(1,rings+1):
            r=ring/rings
            for j in range(sides):
                a=j/sides*math.pi*2;x=math.cos(a)*r;y=math.sin(a)*r
                p.append((x*5.7,14.5+y*5.9,-5.5-1.3*math.sqrt(max(0,1-r*r))))
                n.append(unit((x*.23,y*.23,-max(.05,math.sqrt(1-r*r)))))
                uv.append((.5+x*.5,.5-y*.5))
            for j in range(sides):
                a=1+(ring-1)*sides+j;b=1+(ring-1)*sides+(j+1)%sides
                if ring==1:faces.append((0,a,b))
                else:faces.extend([(a-sides,a,b),(a-sides,b,b-sides)])
        m.surface(p,n,uv,faces,'amber')
        for side in [-1,1]:
            m.tube([(side*8.5,4,1),(side*9,10,1),(side*7.3,14,0)],[.65,.5,.25],'bronze',28)
            m.tube([(side*6.4,19,-2),(side*6.7,17,-3.5),(side*6.9,15,-4)],[.055,.04,.015],'mouth',8)
        torus(m,(0,5,0),5,.33,'bronze',segments=64)
    elif kind=='scale':
        stand(m,12)
        m.tube([(0,3,3),(0,16,4),(0,28,3)],[1.3,1.1,.7],'bronze_dark',32)
        plate(m,(0,22,0),14.3,'plates',rings=16,sides=80)
        plate(m,(-7,14,1),9.5,'hide',normal=(-.15,0,-1),rings=10,sides=56)
        for i in range(7):
            y=12+i*2.9;width=10*math.sin((i+1)/9*math.pi)
            m.tube([(-width,y,-.7),(0,y+2,-2.7),(width,y,-.7)],[.09,.18,.045],'ridge',12)
        m.tube([(0,9,-.2),(0,21,-2.7),(0,34,-.3)],[.18,.40,.035],'horn',24)
        for side in [-1,1]:m.tube([(side*9,3.3,2),(side*8,8,0),(side*6,10,-.1)],[.5,.45,.18],'bronze',24)
    elif kind=='claw':
        stand(m,12)
        # Slender scaled wrist and articulated fingers, not a paw with oversized nails.
        m.tube([(0,4,1),(0,9,1),(0,14,0)],[3.0,3.4,4.0],'hide',56)
        m.ellipsoid((0,13,0),(4.4,5.8,2.8),'hide',64,40)
        for j,x in enumerate([-3.2,0,3.2]):
            endx=x*1.65+(.3 if j==1 else 0)
            height=26.5+(1.8 if j==1 else 0)
            m.tube([(x,16,0),(x*1.4,21,-1.1),(endx,height,-3.8)],[1.35,1.1,.84],'hide',44)
            m.ellipsoid((x*1.4,21,-1.1),(1.26,1.32,1.16),'hide',32,20)
            m.tube([(endx,height,-3.8),(endx*1.05,height+.5,-6.6),(endx*.98,height-1.4,-9.6),(endx*.89,height-4.2,-10.3)],[.93,.72,.39,.012],'horn',56)
            for row in range(5):plate(m,(x*.85,10+row*1.8,-2.7),1.02,'plates',rings=5,sides=24)
            for y in [19,21,23]:
                xx=np.interp(y,[16,height],[x,endx])
                plate(m,(xx,y,-1.8-(y-19)*.22),.80,'plates',rings=4,sides=22)
        # Opposable side digit, clearly separate from the three long fingers.
        m.tube([(-3.2,12,0),(-6.4,13,-2),(-8.0,12,-4.5)],[1.35,1.0,.68],'hide',40)
        m.tube([(-8,12,-4.5),(-9,11,-6.5),(-8.8,9,-8.2),(-7.5,7.5,-8.5)],[.78,.59,.30,.012],'horn',48)
        for y,r in [(4.3,3.5),(5.0,3.6)]:torus(m,(0,y,0),r,.22,'bronze',segments=64)
        for side in [-1,1]:m.tube([(side*7,3.4,2),(side*5,6,1),(side*3.5,7,0)],[.43,.38,.13],'bronze_dark',24)
    return m
