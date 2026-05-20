import { Vec3 } from '../math/vec3.js';
import { Quat }  from '../math/quat.js';
import { Mat4 }  from '../math/mat4.js';

/**
 * RigidBody — full 6DOF rigid body
 *
 * State: position, orientation, linear velocity, angular velocity
 * Derived: world inertia tensor (recomputed when orientation changes)
 *
 * Physics step (semi-implicit Euler):
 *   1. Accumulate forces + torques
 *   2. linearVel  += (force/mass  + gravity) * dt
 *   3. angularVel += invWorldInertia * (torque - ω×(I·ω)) * dt
 *   4. position   += linearVel  * dt
 *   5. orientation = integrate angular velocity into quaternion * dt
 *   6. Clear forces/torques
 */
export class RigidBody {
  constructor(){
    // ── TRANSFORM ──────────────────────────────────────────────────────────
    this.position    = new Vec3();
    this.orientation = Quat.identity();

    // ── VELOCITY ───────────────────────────────────────────────────────────
    this.linearVelocity  = new Vec3();
    this.angularVelocity = new Vec3();

    // ── MASS PROPERTIES ────────────────────────────────────────────────────
    this._mass     = 1.0;
    this._invMass  = 1.0;
    // Local inertia tensor diagonal (set by shape)
    this._localInertia    = new Vec3(1,1,1);
    this._localInvInertia = new Vec3(1,1,1);
    // World-space inertia (recomputed each frame)
    this._worldInvInertia = new Vec3(1,1,1); // diagonal in world space approx

    // ── MATERIAL ───────────────────────────────────────────────────────────
    this.restitution  = 0.3;  // bounciness 0-1
    this.friction     = 0.6;  // surface friction
    this.linearDamp   = 0.02; // velocity damping per second
    this.angularDamp  = 0.05;

    // ── FORCES (cleared each step) ─────────────────────────────────────────
    this._forceAccum  = new Vec3();
    this._torqueAccum = new Vec3();

    // ── FLAGS ──────────────────────────────────────────────────────────────
    this.isStatic    = false;  // true = infinite mass, never moves
    this.isKinematic = false;  // true = manually positioned, affects others
    this.isSleeping  = false;
    this.gravityScale= 1.0;
    this.layer       = 0x0001; // collision layer bitmask
    this.mask        = 0xFFFF; // layers this body collides with

    // ── SLEEP ──────────────────────────────────────────────────────────────
    this._sleepTimer = 0;
    this.sleepThreshold = 0.01; // velocity below this → sleep candidate

    // ── WORLD TRANSFORM CACHE ──────────────────────────────────────────────
    this._worldMatrix = Mat4.identity();
    this._worldDirty  = true;

    // ── SHAPE ──────────────────────────────────────────────────────────────
    this.shape = null; // set via setShape()

    // ── USER DATA ──────────────────────────────────────────────────────────
    this.entity = null; // back-reference to owning entity
  }

  // ── MASS ──────────────────────────────────────────────────────────────────
  get mass()    { return this._mass; }
  get invMass() { return this._invMass; }

  setMass(m){
    if(m<=0||this.isStatic){
      this._mass=0; this._invMass=0;
    } else {
      this._mass=m; this._invMass=1/m;
    }
    this._updateInertia();
  }

  setStatic(v){
    this.isStatic=v;
    if(v){ this._mass=0; this._invMass=0; }
  }

  // ── SHAPE ─────────────────────────────────────────────────────────────────
  setShape(shape){
    this.shape=shape;
    this._updateInertia();
  }

  _updateInertia(){
    if(!this.shape||this.isStatic||this._mass<=0){
      this._localInvInertia=new Vec3(0,0,0);
      return;
    }
    const I=this.shape.getInertiaTensor(this._mass);
    this._localInertia=I;
    this._localInvInertia=new Vec3(
      I.x>1e-10?1/I.x:0,
      I.y>1e-10?1/I.y:0,
      I.z>1e-10?1/I.z:0
    );
  }

  // ── WORLD INERTIA ─────────────────────────────────────────────────────────
  // Approximate: rotate local diagonal inertia to world space
  _updateWorldInertia(){
    // Full transform: I_world = R * I_local * R^T
    // For diagonal I, approximate by rotating the axes
    const R = Mat4.fromQuat(this.orientation);
    const li= this._localInvInertia;
    // Extract columns of R, scale by inv inertia, compute diagonal of R*invI*R^T
    this._worldInvInertia = new Vec3(
      li.x*R.e[0]*R.e[0]+li.y*R.e[4]*R.e[4]+li.z*R.e[8]*R.e[8],
      li.x*R.e[1]*R.e[1]+li.y*R.e[5]*R.e[5]+li.z*R.e[9]*R.e[9],
      li.x*R.e[2]*R.e[2]+li.y*R.e[6]*R.e[6]+li.z*R.e[10]*R.e[10]
    );
  }

  // Apply inverse world inertia to a torque vector → angular acceleration
  applyInvInertia(torque){
    this._updateWorldInertia();
    return new Vec3(
      torque.x*this._worldInvInertia.x,
      torque.y*this._worldInvInertia.y,
      torque.z*this._worldInvInertia.z
    );
  }

  // ── FORCE APPLICATION ─────────────────────────────────────────────────────
  addForce(f)  { this._forceAccum.addSelf(f); this.wake(); }
  addTorque(t) { this._torqueAccum.addSelf(t); this.wake(); }

  // Force at a world-space point (generates torque)
  addForceAtPoint(f, worldPoint){
    this.addForce(f);
    const r=worldPoint.sub(this.position);
    this.addTorque(r.cross(f));
  }

  // Impulse — instant velocity change (no dt)
  applyLinearImpulse(j){
    if(this._invMass<=0) return;
    this.linearVelocity.addSelf(j.scale(this._invMass));
    this.wake();
  }

  applyAngularImpulse(j){
    if(this.isStatic) return;
    this.angularVelocity.addSelf(this.applyInvInertia(j));
    this.wake();
  }

  applyImpulseAtPoint(j, worldPoint){
    this.applyLinearImpulse(j);
    const r=worldPoint.sub(this.position);
    this.applyAngularImpulse(r.cross(j));
  }

  // ── INTEGRATION ───────────────────────────────────────────────────────────
  integrateForces(dt, gravity){
    if(this.isStatic||this.isSleeping||this._invMass<=0) return;

    // Linear: a = F/m + gravity
    const linearAcc = this._forceAccum.scale(this._invMass)
                                       .add(gravity.scale(this.gravityScale));
    this.linearVelocity.addSelf(linearAcc.scale(dt));

    // Angular: α = I^-1 * (τ - ω×(I·ω))
    // Gyroscopic correction: τ_gyro = -ω × (I·ω)
    const Iw = new Vec3(
      this.angularVelocity.x * this._localInertia.x,
      this.angularVelocity.y * this._localInertia.y,
      this.angularVelocity.z * this._localInertia.z
    );
    const gyro   = this.angularVelocity.cross(Iw).negate();
    const angAcc = this.applyInvInertia(this._torqueAccum.add(gyro));
    this.angularVelocity.addSelf(angAcc.scale(dt));

    // Damping
    const ld = Math.pow(1-this.linearDamp,  dt);
    const ad = Math.pow(1-this.angularDamp, dt);
    this.linearVelocity.scaleSelf(ld);
    this.angularVelocity.scaleSelf(ad);

    this._clearForces();
  }

  integrateVelocities(dt){
    if(this.isStatic||this.isSleeping||this._invMass<=0) return;

    this.position.addSelf(this.linearVelocity.scale(dt));

    // Integrate angular velocity into orientation quaternion
    const w=this.angularVelocity;
    const wLen=w.length();
    if(wLen > 1e-10){
      const angle=wLen*dt;
      const axis=w.scale(1/wLen);
      const dq=Quat.fromAxisAngle(axis, angle);
      this.orientation=dq.mul(this.orientation).normalise();
    }

    this._worldDirty=true;
    this._updateSleep(dt);
  }

  // ── SLEEP ─────────────────────────────────────────────────────────────────
  _updateSleep(dt){
    const energy=this.linearVelocity.lengthSq()+this.angularVelocity.lengthSq();
    if(energy<this.sleepThreshold*this.sleepThreshold){
      this._sleepTimer+=dt;
      if(this._sleepTimer>0.5) this.sleep();
    } else {
      this._sleepTimer=0;
    }
  }

  sleep(){ this.isSleeping=true; this.linearVelocity.setSelf(0,0,0); this.angularVelocity.setSelf(0,0,0); }
  wake() { this.isSleeping=false; this._sleepTimer=0; }

  // ── TRANSFORM ─────────────────────────────────────────────────────────────
  getWorldMatrix(){
    if(this._worldDirty){
      this._worldMatrix = Mat4.TRS(this.position, this.orientation, new Vec3(1,1,1));
      this._worldDirty=false;
    }
    return this._worldMatrix;
  }

  worldToLocal(worldPoint){ return this.orientation.conjugate().rotateVec(worldPoint.sub(this.position)); }
  localToWorld(localPoint){ return this.orientation.rotateVec(localPoint).add(this.position); }

  // Velocity of a world-space point on this body
  velocityAtPoint(worldPoint){
    const r=worldPoint.sub(this.position);
    return this.linearVelocity.add(this.angularVelocity.cross(r));
  }

  _clearForces(){ this._forceAccum.setSelf(0,0,0); this._torqueAccum.setSelf(0,0,0); }
}
