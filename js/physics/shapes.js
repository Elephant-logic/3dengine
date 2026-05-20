import { Vec3 } from '../math/vec3.js';
import { AABB }  from '../math/primitives.js';
import { Mat4 }  from '../math/mat4.js';

// ─────────────────────────────────────────────────────────────────────────────
// SHAPE TYPES
// ─────────────────────────────────────────────────────────────────────────────
export const ShapeType = Object.freeze({
  SPHERE:   'sphere',
  BOX:      'box',
  CAPSULE:  'capsule',
  PLANE:    'plane',     // infinite ground plane, normal+d
});

// ─────────────────────────────────────────────────────────────────────────────
// BASE SHAPE
// ─────────────────────────────────────────────────────────────────────────────
export class Shape {
  constructor(type){
    this.type   = type;
    this.offset = new Vec3();  // local offset from body centre
  }

  // Override in subclasses
  getAABB(pos, rot)       { return new AABB(); }
  getInertiaTensor(mass)  { return new Vec3(1,1,1); }  // diagonal elements
}

// ─────────────────────────────────────────────────────────────────────────────
// SPHERE
// ─────────────────────────────────────────────────────────────────────────────
export class SphereShape extends Shape {
  constructor(radius=0.5){
    super(ShapeType.SPHERE);
    this.radius = radius;
  }

  getAABB(pos){
    const r=new Vec3(this.radius,this.radius,this.radius);
    const c=pos.add(this.offset);
    return new AABB(c.sub(r), c.add(r));
  }

  // Solid sphere: I = 2/5 * m * r²
  getInertiaTensor(mass){
    const i = 0.4 * mass * this.radius * this.radius;
    return new Vec3(i,i,i);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BOX
// ─────────────────────────────────────────────────────────────────────────────
export class BoxShape extends Shape {
  constructor(halfExtents=new Vec3(0.5,0.5,0.5)){
    super(ShapeType.BOX);
    this.halfExtents = halfExtents.clone();
  }

  getAABB(pos, rot){
    // Compute AABB of OBB — transform half-extents by rotation
    const mat = Mat4.fromQuat(rot);
    const c   = pos.add(this.offset);
    const hx  = Math.abs(mat.e[0])*this.halfExtents.x + Math.abs(mat.e[4])*this.halfExtents.y + Math.abs(mat.e[8] )*this.halfExtents.z;
    const hy  = Math.abs(mat.e[1])*this.halfExtents.x + Math.abs(mat.e[5])*this.halfExtents.y + Math.abs(mat.e[9] )*this.halfExtents.z;
    const hz  = Math.abs(mat.e[2])*this.halfExtents.x + Math.abs(mat.e[6])*this.halfExtents.y + Math.abs(mat.e[10])*this.halfExtents.z;
    const h   = new Vec3(hx,hy,hz);
    return new AABB(c.sub(h), c.add(h));
  }

  // Solid box: I = m/12 * (b²+c², a²+c², a²+b²) where a,b,c = 2*halfExtents
  getInertiaTensor(mass){
    const a=2*this.halfExtents.x, b=2*this.halfExtents.y, c=2*this.halfExtents.z;
    return new Vec3(
      mass/12*(b*b+c*c),
      mass/12*(a*a+c*c),
      mass/12*(a*a+b*b)
    );
  }

  // Get 8 corners in local space
  getCorners(){
    const h=this.halfExtents;
    return [
      new Vec3(-h.x,-h.y,-h.z), new Vec3( h.x,-h.y,-h.z),
      new Vec3(-h.x, h.y,-h.z), new Vec3( h.x, h.y,-h.z),
      new Vec3(-h.x,-h.y, h.z), new Vec3( h.x,-h.y, h.z),
      new Vec3(-h.x, h.y, h.z), new Vec3( h.x, h.y, h.z),
    ];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CAPSULE — cylinder with hemispherical caps, aligned to local Y axis
// ─────────────────────────────────────────────────────────────────────────────
export class CapsuleShape extends Shape {
  constructor(radius=0.5, halfHeight=1.0){
    super(ShapeType.CAPSULE);
    this.radius     = radius;
    this.halfHeight = halfHeight; // half height of the cylindrical part
  }

  getAABB(pos){
    const r=this.radius;
    const h=this.halfHeight+r;
    const c=pos.add(this.offset);
    return new AABB(c.sub(new Vec3(r,h,r)), c.add(new Vec3(r,h,r)));
  }

  // Approximate solid capsule inertia
  getInertiaTensor(mass){
    const r=this.radius, h=this.halfHeight*2;
    const cylMass=mass*(h/(h+4*r/3));
    const capMass=mass-cylMass;
    const Ixx=cylMass*(r*r/4+h*h/12)+2*capMass*(0.4*r*r+0.375*r*h+h*h/4);
    const Iyy=cylMass*r*r/2+2*capMass*0.4*r*r;
    return new Vec3(Ixx,Iyy,Ixx);
  }

  // Get top/bottom sphere centres in local space
  getSegment(){
    return {
      a: new Vec3(0, -this.halfHeight, 0),
      b: new Vec3(0,  this.halfHeight, 0),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PLANE — infinite static plane (normal + d)
// Only valid for static bodies (mass = 0)
// ─────────────────────────────────────────────────────────────────────────────
export class PlaneShape extends Shape {
  constructor(normal=new Vec3(0,1,0), d=0){
    super(ShapeType.PLANE);
    this.normal = normal.normalise();
    this.d      = d;  // signed distance from origin along normal
  }

  getAABB(){
    // Infinite — return huge box
    const INF=1e6;
    return new AABB(new Vec3(-INF,-INF,-INF), new Vec3(INF,INF,INF));
  }

  getInertiaTensor(){ return new Vec3(Infinity,Infinity,Infinity); }
}
