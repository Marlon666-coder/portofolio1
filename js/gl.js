/*
 * WebGL2 particle engine: morphs between procedural formations, with
 * depth-of-field point sprites, HDR bloom, chromatic aberration, grain.
 */
(function () {
  /* ------------------------------------------------------------------ math */
  const M = {
    perspective(fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
      return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
    },
    lookAt(e, c, up) {
      let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
      let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
      let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
      l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
      const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
      return new Float32Array([
        xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
        -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1,
      ]);
    },
    // R = Rx(ax) * Ry(ay) * Rz(az), column-major
    rotXYZ(ax, ay, az) {
      const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
      return new Float32Array([
        cy * cz, cx * sz + sx * sy * cz, sx * sz - cx * sy * cz, 0,
        -cy * sz, cx * cz - sx * sy * sz, sx * cz + cx * sy * sz, 0,
        sy, -sx * cy, cx * cy, 0,
        0, 0, 0, 1,
      ]);
    },
  };
  const lerp = (a, b, t) => a + (b - a) * t;
  const lerpV = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

  /* --------------------------------------------------------- scene config */
  // eye/target pairs: [start of chapter, end of chapter]. spin = [rx, ry, rz] rad/s. tilt = static rotation.
  const SCENES = [
    { name: "Genesis", shift: 0, eye: [[0, 5.2, 14], [0.6, 2.4, 9.2]], target: [[0, 0, 0], [0, 0, 0]], fov: 46, spin: [0, 0.045, 0], tilt: [0.18, 0, 0.06], colors: ["#7f95ff", "#ffc183", "#9cc4ff"], bg: ["#05060d", "#0b1030"], intensity: 1.0 },
    { name: "AI Data Center", shift: 0.32, eye: [[0.35, 0.15, 15.5], [0.1, 0.05, 6.5]], target: [[-0.1, 0.0, 0], [0, 0.05, -6]], fov: 58, spin: [0, 0, 0], tilt: [0, 0, 0], colors: ["#3f6fe0", "#3dffd2", "#86c8ff"], bg: ["#03050b", "#06122a"], intensity: 0.85 },
    { name: "Planetary Network", shift: -0.34, eye: [[0, 1.6, 11.5], [2.6, 0.9, 8.4]], target: [[0, 0, 0], [0.4, 0, 0]], fov: 45, spin: [0, 0.06, 0], tilt: [0.32, 0, -0.12], colors: ["#4d7dff", "#ffb35c", "#6ae6ff"], bg: ["#03050c", "#071634"], intensity: 1.0 },
    { name: "Primary Compute Node", shift: 0.34, eye: [[0, 6.5, 6.8], [1.8, 3.2, 3.9]], target: [[0, 0, 0], [0, 0.2, 0]], fov: 45, spin: [0, 0.025, 0], tilt: [0, 0.6, 0], colors: ["#c27a3d", "#ffe2a6", "#ff8a3a"], bg: ["#080503", "#1d0f06"], intensity: 1.0 },
    { name: "Orbital Intelligence", shift: -0.34, eye: [[0, 2.2, 12.5], [-3.2, 1.1, 8.2]], target: [[0, 0, 0], [0, 0, 0]], fov: 45, spin: [0, 0.07, 0], tilt: [0.2, 0, 0.1], colors: ["#5a72ff", "#ffffff", "#8fb0ff"], bg: ["#020309", "#0a0f2b"], intensity: 1.0 },
    { name: "Quantum Intelligence", shift: 0.34, eye: [[0, 0.4, 11.5], [0.7, 0.35, 4.4]], target: [[0, 0, 0], [0, 0, 0]], fov: 50, spin: [0.03, 0.05, 0], tilt: [0, 0, 0], colors: ["#8a5cff", "#e6a6ff", "#6ff0ff"], bg: ["#06030c", "#160a2e"], intensity: 0.9 },
    { name: "Autonomous Systems", shift: -0.3, eye: [[-9.5, 2.4, 9.5], [-2.2, 1.2, 7]], target: [[0, 0, 0], [1, 0, 0]], fov: 45, spin: [0.09, 0, 0], tilt: [0, 0, 0], colors: ["#3fd8a8", "#d6fff0", "#5dffc4"], bg: ["#020806", "#05201a"], intensity: 1.0 },
    { name: "Horizon", shift: 0, eye: [[0, 1.6, 13], [0, 0.55, 9.6]], target: [[0, 0, 0], [0, 0.1, 0]], fov: 45, spin: [0, 0.035, 0], tilt: [0.12, 0, 0], colors: ["#d9d4ff", "#ffcf9e", "#fff0d8"], bg: ["#05050a", "#141226"], intensity: 1.0 },
  ].map((s) => ({ ...s, rgb: s.colors.map(hex), bgRgb: s.bg.map(hex) }));

  /* ------------------------------------------------------------- shaders */
  const PARTICLE_VS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform sampler2D uPos;
uniform int uSide, uA, uB;
uniform float uMix, uTime, uRes, uSize, uFocus, uAperture, uMaxSize, uIntensity;
uniform mat4 uMA, uMB, uView, uProj;
uniform vec3 uCA[3];
uniform vec3 uCB[3];
out vec3 vColor;

float h11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }

vec4 fetchP(int s, int id) { return texelFetch(uPos, ivec2(id % uSide, id / uSide + s * uSide), 0); }

vec3 shade(vec4 d, vec3 C[3], float fid, out float sk) {
  float w = d.w;
  if (w >= 1.0) {
    float t = w - 1.0;
    float ph = fract(t * 2.0 - uTime * 0.22);
    float pulse = pow(ph, 22.0);
    sk = 1.0 + pulse * 1.4;
    return C[2] * (0.28 + pulse * 5.0);
  }
  if (w > 0.25) {
    float r = h11(fid * 3.17);
    float f = h11(fid + floor(uTime * (0.6 + r * 2.4) + r * 13.0));
    float on = step(0.22, f);
    sk = 2.1;
    return C[1] * mix(0.25, 2.2, on);
  }
  sk = 1.0;
  float tw = 0.85 + 0.15 * sin(uTime * 1.3 + fid * 0.37);
  return C[0] * tw;
}

void main() {
  int id = gl_VertexID;
  float fid = float(id);
  vec4 a = fetchP(uA, id);
  vec4 b = fetchP(uB, id);
  float r = h11(fid * 1.37 + 0.5);
  float local = clamp(uMix * 1.6 - r * 0.6, 0.0, 1.0);
  local = local * local * (3.0 - 2.0 * local);

  vec3 pa = (uMA * vec4(a.xyz, 1.0)).xyz;
  vec3 pb = (uMB * vec4(b.xyz, 1.0)).xyz;
  vec3 p = mix(pa, pb, local);

  float k = sin(local * 3.14159265);
  vec3 n = vec3(
    sin(p.y * 0.55 + uTime * 0.6 + r * 6.2831),
    sin(p.z * 0.55 + uTime * 0.5 + r * 12.566),
    sin(p.x * 0.55 + uTime * 0.7 + r * 18.85));
  vec3 swirl = vec3(-p.z, 0.0, p.x) * 0.25;
  p += (n * 1.6 + swirl) * k;
  p += 0.012 * vec3(sin(uTime * 0.8 + r * 40.0), cos(uTime * 0.7 + r * 30.0), sin(uTime * 0.9 + r * 20.0));

  vec4 mv = uView * vec4(p, 1.0);
  gl_Position = uProj * mv;

  float sa, sb;
  vec3 ca = shade(a, uCA, fid, sa);
  vec3 cb = shade(b, uCB, fid, sb);
  vec3 col = mix(ca, cb, local) * (1.0 + k * 0.9);
  float sk = mix(sa, sb, local);

  float dist = max(-mv.z, 0.05);
  float s = uSize * sk * uRes / dist;
  float coc = uAperture * abs(dist - uFocus) / dist * uRes;
  float size = clamp(sqrt(s * s + coc * coc), 1.25, uMaxSize);
  float energy = (s * s) / (size * size);
  energy *= smoothstep(0.15, 1.1, dist);
  gl_PointSize = size;
  vColor = col * uIntensity * energy;
}`;

  const PARTICLE_FS = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 o;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float d = dot(c, c);
  if (d > 1.0) discard;
  float a = exp(-d * 3.2) - 0.04;
  o = vec4(vColor * max(a, 0.0) * 1.3, 1.0);
}`;

  const QUAD_VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

  const DOWN_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uThreshold;
uniform int uPrefilter;
out vec4 o;
void main() {
  vec3 c = texture(uTex, vUv + uTexel * vec2(-1.0, -1.0)).rgb
         + texture(uTex, vUv + uTexel * vec2( 1.0, -1.0)).rgb
         + texture(uTex, vUv + uTexel * vec2(-1.0,  1.0)).rgb
         + texture(uTex, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  c *= 0.25;
  if (uPrefilter == 1) {
    float br = max(c.r, max(c.g, c.b));
    float knee = uThreshold * 0.6;
    float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    c *= max(soft, br - uThreshold) / max(br, 1e-4);
  }
  o = vec4(c, 1.0);
}`;

  const UP_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uWeight;
out vec4 o;
void main() {
  vec4 d = uTexel.xyxy * vec4(1.0, 1.0, -1.0, 0.0);
  vec3 s = texture(uTex, vUv - d.xy).rgb;
  s += texture(uTex, vUv - d.wy).rgb * 2.0;
  s += texture(uTex, vUv - d.zy).rgb;
  s += texture(uTex, vUv + d.zw).rgb * 2.0;
  s += texture(uTex, vUv).rgb * 4.0;
  s += texture(uTex, vUv + d.xw).rgb * 2.0;
  s += texture(uTex, vUv + d.zy).rgb;
  s += texture(uTex, vUv + d.wy).rgb * 2.0;
  s += texture(uTex, vUv + d.xy).rgb;
  o = vec4(s * (uWeight / 16.0), 1.0);
}`;

  const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene, uBloom;
uniform float uBloomStr, uTime, uFlash, uAspect, uFade;
uniform vec3 uBg0, uBg1;
uniform vec2 uRes;
out vec4 o;

vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

void main() {
  vec2 d = vUv - 0.5;
  float r2 = dot(d, d);
  float ca = 0.002 + r2 * 0.012 + uFlash * 0.008;
  vec3 col;
  col.r = texture(uScene, vUv - d * ca).r;
  col.g = texture(uScene, vUv).g;
  col.b = texture(uScene, vUv + d * ca).b;
  vec3 bloom = texture(uBloom, vUv).rgb;
  col += bloom * uBloomStr;

  float g = length(d * vec2(uAspect, 1.0));
  vec3 bg = mix(uBg1, uBg0, smoothstep(0.0, 0.85, g));
  col += bg;

  col *= 1.0 + uFlash * 1.5;
  col = aces(col * 1.05);
  col *= mix(1.0, smoothstep(1.05, 0.25, g), 0.75);
  col = pow(col, vec3(1.0 / 2.2));

  float grain = h21(vUv * uRes + fract(uTime * 13.37) * 500.0) - 0.5;
  col += grain * 0.045;
  col *= 0.97 + 0.03 * sin(vUv.y * uRes.y * 1.5);
  col *= uFade;
  o = vec4(col, 1.0);
}`;

  /* -------------------------------------------------------- gl helpers */
  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + "\n" + src);
    return s;
  }
  function program(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, "");
      u[name] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  }

  /* ---------------------------------------------------------- engine */
  const Engine = {
    SCENES,
    ready: false,
    progress: 0, // continuous chapter position [0, S-1]
    mouse: [0, 0],
    flash: 0,
    fade: 0,
    stats: { fps: 60, particles: 0 },
    onFrame: null,

    async init(canvas, onProgress) {
      const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "high-performance" });
      if (!gl) throw new Error("WebGL2 not supported");
      this.gl = gl;
      this.canvas = canvas;

      const mobile = Math.min(window.innerWidth, window.innerHeight) < 700 || /Mobi|Android/i.test(navigator.userAgent);
      const side = mobile ? 176 : 256;
      this.side = side;
      this.N = side * side;
      this.stats.particles = this.N;
      this.dprCap = mobile ? 1.5 : 1.75;

      // HDR targets when available
      this.hdr = !!gl.getExtension("EXT_color_buffer_float") || !!gl.getExtension("EXT_color_buffer_half_float");

      // Generate formations scene by scene so the loader can animate.
      const S = SCENES.length;
      const data = new Float32Array(this.N * 4 * S);
      for (let s = 0; s < S; s++) {
        await new Promise((r) => setTimeout(r, 16));
        window.EdolusScenes.buildScene(s, side, data);
        onProgress && onProgress((s + 1) / (S + 1));
      }

      this.posTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.posTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, side, side * S, 0, gl.RGBA, gl.FLOAT, data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      this.pParticles = program(gl, PARTICLE_VS, PARTICLE_FS);
      this.pDown = program(gl, QUAD_VS, DOWN_FS);
      this.pUp = program(gl, QUAD_VS, UP_FS);
      this.pComp = program(gl, QUAD_VS, COMPOSITE_FS);
      this.vao = gl.createVertexArray();

      this.resize();
      window.addEventListener("resize", () => this.resize());
      onProgress && onProgress(1);
      this.ready = true;
      this.t0 = performance.now();
      this.last = this.t0;
      this.frames = 0;
      this.fpsT = this.t0;
      this.slowFrames = 0;
      requestAnimationFrame((t) => this.frame(t));
    },

    makeTarget(w, h) {
      const gl = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (this.hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE && this.hdr) {
        // Fall back to LDR if the half-float target is not renderable.
        gl.deleteFramebuffer(fb); gl.deleteTexture(tex);
        this.hdr = false;
        return this.makeTarget(w, h);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { tex, fb, w, h };
    },

    resize() {
      const gl = this.gl;
      const dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
      const w = Math.max(2, Math.floor(window.innerWidth * dpr));
      const h = Math.max(2, Math.floor(window.innerHeight * dpr));
      this.canvas.width = w;
      this.canvas.height = h;
      this.dpr = dpr;
      const free = (t) => { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); } };
      free(this.sceneRT);
      (this.levels || []).forEach(free);
      this.sceneRT = this.makeTarget(w, h);
      this.levels = [];
      let lw = w, lh = h;
      for (let i = 0; i < 6; i++) {
        lw = Math.max(1, lw >> 1); lh = Math.max(1, lh >> 1);
        this.levels.push(this.makeTarget(lw, lh));
      }
      this.W = w; this.H = h;
    },

    camera(time) {
      const S = SCENES.length;
      const p = clamp(this.progress, 0, S - 1);
      const k = Math.min(Math.floor(p), S - 1);
      const f = p - k;
      const m = k >= S - 1 ? 0 : easeInOut(smooth(0.32, 0.92, f));
      const camAt = (i, u) => {
        const sc = SCENES[i], e = easeInOut(clamp(u, 0, 1));
        return { eye: lerpV(sc.eye[0], sc.eye[1], e), target: lerpV(sc.target[0], sc.target[1], e), fov: sc.fov };
      };
      const A = camAt(k, k >= S - 1 ? f : f / 0.92);
      const B = camAt(Math.min(k + 1, S - 1), 0);
      const eye = lerpV(A.eye, B.eye, m), target = lerpV(A.target, B.target, m);
      const fov = lerp(A.fov, B.fov, m);

      // mouse parallax: orbit slightly around target
      const yaw = this.mouse[0] * 0.12, pitch = this.mouse[1] * 0.06;
      const rel = [eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]];
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      const rx = rel[0] * cy + rel[2] * sy, rz = -rel[0] * sy + rel[2] * cy;
      const dist = Math.hypot(rx, rel[1], rz);
      const finalEye = [target[0] + rx, target[1] + rel[1] + pitch * dist * 0.5, target[2] + rz];
      // gentle handheld breathing
      finalEye[0] += Math.sin(time * 0.31) * 0.06;
      finalEye[1] += Math.sin(time * 0.43) * 0.04;
      return { eye: finalEye, target, fov, k, m, dist };
    },

    sceneModel(i, time) {
      const s = SCENES[i];
      return M.rotXYZ(s.tilt[0] + s.spin[0] * time, s.tilt[1] + s.spin[1] * time, s.tilt[2] + s.spin[2] * time);
    },

    frame(now) {
      requestAnimationFrame((t) => this.frame(t));
      const gl = this.gl;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      const time = (now - this.t0) / 1000;

      // fps + adaptive resolution
      this.frames++;
      if (now - this.fpsT > 500) {
        this.stats.fps = Math.round((this.frames * 1000) / (now - this.fpsT));
        this.frames = 0; this.fpsT = now;
        if (this.stats.fps < 32 && this.dprCap > 1) {
          this.slowFrames++;
          if (this.slowFrames > 3) { this.dprCap = Math.max(1, this.dprCap - 0.5); this.resize(); this.slowFrames = 0; }
        } else this.slowFrames = 0;
      }
      this.flash *= Math.exp(-dt * 3.5);
      this.fade = Math.min(1, this.fade + dt * 0.6);

      const cam = this.camera(time);
      const S = SCENES.length;
      const A = cam.k, B = Math.min(cam.k + 1, S - 1);
      const sa = SCENES[A], sb = SCENES[B];
      const aspect = this.W / this.H;
      const proj = M.perspective((cam.fov * Math.PI) / 180, aspect, 0.05, 200);
      // lens shift: push the subject away from the chapter copy (less on narrow screens)
      const shift = lerp(sa.shift, sb.shift, cam.m) * (aspect > 1.2 ? 1 : 0);
      proj[8] = -shift;
      const view = M.lookAt(cam.eye, cam.target, [0, 1, 0]);

      /* ---- particles into HDR scene target ---- */
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneRT.fb);
      gl.viewport(0, 0, this.W, this.H);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      const P = this.pParticles;
      gl.useProgram(P.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.posTex);
      gl.uniform1i(P.u.uPos, 0);
      gl.uniform1i(P.u.uSide, this.side);
      gl.uniform1i(P.u.uA, A);
      gl.uniform1i(P.u.uB, B);
      gl.uniform1f(P.u.uMix, cam.m);
      gl.uniform1f(P.u.uTime, time);
      gl.uniform1f(P.u.uRes, this.H / (2 * Math.tan((cam.fov * Math.PI) / 360)));
      gl.uniform1f(P.u.uSize, 0.022 * (this.side === 256 ? 1 : 1.35));
      gl.uniform1f(P.u.uFocus, cam.dist);
      gl.uniform1f(P.u.uAperture, 0.0035);
      gl.uniform1f(P.u.uMaxSize, 36 * this.dpr);
      gl.uniform1f(P.u.uIntensity, lerp(sa.intensity, sb.intensity, cam.m) * (this.hdr ? 0.24 : 0.16) * (256 / this.side) * (256 / this.side) * this.fade);
      gl.uniformMatrix4fv(P.u.uMA, false, this.sceneModel(A, time));
      gl.uniformMatrix4fv(P.u.uMB, false, this.sceneModel(B, time));
      gl.uniformMatrix4fv(P.u.uView, false, view);
      gl.uniformMatrix4fv(P.u.uProj, false, proj);
      gl.uniform3fv(P.u.uCA, sa.rgb.flat());
      gl.uniform3fv(P.u.uCB, sb.rgb.flat());
      gl.bindVertexArray(this.vao);
      gl.drawArrays(gl.POINTS, 0, this.N);

      /* ---- bloom: downsample chain ---- */
      gl.disable(gl.BLEND);
      const D = this.pDown;
      gl.useProgram(D.p);
      gl.uniform1i(D.u.uTex, 0);
      gl.uniform1f(D.u.uThreshold, 0.35);
      let src = this.sceneRT;
      this.levels.forEach((dst, i) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
        gl.viewport(0, 0, dst.w, dst.h);
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform2f(D.u.uTexel, 1 / src.w, 1 / src.h);
        gl.uniform1i(D.u.uPrefilter, i === 0 ? 1 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        src = dst;
      });
      /* ---- bloom: additive upsample ---- */
      const U = this.pUp;
      gl.useProgram(U.p);
      gl.uniform1i(U.u.uTex, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = this.levels.length - 1; i > 0; i--) {
        const s = this.levels[i], d = this.levels[i - 1];
        gl.bindFramebuffer(gl.FRAMEBUFFER, d.fb);
        gl.viewport(0, 0, d.w, d.h);
        gl.bindTexture(gl.TEXTURE_2D, s.tex);
        gl.uniform2f(U.u.uTexel, 1 / s.w, 1 / s.h);
        gl.uniform1f(U.u.uWeight, 1.0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.BLEND);

      /* ---- composite to screen ---- */
      const C = this.pComp;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.W, this.H);
      gl.useProgram(C.p);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sceneRT.tex);
      gl.uniform1i(C.u.uScene, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.levels[0].tex);
      gl.uniform1i(C.u.uBloom, 1);
      gl.uniform1f(C.u.uBloomStr, 0.13);
      gl.uniform1f(C.u.uTime, time);
      gl.uniform1f(C.u.uFlash, this.flash + Math.sin(cam.m * Math.PI) * 0.25);
      gl.uniform1f(C.u.uAspect, aspect);
      gl.uniform1f(C.u.uFade, Math.min(1, this.fade * 1.5));
      gl.uniform2f(C.u.uRes, this.W, this.H);
      gl.uniform3fv(C.u.uBg0, lerpV(sa.bgRgb[0], sb.bgRgb[0], cam.m).map((v) => v * 0.32));
      gl.uniform3fv(C.u.uBg1, lerpV(sa.bgRgb[1], sb.bgRgb[1], cam.m).map((v) => v * 0.32));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);

      this.onFrame && this.onFrame({ time, dt, cam });
    },
  };

  window.EdolusGL = Engine;
})();
