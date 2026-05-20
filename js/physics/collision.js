import { Vec3 }        from '../math/vec3.js';
import { Mat4 }        from '../math/mat4.js';
import { ShapeType }   from './shapes.js';

/**
 * Contact — result of narrowphase collision detection
 * All positions in world space
 */
export class Contact {
  constructor(){
    this.bodyA      = null;
    this.bodyB      = null;
    this.normal     = new Vec3(0,1,0); // points from B into A
    this.depth      = 0;               // penetration depth (positive = overlapping)
    this.pointA     = new Vec3();      // contact point on body A surface
    this.pointB     = new Vec3();      // contact point on body B surface
    this.restitution= 0;
    this.friction   = 0;
    // Cached impulse for warm starting
    this.normalImpulse  = 0;
    this.tangentImpulse = [0,0];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NARROWPHASE — dispatch table for each shape pair
// ─────────────────────────────────────────────────────────────────────────────
export function testPair(bodyA, bodyB){
  const sa=bodyA.shape, sb=bodyB.shape;
  if(!sa||!sb) return null;

  const ta=sa.type, tb=sb.type;

  // Sphere-Sphere
  if(ta===ShapeType.SPHERE&&tb===ShapeType.SPHERE)
    return sphereSphere(bodyA,bodyB);

  // Sphere-Box (either order)
  if(ta===ShapeType.SPHERE&&tb===ShapeType.BOX)
    return sphereBox(bodyA,bodyB);
  if(ta===ShapeType.BOX&&tb===ShapeType.SPHERE){
    const c=sphereBox(bodyB,bodyA);
    if(c){ c.normal=c.normal.negate(); [c.bodyA,c.bodyB]=[c.bodyB,c.bodyA]; [c.pointA,c.pointB]=[c.pointB,c.pointA]; }
    return c;
  }

  // Sphere-Plane
  if(ta===ShapeType.SPHERE&&tb===ShapeType.PLANE)
    return spherePlane(bodyA,bodyB);
  if(ta===ShapeType.PLANE&&tb===ShapeType.SPHERE){
    const c=spherePlane(bodyB,bodyA);
    if(c){ c.normal=c.normal.negate(); [c.bodyA,c.bodyB]=[c.bodyB,c.bodyA]; }
    return c;
  }

  // Box-Plane
  if(ta===ShapeType.BOX&&tb===ShapeType.PLANE)
    return boxPlane(bodyA,bodyB);
  if(ta===ShapeType.PLANE&&tb===ShapeType.BOX){
    const c=boxPlane(bodyB,bodyA);
    if(c){ c.normal=c.normal.negate(); [c.bodyA,c.bodyB]=[c.bodyB,c.bodyA]; }
    return c;
  }

  // Box-Box (SAT)
  if(ta===ShapeType.BOX&&tb===ShapeType.BOX)
    return boxBox(bodyA,bodyB);

  // Capsule-Plane
  if(ta===ShapeType.CAPSULE&&tb===ShapeType.PLANE)
    return capsulePlane(bodyA,bodyB);
  if(ta===ShapeType.PLANE&&tb===ShapeType.CAPSULE){
    const c=capsulePlane(bodyB,bodyA);
    if(c){ c.normal=c.normal.negate(); [c.bodyA,c.bodyB]=[c.bodyB,c.bodyA]; }
    return c;
  }

  // Capsule-Sphere
  if(ta===ShapeType.CAPSULE&&tb===ShapeType.SPHERE)
    return capsuleSphere(bodyA,bodyB);
  if(ta===ShapeType.SPHERE&&tb===ShapeType.CAPSULE){
    const c=capsuleSphere(bodyB,bodyA);
    if(c){ c.normal=c.normal.negate(); [c.bodyA,c.bodyB]=[c.bodyB,c.bodyA]; }
    return c;
  }

  return null; // unsupported pair
}

// ─────────────────────────────────────────────────────────────────────────────
function makeContact(bodyA, bodyB, normal, depth, pointA, pointB){
  const c=new Contact();
  c.bodyA=bodyA; c.bodyB=bodyB;
  c.normal=normal; c.depth=depth;
  c.pointA=pointA; c.pointB=pointB;
  c.restitution=Math.max(bodyA.restitution, bodyB.restitution);
  c.friction   =Math.sqrt(bodyA.friction * bodyB.friction);
  return c;
}

// ─────────────────────────────────────────────────────────────────────────────
// SPHERE — SPHERE
// ─────────────────────────────────────────────────────────────────────────────
function sphereSphere(a, b){
  const pa=a.position.add(a.shape.offset);
  const pb=b.position.add(b.shape.offset);
  const diff=pa.sub(pb);
  const dist=diff.length();
  const sumR=a.shape.radius+b.shape.radius;
  if(dist>=sumR) return null;
  const depth=sumR-dist;
  const normal=dist<1e-10 ? new Vec3(0,1,0) : diff.scale(1/dist);
  return makeContact(a,b,normal,depth,
    pa.sub(normal.scale(a.shape.radius)),
    pb.add(normal.scale(b.shape.radius))
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SPHERE — BOX
// ─────────────────────────────────────────────────────────────────────────────
function sphereBox(sphere, box){
  const sPos=sphere.position.add(sphere.shape.offset);
  const bPos=box.position.add(box.shape.offset);
  // Transform sphere centre to box local space
  const local=box.orientation.conjugate().rotateVec(sPos.sub(bPos));
  const h=box.shape.halfExtents;
  // Clamp to box extents
  const closest=new Vec3(
    Math.max(-h.x,Math.min(h.x,local.x)),
    Math.max(-h.y,Math.min(h.y,local.y)),
    Math.max(-h.z,Math.min(h.z,local.z))
  );
  const diff=local.sub(closest);
  const dist=diff.length();
  if(dist>=sphere.shape.radius) return null;
  // Transform back to world space
  const worldClosest=box.orientation.rotateVec(closest).add(bPos);
  const normal=dist<1e-10
    ? box.orientation.rotateVec(new Vec3(0,1,0)) // fallback — push up
    : sPos.sub(worldClosest).normalise();
  const depth=sphere.shape.radius-dist;
  return makeContact(sphere,box,normal,depth,
    sPos.sub(normal.scale(sphere.shape.radius)),
    worldClosest
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SPHERE — PLANE
// ─────────────────────────────────────────────────────────────────────────────
function spherePlane(sphere, plane){
  const p=sphere.position.add(sphere.shape.offset);
  const dist=p.dot(plane.shape.normal)-plane.shape.d;
  if(dist>=sphere.shape.radius) return null;
  const depth=sphere.shape.radius-dist;
  const normal=plane.shape.normal.clone();
  return makeContact(sphere,plane,normal,depth,
    p.sub(normal.scale(sphere.shape.radius)),
    p.sub(normal.scale(dist))
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BOX — PLANE (generate up to 4 contacts)
// Returns the deepest contact only for simplicity
// ─────────────────────────────────────────────────────────────────────────────
function boxPlane(box, plane){
  const n=plane.shape.normal;
  const d=plane.shape.d;
  const corners=box.shape.getCorners();
  let deepest=null, maxDepth=-Infinity;
  for(const local of corners){
    const world=box.orientation.rotateVec(local).add(box.position);
    const dist=world.dot(n)-d;
    if(dist<0&&-dist>maxDepth){
      maxDepth=-dist;
      deepest=world;
    }
  }
  if(!deepest) return null;
  return makeContact(box,plane,n.clone(),maxDepth,
    deepest.add(n.scale(maxDepth)),
    deepest
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BOX — BOX  (SAT — Separating Axis Theorem)
// ─────────────────────────────────────────────────────────────────────────────
function boxBox(a, b){
  // Get axes: 3 face normals from A, 3 from B, 9 edge cross products
  const Ra=Mat4.fromQuat(a.orientation);
  const Rb=Mat4.fromQuat(b.orientation);

  const axesA=[ colVec(Ra,0), colVec(Ra,1), colVec(Ra,2) ];
  const axesB=[ colVec(Rb,0), colVec(Rb,1), colVec(Rb,2) ];

  const d=b.position.sub(a.position);
  let minDepth=Infinity, bestAxis=null, bestAxisIdx=-1;

  const axes=[...axesA,...axesB];
  for(const ab of axesA) for(const bb of axesB){
    const crossed=ab.cross(bb);
    if(crossed.lengthSq()>1e-10) axes.push(crossed.normalise());
  }

  for(let i=0;i<axes.length;i++){
    const ax=axes[i];
    if(ax.lengthSq()<1e-10) continue;
    const pA=projectBox(ax,axesA,a.shape.halfExtents);
    const pB=projectBox(ax,axesB,b.shape.halfExtents);
    const dProj=Math.abs(d.dot(ax));
    const depth=pA+pB-dProj;
    if(depth<0) return null; // separating axis found
    if(depth<minDepth){ minDepth=depth; bestAxis=ax; bestAxisIdx=i; }
  }

  if(!bestAxis) return null;

  // Ensure normal points from B to A
  let normal=bestAxis.clone();
  if(normal.dot(d)>0) normal=normal.negate();

  // Approximate contact point — midpoint of overlap
  const pointA=a.position.sub(normal.scale(minDepth*0.5));
  const pointB=b.position.add(normal.scale(minDepth*0.5));

  return makeContact(a,b,normal,minDepth,pointA,pointB);
}

function colVec(m, col){ return new Vec3(m.e[col*4],m.e[col*4+1],m.e[col*4+2]); }

function projectBox(axis, axes, halfExtents){
  return Math.abs(axes[0].dot(axis))*halfExtents.x +
         Math.abs(axes[1].dot(axis))*halfExtents.y +
         Math.abs(axes[2].dot(axis))*halfExtents.z;
}

// ─────────────────────────────────────────────────────────────────────────────
// CAPSULE — PLANE
// ─────────────────────────────────────────────────────────────────────────────
function capsulePlane(capsule, plane){
  const n=plane.shape.normal, d=plane.shape.d;
  const seg=capsule.shape.getSegment();
  const wa=capsule.orientation.rotateVec(seg.a).add(capsule.position);
  const wb=capsule.orientation.rotateVec(seg.b).add(capsule.position);
  const da=wa.dot(n)-d, db=wb.dot(n)-d;
  const r=capsule.shape.radius;
  const deepest=da<db?wa:wb;
  const dist=Math.min(da,db);
  if(dist>=r) return null;
  const depth=r-dist;
  return makeContact(capsule,plane,n.clone(),depth,
    deepest.sub(n.scale(r)),
    deepest.sub(n.scale(dist))
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CAPSULE — SPHERE
// ─────────────────────────────────────────────────────────────────────────────
function capsuleSphere(capsule, sphere){
  const seg=capsule.shape.getSegment();
  const wa=capsule.orientation.rotateVec(seg.a).add(capsule.position);
  const wb=capsule.orientation.rotateVec(seg.b).add(capsule.position);
  const sp=sphere.position.add(sphere.shape.offset);
  // Closest point on segment to sphere centre
  const ab=wb.sub(wa);
  const t=Math.max(0,Math.min(1,sp.sub(wa).dot(ab)/ab.dot(ab)));
  const closest=wa.add(ab.scale(t));
  const diff=sp.sub(closest);
  const dist=diff.length();
  const sumR=capsule.shape.radius+sphere.shape.radius;
  if(dist>=sumR) return null;
  const normal=dist<1e-10?new Vec3(0,1,0):diff.scale(1/dist);
  const depth=sumR-dist;
  return makeContact(capsule,sphere,normal,depth,
    closest.add(normal.scale(capsule.shape.radius)),
    sp.sub(normal.scale(sphere.shape.radius))
  );
}
