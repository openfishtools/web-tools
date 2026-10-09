const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main(){
  vUv=aPos*0.5+0.5;
  gl_Position=vec4(aPos,0.0,1.0);
}`;

const FS_COPY = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 o;
void main(){ o=texture(uTex,vUv); }`;

const FS_DENOISE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uStrength;
out vec4 o;
void main(){
  vec4 center=texture(uTex,vUv);
  if(uStrength<=0.001){ o=center; return; }
  float sigmaS=max(0.5,uStrength*0.35);
  float sigmaR=max(0.02,uStrength*0.045);
  vec3 sum=vec3(0.0);
  float wsum=0.0;
  for(int y=-3;y<=3;y++){
    for(int x=-3;x<=3;x++){
      vec2 off=vec2(float(x),float(y))*uTexel*(1.0+uStrength*0.15);
      vec4 s=texture(uTex,vUv+off);
      float ds=float(x*x+y*y);
      float spatial=exp(-ds/(2.0*sigmaS*sigmaS));
      float cd=length(s.rgb-center.rgb);
      float range=exp(-(cd*cd)/(2.0*sigmaR*sigmaR));
      float w=spatial*range;
      sum+=s.rgb*w;
      wsum+=w;
    }
  }
  vec3 filtered=sum/max(wsum,1e-5);
  float mixAmt=min(1.0,uStrength*0.12);
  o=vec4(mix(center.rgb,filtered,mixAmt),center.a);
}`;

const FS_ENHANCE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uOrig;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float sharpen;
uniform float unsharpAmount;
uniform float unsharpRadius;
uniform float brightness;
uniform float contrast;
uniform float shadowsVal;
uniform float hueShift;
uniform float saturationShift;
out vec4 o;
vec3 rgb2hsl(vec3 color){
  float maxC=max(color.r,max(color.g,color.b));
  float minC=min(color.r,min(color.g,color.b));
  vec3 hsl=vec3(0.0);
  hsl.z=(maxC+minC)*0.5;
  if(maxC!=minC){
    float d=maxC-minC;
    hsl.y=hsl.z>0.5?d/(2.0-maxC-minC):d/(maxC+minC);
    if(maxC==color.r) hsl.x=(color.g-color.b)/d+(color.g<color.b?6.0:0.0);
    else if(maxC==color.g) hsl.x=(color.b-color.r)/d+2.0;
    else hsl.x=(color.r-color.g)/d+4.0;
    hsl.x/=6.0;
  }
  return hsl;
}
float hue2rgb(float p,float q,float t){
  if(t<0.0) t+=1.0;
  if(t>1.0) t-=1.0;
  if(t<1.0/6.0) return p+(q-p)*6.0*t;
  if(t<0.5) return q;
  if(t<2.0/3.0) return p+(q-p)*(2.0/3.0-t)*6.0;
  return p;
}
vec3 hsl2rgb(vec3 hsl){
  if(hsl.y==0.0) return vec3(hsl.z);
  float q=hsl.z<0.5?hsl.z*(1.0+hsl.y):hsl.z+hsl.y-hsl.z*hsl.y;
  float p=2.0*hsl.z-q;
  return vec3(hue2rgb(p,q,hsl.x+1.0/3.0),hue2rgb(p,q,hsl.x),hue2rgb(p,q,hsl.x-1.0/3.0));
}
void main(){
  vec3 color=texture(uTex,vUv).rgb;
  if(brightness!=0.0||contrast!=0.0){
    float contrastFactor=(259.0*(contrast+255.0))/(255.0*(259.0-contrast));
    color=(color-0.5)*contrastFactor+0.5+(brightness/255.0);
  }
  if(shadowsVal!=0.0){
    float l=dot(color,vec3(0.299,0.587,0.114));
    if(l<0.5){
      float factor=max(0.0,1.0-l*2.0);
      color+=(shadowsVal/255.0)*factor*0.5;
    }
  }
  if(hueShift!=0.0||saturationShift!=0.0){
    vec3 hsl=rgb2hsl(color);
    hsl.x=mod(hsl.x+hueShift/360.0,1.0);
    hsl.y=clamp(hsl.y+saturationShift/100.0,0.0,1.0);
    color=hsl2rgb(hsl);
  }
  if(sharpen>0.0){
    vec3 n=texture(uTex,vUv+vec2(0.0,-uTexel.y)).rgb;
    vec3 s=texture(uTex,vUv+vec2(0.0,uTexel.y)).rgb;
    vec3 w=texture(uTex,vUv+vec2(-uTexel.x,0.0)).rgb;
    vec3 e=texture(uTex,vUv+vec2(uTexel.x,0.0)).rgb;
    vec3 laplacian=n+s+w+e-4.0*color;
    color=color-(sharpen/100.0)*laplacian;
  }
  if(unsharpAmount>0.0){
    vec2 t=uTexel*unsharpRadius;
    vec3 b=texture(uTex,vUv).rgb*0.25;
    b+=texture(uTex,vUv+vec2(t.x,0.0)).rgb*0.1875;
    b+=texture(uTex,vUv+vec2(-t.x,0.0)).rgb*0.1875;
    b+=texture(uTex,vUv+vec2(0.0,t.y)).rgb*0.1875;
    b+=texture(uTex,vUv+vec2(0.0,-t.y)).rgb*0.1875;
    vec3 diff=color-b;
    color=color+(unsharpAmount/100.0)*diff;
  }
  o=vec4(clamp(color,0.0,1.0),1.0);
}`;

function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s));
  }
  return s;
}

function linkProgram(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p));
  }
  return p;
}

class Fbo {
  constructor(gl, w, h) {
    this.gl = gl;
    this.w = w;
    this.h = h;
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  resize(w, h) {
    if (this.w === w && this.h === h) return;
    this.w = w;
    this.h = h;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  destroy() {
    const gl = this.gl;
    gl.deleteFramebuffer(this.fbo);
    gl.deleteTexture(this.tex);
  }
}

class GpuEnhancer {
  constructor() {
    this.ready = false;
    this.gl = null;
    this.canvas = null;
    this.progs = {};
    this.vao = null;
    this.vbo = null;
    this.fbos = [];
    this.srcTex = null;
    this.w = 0;
    this.h = 0;
  }

  init() {
    if (this.ready) return true;
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) return false;
    this.gl = gl;
    const mk = (fs) => linkProgram(gl, compileShader(gl, gl.VERTEX_SHADER, VS), compileShader(gl, gl.FRAGMENT_SHADER, fs));
    this.progs.copy = mk(FS_COPY);
    this.progs.denoise = mk(FS_DENOISE);
    this.progs.enhance = mk(FS_ENHANCE);
    this.vao = gl.createVertexArray();
    this.vbo = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.srcTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.fbos = [new Fbo(gl, 4, 4), new Fbo(gl, 4, 4)];
    this.ready = true;
    return true;
  }

  _upload(source) {
    const gl = this.gl;
    const w = source.naturalWidth || source.videoWidth || source.width;
    const h = source.naturalHeight || source.videoHeight || source.height;
    if (this.w !== w || this.h !== h) {
      this.w = w;
      this.h = h;
      this.fbos.forEach(f => f.resize(w, h));
    }
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    return { w, h };
  }

  _draw(prog, uniforms, target) {
    const gl = this.gl;
    gl.useProgram(prog);
    gl.bindVertexArray(this.vao);
    if (target) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
      gl.viewport(0, 0, target.w, target.h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.w, this.h);
    }
    Object.entries(uniforms).forEach(([k, v]) => {
      const loc = gl.getUniformLocation(prog, k);
      if (v.tex !== undefined) {
        gl.activeTexture(gl.TEXTURE0 + v.unit);
        gl.bindTexture(gl.TEXTURE_2D, v.tex);
        gl.uniform1i(loc, v.unit);
      } else if (v.length === 2) {
        gl.uniform2fv(loc, v);
      } else {
        gl.uniform1f(loc, v);
      }
    });
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  process(source, params, targetCanvas) {
    if (!this.init()) {
      const ctx = targetCanvas.getContext('2d');
      targetCanvas.width = source.naturalWidth || source.videoWidth || source.width;
      targetCanvas.height = source.naturalHeight || source.videoHeight || source.height;
      ctx.drawImage(source, 0, 0);
      return false;
    }
    const { w, h } = this._upload(source);
    const [f0, f1] = this.fbos;
    const raw = this.srcTex;
    const texel = [1 / w, 1 / h];
    let cur = raw;
    if (params.denoise > 0) {
      this._draw(this.progs.denoise, { uTex: { tex: cur, unit: 0 }, uTexel: texel, uStrength: params.denoise }, f0);
      cur = f0.tex;
    }
    const outFbo = cur === raw ? f0 : f1;
    this._draw(this.progs.enhance, {
      uOrig: { tex: raw, unit: 0 },
      uTex: { tex: cur, unit: 1 },
      uTexel: texel,
      sharpen: params.sharpen,
      unsharpAmount: params.unsharpAmount,
      unsharpRadius: params.unsharpRadius,
      brightness: params.brightness,
      contrast: params.contrast,
      shadowsVal: params.shadows,
      hueShift: params.hue,
      saturationShift: params.saturation
    }, outFbo);
    cur = outFbo.tex;
    this.canvas.width = w;
    this.canvas.height = h;
    this._draw(this.progs.copy, { uTex: { tex: cur, unit: 0 } }, null);
    const ctx = targetCanvas.getContext('2d');
    targetCanvas.width = w;
    targetCanvas.height = h;
    ctx.drawImage(this.canvas, 0, 0);
    return true;
  }
}

window.UpscaleGpuEnhancer = GpuEnhancer;
