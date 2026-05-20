/**
 * Vec3 — 3D vector with full math operations
 * All methods return new Vec3 unless named *Self (mutates in place)
 * Static methods operate without allocation where possible
 */
export class Vec3 {
  constructor(x=0, y=0, z=0){ this.x=x; this.y=y; this.z=z; }

  // ── FACTORIES ─────────────────────────────────────────────────────────────
  static zero()       { return new Vec3(0,0,0); }
  static one()        { return new Vec3(1,1,1); }
  static up()         { return new Vec3(0,1,0); }
  static right()      { return new Vec3(1,0,0); }
  static forward()    { return new Vec3(0,0,-1); }
  static from(v)      { return new Vec3(v.x,v.y,v.z); }
  static fromArray(a) { return new Vec3(a[0],a[1],a[2]); }

  // ── BASIC OPERATIONS ──────────────────────────────────────────────────────
  add(v)    { return new Vec3(this.x+v.x, this.y+v.y, this.z+v.z); }
  sub(v)    { return new Vec3(this.x-v.x, this.y-v.y, this.z-v.z); }
  scale(s)  { return new Vec3(this.x*s,   this.y*s,   this.z*s); }
  negate()  { return new Vec3(-this.x,   -this.y,    -this.z); }
  mul(v)    { return new Vec3(this.x*v.x, this.y*v.y, this.z*v.z); } // component-wise

  // Mutating versions (avoid allocation in hot loops)
  addSelf(v)   { this.x+=v.x; this.y+=v.y; this.z+=v.z; return this; }
  subSelf(v)   { this.x-=v.x; this.y-=v.y; this.z-=v.z; return this; }
  scaleSelf(s) { this.x*=s;   this.y*=s;   this.z*=s;   return this; }
  setSelf(x,y,z){ this.x=x; this.y=y; this.z=z; return this; }
  copyFrom(v)  { this.x=v.x; this.y=v.y; this.z=v.z; return this; }

  // ── DOT / CROSS / LENGTH ──────────────────────────────────────────────────
  dot(v)    { return this.x*v.x + this.y*v.y + this.z*v.z; }
  cross(v)  {
    return new Vec3(
      this.y*v.z - this.z*v.y,
      this.z*v.x - this.x*v.z,
      this.x*v.y - this.y*v.x
    );
  }
  lengthSq(){ return this.x*this.x + this.y*this.y + this.z*this.z; }
  length()  { return Math.sqrt(this.lengthSq()); }

  normalise(){
    const l = this.length();
    if(l < 1e-10) return new Vec3(0,0,0);
    return this.scale(1/l);
  }
  normaliseSelf(){
    const l = this.length();
    if(l > 1e-10) this.scaleSelf(1/l);
    return this;
  }

  // ── INTERPOLATION ─────────────────────────────────────────────────────────
  lerp(v, t){ return new Vec3(
    this.x + (v.x-this.x)*t,
    this.y + (v.y-this.y)*t,
    this.z + (v.z-this.z)*t
  ); }

  // ── DISTANCE ──────────────────────────────────────────────────────────────
  distTo(v)   { return this.sub(v).length(); }
  distSqTo(v) { return this.sub(v).lengthSq(); }

  // ── REFLECTION / PROJECTION ───────────────────────────────────────────────
  reflect(normal){
    // r = v - 2(v·n)n
    return this.sub(normal.scale(2 * this.dot(normal)));
  }
  projectOnto(v){
    const d = v.dot(v);
    if(d < 1e-10) return Vec3.zero();
    return v.scale(this.dot(v) / d);
  }

  // ── ANGLE ─────────────────────────────────────────────────────────────────
  angleTo(v){
    const d = this.dot(v) / (this.length() * v.length());
    return Math.acos(Math.max(-1, Math.min(1, d)));
  }

  // ── UTILITIES ─────────────────────────────────────────────────────────────
  clone()         { return new Vec3(this.x, this.y, this.z); }
  toArray()       { return [this.x, this.y, this.z]; }
  toFloat32()     { return new Float32Array([this.x, this.y, this.z]); }
  equals(v, eps=1e-6){ return Math.abs(this.x-v.x)<eps && Math.abs(this.y-v.y)<eps && Math.abs(this.z-v.z)<eps; }
  isZero(eps=1e-10)  { return this.lengthSq() < eps*eps; }
  toString()      { return `Vec3(${this.x.toFixed(3)}, ${this.y.toFixed(3)}, ${this.z.toFixed(3)})`; }

  // ── STATIC HELPERS ────────────────────────────────────────────────────────
  static dot(a,b)   { return a.x*b.x + a.y*b.y + a.z*b.z; }
  static cross(a,b) { return a.cross(b); }
  static lerp(a,b,t){ return a.lerp(b,t); }
  static dist(a,b)  { return a.distTo(b); }

  // Clamp each component
  clamp(min, max){
    return new Vec3(
      Math.max(min, Math.min(max, this.x)),
      Math.max(min, Math.min(max, this.y)),
      Math.max(min, Math.min(max, this.z))
    );
  }

  // Min/max component-wise
  static min(a,b){ return new Vec3(Math.min(a.x,b.x), Math.min(a.y,b.y), Math.min(a.z,b.z)); }
  static max(a,b){ return new Vec3(Math.max(a.x,b.x), Math.max(a.y,b.y), Math.max(a.z,b.z)); }

  // Swizzle helpers
  get xy() { return [this.x, this.y]; }
  get xz() { return [this.x, this.z]; }
}
