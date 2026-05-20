import { Vec3 } from '../math/vec3.js';
import { Quat }  from '../math/quat.js';

/**
 * Joints constrain relative motion between two bodies
 * All joints use impulse-based solving (same pass as contact solver)
 */

// ─────────────────────────────────────────────────────────────────────────────
// BALL SOCKET — allows all rotation, constrains relative position
// ─────────────────────────────────────────────────────────────────────────────
export class BallSocketJoint {
  constructor(bodyA, bodyB, anchorWorld){
    this.bodyA   = bodyA;
    this.bodyB   = bodyB;
    // Store anchor in local space of each body
    this.localA  = bodyA.worldToLocal(anchorWorld);
    this.localB  = bodyB.worldToLocal(anchorWorld);
    this.enabled = true;
  }

  solve(dt){
    if(!this.enabled) return;
    const a=this.bodyA, b=this.bodyB;
    const worldA=a.localToWorld(this.localA);
    const worldB=b.localToWorld(this.localB);
    const error =worldA.sub(worldB);
    if(error.lengthSq()<1e-10) return;

    const rA=worldA.sub(a.position);
    const rB=worldB.sub(b.position);

    // Effective mass (3×3 diagonal approximation)
    for(let i=0;i<3;i++){
      const axis=['x','y','z'][i];
      const dir  = new Vec3(+(axis==='x'),+(axis==='y'),+(axis==='z'));
      const rAxn = rA.cross(dir);
      const rBxn = rB.cross(dir);
      const ia   = a.applyInvInertia ? a.applyInvInertia(rAxn) : Vec3.zero();
      const ib   = b.applyInvInertia ? b.applyInvInertia(rBxn) : Vec3.zero();
      const eff  = a._invMass+b._invMass+ia.dot(rAxn)+ib.dot(rBxn);
      if(eff<1e-10) continue;

      const lambda = -0.2*error[axis]/dt / eff;
      const j=dir.scale(lambda);
      if(a._invMass>0){
        a.linearVelocity.addSelf(j.scale(a._invMass));
        if(a.applyInvInertia) a.angularVelocity.addSelf(a.applyInvInertia(rA.cross(j)));
      }
      if(b._invMass>0){
        b.linearVelocity.subSelf(j.scale(b._invMass));
        if(b.applyInvInertia) b.angularVelocity.subSelf(b.applyInvInertia(rB.cross(j)));
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HINGE — constrains position + 2 rotation DOFs, leaves 1 free (the hinge axis)
// ─────────────────────────────────────────────────────────────────────────────
export class HingeJoint {
  constructor(bodyA, bodyB, anchorWorld, axisWorld){
    this.bodyA    = bodyA;
    this.bodyB    = bodyB;
    this.localA   = bodyA.worldToLocal(anchorWorld);
    this.localB   = bodyB.worldToLocal(anchorWorld);
    // Hinge axis in local space of each body
    this.axisLocalA = bodyA.orientation.conjugate().rotateVec(axisWorld.normalise());
    this.axisLocalB = bodyB.orientation.conjugate().rotateVec(axisWorld.normalise());
    this.enabled  = true;
    // Limits in radians (null = no limit)
    this.minAngle = null;
    this.maxAngle = null;
    // Motor
    this.motorEnabled    = false;
    this.motorTargetVel  = 0;
    this.motorMaxImpulse = 10;
  }

  solve(dt){
    if(!this.enabled) return;
    // Position constraint (ball-socket)
    const a=this.bodyA, b=this.bodyB;
    const worldA=a.localToWorld(this.localA);
    const worldB=b.localToWorld(this.localB);
    const posErr=worldA.sub(worldB).scale(-0.2/dt);

    // Angular constraint: lock 2 axes perpendicular to hinge
    const axA=a.orientation.rotateVec(this.axisLocalA);
    const axB=b.orientation.rotateVec(this.axisLocalB);
    const angErr=axA.cross(axB).scale(0.2/dt);

    // Apply position correction impulse (simplified)
    const pos=posErr;
    if(pos.lengthSq()>1e-10){
      const rA=worldA.sub(a.position), rB=worldB.sub(b.position);
      const j=pos.scale(1/(a._invMass+b._invMass+0.001));
      if(a._invMass>0) a.linearVelocity.addSelf(j.scale(a._invMass));
      if(b._invMass>0) b.linearVelocity.subSelf(j.scale(b._invMass));
    }

    // Angular error
    if(angErr.lengthSq()>1e-10){
      const eff=1/(1/(a._localInertia?.length()||1)+1/(b._localInertia?.length()||1));
      const aj=angErr.scale(eff*0.3);
      a.angularVelocity.addSelf(aj);
      b.angularVelocity.subSelf(aj);
    }

    // Motor
    if(this.motorEnabled){
      const relVel=a.angularVelocity.sub(b.angularVelocity).dot(axA);
      const velErr=this.motorTargetVel-relVel;
      const eff=1/((a._localInertia?.x||1)+(b._localInertia?.x||1));
      const imp=Math.max(-this.motorMaxImpulse, Math.min(this.motorMaxImpulse, velErr*eff));
      const mj=axA.scale(imp);
      a.angularVelocity.addSelf(mj);
      b.angularVelocity.subSelf(mj);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SPRING — spring-damper between two anchor points
// ─────────────────────────────────────────────────────────────────────────────
export class SpringJoint {
  constructor(bodyA, bodyB, anchorALocal, anchorBLocal, restLength=1){
    this.bodyA       = bodyA;
    this.bodyB       = bodyB;
    this.localA      = anchorALocal.clone();
    this.localB      = anchorBLocal.clone();
    this.restLength  = restLength;
    this.stiffness   = 200;  // N/m
    this.damping     = 20;   // Ns/m
    this.enabled     = true;
    this.breakForce  = Infinity; // joint breaks above this force
    this.broken      = false;
  }

  solve(dt){
    if(!this.enabled||this.broken) return;
    const a=this.bodyA, b=this.bodyB;
    const wA=a.localToWorld(this.localA);
    const wB=b.localToWorld(this.localB);
    const diff=wB.sub(wA);
    const dist=diff.length();
    if(dist<1e-10) return;
    const dir=diff.scale(1/dist);

    // Spring force: F = -k*(dist-rest) - d*(rel_vel·dir)
    const relVel=b.velocityAtPoint(wB).sub(a.velocityAtPoint(wA)).dot(dir);
    const force=this.stiffness*(dist-this.restLength)+this.damping*relVel;

    if(Math.abs(force)>this.breakForce){ this.broken=true; return; }

    const j=dir.scale(force*dt);
    if(a._invMass>0){ a.applyImpulseAtPoint(j,wA); }
    if(b._invMass>0){ b.applyImpulseAtPoint(j.negate(),wB); }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DISTANCE — hard distance constraint (rod) — no stretch allowed
// ─────────────────────────────────────────────────────────────────────────────
export class DistanceJoint {
  constructor(bodyA, bodyB, anchorAWorld, anchorBWorld){
    this.bodyA  = bodyA;
    this.bodyB  = bodyB;
    this.localA = bodyA.worldToLocal(anchorAWorld);
    this.localB = bodyB.worldToLocal(anchorBWorld);
    const diff  = anchorBWorld.sub(anchorAWorld);
    this.length = diff.length();
    this.enabled= true;
  }

  solve(dt){
    if(!this.enabled) return;
    const a=this.bodyA, b=this.bodyB;
    const wA=a.localToWorld(this.localA);
    const wB=b.localToWorld(this.localB);
    const diff=wB.sub(wA);
    const dist=diff.length();
    const err=dist-this.length;
    if(Math.abs(err)<0.001) return;
    const dir=dist<1e-10?new Vec3(0,1,0):diff.scale(1/dist);

    const rA=wA.sub(a.position), rB=wB.sub(b.position);
    const rAxD=rA.cross(dir), rBxD=rB.cross(dir);
    const iA=a.applyInvInertia?a.applyInvInertia(rAxD):Vec3.zero();
    const iB=b.applyInvInertia?b.applyInvInertia(rBxD):Vec3.zero();
    const eff=a._invMass+b._invMass+iA.dot(rAxD)+iB.dot(rBxD);
    if(eff<1e-10) return;

    const lambda = -0.3*err/dt/eff;
    const j=dir.scale(lambda);
    if(a._invMass>0){ a.applyImpulseAtPoint(j,wA); }
    if(b._invMass>0){ b.applyImpulseAtPoint(j.negate(),wB); }
  }
}
