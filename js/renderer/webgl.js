/**
 * WebGL — context creation, shader compilation, resource management
 *
 * All WebGL state goes through here so there's one place to track bindings.
 */
export class GL {
  constructor(canvas){
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', {
      antialias: true,
      depth:     true,
      stencil:   false,
      alpha:     false,
      powerPreference: 'high-performance',
    });
    if(!this.gl) throw new Error('WebGL2 not supported');
    this._init();
    this._boundProgram = null;
    this._boundVAO     = null;
  }

  _init(){
    const gl=this.gl;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0,0,0,1);
  }

  resize(){
    const gl=this.gl;
    const w=this.canvas.clientWidth  * devicePixelRatio|0;
    const h=this.canvas.clientHeight * devicePixelRatio|0;
    if(this.canvas.width!==w||this.canvas.height!==h){
      this.canvas.width=w; this.canvas.height=h;
      gl.viewport(0,0,w,h);
    }
  }

  clear(r=0,g=0,b=0,a=1){
    const gl=this.gl;
    gl.clearColor(r,g,b,a);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  }

  // ── SHADERS ───────────────────────────────────────────────────────────────
  compileShader(src, type){
    const gl=this.gl;
    const s=gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)){
      const err=gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(`Shader compile error:\n${err}`);
    }
    return s;
  }

  createProgram(vertSrc, fragSrc){
    const gl=this.gl;
    const vert=this.compileShader(vertSrc, gl.VERTEX_SHADER);
    const frag=this.compileShader(fragSrc, gl.FRAGMENT_SHADER);
    const prog=gl.createProgram();
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    if(!gl.getProgramParameter(prog, gl.LINK_STATUS)){
      const err=gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new Error(`Program link error:\n${err}`);
    }
    // Cache uniform and attribute locations
    const uniforms={};
    const numU=gl.getProgramParameter(prog,gl.ACTIVE_UNIFORMS);
    for(let i=0;i<numU;i++){
      const info=gl.getActiveUniform(prog,i);
      uniforms[info.name]=gl.getUniformLocation(prog,info.name);
    }
    const attribs={};
    const numA=gl.getProgramParameter(prog,gl.ACTIVE_ATTRIBUTES);
    for(let i=0;i<numA;i++){
      const info=gl.getActiveAttrib(prog,i);
      attribs[info.name]=gl.getAttribLocation(prog,info.name);
    }
    return new ShaderProgram(gl, prog, uniforms, attribs);
  }

  // ── BUFFERS ───────────────────────────────────────────────────────────────
  createVBO(data, usage){
    const gl=this.gl;
    const buf=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data instanceof Float32Array?data:new Float32Array(data), usage||gl.STATIC_DRAW);
    return buf;
  }

  createIBO(data, usage){
    const gl=this.gl;
    const buf=gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data instanceof Uint16Array?data:new Uint16Array(data), usage||gl.STATIC_DRAW);
    return buf;
  }

  updateVBO(buf, data){
    const gl=this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data instanceof Float32Array?data:new Float32Array(data));
  }

  createVAO(){ return this.gl.createVertexArray(); }

  // ── TEXTURES ──────────────────────────────────────────────────────────────
  createTexture(opts={}){
    const gl=this.gl;
    const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const wrap  = opts.wrap   || gl.REPEAT;
    const filter= opts.filter || gl.LINEAR_MIPMAP_LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S,     wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T,     wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, opts.magFilter||gl.LINEAR);
    return tex;
  }

  uploadTexture(tex, imageOrData, width, height){
    const gl=this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if(imageOrData instanceof HTMLImageElement||imageOrData instanceof ImageBitmap||imageOrData instanceof HTMLCanvasElement){
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,imageOrData);
    } else {
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,imageOrData);
    }
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  loadTextureFromURL(url){
    const tex=this.createTexture();
    const gl=this.gl;
    // Placeholder 1×1 white pixel while loading
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));
    const img=new Image();
    img.onload=()=>this.uploadTexture(tex,img);
    img.src=url;
    return tex;
  }

  // ── FRAMEBUFFER ───────────────────────────────────────────────────────────
  createFramebuffer(w, h){
    const gl=this.gl;
    const fb=gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);

    const colorTex=this.createTexture({filter:gl.LINEAR, wrap:gl.CLAMP_TO_EDGE});
    gl.bindTexture(gl.TEXTURE_2D, colorTex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,colorTex,0);

    const depthBuf=gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER,depthBuf);
    gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,w,h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depthBuf);

    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {fb,colorTex,w,h};
  }

  get width() { return this.canvas.width; }
  get height(){ return this.canvas.height; }
}

// ── SHADER PROGRAM WRAPPER ─────────────────────────────────────────────────
export class ShaderProgram {
  constructor(gl, prog, uniforms, attribs){
    this.gl=gl; this.prog=prog;
    this.uniforms=uniforms; this.attribs=attribs;
  }

  use(){ this.gl.useProgram(this.prog); }

  setFloat(name, v)      { const l=this.uniforms[name]; if(l!=null) this.gl.uniform1f(l,v); }
  setInt(name, v)        { const l=this.uniforms[name]; if(l!=null) this.gl.uniform1i(l,v); }
  setVec2(name, x, y)   { const l=this.uniforms[name]; if(l!=null) this.gl.uniform2f(l,x,y); }
  setVec3(name, v)       { const l=this.uniforms[name]; if(l!=null) this.gl.uniform3f(l,v.x,v.y,v.z); }
  setVec4(name, x,y,z,w){ const l=this.uniforms[name]; if(l!=null) this.gl.uniform4f(l,x,y,z,w); }
  setMat4(name, m)       { const l=this.uniforms[name]; if(l!=null) this.gl.uniformMatrix4fv(l,false,m.toFloat32()); }
  setColour(name, c)     { const l=this.uniforms[name]; if(l!=null) this.gl.uniform4f(l,c.r,c.g,c.b,c.a); }

  attrib(name){ return this.attribs[name]??-1; }

  dispose(){ this.gl.deleteProgram(this.prog); }
}
