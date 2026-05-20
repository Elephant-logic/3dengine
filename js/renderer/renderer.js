import { Vec3 }    from '../math/vec3.js';
import { Mat4 }    from '../math/mat4.js';
import { Colour }  from '../math/primitives.js';
import { Mesh }    from './mesh.js';
import {
  PHONG_VERT, PHONG_FRAG,
  UNLIT_VERT, UNLIT_FRAG,
  SKY_VERT,   SKY_FRAG,
  DEBUG_VERT, DEBUG_FRAG,
} from './shaders.js';

/**
 * Renderer — draws meshes with materials, handles lights, debug overlay
 *
 * Usage:
 *   const renderer = new Renderer(glWrapper);
 *   renderer.begin(camera);
 *   renderer.drawMesh(mesh, modelMatrix, material);
 *   renderer.end();
 */
export class Renderer {
  constructor(gl){
    this.gl = gl;

    // Compile built-in shader programs
    this._phong = gl.createProgram(PHONG_VERT, PHONG_FRAG);
    this._unlit = gl.createProgram(UNLIT_VERT, UNLIT_FRAG);
    this._debug = gl.createProgram(DEBUG_VERT, DEBUG_FRAG);
    this._sky   = gl.createProgram(SKY_VERT,   SKY_FRAG);

    // Sky mesh (unit box)
    this._skyMesh = Mesh.box(new Vec3(1,1,1)).upload(gl);

    // Sky config
    this.skyTop    = new Colour(0.05, 0.08, 0.2);
    this.skyHorizon= new Colour(0.35, 0.45, 0.6);
    this.skyBottom = new Colour(0.15, 0.12, 0.1);

    // Lighting
    this.ambient     = new Colour(0.08, 0.08, 0.12);
    this.sunDir      = new Vec3(0.5, 0.8, 0.3).normalise();
    this.sunColour   = new Colour(1.0, 0.95, 0.8);
    this.sunIntensity= 1.2;
    this.lights      = []; // array of {position:Vec3, colour:Colour, radius:number}

    // Debug geometry queued up, flushed at end of frame
    this._debugLines = [];

    // Wireframe box meshes cached by size key
    this._wireBoxes  = new Map();

    // Current camera (set in begin)
    this._cam = null;
    this._view= null;
    this._proj= null;

    // Draw call stats
    this.stats = { draws:0, culled:0 };
  }

  // ── FRAME ─────────────────────────────────────────────────────────────────
  begin(camera){
    this._cam  = camera;
    this._view = camera.viewMatrix;
    this._proj = camera.projMatrix;
    camera.updateFrustum();
    this.gl.resize();
    this.gl.clear(0,0,0,1);
    this.stats.draws=0; this.stats.culled=0;
    this._drawSky();
  }

  end(){
    this._flushDebug();
  }

  // ── SKY ───────────────────────────────────────────────────────────────────
  _drawSky(){
    const gl=this.gl.gl;
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    this._sky.use();
    this._sky.setMat4('uView', this._view);
    this._sky.setMat4('uProj', this._proj);
    this._sky.setVec3('uSkyTop',    this.skyTop   );
    this._sky.setVec3('uSkyHorizon',this.skyHorizon);
    this._sky.setVec3('uSkyBottom', this.skyBottom );
    this._skyMesh.draw(this.gl);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
  }

  // ── MESH DRAW ─────────────────────────────────────────────────────────────
  /**
   * Draw a mesh with a material
   * @param {Mesh}    mesh
   * @param {Mat4}    modelMatrix
   * @param {Material} material
   * @param {AABB|null} aabb — if provided, used for frustum culling
   */
  drawMesh(mesh, modelMatrix, material, aabb=null){
    // Frustum cull
    if(aabb){
      const worldAABB=aabb.transform(modelMatrix);
      if(!this._cam.frustumTestAABB(worldAABB.min, worldAABB.max)){
        this.stats.culled++; return;
      }
    }
    this.stats.draws++;

    const prog = material?.unlit ? this._unlit : this._phong;
    prog.use();

    // Matrices
    prog.setMat4('uModel', modelMatrix);
    prog.setMat4('uView',  this._view);
    prog.setMat4('uProj',  this._proj);

    // Normal matrix = transpose(inverse(model)) — only upper 3×3 matters
    const normMat = modelMatrix.inverse().transpose();
    prog.setMat4('uNormalMatrix', normMat);

    // Material
    const col = material?.colour || Colour.white();
    prog.setColour('uColour', col);
    prog.setFloat('uShininess',  material?.shininess  ?? 32);
    prog.setFloat('uMetallic',   material?.metallic   ?? 0);
    prog.setFloat('uRoughness',  material?.roughness  ?? 0.5);

    // Texture
    const gl=this.gl.gl;
    const hasTex=!!(material?.texture);
    prog.setInt('uHasTexture', hasTex?1:0);
    if(hasTex){
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, material.texture);
      prog.setInt('uTexture',0);
    }

    if(!material?.unlit){
      // Camera + lighting uniforms
      prog.setVec3('uCamPos',       this._cam.position);
      prog.setVec3('uAmbient',      this.ambient);
      prog.setVec3('uSunDir',       this.sunDir);
      prog.setVec3('uSunColour',    this.sunColour);
      prog.setFloat('uSunIntensity',this.sunIntensity);

      const nl=Math.min(this.lights.length,4);
      prog.setInt('uNumLights', nl);
      for(let i=0;i<nl;i++){
        const li=this.lights[i];
        prog.setVec3(`uLightPos[${i}]`,   li.position);
        prog.setVec3(`uLightColour[${i}]`,li.colour);
        prog.setFloat(`uLightRadius[${i}]`,li.radius);
      }
    }

    mesh.draw(this.gl);
  }

  // ── LIGHTS ────────────────────────────────────────────────────────────────
  addLight(position, colour=Colour.white(), radius=20){
    if(this.lights.length>=4) return;
    this.lights.push({position:position.clone(), colour:colour.clone(), radius});
  }
  clearLights(){ this.lights=[]; }

  // ── DEBUG DRAW ────────────────────────────────────────────────────────────
  // All debug calls are queued and flushed at end()

  debugLine(from, to, colour=Colour.green()){
    this._debugLines.push({from:from.clone(),to:to.clone(),colour:colour.clone()});
  }

  debugAABB(min, max, colour=Colour.green()){
    const edges=[
      [[0,0,0],[1,0,0]],[[0,1,0],[1,1,0]],[[0,0,1],[1,0,1]],[[0,1,1],[1,1,1]],
      [[0,0,0],[0,1,0]],[[1,0,0],[1,1,0]],[[0,0,1],[0,1,1]],[[1,0,1],[1,1,1]],
      [[0,0,0],[0,0,1]],[[1,0,0],[1,0,1]],[[0,1,0],[0,1,1]],[[1,1,0],[1,1,1]],
    ];
    for(const [a,b] of edges){
      this.debugLine(
        new Vec3(a[0]?max.x:min.x, a[1]?max.y:min.y, a[2]?max.z:min.z),
        new Vec3(b[0]?max.x:min.x, b[1]?max.y:min.y, b[2]?max.z:min.z),
        colour
      );
    }
  }

  debugSphere(centre, radius, colour=Colour.yellow(), segments=16){
    for(let i=0;i<segments;i++){
      const a0=2*Math.PI*i/segments, a1=2*Math.PI*(i+1)/segments;
      // XZ ring
      this.debugLine(
        centre.add(new Vec3(Math.cos(a0)*radius,0,Math.sin(a0)*radius)),
        centre.add(new Vec3(Math.cos(a1)*radius,0,Math.sin(a1)*radius)),
        colour
      );
      // XY ring
      this.debugLine(
        centre.add(new Vec3(Math.cos(a0)*radius,Math.sin(a0)*radius,0)),
        centre.add(new Vec3(Math.cos(a1)*radius,Math.sin(a1)*radius,0)),
        colour
      );
    }
  }

  debugAxes(worldMatrix, size=1){
    const o=worldMatrix.getTranslation();
    this.debugLine(o, o.add(worldMatrix.transformDir(new Vec3(size,0,0))), new Colour(1,0,0));
    this.debugLine(o, o.add(worldMatrix.transformDir(new Vec3(0,size,0))), new Colour(0,1,0));
    this.debugLine(o, o.add(worldMatrix.transformDir(new Vec3(0,0,size))), new Colour(0,0,1));
  }

  _flushDebug(){
    if(!this._debugLines.length) return;
    const gl=this.gl.gl;
    gl.disable(gl.DEPTH_TEST);
    this._debug.use();
    this._debug.setMat4('uVP',    this._cam.vpMatrix);
    this._debug.setMat4('uModel', Mat4.identity());

    // Upload all lines as a VBO
    const verts=new Float32Array(this._debugLines.length*6);
    for(let i=0;i<this._debugLines.length;i++){
      const {from,to}=this._debugLines[i];
      verts[i*6+0]=from.x;verts[i*6+1]=from.y;verts[i*6+2]=from.z;
      verts[i*6+3]=to.x;  verts[i*6+4]=to.y;  verts[i*6+5]=to.z;
    }

    // One-shot VBO
    const buf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,buf);
    gl.bufferData(gl.ARRAY_BUFFER,verts,gl.STREAM_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0,3,gl.FLOAT,false,12,0);

    // Draw each line with its colour
    for(let i=0;i<this._debugLines.length;i++){
      const c=this._debugLines[i].colour;
      this._debug.setVec4('uColour', c.r,c.g,c.b,c.a);
      gl.drawArrays(gl.LINES,i*2,2);
    }

    gl.deleteBuffer(buf);
    gl.enable(gl.DEPTH_TEST);
    this._debugLines=[];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MATERIAL
// ─────────────────────────────────────────────────────────────────────────────
export class Material {
  constructor(opts={}){
    this.colour     = opts.colour    || Colour.white();
    this.texture    = opts.texture   || null;
    this.shininess  = opts.shininess ?? 32;
    this.metallic   = opts.metallic  ?? 0;
    this.roughness  = opts.roughness ?? 0.5;
    this.unlit      = opts.unlit     ?? false;
    this.transparent= opts.transparent ?? false;
  }

  static colour(r,g,b,a=1){ return new Material({colour:new Colour(r,g,b,a)}); }
  static unlit(colour)     { return new Material({colour, unlit:true}); }
}
