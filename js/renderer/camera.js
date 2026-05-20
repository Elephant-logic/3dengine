import { Vec3 } from '../math/vec3.js';
import { Quat }  from '../math/quat.js';
import { Mat4 }  from '../math/mat4.js';

/**
 * Camera — manages view + projection matrices, frustum culling
 *
 * Usage:
 *   const cam = new Camera();
 *   cam.position = new Vec3(0, 5, 10);
 *   cam.lookAt(new Vec3(0,0,0));
 *   cam.setAspect(canvas.width/canvas.height);
 *   // In render loop:
 *   shader.setMat4('uView', cam.viewMatrix);
 *   shader.setMat4('uProj', cam.projMatrix);
 */
export class Camera {
  constructor(){
    this.position    = new Vec3(0, 5, 10);
    this.orientation = Quat.identity();

    // Projection params
    this.fovY   = Math.PI/3;    // 60 degrees
    this.aspect = 16/9;
    this.near   = 0.1;
    this.far    = 1000;
    this.isOrtho= false;

    // Ortho params
    this.orthoSize = 10;

    this._viewDirty = true;
    this._projDirty = true;
    this._viewMatrix = Mat4.identity();
    this._projMatrix = Mat4.identity();
    this._vpMatrix   = Mat4.identity();
    this._frustum    = null;
  }

  // ── PROJECTION ────────────────────────────────────────────────────────────
  setAspect(aspect){ this.aspect=aspect; this._projDirty=true; }
  setFOV(fovYRadians){ this.fovY=fovYRadians; this._projDirty=true; }

  get projMatrix(){
    if(this._projDirty){
      if(this.isOrtho){
        const h=this.orthoSize, w=h*this.aspect;
        this._projMatrix=Mat4.orthographic(-w,w,-h,h,this.near,this.far);
      } else {
        this._projMatrix=Mat4.perspective(this.fovY,this.aspect,this.near,this.far);
      }
      this._projDirty=false;
      this._vpDirty=true;
    }
    return this._projMatrix;
  }

  // ── VIEW ──────────────────────────────────────────────────────────────────
  get viewMatrix(){
    if(this._viewDirty){
      // View = inverse of camera world transform
      const R = Mat4.fromQuat(this.orientation.conjugate());
      const T = Mat4.translation(this.position.negate());
      this._viewMatrix = R.mul(T);
      this._viewDirty=false;
      this._vpDirty=true;
    }
    return this._viewMatrix;
  }

  get vpMatrix(){
    if(this._vpDirty){
      this._vpMatrix=this.projMatrix.mul(this.viewMatrix);
      this._vpDirty=false;
    }
    return this._vpMatrix;
  }

  // ── ORIENTATION HELPERS ───────────────────────────────────────────────────
  lookAt(target, up=new Vec3(0,1,0)){
    const f=target.sub(this.position).normalise();
    const r=f.cross(up).normalise();
    const u=r.cross(f);
    // Build rotation matrix from axes
    const m=Mat4.identity();
    m.e[0]=r.x; m.e[4]=r.y; m.e[8] =r.z;
    m.e[1]=u.x; m.e[5]=u.y; m.e[9] =u.z;
    m.e[2]=-f.x;m.e[6]=-f.y;m.e[10]=-f.z;
    // Extract quaternion
    this.orientation=matToQuat(m);
    this._viewDirty=true;
  }

  setPosition(p){ this.position=p.clone(); this._viewDirty=true; }
  setOrientation(q){ this.orientation=q.clone(); this._viewDirty=true; }

  // Fly camera: rotate by euler delta (yaw/pitch)
  rotateYaw(rad){
    const q=Quat.fromAxisAngle(new Vec3(0,1,0),rad);
    this.orientation=q.mul(this.orientation).normalise();
    this._viewDirty=true;
  }
  rotatePitch(rad){
    const right=this.orientation.getRight();
    const q=Quat.fromAxisAngle(right,rad);
    this.orientation=q.mul(this.orientation).normalise();
    this._viewDirty=true;
  }

  // Move relative to camera orientation
  moveForward(d){ this.position.addSelf(this.orientation.getForward().scale(d)); this._viewDirty=true; }
  moveRight(d)  { this.position.addSelf(this.orientation.getRight().scale(d)); this._viewDirty=true; }
  moveUp(d)     { this.position.addSelf(new Vec3(0,1,0).scale(d)); this._viewDirty=true; }

  // Accessors
  get forward() { return this.orientation.getForward(); }
  get right()   { return this.orientation.getRight(); }
  get up()      { return this.orientation.getUp(); }

  // ── FRUSTUM CULLING ───────────────────────────────────────────────────────
  _buildFrustum(){
    const vp=this.vpMatrix.e;
    // Extract 6 planes from VP matrix (Gribb/Hartmann method)
    this._frustumPlanes=[
      normPlane( vp[3]+vp[0], vp[7]+vp[4], vp[11]+vp[ 8], vp[15]+vp[12]), // left
      normPlane( vp[3]-vp[0], vp[7]-vp[4], vp[11]-vp[ 8], vp[15]-vp[12]), // right
      normPlane( vp[3]+vp[1], vp[7]+vp[5], vp[11]+vp[ 9], vp[15]+vp[13]), // bottom
      normPlane( vp[3]-vp[1], vp[7]-vp[5], vp[11]-vp[ 9], vp[15]-vp[13]), // top
      normPlane( vp[3]+vp[2], vp[7]+vp[6], vp[11]+vp[10], vp[15]+vp[14]), // near
      normPlane( vp[3]-vp[2], vp[7]-vp[6], vp[11]-vp[10], vp[15]-vp[14]), // far
    ];
  }

  // Test AABB against frustum — returns false if fully outside
  frustumTestAABB(min, max){
    if(!this._frustumPlanes) this._buildFrustum();
    for(const [nx,ny,nz,d] of this._frustumPlanes){
      const px=nx>0?max.x:min.x;
      const py=ny>0?max.y:min.y;
      const pz=nz>0?max.z:min.z;
      if(nx*px+ny*py+nz*pz+d<0) return false;
    }
    return true;
  }

  frustumTestSphere(centre, radius){
    if(!this._frustumPlanes) this._buildFrustum();
    for(const [nx,ny,nz,d] of this._frustumPlanes){
      if(nx*centre.x+ny*centre.y+nz*centre.z+d<-radius) return false;
    }
    return true;
  }

  // Call after VP changes
  updateFrustum(){ this._frustumPlanes=null; this._buildFrustum(); }

  // ── SCREEN → WORLD RAY ───────────────────────────────────────────────────
  // ndcX,ndcY in [-1,1], returns Ray from camera through that screen point
  screenRay(ndcX, ndcY){
    const {Ray}=await import('../math/primitives.js').catch(()=>({Ray:null}));
    // Unproject two points at different depths
    const invVP=this.vpMatrix.inverse();
    const near4=invVP.transformPoint(new Vec3(ndcX,ndcY,-1));
    const far4 =invVP.transformPoint(new Vec3(ndcX,ndcY, 1));
    const dir  =far4.sub(near4).normalise();
    return { origin:near4, direction:dir };
  }
}

// ── HELPERS ────────────────────────────────────────────────────────────────
function normPlane(a,b,c,d){
  const l=Math.sqrt(a*a+b*b+c*c);
  return [a/l,b/l,c/l,d/l];
}

function matToQuat(m){
  const e=m.e;
  const trace=e[0]+e[5]+e[10];
  if(trace>0){
    const s=0.5/Math.sqrt(trace+1);
    return new Quat((e[6]-e[9])*s,(e[8]-e[2])*s,(e[1]-e[4])*s,0.25/s);
  } else if(e[0]>e[5]&&e[0]>e[10]){
    const s=2*Math.sqrt(1+e[0]-e[5]-e[10]);
    return new Quat(0.25*s,(e[1]+e[4])/s,(e[8]+e[2])/s,(e[6]-e[9])/s);
  } else if(e[5]>e[10]){
    const s=2*Math.sqrt(1+e[5]-e[0]-e[10]);
    return new Quat((e[1]+e[4])/s,0.25*s,(e[6]+e[9])/s,(e[8]-e[2])/s);
  } else {
    const s=2*Math.sqrt(1+e[10]-e[0]-e[5]);
    return new Quat((e[8]+e[2])/s,(e[6]+e[9])/s,0.25*s,(e[1]-e[4])/s);
  }
}
