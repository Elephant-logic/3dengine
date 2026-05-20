import { Vec3 } from './vec3.js';
import { Quat }  from './quat.js';

/**
 * Mat4 — column-major 4×4 matrix
 * Compatible with WebGL (Float32Array column-major layout)
 *
 * Layout:  [m00 m10 m20 m30  m01 m11 m21 m31  m02 m12 m22 m32  m03 m13 m23 m33]
 * Index:   [ 0   1   2   3    4   5   6   7    8   9  10  11   12  13  14  15 ]
 */
export class Mat4 {
  constructor(){
    this.e = new Float32Array(16);
  }

  // ── FACTORIES ─────────────────────────────────────────────────────────────
  static identity(){
    const m = new Mat4();
    m.e[0]=1; m.e[5]=1; m.e[10]=1; m.e[15]=1;
    return m;
  }

  static translation(v){
    const m = Mat4.identity();
    m.e[12]=v.x; m.e[13]=v.y; m.e[14]=v.z;
    return m;
  }

  static scaling(v){
    const m = new Mat4();
    m.e[0]=v.x; m.e[5]=v.y; m.e[10]=v.z; m.e[15]=1;
    return m;
  }

  static rotationX(a){
    const m=Mat4.identity(), c=Math.cos(a), s=Math.sin(a);
    m.e[5]=c; m.e[6]=s; m.e[9]=-s; m.e[10]=c;
    return m;
  }
  static rotationY(a){
    const m=Mat4.identity(), c=Math.cos(a), s=Math.sin(a);
    m.e[0]=c; m.e[2]=-s; m.e[8]=s; m.e[10]=c;
    return m;
  }
  static rotationZ(a){
    const m=Mat4.identity(), c=Math.cos(a), s=Math.sin(a);
    m.e[0]=c; m.e[1]=s; m.e[4]=-s; m.e[5]=c;
    return m;
  }

  static fromQuat(q){
    const m = Mat4.identity();
    const x=q.x,y=q.y,z=q.z,w=q.w;
    const x2=x+x,y2=y+y,z2=z+z;
    const xx=x*x2,xy=x*y2,xz=x*z2;
    const yy=y*y2,yz=y*z2,zz=z*z2;
    const wx=w*x2,wy=w*y2,wz=w*z2;
    m.e[ 0]=1-(yy+zz); m.e[ 1]=xy+wz;     m.e[ 2]=xz-wy;
    m.e[ 4]=xy-wz;     m.e[ 5]=1-(xx+zz); m.e[ 6]=yz+wx;
    m.e[ 8]=xz+wy;     m.e[ 9]=yz-wx;     m.e[10]=1-(xx+yy);
    return m;
  }

  // TRS — translate * rotate * scale (most common transform)
  static TRS(pos, rot, scale){
    return Mat4.translation(pos)
               .mul(Mat4.fromQuat(rot))
               .mul(Mat4.scaling(scale));
  }

  // ── CAMERA MATRICES ───────────────────────────────────────────────────────
  static lookAt(eye, target, up){
    const f = target.sub(eye).normalise();
    const r = f.cross(up).normalise();
    const u = r.cross(f);
    const m = new Mat4();
    m.e[ 0]=r.x;  m.e[ 1]=u.x;  m.e[ 2]=-f.x; m.e[ 3]=0;
    m.e[ 4]=r.y;  m.e[ 5]=u.y;  m.e[ 6]=-f.y; m.e[ 7]=0;
    m.e[ 8]=r.z;  m.e[ 9]=u.z;  m.e[10]=-f.z; m.e[11]=0;
    m.e[12]=-r.dot(eye);
    m.e[13]=-u.dot(eye);
    m.e[14]= f.dot(eye);
    m.e[15]=1;
    return m;
  }

  static perspective(fovY, aspect, near, far){
    const f = 1 / Math.tan(fovY * 0.5);
    const rangeInv = 1 / (near - far);
    const m = new Mat4();
    m.e[ 0]=f/aspect;
    m.e[ 5]=f;
    m.e[10]=(near+far)*rangeInv;
    m.e[11]=-1;
    m.e[14]=near*far*rangeInv*2;
    m.e[15]=0;
    return m;
  }

  static orthographic(left, right, bottom, top, near, far){
    const m = new Mat4();
    m.e[ 0]=2/(right-left);
    m.e[ 5]=2/(top-bottom);
    m.e[10]=-2/(far-near);
    m.e[12]=-(right+left)/(right-left);
    m.e[13]=-(top+bottom)/(top-bottom);
    m.e[14]=-(far+near)  /(far-near);
    m.e[15]=1;
    return m;
  }

  // ── OPERATIONS ────────────────────────────────────────────────────────────
  mul(b){
    const a=this.e, c=b.e, r=new Mat4().e;
    for(let col=0;col<4;col++){
      for(let row=0;row<4;row++){
        let s=0;
        for(let k=0;k<4;k++) s+=a[k*4+row]*c[col*4+k];
        r[col*4+row]=s;
      }
    }
    const m=new Mat4(); m.e=new Float32Array(r); return m;
  }

  transpose(){
    const m=new Mat4(), e=this.e;
    for(let i=0;i<4;i++) for(let j=0;j<4;j++) m.e[j*4+i]=e[i*4+j];
    return m;
  }

  inverse(){
    const m=new Mat4(), e=this.e, out=m.e;
    const b00=e[0]*e[5]-e[1]*e[4], b01=e[0]*e[6]-e[2]*e[4];
    const b02=e[0]*e[7]-e[3]*e[4], b03=e[1]*e[6]-e[2]*e[5];
    const b04=e[1]*e[7]-e[3]*e[5], b05=e[2]*e[7]-e[3]*e[6];
    const b06=e[8]*e[13]-e[9]*e[12], b07=e[8]*e[14]-e[10]*e[12];
    const b08=e[8]*e[15]-e[11]*e[12], b09=e[9]*e[14]-e[10]*e[13];
    const b10=e[9]*e[15]-e[11]*e[13], b11=e[10]*e[15]-e[11]*e[14];
    let det=b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;
    if(Math.abs(det)<1e-10) return Mat4.identity();
    det=1/det;
    out[ 0]=( e[5]*b11-e[6]*b10+e[7]*b09)*det;
    out[ 1]=(-e[1]*b11+e[2]*b10-e[3]*b09)*det;
    out[ 2]=( e[13]*b05-e[14]*b04+e[15]*b03)*det;
    out[ 3]=(-e[9]*b05+e[10]*b04-e[11]*b03)*det;
    out[ 4]=(-e[4]*b11+e[6]*b08-e[7]*b07)*det;
    out[ 5]=( e[0]*b11-e[2]*b08+e[3]*b07)*det;
    out[ 6]=(-e[12]*b05+e[14]*b02-e[15]*b01)*det;
    out[ 7]=( e[8]*b05-e[10]*b02+e[11]*b01)*det;
    out[ 8]=( e[4]*b10-e[5]*b08+e[7]*b06)*det;
    out[ 9]=(-e[0]*b10+e[1]*b08-e[3]*b06)*det;
    out[10]=( e[12]*b04-e[13]*b02+e[15]*b00)*det;
    out[11]=(-e[8]*b04+e[9]*b02-e[11]*b00)*det;
    out[12]=(-e[4]*b09+e[5]*b07-e[6]*b06)*det;
    out[13]=( e[0]*b09-e[1]*b07+e[2]*b06)*det;
    out[14]=(-e[12]*b03+e[13]*b01-e[14]*b00)*det;
    out[15]=( e[8]*b03-e[9]*b01+e[10]*b00)*det;
    return m;
  }

  // Transform a Vec3 as a point (w=1) — includes translation
  transformPoint(v){
    const e=this.e;
    const w=e[3]*v.x+e[7]*v.y+e[11]*v.z+e[15]||1;
    return new Vec3(
      (e[0]*v.x+e[4]*v.y+e[ 8]*v.z+e[12])/w,
      (e[1]*v.x+e[5]*v.y+e[ 9]*v.z+e[13])/w,
      (e[2]*v.x+e[6]*v.y+e[10]*v.z+e[14])/w
    );
  }

  // Transform a Vec3 as a direction (w=0) — ignores translation
  transformDir(v){
    const e=this.e;
    return new Vec3(
      e[0]*v.x+e[4]*v.y+e[ 8]*v.z,
      e[1]*v.x+e[5]*v.y+e[ 9]*v.z,
      e[2]*v.x+e[6]*v.y+e[10]*v.z
    );
  }

  // Extract translation from TRS matrix
  getTranslation(){ return new Vec3(this.e[12],this.e[13],this.e[14]); }

  // Extract scale from TRS matrix
  getScale(){
    const e=this.e;
    return new Vec3(
      Math.sqrt(e[0]*e[0]+e[1]*e[1]+e[2]*e[2]),
      Math.sqrt(e[4]*e[4]+e[5]*e[5]+e[6]*e[6]),
      Math.sqrt(e[8]*e[8]+e[9]*e[9]+e[10]*e[10])
    );
  }

  clone(){ const m=new Mat4(); m.e.set(this.e); return m; }
  toFloat32(){ return this.e; }
}
