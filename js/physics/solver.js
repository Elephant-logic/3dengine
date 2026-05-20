import { Vec3 } from '../math/vec3.js';

/**
 * Sequential Impulse Constraint Solver
 *
 * For each contact:
 *   1. Compute relative velocity at contact point
 *   2. Compute impulse magnitude to resolve penetration + restitution
 *   3. Apply to both bodies, clamping to valid range (Coulomb friction cone)
 *   4. Iterate multiple times for stability
 *
 * Warm starting: reuse impulse from previous frame to converge faster
 */

const ITERATIONS = 8;       // solver iterations per step
const SLOP       = 0.005;   // penetration slop (don't correct tiny overlaps)
const BAUMGARTE  = 0.2;     // position correction fraction per step

export class Solver {
  constructor(){
    this.iterations = ITERATIONS;
    // Contact cache: key → {normalImpulse, tangentImpulse}
    this._cache = new Map();
  }

  solve(contacts, dt){
    if(!contacts.length) return;

    // Pre-step: compute effective mass denominators
    const prepared = contacts.map(c => this._prepare(c, dt));

    // Warm start — apply cached impulses from last frame
    for(let i=0;i<prepared.length;i++){
      this._warmStart(prepared[i]);
    }

    // Iterative solving
    for(let iter=0;iter<this.iterations;iter++){
      for(const p of prepared){
        this._solveContact(p, dt);
      }
    }

    // Update cache
    this._updateCache(prepared);
  }

  _prepare(c, dt){
    const a=c.bodyA, b=c.bodyB;
    const n=c.normal;
    const rA=c.pointA.sub(a.position);
    const rB=c.pointB.sub(b.position);

    // Relative velocity at contact
    const vA=a.linearVelocity.add(a.angularVelocity.cross(rA));
    const vB=b.linearVelocity.add(b.angularVelocity.cross(rB));
    const relVel=vA.sub(vB).dot(n);

    // Restitution — only apply if closing fast enough
    const restitution = relVel < -1.0 ? c.restitution : 0;

    // Baumgarte velocity bias for position correction
    const bias = -(BAUMGARTE/dt) * Math.max(0, c.depth - SLOP);

    // Effective mass: 1/(1/mA + 1/mB + (rA×n)·IA⁻¹·(rA×n) + (rB×n)·IB⁻¹·(rB×n))
    const rAnN = rA.cross(n);
    const rBnN = rB.cross(n);
    const iA   = a.applyInvInertia ? a.applyInvInertia(rAnN) : Vec3.zero();
    const iB   = b.applyInvInertia ? b.applyInvInertia(rBnN) : Vec3.zero();
    const massN = a._invMass + b._invMass + iA.dot(rAnN) + iB.dot(rBnN);
    const effMass = massN > 1e-10 ? 1/massN : 0;

    // Tangent directions for friction
    const t1 = tangent(n);
    const t2 = n.cross(t1);

    const effMassT = (dir) => {
      const rAt=rA.cross(dir), rBt=rB.cross(dir);
      const itA=a.applyInvInertia ? a.applyInvInertia(rAt) : Vec3.zero();
      const itB=b.applyInvInertia ? b.applyInvInertia(rBt) : Vec3.zero();
      const m=a._invMass+b._invMass+itA.dot(rAt)+itB.dot(rBt);
      return m>1e-10?1/m:0;
    };

    // Cache key from body pointers
    const key = `${a.entity?a.entity.id:0}_${b.entity?b.entity.id:0}`;

    return {
      c, n, rA, rB,
      effMass, effMassT1: effMassT(t1), effMassT2: effMassT(t2),
      t1, t2,
      bias,
      targetRelVel: -(1+restitution)*Math.min(relVel,0),
      normalImpulse: 0,
      tangentImpulse: [0,0],
      key,
    };
  }

  _warmStart(p){
    const {c, n, t1, t2, rA, rB} = p;
    const a=c.bodyA, b=c.bodyB;
    // Retrieve cached impulse
    const cached=this._cache.get(p.key);
    if(!cached) return;
    p.normalImpulse   = cached.normalImpulse  *0.9;
    p.tangentImpulse  = [...cached.tangentImpulse.map(x=>x*0.9)];
    const jN=n.scale(p.normalImpulse);
    const jT=t1.scale(p.tangentImpulse[0]).add(t2.scale(p.tangentImpulse[1]));
    const j=jN.add(jT);
    applyImpulse(a, b, j,   rA, rB);
    // (angular part handled inside applyImpulse)
  }

  _solveContact(p, dt){
    const {c, n, t1, t2, rA, rB} = p;
    const a=c.bodyA, b=c.bodyB;

    // Current relative velocity
    const vA=a.linearVelocity.add(a.angularVelocity.cross(rA));
    const vB=b.linearVelocity.add(b.angularVelocity.cross(rB));
    const vRel=vA.sub(vB);
    const vn=vRel.dot(n);

    // Normal impulse
    let jn = p.effMass * (p.targetRelVel - vn + p.bias);
    const prevN=p.normalImpulse;
    p.normalImpulse = Math.max(0, prevN+jn); // clamp: no pulling
    jn = p.normalImpulse - prevN;
    applyImpulse(a,b, n.scale(jn), rA, rB);

    // Friction impulses (Coulomb: |tangent| ≤ μ * |normal|)
    const maxFriction = c.friction * p.normalImpulse;
    for(let i=0;i<2;i++){
      const t    = i===0?t1:t2;
      const em   = i===0?p.effMassT1:p.effMassT2;
      const vt   = vRel.dot(t);
      let jt     = -em * vt;
      const prev = p.tangentImpulse[i];
      p.tangentImpulse[i] = Math.max(-maxFriction, Math.min(maxFriction, prev+jt));
      jt = p.tangentImpulse[i] - prev;
      applyImpulse(a,b, t.scale(jt), rA, rB);
    }
  }

  _updateCache(prepared){
    this._cache.clear();
    for(const p of prepared){
      this._cache.set(p.key, {
        normalImpulse:  p.normalImpulse,
        tangentImpulse: [...p.tangentImpulse],
      });
    }
  }

  clearCache(){ this._cache.clear(); }
}

// ── HELPERS ────────────────────────────────────────────────────────────────
function applyImpulse(a, b, j, rA, rB){
  if(a._invMass>0){
    a.linearVelocity.addSelf(j.scale(a._invMass));
    if(a.applyInvInertia) a.angularVelocity.addSelf(a.applyInvInertia(rA.cross(j)));
  }
  if(b._invMass>0){
    b.linearVelocity.subSelf(j.scale(b._invMass));
    if(b.applyInvInertia) b.angularVelocity.subSelf(b.applyInvInertia(rB.cross(j)));
  }
}

function tangent(n){
  // Pick most perpendicular basis vector
  const v = Math.abs(n.x)<0.9 ? new Vec3(1,0,0) : new Vec3(0,1,0);
  return n.cross(v).normalise();
}
