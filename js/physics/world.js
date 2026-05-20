import { Vec3 }     from '../math/vec3.js';
import { Ray, AABB } from '../math/primitives.js';
import { testPair }  from './collision.js';
import { Solver }    from './solver.js';
import { RigidBody } from './rigidbody.js';

/**
 * PhysicsWorld — the main physics simulation
 *
 * Usage:
 *   const world = new PhysicsWorld();
 *   world.gravity = new Vec3(0, -9.81, 0);
 *   const body = world.createBody();
 *   body.setShape(new SphereShape(0.5));
 *   body.setMass(1);
 *   body.position.set(0, 5, 0);
 *   // Each frame:
 *   world.step(dt);
 */
export class PhysicsWorld {
  constructor(){
    this.gravity    = new Vec3(0, -9.81, 0);
    this.bodies     = [];
    this._solver    = new Solver();
    this._contacts  = [];

    // Fixed timestep
    this.fixedDt    = 1/60;
    this._accumulator = 0;

    // Broadphase: simple spatial hash
    this._spatialHash = new SpatialHash(10); // 10 unit cell size

    // Callbacks
    this.onContact  = null; // (contactA, contactB) => void
  }

  createBody(opts={}){
    const b=new RigidBody();
    if(opts.position) b.position.copyFrom(opts.position);
    if(opts.mass!==undefined) b.setMass(opts.mass);
    if(opts.shape){ b.setShape(opts.shape); }
    if(opts.isStatic) b.setStatic(true);
    if(opts.restitution!==undefined) b.restitution=opts.restitution;
    if(opts.friction!==undefined)    b.friction=opts.friction;
    this.bodies.push(b);
    return b;
  }

  removeBody(body){
    const i=this.bodies.indexOf(body);
    if(i>=0) this.bodies.splice(i,1);
  }

  // ── STEP ─────────────────────────────────────────────────────────────────
  // Call with real dt — internally uses fixed substeps
  update(realDt){
    this._accumulator+=Math.min(realDt, 0.1); // cap at 100ms
    while(this._accumulator>=this.fixedDt){
      this._step(this.fixedDt);
      this._accumulator-=this.fixedDt;
    }
  }

  _step(dt){
    // 1. Integrate forces → velocities
    for(const b of this.bodies){
      if(!b.isStatic&&!b.isSleeping) b.integrateForces(dt, this.gravity);
    }

    // 2. Broadphase — find candidate pairs
    const pairs = this._broadphase();

    // 3. Narrowphase — generate contacts
    this._contacts=[];
    for(const [a,b] of pairs){
      const c=testPair(a,b);
      if(c){
        this._contacts.push(c);
        if(this.onContact) this.onContact(c.bodyA, c.bodyB, c);
        c.bodyA.wake(); c.bodyB.wake();
      }
    }

    // 4. Solve constraints
    this._solver.solve(this._contacts, dt);

    // 5. Integrate velocities → positions
    for(const b of this.bodies){
      if(!b.isStatic&&!b.isSleeping) b.integrateVelocities(dt);
    }
  }

  // ── BROADPHASE ────────────────────────────────────────────────────────────
  _broadphase(){
    const pairs=[];
    const n=this.bodies.length;
    // Simple O(n²) for now — replace with spatial hash for large scenes
    for(let i=0;i<n;i++){
      const a=this.bodies[i];
      if(!a.shape) continue;
      const aabb_a=a.shape.getAABB(a.position,a.orientation);
      for(let j=i+1;j<n;j++){
        const b=this.bodies[j];
        if(!b.shape) continue;
        if(a.isStatic&&b.isStatic) continue;
        if(a.isSleeping&&b.isSleeping) continue;
        // Layer mask check
        if(!(a.layer&b.mask)||!(b.layer&a.mask)) continue;
        const aabb_b=b.shape.getAABB(b.position,b.orientation);
        if(aabb_a.intersects(aabb_b)) pairs.push([a,b]);
      }
    }
    return pairs;
  }

  // ── RAYCAST ───────────────────────────────────────────────────────────────
  raycast(origin, direction, maxDist=Infinity, layerMask=0xFFFF){
    const ray=new Ray(origin, direction);
    let closest=null, closestT=maxDist;

    for(const body of this.bodies){
      if(!body.shape) continue;
      if(!(body.layer&layerMask)) continue;

      // AABB pretest
      const aabb=body.shape.getAABB(body.position, body.orientation);
      const aabbT=ray.intersectAABB(aabb.min, aabb.max);
      if(aabbT===null||aabbT>closestT) continue;

      // Shape-specific test
      let t=null;
      const {type}=body.shape;
      if(type==='sphere'){
        const c=body.position.add(body.shape.offset);
        t=ray.intersectSphere(c, body.shape.radius);
      } else if(type==='plane'){
        const n=body.shape.normal;
        t=ray.intersectPlane(n, body.shape.d);
      } else {
        // Box/capsule — use AABB as approximation for now
        t=aabbT;
      }

      if(t!==null&&t<closestT){
        closestT=t;
        const point=ray.at(t);
        // Compute normal
        let normal=new Vec3(0,1,0);
        if(type==='sphere'){
          normal=point.sub(body.position.add(body.shape.offset)).normalise();
        } else if(type==='plane'){
          normal=body.shape.normal.clone();
        }
        closest={ body, point, normal, distance:t };
      }
    }
    return closest; // null if no hit
  }

  // Raycast against all bodies, return all hits sorted by distance
  raycastAll(origin, direction, maxDist=Infinity, layerMask=0xFFFF){
    const hits=[];
    // Temporarily collect all by modifying raycast
    const ray=new Ray(origin,direction);
    for(const body of this.bodies){
      if(!body.shape||!(body.layer&layerMask)) continue;
      const aabb=body.shape.getAABB(body.position,body.orientation);
      const t=ray.intersectAABB(aabb.min,aabb.max);
      if(t!==null&&t<=maxDist) hits.push({body,distance:t,point:ray.at(t)});
    }
    return hits.sort((a,b)=>a.distance-b.distance);
  }

  // ── OVERLAP ───────────────────────────────────────────────────────────────
  // Find all bodies whose AABB overlaps a sphere
  overlapSphere(centre, radius, layerMask=0xFFFF){
    const result=[];
    for(const body of this.bodies){
      if(!body.shape||!(body.layer&layerMask)) continue;
      const aabb=body.shape.getAABB(body.position,body.orientation);
      const c=aabb.centre();
      const hs=aabb.halfSize();
      const closestX=Math.max(c.x-hs.x,Math.min(c.x+hs.x,centre.x));
      const closestY=Math.max(c.y-hs.y,Math.min(c.y+hs.y,centre.y));
      const closestZ=Math.max(c.z-hs.z,Math.min(c.z+hs.z,centre.z));
      const d=new Vec3(centre.x-closestX,centre.y-closestY,centre.z-closestZ);
      if(d.lengthSq()<=radius*radius) result.push(body);
    }
    return result;
  }

  // ── CONTACTS QUERY ────────────────────────────────────────────────────────
  getContactsFor(body){
    return this._contacts.filter(c=>c.bodyA===body||c.bodyB===body);
  }

  isGrounded(body, threshold=0.1){
    const contacts=this.getContactsFor(body);
    return contacts.some(c=>{
      const n=c.bodyA===body?c.normal:c.normal.negate();
      return n.dot(this.gravity.normalise().negate())>0.5;
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SPATIAL HASH — for O(n) broadphase (unused in basic version, ready to swap in)
// ─────────────────────────────────────────────────────────────────────────────
class SpatialHash {
  constructor(cellSize){ this.cellSize=cellSize; this.cells=new Map(); }
  key(x,y,z){ return `${Math.floor(x/this.cellSize)},${Math.floor(y/this.cellSize)},${Math.floor(z/this.cellSize)}`; }
  clear(){ this.cells.clear(); }
  insert(body, aabb){
    const x0=Math.floor(aabb.min.x/this.cellSize), x1=Math.floor(aabb.max.x/this.cellSize);
    const y0=Math.floor(aabb.min.y/this.cellSize), y1=Math.floor(aabb.max.y/this.cellSize);
    const z0=Math.floor(aabb.min.z/this.cellSize), z1=Math.floor(aabb.max.z/this.cellSize);
    for(let x=x0;x<=x1;x++) for(let y=y0;y<=y1;y++) for(let z=z0;z<=z1;z++){
      const k=this.key(x,y,z);
      if(!this.cells.has(k)) this.cells.set(k,[]);
      this.cells.get(k).push(body);
    }
  }
}
