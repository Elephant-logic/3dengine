import { Vec3 } from '../math/vec3.js';

/**
 * Mesh — vertex/index buffers + GPU upload
 *
 * Vertex layout: [x,y,z, nx,ny,nz, u,v]  (8 floats per vertex)
 *
 * Usage:
 *   const mesh = Mesh.box(gl, new Vec3(1,1,1));
 *   mesh.draw(gl);
 */
export class Mesh {
  constructor(){
    this.vertices  = null; // Float32Array — interleaved [pos(3), normal(3), uv(2)]
    this.indices   = null; // Uint16Array
    this.vao       = null;
    this.vbo       = null;
    this.ibo       = null;
    this.indexCount= 0;
    this._gl       = null;
  }

  // Upload to GPU. gl = GL wrapper instance
  upload(glWrapper){
    const gl=glWrapper.gl;
    this._gl=gl;
    this.vao=gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    this.vbo=glWrapper.createVBO(this.vertices);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);

    const stride=8*4; // 8 floats * 4 bytes
    // Position  — location 0
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    // Normal    — location 1
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    // UV        — location 2
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 24);

    this.ibo=glWrapper.createIBO(this.indices);
    this.indexCount=this.indices.length;

    gl.bindVertexArray(null);
    return this;
  }

  draw(glWrapper){
    const gl=glWrapper.gl;
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }

  dispose(){
    if(!this._gl) return;
    const gl=this._gl;
    if(this.vao) gl.deleteVertexArray(this.vao);
    if(this.vbo) gl.deleteBuffer(this.vbo);
    if(this.ibo) gl.deleteBuffer(this.ibo);
  }

  // ── GEOMETRY BUILDERS ─────────────────────────────────────────────────────
  // Return Mesh with data filled, call .upload(gl) before drawing

  static box(halfExtents=new Vec3(0.5,0.5,0.5)){
    const h=halfExtents;
    // 6 faces × 4 vertices × 8 floats
    const verts=[], inds=[];
    const faces=[
      { n:[0,0, 1], u:[1,0,0], v:[0,1,0], p:[[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]] },
      { n:[0,0,-1], u:[-1,0,0],v:[0,1,0], p:[[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]] },
      { n:[0,1, 0], u:[1,0,0], v:[0,0,-1],p:[[-1,1,-1],[1,1,-1],[1,1,1],[-1,1,1]] },
      { n:[0,-1,0], u:[1,0,0], v:[0,0,1], p:[[-1,-1,1],[1,-1,1],[1,-1,-1],[-1,-1,-1]] },
      { n:[1,0, 0], u:[0,0,-1],v:[0,1,0], p:[[1,-1,-1],[1,-1,1],[1,1,1],[1,1,-1]] },
      { n:[-1,0,0], u:[0,0,1], v:[0,1,0], p:[[-1,-1,1],[-1,-1,-1],[-1,1,-1],[-1,1,1]] },
    ];
    for(const face of faces){
      const base=verts.length/8;
      const uvCoords=[[0,0],[1,0],[1,1],[0,1]];
      face.p.forEach((p,i)=>{
        verts.push(p[0]*h.x, p[1]*h.y, p[2]*h.z, ...face.n, ...uvCoords[i]);
      });
      inds.push(base,base+1,base+2, base,base+2,base+3);
    }
    const m=new Mesh();
    m.vertices=new Float32Array(verts);
    m.indices =new Uint16Array(inds);
    return m;
  }

  static sphere(radius=0.5, rings=16, sectors=32){
    const verts=[], inds=[];
    for(let r=0;r<=rings;r++){
      const phi  =Math.PI*r/rings;
      const cosPhi=Math.cos(phi), sinPhi=Math.sin(phi);
      for(let s=0;s<=sectors;s++){
        const theta=2*Math.PI*s/sectors;
        const cosT =Math.cos(theta), sinT=Math.sin(theta);
        const nx=sinPhi*cosT, ny=cosPhi, nz=sinPhi*sinT;
        verts.push(nx*radius,ny*radius,nz*radius, nx,ny,nz, s/sectors,r/rings);
      }
    }
    for(let r=0;r<rings;r++) for(let s=0;s<sectors;s++){
      const a=r*(sectors+1)+s, b=a+sectors+1;
      inds.push(a,b,a+1, b,b+1,a+1);
    }
    const m=new Mesh(); m.vertices=new Float32Array(verts); m.indices=new Uint16Array(inds); return m;
  }

  static cylinder(radius=0.5, halfHeight=1.0, segments=24){
    const verts=[], inds=[];
    const step=2*Math.PI/segments;
    // Side faces
    for(let i=0;i<=segments;i++){
      const a=i*step;
      const cos=Math.cos(a), sin=Math.sin(a);
      const u=i/segments;
      verts.push(cos*radius,-halfHeight,sin*radius, cos,0,sin, u,1);
      verts.push(cos*radius, halfHeight,sin*radius, cos,0,sin, u,0);
    }
    for(let i=0;i<segments;i++){
      const b=i*2;
      inds.push(b,b+2,b+1, b+1,b+2,b+3);
    }
    // Top cap
    const topBase=verts.length/8;
    verts.push(0,halfHeight,0, 0,1,0, 0.5,0.5);
    for(let i=0;i<=segments;i++){
      const a=i*step;
      verts.push(Math.cos(a)*radius,halfHeight,Math.sin(a)*radius, 0,1,0,
        0.5+Math.cos(a)*0.5,0.5+Math.sin(a)*0.5);
    }
    for(let i=0;i<segments;i++) inds.push(topBase,topBase+i+1,topBase+i+2);
    // Bottom cap
    const botBase=verts.length/8;
    verts.push(0,-halfHeight,0, 0,-1,0, 0.5,0.5);
    for(let i=0;i<=segments;i++){
      const a=i*step;
      verts.push(Math.cos(a)*radius,-halfHeight,Math.sin(a)*radius, 0,-1,0,
        0.5+Math.cos(a)*0.5,0.5+Math.sin(a)*0.5);
    }
    for(let i=0;i<segments;i++) inds.push(botBase,botBase+i+2,botBase+i+1);
    const m=new Mesh(); m.vertices=new Float32Array(verts); m.indices=new Uint16Array(inds); return m;
  }

  static plane(halfSize=10, subdivisions=1){
    const verts=[], inds=[];
    const step=halfSize*2/subdivisions;
    for(let z=0;z<=subdivisions;z++) for(let x=0;x<=subdivisions;x++){
      const px=-halfSize+x*step, pz=-halfSize+z*step;
      verts.push(px,0,pz, 0,1,0, x/subdivisions,z/subdivisions);
    }
    for(let z=0;z<subdivisions;z++) for(let x=0;x<subdivisions;x++){
      const a=z*(subdivisions+1)+x;
      inds.push(a,a+1,a+subdivisions+1, a+1,a+subdivisions+2,a+subdivisions+1);
    }
    const m=new Mesh(); m.vertices=new Float32Array(verts); m.indices=new Uint16Array(inds); return m;
  }

  // Procedural capsule (cylinder + two hemisphere caps)
  static capsule(radius=0.5, halfHeight=1.0, segments=16, rings=8){
    // Build as sphere but squash middle
    const verts=[], inds=[];
    const totalRings=rings*2+1;
    for(let r=0;r<=totalRings;r++){
      const phi=Math.PI*r/totalRings;
      const cosPhi=Math.cos(phi), sinPhi=Math.sin(phi);
      // Extra height offset for capsule shape
      const yOffset= r<=rings ? halfHeight : -halfHeight;
      for(let s=0;s<=segments;s++){
        const theta=2*Math.PI*s/segments;
        const cosT=Math.cos(theta), sinT=Math.sin(theta);
        const nx=sinPhi*cosT, ny=cosPhi, nz=sinPhi*sinT;
        const py=ny*radius+(ny>=0?halfHeight:-halfHeight);
        verts.push(nx*radius,py,nz*radius, nx,ny,nz, s/segments,r/totalRings);
      }
    }
    for(let r=0;r<totalRings;r++) for(let s=0;s<segments;s++){
      const a=r*(segments+1)+s, b=a+segments+1;
      inds.push(a,b,a+1, b,b+1,a+1);
    }
    const m=new Mesh(); m.vertices=new Float32Array(verts); m.indices=new Uint16Array(inds); return m;
  }

  // Bake from raw arrays (for custom geometry)
  static fromArrays(positions, normals, uvs, indices){
    const n=positions.length/3;
    const verts=new Float32Array(n*8);
    for(let i=0;i<n;i++){
      verts[i*8+0]=positions[i*3+0]; verts[i*8+1]=positions[i*3+1]; verts[i*8+2]=positions[i*3+2];
      verts[i*8+3]=normals[i*3+0];   verts[i*8+4]=normals[i*3+1];   verts[i*8+5]=normals[i*3+2];
      verts[i*8+6]=uvs?uvs[i*2+0]:0; verts[i*8+7]=uvs?uvs[i*2+1]:0;
    }
    const m=new Mesh(); m.vertices=verts; m.indices=new Uint16Array(indices); return m;
  }
}
