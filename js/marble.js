/**
 * Marble background with a cursor "wake".
 *
 * One fixed full-screen WebGL2 canvas paints the marble for every section.
 *  1. A small flow-map texture (ping-pong framebuffers) stores the cursor's
 *     velocity, stamped around the pointer and slowly dissipated each frame.
 *  2. The marble pass offsets its texture lookup by that flow, so the veins
 *     smear in the direction the cursor brushed past, then settle back.
 *
 * Look matches Figma: light sections = marble with "exclusion" over white at
 * 15% (≈ inverted image), the contact section = dark with marble at 7%.
 */
(() => {
  const canvas = document.getElementById('marble');
  const root = document.documentElement;
  const gl = canvas && canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false });

  if (!gl) {
    root.classList.add('no-webgl');
    return;
  }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Rendering into half-float targets needs this extension; without it we
  // still draw the marble, just without the cursor wake.
  const canFlow = !!gl.getExtension('EXT_color_buffer_float') && !reduceMotion;

  const SETTINGS = {
    // 'procedural' = marble drawn by code (no resolution limit, no seams)
    // 'image'      = assets/img/marble.png (the Figma image)
    // Override per visit for comparison: index.html?marble=image
    mode: 'procedural',

    flowSize: 128,     // flow-map resolution
    falloff: 0.2,      // brush radius (in viewport-height units)
    dissipation: 0.965,// how fast the wake fades (closer to 1 = longer)
    strength: 0.03,    // how far the marble is pushed

    // procedural mode
    // 'satin' = glossy liquid-marble folds, 'smoke' = soft rising smoke
    // Override per visit: index.html?style=smoke
    style: 'smoke',

    // satin style
    scale: 560,        // size of the marble pattern, in design px (bigger = larger swirls)
    warp: 6,           // how much the pattern twists (bigger = more liquid)
    veins: 1.2,        // density of the fine ribbons
    speed: 0.02,       // idle flowing speed (0 = still)
    relief: 14,        // how raised the satin folds look (0 = flat)
    gloss: 24,         // highlight sharpness (bigger = smaller, crisper shine)

    // smoke style
    smokeScale: 640,   // size of the smoke clouds, in design px
    smokeDensity: 1,   // how thick the smoke looks (0.5 = faint, 1.5 = heavy)
    smokeSpeed: 0.06,  // how fast it drifts upward (0 = still)
    disperse: 1,       // how strongly the cursor scatters / clears the smoke (0 = off)

    resolution: 0.75,  // render scale of the background (it's soft, so < 1 saves GPU)

    // image mode
    crop: 0.708,       // Figma shows the top 70.8% of the marble image
  };

  // Try values without editing code: index.html?marble=procedural&scale=300&warp=4
  const params = new URLSearchParams(location.search);
  const modeParam = params.get('marble');
  if (modeParam === 'image' || modeParam === 'procedural') SETTINGS.mode = modeParam;
  const styleParam = params.get('style');
  if (styleParam === 'satin' || styleParam === 'smoke') SETTINGS.style = styleParam;
  ['scale', 'warp', 'veins', 'speed', 'relief', 'gloss',
    'smokeScale', 'smokeDensity', 'smokeSpeed', 'disperse',
    'strength', 'falloff', 'dissipation', 'resolution'].forEach((key) => {
    const v = parseFloat(params.get(key));
    if (!Number.isNaN(v)) SETTINGS[key] = v;
  });
  const procedural = SETTINGS.mode === 'procedural';
  const smoke = SETTINGS.style === 'smoke';

  /* ---------- shaders ---------- */

  const VERT = `#version 300 es
    in vec2 position;
    out vec2 vUv;
    void main() {
      vUv = position * 0.5 + 0.5;
      gl_Position = vec4(position, 0.0, 1.0);
    }`;

  const FLOW_FRAG = `#version 300 es
    precision highp float;
    in vec2 vUv;
    out vec4 outColor;
    uniform sampler2D tMap;
    uniform vec2 uMouse;
    uniform vec2 uVelocity;
    uniform float uAspect;
    uniform float uFalloff;
    uniform float uDissipation;

    void main() {
      vec4 color = texture(tMap, vUv) * uDissipation;
      vec2 cursor = vUv - uMouse;
      cursor.x *= uAspect;

      vec3 stamp = vec3(uVelocity * vec2(1.0, -1.0), 1.0 - pow(1.0 - min(1.0, length(uVelocity)), 3.0));
      float falloff = smoothstep(uFalloff, 0.0, length(cursor));
      color.rgb = mix(color.rgb, stamp, vec3(falloff));

      outColor = vec4(color.rgb, 1.0);
    }`;

  const MARBLE_FRAG = `#version 300 es
    precision highp float;
    in vec2 vUv;
    out vec4 outColor;
    uniform sampler2D tMarble;
    uniform sampler2D tFlow;
    uniform vec2 uRes;        // viewport in CSS px
    uniform float uScroll;    // window.scrollY
    uniform float uSecH;      // section height in CSS px
    uniform float uDarkTop;   // document y where the dark (contact) section starts
    uniform float uUnit;      // 1 design px in CSS px
    uniform float uTime;
    uniform float uStrength;
    uniform float uCrop;
    uniform float uReady;     // fades in once the image is loaded
    uniform float uDrift;     // idle liquid motion (0 with reduced motion)
    uniform float uMode;      // 1 = procedural, 0 = image
    uniform float uScale;
    uniform float uWarp;
    uniform float uVeins;
    uniform float uSpeed;
    uniform float uRelief;    // how raised the satin folds look
    uniform float uGloss;     // sharpness of the specular highlight
    uniform float uStyle;     // procedural: 0 = satin, 1 = smoke
    uniform float uSmokeScale;
    uniform float uSmokeDensity;
    uniform float uSmokeSpeed;
    uniform float uDisperse;

    const vec3 WHITE = vec3(1.0);
    const vec3 DARK = vec3(0.133, 0.133, 0.137);

    /* ---- procedural marble: domain-warped fractal noise ---- */

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    vec2 grad(vec2 i) {
      float a = hash(i) * 6.2831853;
      return vec2(cos(a), sin(a));
    }

    // Gradient noise with a quintic fade: organic, without the faint
    // grid-aligned blobs of value noise. Returns roughly 0..1.
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
      float a = dot(grad(i), f);
      float b = dot(grad(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
      float c = dot(grad(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
      float d = dot(grad(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
      return 0.5 + 0.7 * mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }

    // 3 octaves only: more octaves add fine crinkles, but liquid marble
    // is made of smooth, satin-like folds.
    float fbm(vec2 p) {
      const mat2 R = mat2(1.6, 1.2, -1.2, 1.6); // rotate + scale each octave
      float sum = 0.0;
      float amp = 0.55;
      for (int i = 0; i < 3; i++) {
        sum += amp * noise(p);
        p = R * p;
        amp *= 0.45;
      }
      return sum;
    }

    // 6 octaves: smoke needs the fine wisps that satin deliberately avoids.
    float fbmDetail(vec2 p) {
      const mat2 R = mat2(1.6, 1.2, -1.2, 1.6);
      float sum = 0.0;
      float amp = 0.5;
      for (int i = 0; i < 6; i++) {
        sum += amp * noise(p);
        p = R * p;
        amp *= 0.5;
      }
      return sum;
    }

    // Smoke density 0..1. Each warp layer drifts at its own speed, so the
    // smoke curls into itself while the whole field rises (p.y decreases).
    float smokeField(vec2 p, float time) {
      p.y += time;                                         // rise
      vec2 q = vec2(
        fbmDetail(p + vec2(0.0, time * 0.5)),
        fbmDetail(p + vec2(5.2, 1.3) - time * 0.2));
      vec2 r = vec2(
        fbmDetail(p + 3.0 * q + vec2(1.7, 9.2) + time * 0.35),
        fbmDetail(p + 3.0 * q + vec2(8.3, 2.8) - time * 0.25));
      float d = fbmDetail(p + 3.0 * r);

      // thin the field into wisps: dense cores with soft feathered edges
      float wisps = smoothstep(0.42, 0.82, d);
      float haze = smoothstep(0.2, 0.9, length(r) * 0.6);
      return clamp((wisps * 0.85 + haze * 0.15) * uSmokeDensity, 0.0, 1.0);
    }

    // The satin surface. x = height of the folds (0..1), y = large-scale
    // shade. p is in pattern units, time drives the slow flow.
    vec2 marbleField(vec2 p, float time) {
      // twist the space twice (domain warping)
      vec2 q = vec2(fbm(p + time * 0.6), fbm(p + vec2(5.2, 1.3) - time * 0.4));
      vec2 r = vec2(
        fbm(p + uWarp * q + vec2(1.7, 9.2)),
        fbm(p + uWarp * q + vec2(8.3, 2.8)));
      vec2 w = p + uWarp * r;

      // Long diagonal stripes drawn in the twisted space become swirling
      // ribbons (classic marble: sin(x + turbulence)), without the closed
      // "contour rings" you get from banding the noise value itself.
      float phase = (w.x * 0.8 + w.y * 0.6) * uVeins * 6.2831;
      float height = smoothstep(0.0, 1.0, 0.5 + 0.5 * sin(phase));
      return vec2(height, fbm(w * 0.5));
    }

    // Each section ("tile") shows the top W of the image's short axis, so a
    // tile can keep flowing past its bottom edge by B of a section.
    // W * (1 + B) must stay <= 1.
    const float W = 0.87;
    const float B = 0.15;

    // Cubic B-spline sampling built from 4 bilinear taps. The marble image is
    // small (564 × 1128) and gets enlarged ~2-3×, where plain bilinear
    // filtering shows a blocky, pixelated texture.
    vec4 cubic(float v) {
      vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
      vec4 s = n * n * n;
      float x = s.x;
      float y = s.y - 4.0 * s.x;
      float z = s.z - 4.0 * s.y + 6.0 * s.x;
      float w = 6.0 - x - y - z;
      return vec4(x, y, z, w) * (1.0 / 6.0);
    }

    vec3 textureBicubic(sampler2D tex, vec2 uv) {
      vec2 size = vec2(textureSize(tex, 0));
      vec2 inv = 1.0 / size;
      uv = uv * size - 0.5;
      vec2 fxy = fract(uv);
      uv -= fxy;
      vec4 xc = cubic(fxy.x);
      vec4 yc = cubic(fxy.y);
      vec4 c = uv.xxyy + vec2(-0.5, 1.5).xyxy;
      vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
      vec4 o = (c + vec4(xc.yw, yc.yw) / s) * inv.xxyy;
      vec3 s0 = texture(tex, o.xz).rgb;
      vec3 s1 = texture(tex, o.yz).rgb;
      vec3 s2 = texture(tex, o.xw).rgb;
      vec3 s3 = texture(tex, o.yw).rgb;
      float sx = s.x / (s.x + s.y);
      float sy = s.z / (s.z + s.w);
      return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
    }

    // s: 0..1 down the tile (may go up to 1 + B), lu: 0..1 across the screen
    vec3 tile(float k, float s, float lu) {
      float h = mod(k, 2.0) > 0.5 ? 1.0 - lu : lu;   // vary neighbours by mirroring sideways
      float shift = mod(k, 3.0) * 0.12;              // ...and sliding the window
      // the image is portrait and rotated -90deg in Figma
      vec2 iuv = vec2(1.0 - s * W, shift + h * uCrop * W);
      return textureBicubic(tMarble, clamp(iuv, 0.002, 0.998));
    }

    void main() {
      vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uRes;   // top-left origin

      vec3 flow = texture(tFlow, vUv).rgb;
      vec2 offset = flow.xy * uStrength;
      vec2 spx = px - vec2(offset.x, -offset.y) * uRes.y;

      float docY = uScroll + spx.y;

      // where the cursor just passed, the veins show a little stronger
      float boost = clamp(length(flow.xy) * 0.6, 0.0, 1.0);

      vec3 light;   // colour for the white sections
      vec3 dark;    // colour for the dark contact section
      float lum;    // drives the wavy light → dark edge

      if (uMode > 0.5 && uStyle > 0.5) {
        // Smoke: same continuous document space as the satin.
        vec2 p = vec2(spx.x, docY) / uUnit / uSmokeScale;
        float time = uTime * uDrift * uSmokeSpeed;

        // Cursor disturbance. flow.xy is the recent cursor velocity here
        // (y up), fading over time, so all of this settles back by itself.
        float stir = clamp(length(flow.xy) * 0.8, 0.0, 1.0) * uDisperse;
        // 1. curl: push sideways to the motion so the smoke rolls around the path
        vec2 curl = vec2(-flow.y, -flow.x) * 0.06 * uDisperse;
        // 2. scatter: break the wisps up with fine noise where it was stirred
        vec2 scatter = vec2(
          noise(p * 6.0 + time * 4.0),
          noise(p * 6.0 + vec2(7.1, 3.3) - time * 4.0)) - 0.5;
        float s = smokeField(p + curl + scatter * stir * 0.25, time);
        // 3. clear: the cursor's path thins out, then slowly fills back in
        s *= 1.0 - stir * 0.65;

        // grey smoke on white, pale smoke on the dark section
        light = vec3(clamp(1.0 - s * 0.16, 0.0, 1.0));
        dark = DARK + vec3(s * 0.11);
        lum = s * 0.5;
      } else if (uMode > 0.5) {
        // One continuous pattern over the whole document, in design px,
        // so it is resolution-independent and has no section seams.
        vec2 p = vec2(spx.x, docY) / uUnit / uScale;
        float time = uTime * uDrift * uSpeed;
        vec2 field = marbleField(p, time);
        float h = field.x;

        // Light the folds like glossy satin. The slope is measured by
        // sampling the surface 1.5 design px to the right and below.
        // (Screen-space dFdx/dFdy is cheaper but works on 2x2 pixel blocks,
        // which shows up as stair-stepped edges on the highlights.)
        const float EPS = 1.5;
        float hx = marbleField(p + vec2(EPS / uScale, 0.0), time).x;
        float hy = marbleField(p + vec2(0.0, EPS / uScale), time).x;
        vec2 slope = vec2(hx - h, -(hy - h)) / EPS;      // y flipped: light uses y-up
        vec3 n = normalize(vec3(-slope * uRelief, 1.0));
        vec3 L = normalize(vec3(-0.45, 0.55, 0.7));      // light from the top-left
        float tone = clamp(dot(n, L), 0.0, 1.0) - L.z;    // < 0 shadow, > 0 lit
        float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), uGloss);
        float shade = field.y - 0.5;

        // kept subtle: the background should support the content, not compete
        float v = 0.965 + tone * 0.07 + spec * 0.04 - shade * 0.04 - boost * 0.04;
        light = vec3(clamp(v, 0.0, 1.0));
        dark = DARK + vec3(0.015 + tone * 0.03 + spec * 0.045 + shade * 0.015 + boost * 0.03);
        lum = h * 0.5;
      } else {
        vec3 m;
        float t = docY / uSecH;
        float lu = spx.x / uRes.x;

        // A slow breathing so the marble feels liquid even when idle.
        // Driven by the continuous document position t (not the per-section
        // fraction), otherwise it would jump at every section boundary.
        float time = uTime * uDrift;
        lu += 0.004 * uDrift * sin(t * 9.0 + time * 0.30);
        t += 0.004 * uDrift * cos(lu * 7.0 + time * 0.25);

        float k = floor(t);
        float f = t - k;

        // Cross-fade into the previous section's continuation near the top of
        // each section, so there is no visible seam between sections.
        m = tile(k, f, lu);
        if (f < B) {
          vec3 prev = tile(k - 1.0, 1.0 + f, lu);
          m = mix(prev, m, smoothstep(0.0, B, f));
        }

        light = mix(WHITE, WHITE - m, 0.15 + boost * 0.18);
        dark = mix(DARK, m, 0.07 + boost * 0.10);
        lum = dot(m, vec3(0.299, 0.587, 0.114));
      }

      // Light → dark edge follows the marble veins instead of a straight cut.
      // It wobbles within roughly -24..+40 design px of the boundary, so it
      // never reaches the text above (05 footer) or below (06 label).
      float edge = docY - uDarkTop - 8.0 * uUnit + (lum - 0.25) * 32.0 * uUnit;
      float d = smoothstep(-16.0 * uUnit, 16.0 * uUnit, edge);

      vec3 col = mix(light, dark, d);
      vec3 base = mix(WHITE, DARK, d);

      // ±0.5/255 dither keeps the soft marble gradients from banding
      float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      outColor = vec4(mix(base, col, uReady) + dither / 255.0, 1.0);
    }`;

  /* ---------- GL helpers ---------- */

  function compile(type, src) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader));
    }
    return shader;
  }

  function program(frag) {
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(prog, 0, 'position');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog));
    }
    const uniforms = {};
    const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const { name } = gl.getActiveUniform(prog, i);
      uniforms[name] = gl.getUniformLocation(prog, name);
    }
    return { prog, uniforms };
  }

  function createTarget(size) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, size, size, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo };
  }

  let marbleProg, flowProg;
  try {
    marbleProg = program(MARBLE_FRAG);
    flowProg = canFlow ? program(FLOW_FRAG) : null;
  } catch (err) {
    console.warn('[marble] WebGL setup failed, using CSS fallback.', err);
    root.classList.add('no-webgl');
    return;
  }

  // one oversized triangle covers the screen
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // flow ping-pong
  let read = canFlow ? createTarget(SETTINGS.flowSize) : null;
  let write = canFlow ? createTarget(SETTINGS.flowSize) : null;

  // a 1×1 neutral flow texture when the wake is disabled
  const emptyFlow = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, emptyFlow);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));

  // marble image
  const marbleTex = gl.createTexture();
  let ready = 0;
  let loaded = false;
  const img = new Image();
  img.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, marbleTex);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    } catch (err) {
      // Opened via file:// — browsers block images in WebGL there. Use `npm start`.
      console.warn('[marble] Serve the site over http (npm start) for the WebGL effect.', err);
      root.classList.add('no-webgl');
      return;
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    loaded = true;
  };
  img.onerror = () => root.classList.add('no-webgl');
  if (procedural) {
    loaded = true; // nothing to wait for
  } else {
    img.src = 'assets/img/marble.png';
  }

  /* ---------- layout & pointer ---------- */

  const sections = Array.from(document.querySelectorAll('.section'));
  // the first element marked data-marble-dark (and everything below it) is painted dark
  const darkSection = document.querySelector('[data-marble-dark]');
  const docTop = (el) => el.getBoundingClientRect().top + window.scrollY;
  const view = { w: 1, h: 1, dpr: 1, secH: 1, darkTop: Infinity };

  function resize() {
    // the procedural marble is soft, so it can be computed at a lower
    // resolution and stretched without visible loss
    view.dpr = Math.min(window.devicePixelRatio || 1, 2) * (procedural ? SETTINGS.resolution : 1);
    view.w = root.clientWidth;
    view.h = window.innerHeight;
    view.secH = sections[0] ? sections[0].offsetHeight : view.h;
    view.darkTop = darkSection ? docTop(darkSection) : 1e9;
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);
  }
  window.addEventListener('resize', resize);
  resize();

  const mouse = { x: -1, y: -1 };          // flow-map uv (y up)
  const velocity = { x: 0, y: 0 };         // smoothed
  const target = { x: 0, y: 0 };           // latest raw velocity
  let last = null;

  window.addEventListener('pointermove', (e) => {
    const now = performance.now();
    mouse.x = e.clientX / view.w;
    mouse.y = 1 - e.clientY / view.h;
    if (last) {
      const dt = Math.max(14, now - last.t);
      target.x = (e.clientX - last.x) / dt;
      target.y = (e.clientY - last.y) / dt;
    }
    last = { x: e.clientX, y: e.clientY, t: now };
  }, { passive: true });

  document.addEventListener('pointerleave', () => { last = null; });

  /* ---------- loop ---------- */

  const start = performance.now();
  let prev = start;

  function frame(now) {
    const dt = Math.min(64, now - prev) / 16.67; // 1 at 60fps
    prev = now;

    if (loaded && ready < 1) ready = Math.min(1, ready + 0.04 * dt);

    // pointer stopped → let the stamp fade out
    if (last && now - last.t > 50) { target.x = 0; target.y = 0; }
    const moving = target.x !== 0 || target.y !== 0;
    const k = moving ? 0.5 : 0.1;
    velocity.x += (target.x - velocity.x) * k;
    velocity.y += (target.y - velocity.y) * k;

    gl.bindVertexArray(vao);

    if (canFlow) {
      gl.useProgram(flowProg.prog);
      gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
      gl.viewport(0, 0, SETTINGS.flowSize, SETTINGS.flowSize);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, read.tex);
      const u = flowProg.uniforms;
      gl.uniform1i(u.tMap, 0);
      gl.uniform2f(u.uMouse, mouse.x, mouse.y);
      gl.uniform2f(u.uVelocity, velocity.x, velocity.y);
      gl.uniform1f(u.uAspect, view.w / view.h);
      gl.uniform1f(u.uFalloff, SETTINGS.falloff);
      gl.uniform1f(u.uDissipation, Math.pow(SETTINGS.dissipation, dt));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      [read, write] = [write, read];
    }

    gl.useProgram(marbleProg.prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, marbleTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, canFlow ? read.tex : emptyFlow);
    const m = marbleProg.uniforms;
    gl.uniform1i(m.tMarble, 0);
    gl.uniform1i(m.tFlow, 1);
    gl.uniform2f(m.uRes, view.w, view.h);
    // read every frame: main.js refines --u after load, which moves sections
    if (sections[0]) view.secH = sections[0].offsetHeight;
    if (darkSection) view.darkTop = docTop(darkSection);
    gl.uniform1f(m.uScroll, window.scrollY);
    gl.uniform1f(m.uSecH, view.secH);
    gl.uniform1f(m.uDarkTop, view.darkTop);
    gl.uniform1f(m.uUnit, view.w / 1440);
    gl.uniform1f(m.uTime, (now - start) / 1000);
    gl.uniform1f(m.uStrength, SETTINGS.strength);
    gl.uniform1f(m.uCrop, SETTINGS.crop);
    gl.uniform1f(m.uReady, loaded ? ready : 0);
    gl.uniform1f(m.uDrift, reduceMotion ? 0 : 1);
    gl.uniform1f(m.uMode, procedural ? 1 : 0);
    gl.uniform1f(m.uScale, SETTINGS.scale);
    gl.uniform1f(m.uWarp, SETTINGS.warp);
    gl.uniform1f(m.uVeins, SETTINGS.veins);
    gl.uniform1f(m.uSpeed, SETTINGS.speed);
    gl.uniform1f(m.uRelief, SETTINGS.relief);
    gl.uniform1f(m.uGloss, SETTINGS.gloss);
    gl.uniform1f(m.uStyle, smoke ? 1 : 0);
    gl.uniform1f(m.uSmokeScale, SETTINGS.smokeScale);
    gl.uniform1f(m.uSmokeDensity, SETTINGS.smokeDensity);
    gl.uniform1f(m.uSmokeSpeed, SETTINGS.smokeSpeed);
    gl.uniform1f(m.uDisperse, SETTINGS.disperse);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
