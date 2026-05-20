/**
 * Engine — single import that gives you everything
 *
 * Usage:
 *   import { Engine, Vec3, Quat, ... } from './js/engine.js';
 *
 *   const game = await Engine.create('#canvas', {
 *     init(game){
 *       // set up scene
 *       const cube = game.scene.createEntity('Cube');
 *       cube.addComponent(new MeshRenderer(Mesh.box(), Material.colour(1,0.3,0.1)));
 *       cube.addComponent(new RigidBodyComponent(game.physics, {
 *         mass: 1,
 *         shape: new BoxShape(new Vec3(0.5,0.5,0.5)),
 *       }));
 *       cube.position = new Vec3(0,5,0);
 *
 *       // Floor
 *       const floor = game.scene.createEntity('Floor');
 *       floor.addComponent(new RigidBodyComponent(game.physics, {
 *         isStatic: true,
 *         shape: new PlaneShape(),
 *       }));
 *     },
 *     update(game, dt){
 *       // game logic here
 *     }
 *   });
 *   game.start();
 */

// ── MATH ──────────────────────────────────────────────────────────────────
export { Vec3 }                      from './math/vec3.js';
export { Quat }                      from './math/quat.js';
export { Mat4 }                      from './math/mat4.js';
export { Ray, AABB, Colour }         from './math/primitives.js';

// ── PHYSICS ───────────────────────────────────────────────────────────────
export { RigidBody }                 from './physics/rigidbody.js';
export { Shape, SphereShape, BoxShape, CapsuleShape, PlaneShape } from './physics/shapes.js';
export { PhysicsWorld }              from './physics/world.js';
export { Solver }                    from './physics/solver.js';
export { BallSocketJoint, HingeJoint, SpringJoint, DistanceJoint } from './physics/joints.js';

// ── RENDERER ──────────────────────────────────────────────────────────────
export { GL, ShaderProgram }         from './renderer/webgl.js';
export { Mesh }                      from './renderer/mesh.js';
export { Camera }                    from './renderer/camera.js';
export { Renderer, Material }        from './renderer/renderer.js';

// ── GAME ──────────────────────────────────────────────────────────────────
export { Entity, Component, MeshRenderer, RigidBodyComponent, CameraComponent, ScriptComponent } from './game/entity.js';
export { Scene, Input, Game }        from './game/scene.js';

// ── ENGINE FACTORY ────────────────────────────────────────────────────────
export const Engine = {
  /**
   * Create and return a configured Game instance
   * @param {string|HTMLCanvasElement} canvasOrSelector
   * @param {object} opts — { init, update, render }
   */
  async create(canvasOrSelector, opts={}){
    // Get canvas
    const canvas = typeof canvasOrSelector==='string'
      ? document.querySelector(canvasOrSelector)
      : canvasOrSelector;
    if(!canvas) throw new Error(`Canvas not found: ${canvasOrSelector}`);

    // Resize canvas to fill window
    function resize(){
      canvas.width  = canvas.clientWidth  * devicePixelRatio|0;
      canvas.height = canvas.clientHeight * devicePixelRatio|0;
    }
    resize();
    window.addEventListener('resize', resize);

    // Import subsystems
    const { GL }          = await import('./renderer/webgl.js');
    const { Renderer }    = await import('./renderer/renderer.js');
    const { Camera }      = await import('./renderer/camera.js');
    const { PhysicsWorld }= await import('./physics/world.js');
    const { Game }        = await import('./game/scene.js');

    // Create WebGL context
    const gl       = new GL(canvas);
    const renderer = new Renderer(gl);
    const physics  = new PhysicsWorld();
    const camera   = new Camera();
    camera.setAspect(canvas.width/canvas.height);
    window.addEventListener('resize', ()=>camera.setAspect(canvas.width/canvas.height));

    // Create game
    const game     = new Game(canvas, opts);
    game.gl        = gl;
    game.renderer  = renderer;
    game.physics   = physics;
    game.camera    = camera;

    return game;
  }
};
