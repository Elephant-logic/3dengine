import { Vec3 } from './vec3.js';

// ─────────────────────────────────────────────────────────────────────────────
// RAY
// ─────────────────────────────────────────────────────────────────────────────
export class Ray {
  constructor(origin, direction){
    this.origin    = origin.clone();
    this.direction = direction.normalise();
  }

  at(t){ return this.origin.add(this.direction.scale(t)); }

  // Returns t (distance) or null if no intersection
  intersectPlane(planeNormal, planeD){
    const denom = this.direction.dot(planeNormal);
    if(Math.abs(denom) < 1e-10) return null;
    const t = (planeD - this.origin.dot(planeNormal)) / denom;
    return t >= 0 ? t : null;
  }

  intersectSphere(centre, radius){
    const oc = this.origin.sub(centre);
    const a  = this.direction.dot(this.direction);
    const b  = 2 * oc.dot(this.direction);
    const c  = oc.dot(oc) - radius*radius;
    const disc = b*b - 4*a*c;
    if(disc < 0) return null;
    const t = (-b - Math.sqrt(disc)) / (2*a);
    return t >= 0 ? t : null;
  }

  intersectAABB(min, max){
    let tmin=-Infinity, tmax=Infinity;
    for(let i=0;i<3;i++){
      const axis = i===0?'x':i===1?'y':'z';
      const d    = this.direction[axis];
      if(Math.abs(d) < 1e-10){
        if(this.origin[axis]<min[axis]||this.origin[axis]>max[axis]) return null;
      } else {
        let t1=(min[axis]-this.origin[axis])/d;
        let t2=(max[axis]-this.origin[axis])/d;
        if(t1>t2)[t1,t2]=[t2,t1];
        tmin=Math.max(tmin,t1);
        tmax=Math.min(tmax,t2);
        if(tmin>tmax) return null;
      }
    }
    return tmin>=0 ? tmin : (tmax>=0 ? tmax : null);
  }

  // Möller–Trumbore triangle intersection
  intersectTriangle(v0, v1, v2){
    const e1=v1.sub(v0), e2=v2.sub(v0);
    const h=this.direction.cross(e2);
    const a=e1.dot(h);
    if(Math.abs(a)<1e-10) return null;
    const f=1/a;
    const s=this.origin.sub(v0);
    const u=f*s.dot(h);
    if(u<0||u>1) return null;
    const q=s.cross(e1);
    const v=f*this.direction.dot(q);
    if(v<0||u+v>1) return null;
    const t=f*e2.dot(q);
    return t>1e-6 ? t : null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AABB — Axis Aligned Bounding Box
// ─────────────────────────────────────────────────────────────────────────────
export class AABB {
  constructor(min=new Vec3(), max=new Vec3()){
    this.min=min.clone();
    this.max=max.clone();
  }

  static fromCentreHalfSize(centre, halfSize){
    return new AABB(centre.sub(halfSize), centre.add(halfSize));
  }

  static empty(){
    return new AABB(
      new Vec3( Infinity, Infinity, Infinity),
      new Vec3(-Infinity,-Infinity,-Infinity)
    );
  }

  centre(){ return this.min.add(this.max).scale(0.5); }
  halfSize(){ return this.max.sub(this.min).scale(0.5); }
  size(){ return this.max.sub(this.min); }

  contains(p){
    return p.x>=this.min.x&&p.x<=this.max.x&&
           p.y>=this.min.y&&p.y<=this.max.y&&
           p.z>=this.min.z&&p.z<=this.max.z;
  }

  intersects(b){
    return this.min.x<=b.max.x&&this.max.x>=b.min.x&&
           this.min.y<=b.max.y&&this.max.y>=b.min.y&&
           this.min.z<=b.max.z&&this.max.z>=b.min.z;
  }

  // Signed distance — negative means inside
  sdf(p){
    const d=new Vec3(
      Math.abs(p.x-this.centre().x)-this.halfSize().x,
      Math.abs(p.y-this.centre().y)-this.halfSize().y,
      Math.abs(p.z-this.centre().z)-this.halfSize().z
    );
    return Math.min(Math.max(d.x,d.y,d.z),0)+
           new Vec3(Math.max(d.x,0),Math.max(d.y,0),Math.max(d.z,0)).length();
  }

  expand(p){
    this.min=Vec3.min(this.min,p);
    this.max=Vec3.max(this.max,p);
    return this;
  }

  expandAABB(b){
    this.min=Vec3.min(this.min,b.min);
    this.max=Vec3.max(this.max,b.max);
    return this;
  }

  // Inflate by margin on all sides
  inflate(margin){
    const m=new Vec3(margin,margin,margin);
    return new AABB(this.min.sub(m),this.max.add(m));
  }

  // Transform AABB by a matrix (returns new enclosing AABB)
  transform(mat){
    const corners=[
      new Vec3(this.min.x,this.min.y,this.min.z),
      new Vec3(this.max.x,this.min.y,this.min.z),
      new Vec3(this.min.x,this.max.y,this.min.z),
      new Vec3(this.max.x,this.max.y,this.min.z),
      new Vec3(this.min.x,this.min.y,this.max.z),
      new Vec3(this.max.x,this.min.y,this.max.z),
      new Vec3(this.min.x,this.max.y,this.max.z),
      new Vec3(this.max.x,this.max.y,this.max.z),
    ];
    const result=AABB.empty();
    for(const c of corners) result.expand(mat.transformPoint(c));
    return result;
  }

  clone(){ return new AABB(this.min.clone(),this.max.clone()); }
}

// ─────────────────────────────────────────────────────────────────────────────
// COLOUR
// ─────────────────────────────────────────────────────────────────────────────
export class Colour {
  constructor(r=1, g=1, b=1, a=1){ this.r=r; this.g=g; this.b=b; this.a=a; }

  static fromHex(hex){
    const n=parseInt(hex.replace('#',''),16);
    return new Colour(
      ((n>>16)&255)/255,
      ((n>> 8)&255)/255,
      ( n     &255)/255
    );
  }

  static fromHSL(h,s,l){
    h=((h%360)+360)%360;
    s=Math.max(0,Math.min(1,s));
    l=Math.max(0,Math.min(1,l));
    const c=(1-Math.abs(2*l-1))*s;
    const x=c*(1-Math.abs((h/60)%2-1));
    const m=l-c/2;
    let r=0,g=0,b=0;
    if(h<60)     {r=c;g=x;b=0;}
    else if(h<120){r=x;g=c;b=0;}
    else if(h<180){r=0;g=c;b=x;}
    else if(h<240){r=0;g=x;b=c;}
    else if(h<300){r=x;g=0;b=c;}
    else          {r=c;g=0;b=x;}
    return new Colour(r+m,g+m,b+m);
  }

  static white()  { return new Colour(1,1,1,1); }
  static black()  { return new Colour(0,0,0,1); }
  static red()    { return new Colour(1,0,0,1); }
  static green()  { return new Colour(0,1,0,1); }
  static blue()   { return new Colour(0,0,1,1); }
  static yellow() { return new Colour(1,1,0,1); }

  lerp(c, t){
    return new Colour(
      this.r+(c.r-this.r)*t,
      this.g+(c.g-this.g)*t,
      this.b+(c.b-this.b)*t,
      this.a+(c.a-this.a)*t
    );
  }

  toArray()   { return [this.r,this.g,this.b,this.a]; }
  toFloat32() { return new Float32Array([this.r,this.g,this.b,this.a]); }
  clone()     { return new Colour(this.r,this.g,this.b,this.a); }

  // Linear to gamma (sRGB approximation)
  toGamma(){ return new Colour(Math.pow(this.r,1/2.2),Math.pow(this.g,1/2.2),Math.pow(this.b,1/2.2),this.a); }
}
