import { Vec3 } from './vec3.js';

/**
 * Quat — unit quaternion for 3D rotation
 * Stored as (x, y, z, w) where w is the scalar component
 */
export class Quat {
  constructor(x=0, y=0, z=0, w=1){ this.x=x; this.y=y; this.z=z; this.w=w; }

  // ── FACTORIES ─────────────────────────────────────────────────────────────
  static identity() { return new Quat(0,0,0,1); }

  static fromAxisAngle(axis, angle){
    const half = angle * 0.5;
    const s    = Math.sin(half);
    const n    = axis.normalise();
    return new Quat(n.x*s, n.y*s, n.z*s, Math.cos(half));
  }

  // Euler angles in radians (YXZ order — standard game convention)
  static fromEuler(pitch, yaw, roll){
    const cx=Math.cos(pitch*0.5), sx=Math.sin(pitch*0.5);
    const cy=Math.cos(yaw  *0.5), sy=Math.sin(yaw  *0.5);
    const cz=Math.cos(roll *0.5), sz=Math.sin(roll *0.5);
    return new Quat(
      sx*cy*cz + cx*sy*sz,
      cx*sy*cz - sx*cy*sz,
      cx*cy*sz + sx*sy*cz,
      cx*cy*cz - sx*sy*sz
    );
  }

  // Shortest rotation from direction a to direction b
  static fromTo(a, b){
    const na = a.normalise(), nb = b.normalise();
    const d  = na.dot(nb);
    if(d >= 1.0 - 1e-6) return Quat.identity();
    if(d <= -1.0 + 1e-6){
      // 180 degree rotation — find perpendicular axis
      let perp = new Vec3(1,0,0);
      if(Math.abs(na.x) > 0.9) perp = new Vec3(0,1,0);
      const axis = na.cross(perp).normalise();
      return Quat.fromAxisAngle(axis, Math.PI);
    }
    const c = na.cross(nb);
    const q = new Quat(c.x, c.y, c.z, 1 + d);
    return q.normalise();
  }

  static from(q){ return new Quat(q.x,q.y,q.z,q.w); }

  // ── OPERATIONS ────────────────────────────────────────────────────────────
  mul(q){
    return new Quat(
      this.w*q.x + this.x*q.w + this.y*q.z - this.z*q.y,
      this.w*q.y - this.x*q.z + this.y*q.w + this.z*q.x,
      this.w*q.z + this.x*q.y - this.y*q.x + this.z*q.w,
      this.w*q.w - this.x*q.x - this.y*q.y - this.z*q.z
    );
  }

  conjugate(){ return new Quat(-this.x,-this.y,-this.z, this.w); }
  inverse()  {
    const lsq = this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w;
    if(lsq < 1e-10) return Quat.identity();
    const inv = 1/lsq;
    return new Quat(-this.x*inv,-this.y*inv,-this.z*inv, this.w*inv);
  }

  lengthSq(){ return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w; }
  length()  { return Math.sqrt(this.lengthSq()); }
  normalise(){
    const l=this.length();
    if(l<1e-10) return Quat.identity();
    const inv=1/l;
    return new Quat(this.x*inv,this.y*inv,this.z*inv,this.w*inv);
  }
  normaliseSelf(){
    const l=this.length();
    if(l>1e-10){ const inv=1/l; this.x*=inv;this.y*=inv;this.z*=inv;this.w*=inv; }
    return this;
  }

  // Rotate a vector by this quaternion: q * v * q^-1
  rotateVec(v){
    const qx=this.x,qy=this.y,qz=this.z,qw=this.w;
    const vx=v.x,vy=v.y,vz=v.z;
    // t = 2 * cross(q.xyz, v)
    const tx=2*(qy*vz-qz*vy);
    const ty=2*(qz*vx-qx*vz);
    const tz=2*(qx*vy-qy*vx);
    return new Vec3(
      vx + qw*tx + qy*tz - qz*ty,
      vy + qw*ty + qz*tx - qx*tz,
      vz + qw*tz + qx*ty - qy*tx
    );
  }

  // ── INTERPOLATION ─────────────────────────────────────────────────────────
  slerp(q, t){
    let dot = this.x*q.x+this.y*q.y+this.z*q.z+this.w*q.w;
    // Clamp dot to valid range
    dot = Math.max(-1, Math.min(1, dot));
    // Ensure shortest path
    let qb = q;
    if(dot < 0){ dot=-dot; qb=new Quat(-q.x,-q.y,-q.z,-q.w); }
    if(dot > 0.9995){
      // Linear interpolation for near-identical quaternions
      return new Quat(
        this.x+(qb.x-this.x)*t,
        this.y+(qb.y-this.y)*t,
        this.z+(qb.z-this.z)*t,
        this.w+(qb.w-this.w)*t
      ).normalise();
    }
    const angle  = Math.acos(dot);
    const sinInv = 1/Math.sin(angle);
    const sa = Math.sin((1-t)*angle)*sinInv;
    const sb = Math.sin(    t *angle)*sinInv;
    return new Quat(
      this.x*sa+qb.x*sb,
      this.y*sa+qb.y*sb,
      this.z*sa+qb.z*sb,
      this.w*sa+qb.w*sb
    );
  }

  // ── EULER EXTRACTION ──────────────────────────────────────────────────────
  toEuler(){
    // Returns {pitch, yaw, roll} in radians
    const sinr_cosp = 2*(this.w*this.x+this.y*this.z);
    const cosr_cosp = 1-2*(this.x*this.x+this.y*this.y);
    const pitch = Math.atan2(sinr_cosp, cosr_cosp);

    const sinp = 2*(this.w*this.y-this.z*this.x);
    const yaw  = Math.abs(sinp)>=1 ? Math.sign(sinp)*Math.PI/2 : Math.asin(sinp);

    const siny_cosp = 2*(this.w*this.z+this.x*this.y);
    const cosy_cosp = 1-2*(this.y*this.y+this.z*this.z);
    const roll = Math.atan2(siny_cosp, cosy_cosp);

    return {pitch, yaw, roll};
  }

  // ── AXIS EXTRACTION ───────────────────────────────────────────────────────
  getForward(){ return this.rotateVec(new Vec3(0,0,-1)); }
  getUp()     { return this.rotateVec(new Vec3(0,1, 0)); }
  getRight()  { return this.rotateVec(new Vec3(1,0, 0)); }

  clone()    { return new Quat(this.x,this.y,this.z,this.w); }
  toString() { return `Quat(${this.x.toFixed(3)},${this.y.toFixed(3)},${this.z.toFixed(3)},${this.w.toFixed(3)})`; }
}
