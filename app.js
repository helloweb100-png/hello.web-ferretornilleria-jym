/* =========================================================================
   J&K FERRETORNILLERÍA · app.js
   Orden del archivo:
     1. Utilidades y estado
     2. Loader (medidor de torque)
     3. Escena 3D (Three.js): tornillo del hero, partículas, tornillo del cierre
        y renders de producto generados en vivo
     4. Movimiento (GSAP + ScrollTrigger + Lenis)
     5. Interfaz: menú, formulario a WhatsApp, acordeón
     6. Arranque
   El contenido es visible por defecto: las animaciones solo "mejoran" cuando
   las librerías cargan (clase .js-anim). Sin ellas la página sigue funcionando.
   ========================================================================= */
(() => {
  'use strict';

  /* ---------- 1. Utilidades y estado ---------- */
  const WA_NUMBER = '5212224247330';
  const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.min.js';

  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const html = document.documentElement;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const hasGSAP = () => !!(window.gsap && window.ScrollTrigger);
  const animated = !reduceMotion;

  const state = {
    intro: 0,       // 0..1, entrada del tornillo del hero
    finale: 0,      // 0..1, avance del tornillo del cierre (scroll)
    lenis: null,
    introDone: false,
  };

  const waUrl = (msg) => `https://wa.me/${WA_NUMBER}${msg ? `?text=${encodeURIComponent(msg)}` : ''}`;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // Cede el hilo principal un cuadro para que el loader y el navegador respiren entre tareas pesadas.
  // (El respaldo con setTimeout evita que la carga se quede colgada en pestañas en segundo plano.)
  const nextFrame = () => new Promise((resolve) => {
    let done = false;
    const go = () => { if (!done) { done = true; resolve(); } };
    requestAnimationFrame(go);
    setTimeout(go, 60);
  });

  // Enlaces a WhatsApp con mensaje contextual por botón
  $$('[data-wa]').forEach((a) => a.setAttribute('href', waUrl(a.dataset.wa)));
  const yearEl = $('#year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------- 2. Loader ---------- */
  function createLoader() {
    const el = $('#loader');
    if (!el) return { ready() {}, whenFull: Promise.resolve(), exit: (cb) => { cb && cb(); return Promise.resolve(); } };

    const gauge = $('.gauge__progress', el);
    const pctEl = $('#loaderPct');
    const msgEl = $('#loaderMsg');
    const steps = [[0, 'Seleccionando tornillos'], [30, 'Midiendo cada rosca'], [62, 'Aplicando torque'], [94, 'Apretado']];
    const MIN = animated ? 2000 : 350;
    const t0 = performance.now();
    let shown = 0;
    let isReady = false;
    let resolveFull;
    const whenFull = new Promise((r) => (resolveFull = r));

    const paint = (v) => {
      gauge.style.setProperty('--p', v.toFixed(2));
      pctEl.textContent = Math.min(100, Math.round(v));
      const m = steps.filter(([t]) => v >= t).pop();
      if (m && msgEl.textContent !== m[1]) msgEl.textContent = m[1];
    };

    const loop = () => {
      const timeP = clamp((performance.now() - t0) / MIN, 0, 1);
      const goal = timeP * (isReady ? 100 : 91);
      shown += (goal - shown) * 0.14;
      paint(shown);
      if (isReady && timeP >= 1 && shown > 99.3) {
        paint(100);
        resolveFull();
        return;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    return {
      ready() { isReady = true; },
      whenFull,
      exit(onMid, onPre) {
        return new Promise((resolve) => {
          const done = () => { el.remove(); resolve(); };
          onPre && onPre();
          if (!hasGSAP() || reduceMotion) { onMid && onMid(); done(); return; }
          const g = window.gsap;
          const tl = g.timeline({ onComplete: done });
          tl.to('.loader__core', { scale: 1.12, duration: .3, ease: 'power2.in' })
            .to('.loader__core', { opacity: 0, scale: .9, duration: .35, ease: 'power2.in' }, '>-0.05')
            .addLabel('open', '>-0.1')
            .to('.loader__half--top', { yPercent: -100, duration: 1, ease: 'expo.inOut' }, 'open')
            .to('.loader__half--bottom', { yPercent: 100, duration: 1, ease: 'expo.inOut' }, 'open')
            .call(() => onMid && onMid(), null, 'open+=0.65');
        });
      },
    };
  }

  /* ---------- 3. Escena 3D ---------- */
  const hasWebGL = () => {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) { return false; }
  };

  async function createScene() {
    if (!hasWebGL()) throw new Error('WebGL no disponible');
    const THREE = await import(THREE_URL);
    try { await Promise.race([document.fonts.load('900 150px Archivo'), wait(1800)]); } catch (e) { /* sin fuente: usa fallback */ }

    await nextFrame();
    const TAU = Math.PI * 2;
    const canvas = $('#gl');
    const small = matchMedia('(max-width: 899px)').matches;
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x000000, 0);
    await nextFrame();
    // El canvas ocupa toda la pantalla: se limita la resolución y baja sola si el equipo va justo.
    const dprCap = small ? 1.25 : 1.5;
    let pr = Math.min(devicePixelRatio || 1, dprCap);
    let busy = false;            // true mientras se generan los renders de producto
    let pendingResize = false;

    /* --- Entorno de estudio: softboxes blancos + franja amarilla + azul de marca --- */
    const makeEnv = () => {
      const pm = new THREE.PMREMGenerator(renderer);
      const s = new THREE.Scene();
      s.add(new THREE.Mesh(new THREE.BoxGeometry(24, 24, 24), new THREE.MeshBasicMaterial({ color: 0xb9c4d8, side: THREE.BackSide })));
      const panel = (w, h, color, k, pos) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
        m.position.set(...pos); m.lookAt(0, 0, 0); s.add(m);
      };
      panel(14, 5, 0xffffff, 7, [0, 10, 3]);      // softbox superior
      panel(4, 14, 0xffffff, 5, [-10, 1, 4]);     // tira izquierda
      panel(4, 14, 0xffd60a, 4, [10, 0, 3]);      // tira amarilla de marca
      panel(14, 4, 0x2f5cff, 2.4, [0, -10, 3]);   // rebote azul inferior
      panel(8, 8, 0xffffff, 2.2, [0, 2, 11]);     // relleno frontal
      panel(3, 12, 0x0a1230, 1, [-6, 0, -9]);     // contraste oscuro (da definición al cromo)
      panel(3, 12, 0x0a1230, 1, [7, 0, -8]);
      panel(10, 2, 0x0a1230, 1, [0, -4, 10]);
      const rt = pm.fromScene(s, 0.035);
      pm.dispose();
      return rt.texture;
    };
    const env = makeEnv();
    await nextFrame();

    /* --- Materiales --- */
    const metal = (color, metalness, roughness, extra = {}) =>
      new THREE.MeshStandardMaterial({ color, metalness, roughness, envMapIntensity: 1.2, side: THREE.DoubleSide, ...extra });
    const M = {
      steel: metal(0xdfe7f4, 1, 0.2),
      zinc: metal(0xcfdcef, 1, 0.3),
      yellow: metal(0xf4c20d, 0.9, 0.27),
      blue: metal(0x2a55d4, 0.85, 0.26),
      phos: metal(0x30343d, 0.6, 0.4),
      navy: metal(0x14307a, 0.55, 0.38),
      dark: new THREE.MeshStandardMaterial({ color: 0x0b0e15, metalness: 0.2, roughness: 0.75, side: THREE.DoubleSide }),
    };

    /* --- Geometrías base --- */
    const hexPts = (R, rot = 0) => Array.from({ length: 6 }, (_, i) => new THREE.Vector2(Math.cos(rot + i * Math.PI / 3) * R, Math.sin(rot + i * Math.PI / 3) * R));
    const circlePath = (r) => { const p = new THREE.Path(); p.absarc(0, 0, r, 0, TAU, true); return p; };
    const extrudeY = (shape, depth, bevel = 0.04, segs = 3) => {
      const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: segs, curveSegments: 48 });
      g.rotateX(-Math.PI / 2);
      return g;
    };
    const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

    // Rosca helicoidal real: perfil trapezoidal que avanza con el ángulo.
    function threadGeometry({ len, rMaj = 0.5, depth = 0.085, pitch = 0.2, neck = 0.9, tipLen = 0.35, sharp = false, na = 56, spp = 9 }) {
      const rMin = rMaj - depth;
      const nz = Math.max(8, Math.round((len / pitch) * spp));
      const pos = [];
      const idx = [];
      for (let i = 0; i <= nz; i++) {
        const z = (i / nz) * len;
        const w = neck <= 0 ? 1 : smooth(neck, neck + 0.4, z);
        const s0 = len - tipLen;
        let taper = 1;
        if (z > s0) taper = sharp ? Math.max(0.03, 1 - ((z - s0) / tipLen) * 0.97) : 1 - smooth(s0, len, z) * 0.22;
        for (let j = 0; j < na; j++) {
          const th = (j / na) * TAU;
          let f = z / pitch - th / TAU; f -= Math.floor(f);
          const prof = smooth(0, 0.3, f) - smooth(0.52, 0.82, f);
          const r = (rMin + depth * ((1 - w) + w * prof)) * taper;
          pos.push(Math.cos(th) * r, -z, Math.sin(th) * r);
        }
      }
      for (let i = 0; i < nz; i++) {
        for (let j = 0; j < na; j++) {
          const a = i * na + j, b = i * na + ((j + 1) % na), c = (i + 1) * na + j, d = (i + 1) * na + ((j + 1) % na);
          idx.push(a, b, c, b, d, c);
        }
      }
      // Tapa de la punta (vértices propios para arista dura)
      const capBase = pos.length / 3;
      const lastStart = nz * na * 3;
      for (let j = 0; j < na; j++) pos.push(pos[lastStart + j * 3], pos[lastStart + j * 3 + 1], pos[lastStart + j * 3 + 2]);
      pos.push(0, -len, 0);
      const center = capBase + na;
      for (let j = 0; j < na; j++) idx.push(center, capBase + j, capBase + ((j + 1) % na));
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    }

    const lathe = (pts, seg = 64) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);

    /* --- Textura grabada "J&K" para la cabeza del tornillo del hero --- */
    const stampMaterial = (() => {
      const s = 512;
      const c = document.createElement('canvas'); c.width = c.height = s;
      const g = c.getContext('2d');
      g.fillStyle = '#7a7a7a'; g.fillRect(0, 0, s, s);
      g.strokeStyle = '#ffffff'; g.lineWidth = 9; g.beginPath(); g.arc(s / 2, s / 2, s * 0.385, 0, TAU); g.stroke();
      g.strokeStyle = '#3a3a3a'; g.lineWidth = 5; g.beginPath(); g.arc(s / 2, s / 2, s * 0.33, 0, TAU); g.stroke();
      g.fillStyle = '#ffffff'; g.font = '900 148px Archivo, "Arial Black", Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('J&K', s / 2, s / 2 + 8);
      const tex = new THREE.CanvasTexture(c);
      tex.anisotropy = 8;
      tex.repeat.set(0.5 / 0.93, 0.5 / 0.93); tex.offset.set(0.5, 0.5);
      return metal(0xdfe7f4, 1, 0.22, { bumpMap: tex, bumpScale: 2.4 });
    })();

    /* --- Cabezas (se construyen hacia +Y desde y=0) --- */
    const markCross = (y, s = 1) => {
      const g = new THREE.Group();
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.72 * s, 0.07, 0.13 * s), M.dark);
      const b = a.clone(); b.rotation.y = Math.PI / 2;
      g.add(a, b); g.position.y = y; return g;
    };
    const markSlot = (y, len = 1.3, rot = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.14), M.dark);
      m.position.y = y; m.rotation.y = rot; return m;
    };
    const HEAD = {
      hex(mat, stamp) {
        const g = new THREE.Group();
        const shape = new THREE.Shape(hexPts(0.866));
        g.add(new THREE.Mesh(extrudeY(shape, 0.5, 0.05, 3), stamp ? [stampMaterial, mat] : mat));
        const w = new THREE.Mesh(new THREE.CylinderGeometry(0.74, 0.74, 0.07, 56), mat); w.position.y = -0.09; g.add(w);
        return g;
      },
      allen(mat) {
        const g = new THREE.Group();
        const low = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.42, 64), mat); low.position.y = 0.21; g.add(low);
        const sh = new THREE.Shape(); sh.absarc(0, 0, 0.76, 0, TAU, false);
        const hole = new THREE.Path(); hole.setFromPoints(hexPts(0.42)); sh.holes.push(hole);
        const up = new THREE.Mesh(extrudeY(sh, 0.4, 0.04, 3), mat); up.position.y = 0.42; g.add(up);
        const floor = new THREE.Mesh(new THREE.CircleGeometry(0.42, 6), M.dark); floor.rotation.x = -Math.PI / 2; floor.position.y = 0.43; g.add(floor);
        return g;
      },
      pan(mat) {
        const g = new THREE.Group();
        const pts = [[0, 0], [0.86, 0], [0.86, 0.12]];
        for (let k = 1; k <= 16; k++) { const a = (k / 16) * Math.PI / 2; pts.push([0.86 * Math.cos(a), 0.12 + 0.42 * Math.sin(a)]); }
        g.add(new THREE.Mesh(lathe(pts), mat));
        g.add(markSlot(0.53, 1.35, 0.35));
        return g;
      },
      flat(mat, pozi) {
        const g = new THREE.Group();
        g.add(new THREE.Mesh(lathe([[0, 0], [0.5, 0], [0.9, 0.4], [0.92, 0.44], [0.88, 0.48], [0, 0.48]]), mat));
        g.add(markCross(0.49, 1));
        if (pozi) { const d = markCross(0.49, 0.6); d.rotation.y = Math.PI / 4; g.add(d); }
        return g;
      },
      bugle(mat) {
        const g = new THREE.Group();
        const pts = [[0, 0], [0.5, 0]];
        for (let k = 1; k <= 14; k++) { const t = k / 14; pts.push([0.5 + 0.42 * (1 - Math.pow(1 - t, 2.3)), 0.52 * t]); }
        pts.push([0.88, 0.54], [0, 0.54]);
        g.add(new THREE.Mesh(lathe(pts), mat));
        g.add(markCross(0.55, 1));
        return g;
      },
      gota(mat) {
        const g = new THREE.Group();
        const pts = [[0, 0], [0.84, 0], [0.84, 0.1]];
        for (let k = 1; k <= 18; k++) { const a = (k / 18) * Math.PI / 2; pts.push([0.84 * Math.cos(a), 0.1 + 0.62 * Math.sin(a)]); }
        g.add(new THREE.Mesh(lathe(pts), mat));
        g.add(markCross(0.73, 0.8));
        g.add(markSlot(0.72, 1.2, Math.PI / 4));
        return g;
      },
    };

    function makeBolt({ head, mat = M.steel, headMat = mat, thread, stamp = false }) {
      const g = new THREE.Group();
      g.add(HEAD[head](headMat, stamp));
      g.add(new THREE.Mesh(threadGeometry(thread), mat));
      return g;
    }
    function makeNut(mat, R = 0.866, h = 0.78, hole = 0.6) {
      const shape = new THREE.Shape(hexPts(R)); shape.holes.push(circlePath(hole));
      const m = new THREE.Mesh(extrudeY(shape, h - 0.1, 0.05, 3), mat); m.position.y = 0.05; return m;
    }
    function makeWasher(mat, outer = 1.0, inner = 0.58, t = 0.1) {
      const shape = new THREE.Shape(); shape.absarc(0, 0, outer, 0, TAU, false); shape.holes.push(circlePath(inner));
      const m = new THREE.Mesh(extrudeY(shape, t - 0.04, 0.02, 2), mat); m.position.y = 0.02; return m;
    }

    /* --- Disco de corte (genérico, sin marcas de terceros) --- */
    function discLabel() {
      const s = 1024, c = document.createElement('canvas'); c.width = c.height = s;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(s / 2, s / 2, 60, s / 2, s / 2, s / 2);
      grad.addColorStop(0, '#2a52c9'); grad.addColorStop(1, '#17399c');
      g.fillStyle = grad; g.fillRect(0, 0, s, s);
      g.globalAlpha = 0.07;
      for (let i = 0; i < 2600; i++) { g.fillStyle = Math.random() > 0.5 ? '#fff' : '#000'; g.fillRect(Math.random() * s, Math.random() * s, 2, 2); }
      g.globalAlpha = 1;
      g.fillStyle = '#f2f6ff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      const arc = (txt, r, a0, a1, px, bottom = false) => {
        g.font = `800 ${px}px Archivo, Arial, sans-serif`;
        const step = (a1 - a0) / (txt.length - 1 || 1);
        [...txt].forEach((ch, i) => { const a = a0 + step * i; g.save(); g.translate(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r); g.rotate(bottom ? a - Math.PI / 2 : a + Math.PI / 2); g.fillText(ch, 0, 0); g.restore(); });
      };
      arc('DISCO DE CORTE', s * 0.4, -Math.PI * 0.86, -Math.PI * 0.14, 54);
      arc('METAL E INOXIDABLE', s * 0.4, Math.PI * 0.82, Math.PI * 0.18, 50, true);
      g.font = '900 150px Archivo, Arial, sans-serif'; g.fillText('4½″', s * 0.5, s * 0.8 - 40);
      g.font = '700 46px "JetBrains Mono", monospace'; g.fillText('115 x 1.0 x 22.2 mm', s * 0.5, s * 0.2 + 60);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
      const R = 2.32; tex.repeat.set(0.5 / R, 0.5 / R); tex.offset.set(0.5, 0.5);
      return tex;
    }
    let discTex = null;
    function makeDisc() {
      const g = new THREE.Group();
      const R = 2.3;
      const shape = new THREE.Shape(); shape.absarc(0, 0, R, 0, TAU, false); shape.holes.push(circlePath(0.5));
      discTex = discTex || discLabel();
      const label = new THREE.MeshStandardMaterial({ map: discTex, metalness: 0.1, roughness: 0.62, side: THREE.DoubleSide });
      const edge = new THREE.MeshStandardMaterial({ color: 0x0f2468, metalness: 0.2, roughness: 0.7, side: THREE.DoubleSide });
      g.add(new THREE.Mesh(extrudeY(shape, 0.1, 0.02, 2), [label, edge]));
      const hub = new THREE.Shape(); hub.absarc(0, 0, 0.88, 0, TAU, false); hub.holes.push(circlePath(0.5));
      const hm = new THREE.Mesh(extrudeY(hub, 0.2, 0.02, 2), metal(0xaab5c9, 1, 0.45, { envMapIntensity: 0.7 })); hm.position.y = -0.06; g.add(hm);
      return g;
    }

    /* --- Catálogo de piezas para los renders de producto --- */
    const PRODUCTS = {
      hex: { build: () => makeBolt({ head: 'hex', mat: M.steel, thread: { len: 4.6, pitch: 0.2, depth: 0.085, neck: 1.3 } }), tilt: -0.82, pitch: 0.5, spin: 0.5 },
      allen: { build: () => makeBolt({ head: 'allen', mat: M.phos, thread: { len: 4.2, pitch: 0.18, depth: 0.08, neck: 0.8 } }), tilt: -0.8, pitch: 0.55, spin: 0.2 },
      machine: { build: () => makeBolt({ head: 'pan', mat: M.zinc, thread: { len: 4.4, pitch: 0.17, depth: 0.075, neck: 0.05 } }), tilt: -0.85, pitch: 0.5, spin: 0.4 },
      pija: { build: () => makeBolt({ head: 'flat', mat: M.steel, thread: { len: 4.6, pitch: 0.36, depth: 0.2, neck: 0.8, sharp: true, tipLen: 1.2 } }), tilt: -0.8, pitch: 0.5, spin: 0.3 },
      drywall: { build: () => makeBolt({ head: 'bugle', mat: M.phos, thread: { len: 4.8, pitch: 0.27, depth: 0.15, neck: 0.5, sharp: true, tipLen: 1.1 } }), tilt: -0.8, pitch: 0.52, spin: 0.6 },
      multi: { build: () => makeBolt({ head: 'flat', mat: M.yellow, stamp: true, thread: { len: 4.2, pitch: 0.32, depth: 0.18, neck: 0.6, sharp: true, tipLen: 1.0 } }), tilt: -0.82, pitch: 0.5, spin: 1.1 },
      gota: { build: () => makeBolt({ head: 'gota', mat: M.zinc, thread: { len: 4.0, pitch: 0.2, depth: 0.09, neck: 0.6 } }), tilt: -0.82, pitch: 0.52, spin: 0.8 },
      disc: { build: makeDisc, tilt: -0.35, pitch: 0.95, spin: 0.2 },
      'disc-flat': { build: makeDisc, tilt: 0, pitch: Math.PI / 2 - 0.0, spin: 0, flat: true },
    };

    // Un producto por cuadro: así el loader sigue girando fluido mientras se generan.
    async function renderProducts() {
      busy = true;
      const out = {};
      const S = 560;
      const prevPR = renderer.getPixelRatio();
      const prevSize = renderer.getSize(new THREE.Vector2());
      renderer.setPixelRatio(1);
      renderer.setSize(S, S, false);
      const sc = new THREE.Scene();
      sc.environment = env;
      const key = new THREE.DirectionalLight(0xffffff, 1.1); key.position.set(3, 6, 5); sc.add(key);
      const cam = new THREE.PerspectiveCamera(22, 1, 0.1, 100);
      for (const [name, def] of Object.entries(PRODUCTS)) {
        const obj = def.build();
        const inner = new THREE.Group(); inner.add(obj); inner.rotation.y = def.spin;
        const pivot = new THREE.Group(); pivot.add(inner);
        pivot.rotation.set(def.pitch, 0, def.tilt);
        if (def.flat) pivot.rotation.set(Math.PI / 2, 0, 0);
        sc.add(pivot);
        pivot.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(pivot);
        const size = box.getSize(new THREE.Vector3()); const ctr = box.getCenter(new THREE.Vector3());
        pivot.position.sub(ctr);
        const maxDim = Math.max(size.x, size.y);
        const dist = (maxDim / 2) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * (def.flat ? 1.1 : 1.16) + size.z / 2;
        cam.position.set(0, 0, dist); cam.lookAt(0, 0, 0);
        renderer.render(sc, cam);
        out[name] = canvas.toDataURL('image/png');
        sc.remove(pivot);
        pivot.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
        await nextFrame();
      }
      renderer.setPixelRatio(prevPR);
      renderer.setSize(prevSize.x, prevSize.y, false);
      renderer.clear();
      busy = false;
      if (pendingResize) resize();
      return out;
    }

    // Calienta la escena viva detrás del loader: compila shaders y sube texturas/geometrías a la GPU.
    // Así el primer cuadro real del hero no se congela justo cuando aparece el título.
    async function warm() {
      resize();
      hero.root.visible = fin.root.visible = true;
      partMeshes.forEach((m) => { m.visible = true; });
      hero.root.scale.setScalar(0.3); fin.root.scale.setScalar(0.3);
      try { if (renderer.compileAsync) await renderer.compileAsync(scene, camera); else renderer.compile(scene, camera); } catch (e) { /* se compilará al primer cuadro */ }
      renderer.render(scene, camera);
      await nextFrame();
      renderer.render(scene, camera);
      await nextFrame();
      renderer.clear();
      hero.root.visible = fin.root.visible = false;
      partMeshes.forEach((m) => { m.visible = false; });
    }

    /* --- Escena viva (hero + cierre) --- */
    await nextFrame();
    const scene = new THREE.Scene();
    scene.environment = env;
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 0, 14);
    const VIS_H = 2 * 14 * Math.tan(THREE.MathUtils.degToRad(15)); // alto visible en z=0
    const key = new THREE.DirectionalLight(0xffffff, 1.0); key.position.set(4, 7, 8); scene.add(key);

    // Hero: tornillo con cabeza estampada J&K, tuerca viajando por la rosca y partículas
    const hero = { root: new THREE.Group(), tilt: new THREE.Group(), holder: new THREE.Group(), spin: new THREE.Group(), slider: new THREE.Group() };
    const heroPitch = 0.2;
    hero.spin.add(makeBolt({ head: 'hex', mat: M.steel, stamp: true, thread: { len: 4.6, pitch: heroPitch, depth: 0.085, neck: 1.3, tipLen: 0.32 } }));
    const hWasher = makeWasher(M.steel, 0.98, 0.6, 0.12); hWasher.position.y = -0.12;
    const hNut = makeNut(M.blue, 0.866, 0.78, 0.6); hNut.position.y = -0.9;
    hero.slider.add(hWasher, hNut);
    hero.holder.position.y = 2.0;
    hero.holder.add(hero.spin, hero.slider);
    hero.tilt.add(hero.holder);
    hero.root.add(hero.tilt);
    scene.add(hero.root);

    // Partículas: tuercas, arandelas y tornillos cortos (InstancedMesh)
    const nParts = small ? 0.55 : 1;
    const specs = [
      { n: Math.round(4 * nParts), geo: makeNut(M.yellow).geometry, mat: M.yellow, k: 0.34 },
      { n: Math.round(4 * nParts), geo: makeNut(M.steel).geometry, mat: M.steel, k: 0.3 },
      { n: Math.round(3 * nParts), geo: makeNut(M.blue).geometry, mat: M.blue, k: 0.32 },
      { n: Math.round(6 * nParts), geo: makeWasher(M.steel).geometry, mat: M.steel, k: 0.34 },
    ];
    const shortHead = new THREE.ExtrudeGeometry(new THREE.Shape(hexPts(0.866)), { depth: 0.5, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2, curveSegments: 24 }).rotateX(-Math.PI / 2);
    const shortShank = threadGeometry({ len: 1.8, pitch: 0.2, depth: 0.085, neck: 0.2, tipLen: 0.3 });
    const dummy = new THREE.Object3D();
    const rand = (a, b) => a + Math.random() * (b - a);
    const parts = [];
    const partMeshes = [];
    const addInstanced = (geo, mat, n) => { const m = new THREE.InstancedMesh(geo, mat, n); m.frustumCulled = false; scene.add(m); partMeshes.push(m); return m; };
    specs.forEach((sp) => {
      if (!sp.n) return;
      const mesh = addInstanced(sp.geo, sp.mat, sp.n);
      for (let i = 0; i < sp.n; i++) parts.push({ mesh, i, k: sp.k, pair: null });
    });
    const nBolts = Math.round(6 * nParts);
    if (nBolts) {
      const heads = addInstanced(shortHead, M.steel, nBolts);
      const shanks = addInstanced(shortShank, M.steel, nBolts);
      for (let i = 0; i < nBolts; i++) parts.push({ mesh: heads, pair: shanks, i, k: 0.3 });
    }
    parts.forEach((p) => {
      let ox, oy;
      do { ox = rand(-0.5, 0.85); oy = small ? rand(-0.42, 0.78) : rand(-0.75, 0.75); } while (ox * ox * 1.7 + oy * oy * 0.45 < 0.16);
      p.ox = ox; p.oy = oy; p.oz = rand(-3.5, 1.2);
      p.s = p.k * rand(0.7, 1.25);
      p.rx = rand(-1, 1) * 0.6; p.ry = rand(-1, 1) * 0.6; p.rz = rand(-1, 1) * 0.5;
      p.r0 = new THREE.Euler(rand(0, TAU), rand(0, TAU), rand(0, TAU));
      p.ph = rand(0, TAU); p.amp = rand(0.02, 0.07); p.sp = rand(0.25, 0.6);
    });

    await nextFrame();
    // Cierre: placa azul, arandela, tornillo corto que se aprieta y tuerca
    const fin ={ root: new THREE.Group(), tilt: new THREE.Group(), bolt: new THREE.Group(), spin: new THREE.Group() };
    {
      const plate = new THREE.Shape();
      const w = 2.15, r = 0.3;
      plate.moveTo(-w + r, -w); plate.lineTo(w - r, -w); plate.quadraticCurveTo(w, -w, w, -w + r); plate.lineTo(w, w - r); plate.quadraticCurveTo(w, w, w - r, w);
      plate.lineTo(-w + r, w); plate.quadraticCurveTo(-w, w, -w, w - r); plate.lineTo(-w, -w + r); plate.quadraticCurveTo(-w, -w, -w + r, -w);
      plate.holes.push(circlePath(0.58));
      const pm = new THREE.Mesh(extrudeY(plate, 0.22, 0.04, 3), M.navy); pm.position.y = -0.26;
      const fw = makeWasher(M.yellow, 1.05, 0.6, 0.12); fw.position.y = 0;
      const fnut = makeNut(M.yellow, 0.866, 0.78, 0.6); fnut.position.y = -1.1;
      const bolt = makeBolt({ head: 'hex', mat: M.steel, stamp: true, thread: { len: 2.9, pitch: 0.2, depth: 0.085, neck: 0.6, tipLen: 0.3 } });
      fin.spin.add(bolt);
      fin.bolt.add(fin.spin);
      fin.tilt.add(pm, fw, fnut, fin.bolt);
      fin.root.add(fin.tilt);
      fin.tilt.position.y = -0.2;
      scene.add(fin.root);
    }

    /* --- Ciclo de render solo cuando el hero o el cierre son visibles --- */
    const anchors = { hero: $('[data-bolt-anchor="hero"]'), finale: $('[data-bolt-anchor="finale"]') };
    const vis = { hero: false, finale: false };
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    let vw = innerWidth, vh = innerHeight;
    let running = false, raf = 0, last = 0, time = 0, lastScroll = scrollY, finaleSmooth = 0;

    const resize = () => {
      if (busy) { pendingResize = true; return; }
      pendingResize = false;
      vw = innerWidth; vh = innerHeight;
      renderer.setPixelRatio(pr);
      renderer.setSize(vw, vh, false);
      camera.aspect = vw / vh; camera.updateProjectionMatrix();
    };
    resize();
    addEventListener('resize', resize, { passive: true });
    if (finePointer) addEventListener('pointermove', (e) => { mouse.tx = (e.clientX / vw - 0.5) * 2; mouse.ty = (e.clientY / vh - 0.5) * 2; }, { passive: true });

    const place = (rect) => {
      const wpp = VIS_H / vh;
      return { cx: (rect.left + rect.width / 2 - vw / 2) * wpp, cy: -(rect.top + rect.height / 2 - vh / 2) * wpp, size: Math.min(rect.width, rect.height) * wpp };
    };

    function updateHero(dt) {
      const p = place(anchors.hero.getBoundingClientRect());
      const intro = easeOutExpo(state.intro);
      const s = (p.size * 0.9 / 5.3) * (0.55 + 0.45 * intro);
      hero.root.position.set(p.cx, p.cy + (1 - intro) * p.size * 1.1, 0);
      hero.root.scale.setScalar(s);
      hero.tilt.rotation.set(0.5 + mouse.y * 0.16, mouse.x * 0.3, -0.72 - mouse.x * 0.05);
      const dScroll = scrollY - lastScroll;
      if (animated) {
        hero.spin.rotation.y += dt * (0.75 + (1 - intro) * 9) + dScroll * 0.012;
        const u = 0.5 + 0.5 * Math.sin(time * 0.85);
        hero.slider.position.y = -1.5 - u * 1.9;
        hero.slider.rotation.y = (hero.slider.position.y / heroPitch) * TAU;
      } else {
        hero.slider.position.y = -2.3;
      }

      // Partículas alrededor del escenario
      const S = p.size;
      const bs = S * 0.9 / 5.3;
      parts.forEach((q) => {
        const dr = animated ? time : 0;
        dummy.position.set(
          p.cx + q.ox * S + Math.sin(dr * q.sp + q.ph) * q.amp * S,
          p.cy + q.oy * S + Math.cos(dr * q.sp * 0.9 + q.ph) * q.amp * S + (1 - intro) * S * 0.6,
          q.oz
        );
        dummy.rotation.set(q.r0.x + dr * q.rx, q.r0.y + dr * q.ry, q.r0.z + dr * q.rz);
        dummy.scale.setScalar(bs * q.s * (0.2 + 0.8 * intro));
        dummy.updateMatrix();
        q.mesh.setMatrixAt(q.i, dummy.matrix);
        if (q.pair) q.pair.setMatrixAt(q.i, dummy.matrix);
      });
      partMeshes.forEach((m) => { m.visible = true; m.instanceMatrix.needsUpdate = true; });
    }

    function updateFinale(dt) {
      const p = place(anchors.finale.getBoundingClientRect());
      finaleSmooth += (state.finale - finaleSmooth) * (1 - Math.exp(-dt * 6));
      const t = easeOutCubic(clamp(finaleSmooth, 0, 1));
      fin.root.position.set(p.cx, p.cy, 0);
      fin.root.scale.setScalar(p.size * 0.9 / 5.8);
      fin.tilt.rotation.set(0.42 + mouse.y * 0.08, -0.5 + mouse.x * 0.2 + Math.sin(time * 0.4) * 0.05, 0);
      fin.bolt.position.y = lerp(3.6, 0.12, t);
      fin.spin.rotation.y = finaleSmooth * TAU * 7;
    }

    let accDt = 0, accN = 0;
    function frame(now) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;
      // Calidad adaptativa: si el promedio pasa de ~31 fps, baja la resolución del canvas un escalón
      accDt += dt; accN++;
      if (accN >= 45) {
        if (accDt / accN > 0.032 && pr > 1) { pr = Math.max(1, pr - 0.25); resize(); }
        accDt = 0; accN = 0;
      }
      const k = 1 - Math.exp(-dt * 5);
      mouse.x += (mouse.tx - mouse.x) * k; mouse.y += (mouse.ty - mouse.y) * k;
      hero.root.visible = vis.hero;
      partMeshes.forEach((m) => { m.visible = vis.hero; });
      fin.root.visible = vis.finale;
      if (vis.hero) updateHero(dt);
      if (vis.finale) updateFinale(dt);
      lastScroll = scrollY;
      renderer.render(scene, camera);
    }
    function sync() {
      const want = (vis.hero || vis.finale) && !document.hidden;
      if (want && !running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
      else if (!want && running) { running = false; cancelAnimationFrame(raf); renderer.clear(); }
    }
    // El observador se crea en start(): antes de eso no se renderiza la escena viva
    // (así no choca con la generación de renders de producto ni con el loader).
    let io = null;
    function start() {
      if (!io) {
        io = new IntersectionObserver((entries) => {
          entries.forEach((e) => { vis[e.target.dataset.boltAnchor] = e.isIntersecting; });
          sync();
        }, { rootMargin: '120px' });
        Object.values(anchors).forEach((a) => a && io.observe(a));
        document.addEventListener('visibilitychange', sync);
      }
      sync();
    }
    const show = () => canvas.classList.add('is-on');

    return { renderProducts, warm, start, show, resize };
  }

  /* ---------- 4. Movimiento ---------- */
  function splitWords(el) {
    const words = [];
    const walk = (node) => {
      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType === 3) {
          const frag = document.createDocumentFragment();
          child.textContent.split(/(\s+)/).forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
            const s = document.createElement('span');
            s.className = 'w'; s.textContent = part;
            frag.appendChild(s); words.push(s);
          });
          node.replaceChild(frag, child);
        } else if (child.nodeType === 1) walk(child);
      });
    };
    walk(el);
    return words;
  }

  function initMotion() {
    const gsap = window.gsap, ScrollTrigger = window.ScrollTrigger;
    gsap.registerPlugin(ScrollTrigger);
    ScrollTrigger.config({ ignoreMobileResize: true });

    // Smooth scroll
    if (window.Lenis) {
      const lenis = new window.Lenis({ lerp: 0.09, smoothWheel: true, wheelMultiplier: 0.9 });
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add((t) => lenis.raf(t * 1000));
      // Durante la entrada se deja el suavizado de saltos de GSAP (500ms/33ms): si el navegador
      // tropieza un cuadro, la animación del título continúa en vez de "saltarse" al final.
      // Se desactiva al terminar la entrada (lo recomienda Lenis para el scroll).
      lenis.stop();
      state.lenis = lenis;
    }

    // Barra de progreso (hilo)
    gsap.to('.progress', { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: 0.2 } });

    // Navegación: se oculta al bajar, vuelve al subir
    const header = $('.site-header');
    ScrollTrigger.create({
      start: 0, end: 'max',
      onUpdate: (self) => { header.classList.toggle('is-hidden', self.direction === 1 && self.scroll() > 280 && !header.classList.contains('menu-open')); },
    });
    // Enlace activo según sección
    const links = $$('.nav__links a');
    links.forEach((a) => {
      const sec = $(a.getAttribute('href'));
      if (!sec) return;
      ScrollTrigger.create({
        trigger: sec, start: 'top 55%', end: 'bottom 55%',
        onToggle: (self) => { if (self.isActive) links.forEach((l) => l.setAttribute('aria-current', l === a ? 'true' : 'false')); else a.setAttribute('aria-current', 'false'); },
      });
    });

    // Marquee: velocidad y dirección dependen del scroll
    const mq = $('.marquee');
    if (mq) {
      mq.classList.add('is-gsap');
      const track = gsap.to('.marquee__inner', { xPercent: -50, duration: 46, ease: 'none', repeat: -1 });
      let dir = 1, boost = 0;
      ScrollTrigger.create({ start: 0, end: 'max', onUpdate: (self) => { if (self.direction) dir = self.direction; boost = Math.min(Math.abs(self.getVelocity()) / 320, 7); } });
      gsap.ticker.add(() => {
        boost *= 0.93;
        track.timeScale(lerp(track.timeScale(), dir * (1 + boost), 0.1));
        gsap.set('.marquee__skew', { skewX: clamp(-dir * boost * 1.4, -9, 9) });
      });
    }

    // Manifiesto: las palabras se encienden con el scroll
    const man = $('.manifesto__text');
    if (man) {
      const words = splitWords(man);
      gsap.fromTo(words, { opacity: 0.14 }, { opacity: 1, ease: 'none', stagger: 0.12, scrollTrigger: { trigger: man, start: 'top 80%', end: 'bottom 45%', scrub: 0.4 } });
      $$('mark', man).forEach((m) => {
        gsap.fromTo(m, { backgroundSize: '0% 0.4em' }, { backgroundSize: '100% 0.4em', ease: 'none', scrollTrigger: { trigger: m, start: 'top 72%', end: 'top 42%', scrub: true } });
      });
    }

    const mm = gsap.matchMedia();

    // Catálogo: panorámica horizontal anclada (escritorio) / carrusel nativo (móvil)
    mm.add('(min-width: 900px)', () => {
      const pin = $('.catalog__pin'), vp = $('.catalog__viewport'), track = $('.catalog__track'), bar = $('.catalog__bar span');
      if (!pin || !track) return;
      const dist = () => Math.max(0, track.scrollWidth - vp.clientWidth);
      const pan = gsap.to(track, {
        x: () => -dist(), ease: 'none',
        scrollTrigger: {
          trigger: pin, start: 'top top', end: () => '+=' + dist(), pin: true, scrub: 0.7, anticipatePin: 1, invalidateOnRefresh: true,
          onUpdate: (self) => bar.style.setProperty('--prog', (0.08 + self.progress * 0.92).toFixed(3)),
        },
      });
      $$('.pcard').forEach((card) => {
        const st = { trigger: card, containerAnimation: pan, start: 'left 100%', end: 'right 0%', scrub: true };
        const img = $('.pcard__img', card), word = $('.pcard__word', card);
        if (img) gsap.fromTo(img, { xPercent: 9, rotate: -5 }, { xPercent: -9, rotate: 5, ease: 'none', scrollTrigger: st });
        if (word) gsap.fromTo(word, { xPercent: 16 }, { xPercent: -16, ease: 'none', scrollTrigger: st });
      });
      return () => bar.style.removeProperty('--prog');
    });
    mm.add('(max-width: 899px)', () => {
      const vp = $('.catalog__viewport'), bar = $('.catalog__bar span');
      if (!vp) return;
      const upd = () => { const max = vp.scrollWidth - vp.clientWidth; bar.style.setProperty('--prog', (0.1 + (max > 0 ? vp.scrollLeft / max : 0) * 0.9).toFixed(3)); };
      vp.addEventListener('scroll', upd, { passive: true });
      upd();
      return () => vp.removeEventListener('scroll', upd);
    });

    // Imagen que se abre a pantalla completa
    // El recorte se interpola con números propios: el navegador normaliza inset()
    // a 3 valores cuando izquierda y derecha coinciden y eso rompe la mezcla de strings.
    const setupExpand = (from) => {
      const pinEl = $('.expand__pin'), frame = $('.expand__frame'), img = $('img', frame), copy = $('.expand__copy'), cap = $('.expand__caption');
      if (!pinEl) return;
      const o = { ...from };
      const paint = () => { frame.style.clipPath = `inset(${o.t}% ${o.r}% ${o.b}% ${o.l}% round ${o.rad}px)`; };
      paint();
      gsap.set(copy.children, { opacity: 0, y: 40 });
      const tl = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: pinEl, start: 'top top', end: '+=140%', pin: true, scrub: 0.6, anticipatePin: 1 } });
      tl.to(o, { t: 0, r: 0, b: 0, l: 0, rad: 0, duration: 1, onUpdate: paint }, 0)
        .fromTo(img, { scale: 1.45 }, { scale: 1, duration: 1 }, 0)
        .to(cap, { opacity: 0, duration: 0.25 }, 0)
        .to(copy.children, { opacity: 1, y: 0, stagger: 0.14, duration: 0.5 }, 0.62);
      return () => { frame.style.clipPath = ''; gsap.set([copy.children, cap, img], { clearProps: 'all' }); };
    };
    mm.add('(min-width: 900px)', () => setupExpand({ t: 19, r: 30, b: 24, l: 30, rad: 16 }));
    mm.add('(max-width: 899px)', () => setupExpand({ t: 23, r: 9, b: 28, l: 9, rad: 16 }));

    // Cartas apiladas: la anterior se hunde al llegar la siguiente
    const cards = $$('.wcard');
    cards.forEach((card, i) => {
      if (i === cards.length - 1) return;
      // Las cartas son opacas: la anterior se hunde y se oscurece, sin transparentar el texto de las de abajo
      gsap.fromTo(card, { scale: 1, '--dim': 0 }, { scale: 0.93 - i * 0.004, '--dim': 0.34, ease: 'none', scrollTrigger: { trigger: cards[i + 1], start: 'top 88%', end: 'top 22%', scrub: true } });
    });
    mm.add('(min-width: 900px)', () => {
      cards.forEach((card) => {
        const img = $('.wcard__img', card);
        if (!img) return;
        gsap.set(img, { y: 0, yPercent: -50, rotate: -12 });
        gsap.fromTo(img, { y: 50, rotate: -22 }, { y: -50, rotate: -4, ease: 'none', scrollTrigger: { trigger: card, start: 'top bottom', end: 'bottom top', scrub: true } });
      });
    });
    mm.add('(max-width: 899px)', () => {
      cards.forEach((card) => {
        const img = $('.wcard__img', card);
        if (!img) return;
        gsap.fromTo(img, { rotate: -22, y: 30 }, { rotate: -6, y: -20, ease: 'none', scrollTrigger: { trigger: card, start: 'top bottom', end: 'bottom top', scrub: true } });
      });
    });

    // Bento: contador y regla
    const num = $('[data-count]');
    if (num) {
      const target = +num.dataset.count, o = { v: 0 };
      ScrollTrigger.create({ trigger: '.b1', start: 'top 82%', once: true, onEnter: () => gsap.to(o, { v: target, duration: 1.6, ease: 'power2.out', onUpdate: () => (num.textContent = Math.round(o.v)) }) });
      num.textContent = '0';
    }

    // Hilo de "Cómo pedir"
    const thread = $('.steps__list');
    if (thread) gsap.fromTo(thread, { '--tp': 0 }, { '--tp': 1, ease: 'none', scrollTrigger: { trigger: thread, start: 'top 72%', end: 'bottom 62%', scrub: 0.5 } });

    // Cierre: el tornillo se aprieta con el scroll
    ScrollTrigger.create({ trigger: '.finale', start: 'top 80%', end: 'center 42%', onUpdate: (self) => { state.finale = self.progress; } });

    // Aparición por lotes (el contenido ya es visible sin JS)
    ScrollTrigger.batch('[data-reveal]', {
      start: 'top 88%', once: true,
      onEnter: (batch) => gsap.fromTo(batch, { opacity: 0, y: 32 }, {
        opacity: 1, y: 0, duration: 1.1, ease: 'expo.out', stagger: 0.09, overwrite: true,
        onComplete: () => batch.forEach((el) => { el.classList.add('is-in'); gsap.set(el, { clearProps: 'opacity,transform' }); }),
      }),
    });

    // Inclinación 3D de piezas del catálogo con el puntero
    if (finePointer) {
      $$('.pcard__media:not(.pcard__media--photo)').forEach((m) => {
        const img = $('.pcard__img', m);
        if (!img) return;
        gsap.set(img, { transformPerspective: 800 });
        const rx = gsap.quickTo(img, 'rotationX', { duration: 0.7, ease: 'power3' });
        const ry = gsap.quickTo(img, 'rotationY', { duration: 0.7, ease: 'power3' });
        m.addEventListener('pointermove', (e) => { const r = m.getBoundingClientRect(); ry(((e.clientX - r.left) / r.width - 0.5) * 22); rx(-((e.clientY - r.top) / r.height - 0.5) * 22); });
        m.addEventListener('pointerleave', () => { rx(0); ry(0); });
      });
    }

    // Parallax suave del hero
    const heroEl = $('.hero');
    gsap.to('.hero__copy', { yPercent: -8, opacity: 0.35, ease: 'none', scrollTrigger: { trigger: heroEl, start: 'top top', end: 'bottom top', scrub: true } });
    gsap.to('.stage-art', { yPercent: -10, scale: 1.06, ease: 'none', scrollTrigger: { trigger: heroEl, start: 'top top', end: 'bottom top', scrub: true } });
  }

  function playIntro(scene) {
    const gsap = window.gsap;
    if (scene) scene.show();
    const title = $('.hero__title');
    const tl = gsap.timeline({ defaults: { ease: 'expo.out' }, onComplete: () => finishIntro() });
    const finishIntro = () => {
      ['.hero__title', '.hero__stage', '.wa-float', '.site-header'].forEach((s) => { const e = $(s); if (e) e.classList.add('is-in'); });
      $$('[data-hero]').forEach((e) => e.classList.add('is-in'));
      gsap.set(['.hero__title .line > span', '[data-hero]', '.hero__stage', '.wa-float'], { clearProps: 'opacity,transform' });
      state.introDone = true;
      gsap.ticker.lagSmoothing(0);
      performance.mark('jk-intro-done');
      if (state.lenis) state.lenis.start();
      html.classList.remove('is-loading');
      window.ScrollTrigger.refresh();
    };
    tl.fromTo('.site-header', { yPercent: -160, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 1.1 }, 0.1)
      .fromTo('[data-hero="pill"]', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 1 }, 0.05)
      // y: 0 explícito: GSAP lee el translateY(112%) del CSS como píxeles y, sin esto, ese resto
      // dejaba el título escondido hasta el final de la entrada.
      .fromTo('.hero__title .line > span', { yPercent: 112, y: 0 }, { yPercent: 0, y: 0, duration: 1.3, stagger: 0.12 }, 0.1)
      .call(() => title.classList.add('hl-on'), null, 0.9)
      .fromTo('[data-hero="lead"]', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 1 }, 0.5)
      .fromTo('[data-hero="cta"]', { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 1 }, 0.65)
      .fromTo('.hero__stage', { opacity: 0, scale: 0.86 }, { opacity: 1, scale: 1, duration: 1.4 }, 0.1)
      .fromTo('.wa-float', { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.9, ease: 'back.out(1.8)' }, 1.5)
      .to(state, { intro: 1, duration: 2, ease: 'none' }, 0.15);
    // Aviso del botón flotante, una sola vez
    setTimeout(() => { const w = $('.wa-float'); if (w) { w.classList.add('show-tip'); setTimeout(() => w.classList.remove('show-tip'), 5200); } }, 9000);
  }

  /* ---------- 5. Interfaz ---------- */
  function initUI() {
    const header = $('.site-header');
    const toggle = $('.nav__toggle');
    const menu = $('#menu');
    const anim = hasGSAP() && animated;

    const openMenu = () => {
      menu.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'Cerrar menú');
      header.classList.add('menu-open');
      html.classList.add('menu-is-open');
      header.classList.remove('is-hidden');
      html.style.overflow = 'hidden';
      if (state.lenis) state.lenis.stop();
      if (anim) {
        window.gsap.fromTo(menu, { clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0% 0)', duration: 0.7, ease: 'expo.out' });
        window.gsap.fromTo('.menu__nav a, .menu__foot > *', { y: 36, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, stagger: 0.06, ease: 'expo.out', delay: 0.15 });
      }
      const first = $('.menu__nav a', menu); if (first) first.focus({ preventScroll: true });
    };
    const closeMenu = (returnFocus = true) => {
      if (menu.hidden) return;
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Abrir menú');
      header.classList.remove('menu-open');
      html.classList.remove('menu-is-open');
      html.style.overflow = '';
      if (state.lenis && state.introDone) state.lenis.start();
      const done = () => { menu.hidden = true; };
      if (anim) window.gsap.to(menu, { clipPath: 'inset(0 0 100% 0)', duration: 0.5, ease: 'expo.inOut', onComplete: done });
      else done();
      if (returnFocus) toggle.focus({ preventScroll: true });
    };
    toggle.addEventListener('click', () => (toggle.getAttribute('aria-expanded') === 'true' ? closeMenu() : openMenu()));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
    matchMedia('(min-width: 1000px)').addEventListener('change', (e) => { if (e.matches) closeMenu(false); });

    // Anclas con scroll suave
    $$('a[href^="#"]').forEach((a) => {
      a.addEventListener('click', (e) => {
        const id = a.getAttribute('href');
        if (!id || id.length < 2) return;
        const target = $(id);
        if (!target) return;
        e.preventDefault();
        const inMenu = !menu.hidden;
        closeMenu(false);
        const go = () => {
          if (state.lenis) state.lenis.scrollTo(target, { offset: 0, duration: 1.8, easing: (t) => 1 - Math.pow(1 - t, 4) });
          else target.scrollIntoView({ behavior: animated ? 'smooth' : 'auto' });
          history.replaceState(null, '', id);
        };
        inMenu ? setTimeout(go, 350) : go();
      });
    });

    // Formulario -> WhatsApp
    const form = $('#quote-form');
    if (form) {
      const note = $('#form-note');
      const rules = {
        nombre: [(v) => v.trim().length >= 2, 'Escribe tu nombre para saber cómo atenderte.'],
        tipo: [(v) => !!v, 'Elige qué tipo de producto necesitas.'],
        detalle: [(v) => v.trim().length >= 5, 'Cuéntanos medida, grado o cantidad, aunque sea aproximado.'],
      };
      const setErr = (name, msg) => {
        const input = form.elements[name];
        const err = $('#e-' + name);
        input.closest('.field').classList.toggle('is-invalid', !!msg);
        input.setAttribute('aria-invalid', msg ? 'true' : 'false');
        err.textContent = msg || '';
      };
      Object.keys(rules).forEach((n) => form.elements[n].addEventListener('input', () => setErr(n, '')));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        let first = null;
        Object.entries(rules).forEach(([n, [test, msg]]) => {
          const ok = test(form.elements[n].value);
          setErr(n, ok ? '' : msg);
          if (!ok && !first) first = form.elements[n];
        });
        if (first) { first.focus(); note.classList.remove('is-ok'); note.textContent = 'Revisa los campos marcados para continuar.'; return; }
        const msg = `Hola J&K, soy ${form.elements.nombre.value.trim()}.\nNecesito cotizar: ${form.elements.tipo.value}.\nDetalle: ${form.elements.detalle.value.trim()}\n(Mensaje enviado desde su página web)`;
        const w = window.open(waUrl(msg), '_blank', 'noopener');
        if (!w) location.href = waUrl(msg);
        note.classList.add('is-ok');
        note.textContent = 'Abriendo WhatsApp con tu mensaje listo. Si no se abrió, toca el botón verde de WhatsApp.';
      });
    }

    // Acordeón con altura animada
    $$('.qa').forEach((d) => {
      const sum = $('summary', d), ans = $('.qa__a', d);
      sum.addEventListener('click', (e) => {
        if (!anim) return;
        e.preventDefault();
        const g = window.gsap;
        if (d.open && !d.classList.contains('is-closing')) {
          d.classList.add('is-closing');
          g.to(ans, { height: 0, duration: 0.45, ease: 'power3.inOut', onComplete: () => { d.open = false; d.classList.remove('is-closing'); g.set(ans, { clearProps: 'height' }); window.ScrollTrigger.refresh(); } });
        } else if (!d.open) {
          d.open = true;
          g.fromTo(ans, { height: 0 }, { height: 'auto', duration: 0.6, ease: 'power3.out', onComplete: () => { g.set(ans, { clearProps: 'height' }); window.ScrollTrigger.refresh(); } });
        }
      });
    });
  }

  /* ---------- 6. Arranque ---------- */
  const fallbackBolt = () => {
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><g transform='rotate(-38 100 100)'><rect x='68' y='18' width='64' height='36' rx='7' fill='#C9D3E6' stroke='#0B1530' stroke-width='5'/><rect x='84' y='54' width='32' height='124' fill='#E3EAF6' stroke='#0B1530' stroke-width='5'/><path d='M84 72h32M84 90h32M84 108h32M84 126h32M84 144h32M84 162h32' stroke='#0B1530' stroke-width='4'/></g></svg>";
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  };

  async function boot() {
    const loader = createLoader();
    const gsapOK = hasGSAP();
    if (animated && gsapOK) {
      html.classList.add('js-anim');
      html.classList.add('is-loading');
      // Elementos que aparecen al hacer scroll
      ['.who__head > *', '.section-head > *', '.catalog__head', '.contact__main > *:not(form)', '.contact__side > *', '.faq__intro > *', '.finale__copy > *'].forEach((sel) => $$(sel).forEach((el) => el.setAttribute('data-reveal', '')));
    }
    // Seguro: si algo falla, el contenido se muestra igual
    setTimeout(() => { if (!state.introDone) {
      console.warn('[J&K] La carga tardó demasiado; se muestra el contenido sin esperar.'); html.classList.add('anim-failsafe'); state.intro = 1; html.classList.remove('is-loading'); if (state.lenis) state.lenis.start(); const l = $('#loader'); if (l) l.remove(); } }, 22000);

    let scene = null;
    try {
      scene = await createScene();
      performance.mark('jk-scene');
      const urls = await scene.renderProducts();
      performance.mark('jk-products');
      $$('img[data-render]').forEach((img) => {
        if (!urls[img.dataset.render]) return;
        img.src = urls[img.dataset.render];
        if (img.decode) img.decode().catch(() => {}); // decodifica fuera del hilo principal para que el scroll no tropiece
      });
      await scene.warm();
      performance.mark('jk-warm');
    } catch (err) {
      console.warn('[J&K] Sin escena 3D, usando alternativa estática:', err && err.message);
      html.classList.add('no-webgl');
      $$('img[data-render]').forEach((img) => { img.src = fallbackBolt(); });
    }
    try { await Promise.race([document.fonts.ready, wait(2500)]); } catch (e) { /* ignorar */ }

    await nextFrame();
    initUI();
    await nextFrame();
    if (animated && gsapOK) { try { initMotion(); } catch (err) { console.warn('[J&K] Movimiento:', err); html.classList.add('anim-failsafe'); } }
    state.finale = (reduceMotion || !gsapOK) ? 1 : 0;

    await nextFrame();
    loader.ready();
    await loader.whenFull;
    performance.mark('jk-loader-full');
    // El 3D arranca (oculto) al empezar a abrirse las cortinas: su primer cuadro real ocurre cuando
    // todavía no se ve nada, y el título entra cuando el navegador ya está estable.
    const startScene = () => { if (scene) scene.start(); };
    const start = () => {
      if (animated && gsapOK) playIntro(scene);
      else { if (scene) scene.show(); state.intro = 1; state.introDone = true; html.classList.remove('is-loading'); }
    };
    await nextFrame();
    await loader.exit(start, startScene);
    addEventListener('load', () => { if (hasGSAP()) window.ScrollTrigger.refresh(); });
  }

  boot();
})();
