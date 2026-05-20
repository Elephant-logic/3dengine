import { Vec3 }   from '../math/vec3.js';
import { Entity }  from './entity.js';

// ─────────────────────────────────────────────────────────────────────────────
// SCENE
// ─────────────────────────────────────────────────────────────────────────────
export class Scene {
  constructor(){
    this._entities = [];
    this._started  = false;
  }

  createEntity(name='Entity'){
    const e = new Entity(name);
    e.scene = this;
    this._entities.push(e);
    if(this._started) e._start();
    return e;
  }

  removeEntity(e){
    const i=this._entities.indexOf(e);
    if(i>=0) this._entities.splice(i,1);
  }

  findByName(name){ return this._entities.find(e=>e.name===name)||null; }
  findByTag(tag)  { return this._entities.filter(e=>e.tags.has(tag)); }
  findById(id)    { return this._entities.find(e=>e.id===id)||null; }

  start(){
    this._started=true;
    for(const e of this._entities) e._start();
  }

  update(dt){
    for(const e of this._entities) if(!e.parent) e._update(dt);
  }

  lateUpdate(dt){
    for(const e of this._entities) if(!e.parent) e._lateUpdate(dt);
  }

  render(renderer){
    for(const e of this._entities) if(!e.parent) e._render(renderer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INPUT
// ─────────────────────────────────────────────────────────────────────────────
export class Input {
  constructor(canvas){
    this._keys   = new Set();
    this._mouse  = { x:0, y:0, dx:0, dy:0, buttons:new Set(), locked:false };
    this._touch  = [];
    this._gamepad= null;

    // Keyboard
    window.addEventListener('keydown',  e=>{ this._keys.add(e.code);    e.preventDefault(); });
    window.addEventListener('keyup',    e=>{ this._keys.delete(e.code); });

    // Mouse
    canvas.addEventListener('mousemove', e=>{
      if(this._mouse.locked){
        this._mouse.dx+=e.movementX;
        this._mouse.dy+=e.movementY;
      } else {
        this._mouse.x=e.clientX; this._mouse.y=e.clientY;
      }
    });
    canvas.addEventListener('mousedown', e=>this._mouse.buttons.add(e.button));
    canvas.addEventListener('mouseup',   e=>this._mouse.buttons.delete(e.button));
    canvas.addEventListener('click', ()=>{
      if(this._mouse.locked===false) canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', ()=>{
      this._mouse.locked = document.pointerLockElement===canvas;
    });

    // Touch
    canvas.addEventListener('touchstart', e=>{
      for(const t of e.changedTouches) this._touch.push({id:t.identifier,x:t.clientX,y:t.clientY,dx:0,dy:0});
      e.preventDefault();
    },{passive:false});
    canvas.addEventListener('touchmove', e=>{
      for(const t of e.changedTouches){
        const existing=this._touch.find(tt=>tt.id===t.identifier);
        if(existing){ existing.dx=t.clientX-existing.x; existing.dy=t.clientY-existing.y; existing.x=t.clientX; existing.y=t.clientY; }
      }
      e.preventDefault();
    },{passive:false});
    canvas.addEventListener('touchend', e=>{
      for(const t of e.changedTouches){
        const i=this._touch.findIndex(tt=>tt.id===t.identifier);
        if(i>=0) this._touch.splice(i,1);
      }
    });

    // Gamepad
    window.addEventListener('gamepadconnected',    e=>this._gamepad=e.gamepad);
    window.addEventListener('gamepaddisconnected', ()=>this._gamepad=null);
  }

  // ── API ───────────────────────────────────────────────────────────────────
  key(code)     { return this._keys.has(code); }
  keyDown(code) { return this._justPressed.has(code); }

  get mouseX()  { return this._mouse.x; }
  get mouseY()  { return this._mouse.y; }
  get mouseDX() { return this._mouse.dx; }
  get mouseDY() { return this._mouse.dy; }
  mouseButton(b){ return this._mouse.buttons.has(b); }

  get touches() { return this._touch; }

  // Gamepad axis [-1,1]
  axis(index){
    const gp=navigator.getGamepads?.[this._gamepad?.index];
    return gp?.axes[index]??0;
  }
  gpButton(index){
    const gp=navigator.getGamepads?.[this._gamepad?.index];
    return gp?.buttons[index]?.pressed??false;
  }

  // Common movement axes (WASD / left stick)
  get moveX(){ return (this.key('KeyD')?1:0)-(this.key('KeyA')?1:0)+this.axis(0); }
  get moveZ(){ return (this.key('KeyS')?1:0)-(this.key('KeyW')?1:0)+this.axis(1); }
  get jump() { return this.key('Space')||this.gpButton(0); }
  get sprint(){ return this.key('ShiftLeft')||this.gpButton(5); }

  // Call at end of frame to consume delta values
  _endFrame(){
    this._mouse.dx=0; this._mouse.dy=0;
    for(const t of this._touch) t.dx=0,t.dy=0;
  }

  _justPressed = new Set();
  _frameKeys   = new Set();
}

// ─────────────────────────────────────────────────────────────────────────────
// GAME — main entry point, wires everything together
// ─────────────────────────────────────────────────────────────────────────────
export class Game {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} opts
   * @param {function} opts.init(game)   — called once on start
   * @param {function} opts.update(game, dt) — called each frame
   */
  constructor(canvas, opts={}){
    this.canvas   = canvas;
    this.opts     = opts;
    this.running  = false;
    this._lastT   = 0;
    this._accumulator = 0;

    // Engine subsystems — set up by Engine.create()
    this.gl       = null;
    this.renderer = null;
    this.physics  = null;
    this.scene    = new Scene();
    this.input    = new Input(canvas);

    // Active camera — set by user
    this.camera   = null;

    // Fixed physics step
    this.fixedDt  = 1/60;

    // Debug
    this.showDebug   = false;
    this.showPhysics = false;
  }

  start(){
    this.running=true;
    if(this.opts.init) this.opts.init(this);
    this.scene.start();
    requestAnimationFrame(t=>this._loop(t));
  }

  _loop(timestamp){
    if(!this.running) return;
    const dt=Math.min((timestamp-this._lastT)/1000, 0.1);
    this._lastT=timestamp;

    // Fixed physics steps
    if(this.physics){
      this.physics.update(dt);
    }

    // Variable update
    this.scene.update(dt);
    if(this.opts.update) this.opts.update(this, dt);

    // Late update (camera follow etc)
    this.scene.lateUpdate(dt);

    // Render
    if(this.renderer&&this.camera){
      this.renderer.begin(this.camera);

      // Draw debug physics shapes
      if(this.showPhysics&&this.physics){
        for(const body of this.physics.bodies){
          if(!body.shape) continue;
          const aabb=body.shape.getAABB(body.position,body.orientation);
          const c=body.isStatic
            ? new (require('../math/primitives.js').Colour)(0.3,0.3,1)
            : body.isSleeping
              ? new (require('../math/primitives.js').Colour)(0.5,0.5,0.5)
              : new (require('../math/primitives.js').Colour)(0,1,0.2);
          this.renderer.debugAABB(aabb.min,aabb.max,c);
        }
      }

      this.scene.render(this.renderer);
      if(this.opts.render) this.opts.render(this);
      this.renderer.end();
    }

    this.input._endFrame();
    requestAnimationFrame(t=>this._loop(t));
  }

  stop(){ this.running=false; }
}
