import { Vec3 } from '../math/vec3.js';
import { Quat }  from '../math/quat.js';
import { Mat4 }  from '../math/mat4.js';

let _nextId = 1;

/**
 * Entity — a game object in the scene
 *
 * Has a transform (position, rotation, scale) and a list of Components.
 * Components add behaviour: MeshRenderer, RigidBodyComponent, Camera, Script...
 *
 * Usage:
 *   const e = scene.createEntity('Player');
 *   e.position = new Vec3(0, 5, 0);
 *   e.addComponent(new MeshRenderer(mesh, material));
 *   e.addComponent(new RigidBodyComponent(world, { mass: 70, shape: new CapsuleShape() }));
 */
export class Entity {
  constructor(name='Entity'){
    this.id       = _nextId++;
    this.name     = name;
    this.tags     = new Set();
    this.active   = true;

    // Transform
    this.position = new Vec3();
    this.rotation = Quat.identity();
    this.scale    = new Vec3(1,1,1);
    this._worldMatrix = Mat4.identity();
    this._dirty   = true;

    // Hierarchy
    this.parent   = null;
    this.children = [];

    // Components (stored by constructor name for fast lookup)
    this._components = [];
    this._compMap    = new Map();

    // Scene back-reference
    this.scene    = null;
  }

  // ── TRANSFORM ─────────────────────────────────────────────────────────────
  get worldMatrix(){
    if(this._dirty){
      const local = Mat4.TRS(this.position, this.rotation, this.scale);
      this._worldMatrix = this.parent
        ? this.parent.worldMatrix.mul(local)
        : local;
      this._dirty=false;
    }
    return this._worldMatrix;
  }

  setDirty(){
    this._dirty=true;
    for(const child of this.children) child.setDirty();
  }

  setPosition(v){ this.position=v.clone(); this.setDirty(); return this; }
  setRotation(q){ this.rotation=q.clone(); this.setDirty(); return this; }
  setScale(v)   { this.scale=v.clone();    this.setDirty(); return this; }
  setScale1(s)  { this.scale=new Vec3(s,s,s); this.setDirty(); return this; }

  get forward(){ return this.rotation.getForward(); }
  get right()  { return this.rotation.getRight();   }
  get up()     { return this.rotation.getUp();      }

  // World-space accessors
  get worldPosition(){ return this.worldMatrix.getTranslation(); }

  lookAt(target, up=new Vec3(0,1,0)){
    const f=target.sub(this.worldPosition).normalise();
    if(f.isZero()) return;
    this.rotation=Quat.fromTo(new Vec3(0,0,-1), f);
    this.setDirty();
    return this;
  }

  translate(v){ this.position.addSelf(v); this.setDirty(); return this; }
  rotate(q)   { this.rotation=q.mul(this.rotation).normalise(); this.setDirty(); return this; }

  // ── HIERARCHY ─────────────────────────────────────────────────────────────
  addChild(child){
    if(child.parent) child.parent.removeChild(child);
    child.parent=this;
    this.children.push(child);
    child.setDirty();
    return child;
  }

  removeChild(child){
    const i=this.children.indexOf(child);
    if(i>=0){ this.children.splice(i,1); child.parent=null; child.setDirty(); }
  }

  // ── COMPONENTS ────────────────────────────────────────────────────────────
  addComponent(comp){
    comp.entity = this;
    this._components.push(comp);
    this._compMap.set(comp.constructor, comp);
    if(comp.onAttach) comp.onAttach();
    return comp;
  }

  getComponent(Type){
    return this._compMap.get(Type) || null;
  }

  getComponents(Type){
    return this._components.filter(c=>c instanceof Type);
  }

  removeComponent(comp){
    const i=this._components.indexOf(comp);
    if(i>=0){
      this._components.splice(i,1);
      this._compMap.delete(comp.constructor);
      if(comp.onDetach) comp.onDetach();
    }
  }

  hasComponent(Type){ return this._compMap.has(Type); }

  // ── LIFECYCLE ─────────────────────────────────────────────────────────────
  _start(){
    for(const c of this._components) if(c.start) c.start();
    for(const child of this.children) child._start();
  }

  _update(dt){
    if(!this.active) return;
    for(const c of this._components) if(c.active!==false&&c.update) c.update(dt);
    for(const child of this.children) child._update(dt);
  }

  _lateUpdate(dt){
    if(!this.active) return;
    for(const c of this._components) if(c.active!==false&&c.lateUpdate) c.lateUpdate(dt);
    for(const child of this.children) child._lateUpdate(dt);
  }

  _render(renderer){
    if(!this.active) return;
    for(const c of this._components) if(c.active!==false&&c.render) c.render(renderer);
    for(const child of this.children) child._render(renderer);
  }

  destroy(){
    for(const c of this._components) if(c.onDetach) c.onDetach();
    for(const child of [...this.children]) child.destroy();
    if(this.parent) this.parent.removeChild(this);
    if(this.scene)  this.scene.removeEntity(this);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT BASE
// ─────────────────────────────────────────────────────────────────────────────
export class Component {
  constructor(){
    this.entity = null;
    this.active = true;
  }
  // Lifecycle hooks — override in subclasses
  onAttach()    {}  // called when added to entity
  onDetach()    {}  // called when removed
  start()       {}  // called once, first frame
  update(dt)    {}  // called every frame
  lateUpdate(dt){}  // called after all updates
  render(renderer){}// called during render pass
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILT-IN COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

/** MeshRenderer — draws a mesh with a material */
export class MeshRenderer extends Component {
  constructor(mesh, material, aabb=null){
    super();
    this.mesh     = mesh;
    this.material = material;
    this.aabb     = aabb;         // local AABB for frustum cull
    this.castShadow    = true;
    this.receiveShadow = true;
  }
  render(renderer){
    renderer.drawMesh(this.mesh, this.entity.worldMatrix, this.material, this.aabb);
  }
}

/** RigidBodyComponent — bridges Entity and PhysicsWorld.RigidBody */
export class RigidBodyComponent extends Component {
  constructor(physicsWorld, opts={}){
    super();
    this._world = physicsWorld;
    this._opts  = opts;
    this.body   = null;
    this.syncToEntity = true;  // copy physics position back to entity
  }

  onAttach(){
    this.body = this._world.createBody({
      ...this._opts,
      position: this.entity.position,
    });
    this.body.entity=this.entity;
    if(this._opts.orientation) this.body.orientation=this._opts.orientation.clone();
  }

  onDetach(){
    if(this.body) this._world.removeBody(this.body);
  }

  update(){
    if(this.syncToEntity&&this.body&&!this.body.isSleeping){
      this.entity.setPosition(this.body.position);
      this.entity.setRotation(this.body.orientation);
    }
  }

  // Convenience pass-throughs
  get velocity(){ return this.body?.linearVelocity; }
  applyForce(f){ this.body?.addForce(f); }
  applyImpulse(j){ this.body?.applyLinearImpulse(j); }
  isGrounded(){ return this._world.isGrounded(this.body); }
}

/** CameraComponent — attaches a Camera to an entity */
export class CameraComponent extends Component {
  constructor(camera){
    super();
    this.camera = camera;
  }
  update(){
    this.camera.setPosition(this.entity.worldPosition);
    this.camera.setOrientation(this.entity.rotation);
  }
}

/** ScriptComponent — attach arbitrary update/render functions */
export class ScriptComponent extends Component {
  constructor(hooks={}){
    super();
    if(hooks.start)      this.start      = hooks.start.bind(this);
    if(hooks.update)     this.update     = hooks.update.bind(this);
    if(hooks.lateUpdate) this.lateUpdate = hooks.lateUpdate.bind(this);
    if(hooks.render)     this.render     = hooks.render.bind(this);
    if(hooks.onAttach)   this.onAttach   = hooks.onAttach.bind(this);
    Object.assign(this, hooks.data||{});
  }
}
