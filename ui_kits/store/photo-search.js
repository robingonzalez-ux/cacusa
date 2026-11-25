// "Buscar por foto" de la tienda (25 nov) — compartido por la tienda ES y EN.
// Lo carga app.js (openPhotoSearch) recién cuando la clienta toca "◇ Buscar por foto": antes de
// eso la tienda no descarga nada de esto. Usa los globales de app.js (PRODUCTS, __LANG,
// trapFocus, _pcardHref, _pcardNav, _focal, _zoom, imgBgStyle).
//
// Motor = el "v2" del identificador del panel (cacusa-admin/index.html: loadV2, rawV2Both,
// pieceBox, viewSquares, projectRaw, colorDescriptor, rankCatalog), portado al mínimo:
//   · TF.js 4.22.0 (jsDelivr, con SRI) + EfficientNetV2-B0 a 288 px (~11,7 MB),
//   · models/recog-v2.json (manifiesto) + recog-v2-proj.bin (proyección 1952 → 512),
//   · models/catalog-refs-v2.json + .bin (huellas precalculadas de cada foto del catálogo y sus
//     12 variantes), todo servido por GitHub Pages en admin.cacusabytaitus.com/models/ (CORS *).
// Solo compiten productos disponibles, con stock (available !== false, que ya incluye
// /pub/stock) y presentes en catalog-refs-v2: una pieza agregada después de generar las huellas
// simplemente no aparece hasta que el panel las regenere.
// Privacidad: la foto de la clienta nunca sale del navegador (se analiza en un <canvas>).
(function () {
  'use strict';
  if (window.CacusaPhotoSearch) return;

  const EN = typeof __LANG !== 'undefined' && __LANG === 'en';
  const ADMIN_ROOT = 'https://admin.cacusabytaitus.com/';
  const MANIFEST_URL = ADMIN_ROOT + 'models/recog-v2.json';
  const TFJS_URL = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
  const TFJS_SRI = 'sha384-vE8hbVJ4lezako5rlvE7bY0BVzWlFhZncPlckrqNwcUQpVtgbENTgZ8TBbnPjZre';
  const TOP_N = 8;
  const MAX_SIDE = 1024; // la foto se achica antes de analizarla (las vistas son de 288 px)

  const T = EN ? {
    title: '◇ Search by photo',
    intro: 'Take or choose a photo of a piece of jewelry and we will show you the most similar pieces in stock.',
    pick: '◇ Take or choose a photo',
    pickAgain: '◇ Try another photo',
    close: 'Close',
    preparing: 'Preparing search… the first time it downloads ~14 MB',
    ready: 'Ready. Take or choose a photo.',
    saveData: 'Data saver is on: the search engine (~14 MB) will download when you choose a photo.',
    searching: 'Looking for similar pieces…',
    results: n => 'These are the ' + n + ' most similar pieces in stock.',
    none: 'We could not find similar pieces in stock. Message us on WhatsApp and we will help you.',
    errEngine: 'Photo search could not be prepared on this device. Check your connection and try again.',
    errPhoto: 'We could not read that photo. Try another one.',
    privacy: 'Your photo is not uploaded anywhere: it is analyzed on your own phone or computer.',
    yourPhoto: 'Your photo',
  } : {
    title: '◇ Buscar por foto',
    intro: 'Toma o elige una foto de una joya y te mostramos las piezas más parecidas que tenemos en stock.',
    pick: '◇ Tomar o elegir foto',
    pickAgain: '◇ Probar con otra foto',
    close: 'Cerrar',
    preparing: 'Preparando búsqueda… la primera vez descarga ~14 MB',
    ready: 'Listo. Toma o elige una foto.',
    saveData: 'Tienes el ahorro de datos activado: el buscador (~14 MB) se descarga cuando elijas una foto.',
    searching: 'Buscando piezas parecidas…',
    results: n => 'Estas son las ' + n + ' piezas más parecidas con stock.',
    none: 'No encontramos piezas parecidas con stock. Escríbenos por WhatsApp y te ayudamos.',
    errEngine: 'No pudimos preparar la búsqueda por foto en este dispositivo. Revisa tu conexión e inténtalo de nuevo.',
    errPhoto: 'No pudimos leer esa foto. Prueba con otra.',
    privacy: 'Tu foto no se sube a ningún lado: se analiza en tu propio teléfono o computadora.',
    yourPhoto: 'Tu foto',
  };

  // ── Motor ──────────────────────────────────────────────────
  let _tfP = null;
  function loadTfjs() {
    if (window.tf && window.tf.loadGraphModel) return Promise.resolve(window.tf);
    if (_tfP) return _tfP;
    // tf.min.js hace `try { regeneratorRuntime = r } catch { Function(...) }`: sin la variable
    // global caería en Function(), que el CSP de la tienda bloquea (sin 'unsafe-eval'). Igual
    // que en el panel: declararla antes evita el eval.
    if (!('regeneratorRuntime' in window)) window.regeneratorRuntime = undefined;
    _tfP = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TFJS_URL; s.integrity = TFJS_SRI; s.crossOrigin = 'anonymous'; s.async = true;
      s.onload = () => (window.tf ? resolve(window.tf) : reject(new Error('tf init')));
      s.onerror = () => reject(new Error('tf load'));
      document.head.appendChild(s);
    });
    _tfP.catch(() => { _tfP = null; });
    return _tfP;
  }
  async function fetchOk(url, kind) {
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
    return kind === 'json' ? r.json() : r.arrayBuffer();
  }
  // Proyección: mu float32[dIn] · escala float32[dOut] · W int8[dIn×dOut] por filas.
  async function loadProjection(meta, dIn, dOut) {
    const buf = await fetchOk(new URL(meta.bin, MANIFEST_URL).href + '?h=' + String(meta.binSha256 || '').slice(0, 12));
    if (meta.binBytes && buf.byteLength !== meta.binBytes) throw new Error('proj: tamaño inesperado');
    const mu = new Float32Array(buf, 0, dIn), sc = new Float32Array(buf, dIn * 4, dOut), q = new Int8Array(buf, (dIn + dOut) * 4, dIn * dOut);
    const W = new Float32Array(dIn * dOut);
    for (let i = 0; i < dIn; i++) for (let j = 0; j < dOut; j++) W[i * dOut + j] = q[i * dOut + j] * sc[j];
    return { mu: Float32Array.from(mu), W, dIn, dOut };
  }
  // Red: primero desde IndexedDB (visitas siguientes sin volver a bajar 11,7 MB), si no desde el
  // panel, y se guarda. Si IndexedDB no está (modo privado) se usa igual, sin guardar.
  async function loadModel(tf, man, onProgress) {
    const key = 'indexeddb://cacusa-store-' + man.emb;
    try { const m = await tf.loadGraphModel(key); if (onProgress) onProgress(1); return m; } catch (_) {}
    const m = await tf.loadGraphModel(new URL(man.model, ADMIN_ROOT).href, { onProgress });
    try { await m.save(key); } catch (_) {}
    return m;
  }
  // Huellas del catálogo: Map id → { color, vecs: [Float32Array normalizado], pen: [0 | margen] }.
  // Por cada foto: la huella base (sin penalización) y sus variantes (− margen, como en el panel).
  async function loadRefs(man) {
    const refsUrl = new URL(man.refs, ADMIN_ROOT).href;
    const idx = await fetchOk(refsUrl, 'json');
    if (!idx || idx.model !== man.emb || !(idx.dim > 0)) throw new Error('refs: versión distinta');
    const buf = await fetchOk(new URL(idx.bin, refsUrl).href + '?h=' + String(idx.binSha256 || '').slice(0, 12));
    if (buf.byteLength !== idx.binBytes) throw new Error('refs: tamaño inesperado');
    const dim = idx.dim, i8 = new Int8Array(buf), nVec = i8.length / dim;
    const vec = k => l2norm(i8.subarray(k * dim, (k + 1) * dim));
    const map = new Map();
    for (const [id, list] of Object.entries(idx.products || {})) {
      const rec = { color: null, vecs: [], pen: [] };
      for (const e of (Array.isArray(list) ? list : [])) {
        const n = Math.max(0, (e && e.n) | 0);
        if (!e || !(e.offset >= 0) || e.offset + 1 + n > nVec) continue;
        if (!rec.color && Array.isArray(e.color) && e.color.length === 27) rec.color = Float32Array.from(e.color);
        rec.vecs.push(vec(e.offset)); rec.pen.push(0);
        for (let k = 1; k <= n; k++) { rec.vecs.push(vec(e.offset + k)); rec.pen.push(1); }
      }
      if (rec.vecs.length) map.set(String(id), rec);
    }
    return { map, dim };
  }
  let _engineP = null;
  function loadEngine(onProgress) {
    if (_engineP) return _engineP;
    _engineP = (async () => {
      const [tf, man] = await Promise.all([loadTfjs(), fetchOk(MANIFEST_URL, 'json')]);
      if (!man || man.version !== 2 || !man.model || !man.proj || !man.refs || !Array.isArray(man.views) || !Array.isArray(man.parts)) throw new Error('manifiesto v2 inválido');
      try { await tf.ready(); } catch (_) {}
      const [proj, model, refs] = await Promise.all([
        loadProjection(man.proj, man.dIn, man.dOut),
        loadModel(tf, man, f => { if (onProgress) onProgress(f); }),
        loadRefs(man),
      ]);
      if (refs.dim !== proj.dOut) throw new Error('refs y proyección no coinciden');
      // Calentamiento: la primera pasada compila los shaders de WebGL (así la búsqueda es rápida).
      // Mismo tamaño de lote que una búsqueda real (una vista por cada entrada de man.views).
      try { const o = tf.tidy(() => model.execute(tf.zeros([man.views.length, man.size, man.size, 3]))); o.dataSync(); o.dispose(); } catch (_) {}
      return { tf, model, proj, refs: refs.map, size: man.size, parts: man.parts, views: man.views,
               cw: man.cw != null ? man.cw : 0.05, margin: man.margin != null ? man.margin : 0.03 };
    })();
    _engineP.catch(() => { _engineP = null; });
    return _engineP;
  }

  // ── Huella de una foto (igual que el panel, v2, sin "Marca la joya") ──
  function l2norm(v) {
    let s = 0; for (let i = 0; i < v.length; i++) s += v[i] * v[i];
    const n = Math.sqrt(s) || 1, out = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
    return out;
  }
  function dot(a, b) { const n = Math.min(a.length, b.length); let s = 0; for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; }
  function dims(img) { return [img.naturalWidth || img.width, img.naturalHeight || img.height]; }
  function cropSquare(img, sx, sy, side, size) {
    const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    return cv;
  }
  function squareCrop(img, frac, size) {
    const [w, h] = dims(img), side = Math.min(w, h) * frac;
    return cropSquare(img, (w - side) / 2, (h - side) / 2, side, size);
  }
  // Zona de la pieza: distancia al color de los bordes (foto a 128 px), suavizado 5×5, Otsu.
  const PIECE_BOX = { floor: 18, lo: 0.03, hi: 0.97, minFrac: 0.01, maxFrac: 0.75 };
  function pieceBox(img) {
    const P = PIECE_BOX, [w, h] = dims(img), S = 128 / Math.max(w, h);
    const W = Math.max(8, Math.round(w * S)), H = Math.max(8, Math.round(h * S));
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    const B = 4, segs = 6, protos = [];
    const med = arr => { arr.sort((a, b) => a - b); return arr[arr.length >> 1]; };
    const sample = (x0, y0, x1, y1) => {
      const r = [], g = [], b = [];
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; r.push(d[i]); g.push(d[i + 1]); b.push(d[i + 2]); }
      if (r.length) protos.push([med(r), med(g), med(b)]);
    };
    for (let s = 0; s < segs; s++) {
      const xa = Math.floor(W * s / segs), xb = Math.floor(W * (s + 1) / segs), ya = Math.floor(H * s / segs), yb = Math.floor(H * (s + 1) / segs);
      sample(xa, 0, xb, B); sample(xa, H - B, xb, H); sample(0, ya, B, yb); sample(W - B, ya, W, yb);
    }
    const dist = new Float32Array(W * H);
    for (let i = 0, p = 0; p < W * H; p++, i += 4) {
      let m = 1e9;
      for (const q of protos) { const dr = d[i] - q[0], dg = d[i + 1] - q[1], db = d[i + 2] - q[2]; const e = dr * dr + dg * dg + db * db; if (e < m) m = e; }
      dist[p] = Math.sqrt(m);
    }
    const bl = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) { s += dist[yy * W + xx]; n++; } }
      bl[y * W + x] = s / n;
    }
    let mx = 0; for (const v of bl) mx = Math.max(mx, v);
    if (mx < 8) return null;
    const hist = new Float64Array(64); for (const v of bl) hist[Math.min(63, Math.floor(v / mx * 64))]++;
    const tot = W * H; let sum = 0; for (let i = 0; i < 64; i++) sum += i * hist[i];
    let wB = 0, sB = 0, best = 0, th = 32;
    for (let i = 0; i < 64; i++) {
      wB += hist[i]; if (!wB) continue; const wF = tot - wB; if (!wF) break;
      sB += i * hist[i]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; th = i; }
    }
    const thr = Math.max((th + 1) / 64 * mx, P.floor);
    const px = new Float64Array(W), py = new Float64Array(H); let mass = 0, fg = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = bl[y * W + x]; if (v > thr) { const wgt = v - thr; px[x] += wgt; py[y] += wgt; mass += wgt; fg++; } }
    const frac = fg / tot;
    if (!mass || frac < P.minFrac || frac > P.maxFrac) return null;
    const pct = (arr, q) => { let c = 0; const t = mass * q; for (let i = 0; i < arr.length; i++) { c += arr[i]; if (c >= t) return i; } return arr.length - 1; };
    return [pct(px, P.lo) / S, pct(py, P.lo) / S, (pct(px, P.hi) + 1) / S, (pct(py, P.hi) + 1) / S];
  }
  function boxSquare(img, box, margin) {
    const [w, h] = dims(img), cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
    let side = Math.max(box[2] - box[0], box[3] - box[1]) * margin;
    side = Math.min(Math.max(side, Math.min(w, h) * 0.3), Math.max(w, h));
    return [cx - side / 2, cy - side / 2, side];
  }
  // Vistas del manifiesto: ['c', f] = cuadrado centrado (fracción f del lado corto);
  // ['p', m] = pieza con margen m (sin pieza clara = foto entera).
  function views(eng, img) {
    const [w, h] = dims(img), s = Math.min(w, h), box = pieceBox(img);
    return eng.views.map(([t, f]) => {
      const q = t === 'p' && box ? boxSquare(img, box, f) : [(w - s * (t === 'c' ? f : 1)) / 2, (h - s * (t === 'c' ? f : 1)) / 2, s * (t === 'c' ? f : 1)];
      return cropSquare(img, q[0], q[1], q[2], eng.size);
    });
  }
  // Una pasada de la red por las 5 vistas → partes normalizadas → promedio → proyección.
  function embed(eng, img) {
    const { tf, model, proj } = eng, vs = views(eng, img);
    const out = tf.tidy(() => model.execute(tf.stack(vs.map(c => tf.browser.fromPixels(c))).toFloat().div(255)));
    const raw = out.dataSync(); out.dispose();
    const dIn = proj.dIn, acc = new Float64Array(dIn);
    for (let v = 0; v < vs.length; v++) {
      const f = raw.subarray(v * dIn, (v + 1) * dIn), x = new Float64Array(dIn);
      for (const [a, b] of eng.parts) { let s = 0; for (let i = a; i < b; i++) s += f[i] * f[i]; const n = Math.sqrt(s) || 1; for (let i = a; i < b; i++) x[i] = f[i] / n; }
      let s = 0; for (let i = 0; i < dIn; i++) s += x[i] * x[i]; const n = Math.sqrt(s) || 1;
      for (let i = 0; i < dIn; i++) acc[i] += x[i] / n;
    }
    const xa = l2norm(acc), { mu, W, dOut } = proj, y = new Float64Array(dOut);
    for (let i = 0; i < dIn; i++) { const xi = xa[i] - mu[i]; if (!xi) continue; const r = i * dOut; for (let j = 0; j < dOut; j++) y[j] += xi * W[r + j]; }
    return l2norm(y);
  }
  // Color: histograma HSV del centro (8 tonos × 3 saturaciones + 3 grises).
  function colorDescriptor(img) {
    const d = squareCrop(img, 0.6, 48).getContext('2d').getImageData(0, 0, 48, 48).data;
    const h = new Float32Array(27); let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn, s = mx ? c / mx : 0;
      if (s < 0.15 || mx < 0.12) { h[24 + Math.min(2, Math.floor(mx * 3))] += 1; n++; continue; }
      let hue = c === 0 ? 0 : mx === r ? ((g - b) / c) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4;
      hue = (hue * 60 + 360) % 360;
      h[Math.floor(hue / 45) * 3 + Math.min(2, Math.floor((s - 0.15) / 0.29))] += 1; n++;
    }
    for (let i = 0; i < 27; i++) h[i] /= (n || 1);
    return h;
  }
  function colorSim(a, b) { if (!a || !b) return 0; let s = 0; for (let i = 0; i < a.length; i++) s += Math.min(a[i], b[i]); return s; }
  // Puntaje = (1 − cw) × mejor coseno (foto del catálogo, o variante − margen) + cw × color.
  function rank(eng, q, color) {
    const out = [];
    for (const p of (typeof PRODUCTS !== 'undefined' ? PRODUCTS : [])) {
      if (!p || p.available === false) continue;
      const rec = eng.refs.get(String(p.id));
      if (!rec) continue;
      let best = -1;
      for (let k = 0; k < rec.vecs.length; k++) { const s = dot(q, rec.vecs[k]) - (rec.pen[k] ? eng.margin : 0); if (s > best) best = s; }
      out.push({ p, score: (1 - eng.cw) * best + eng.cw * colorSim(color, rec.color) });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, TOP_N).map(x => x.p);
  }
  // Archivo → canvas de lado mayor ≤ MAX_SIDE (respeta la orientación EXIF). Sin blob: ni subir
  // nada: createImageBitmap, o FileReader → data: (el CSP de la tienda permite img-src data:).
  async function fileToCanvas(file) {
    let src = null;
    try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (_) {
      src = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => { const im = new Image(); im.onload = () => resolve(im); im.onerror = reject; im.src = fr.result; };
        fr.onerror = reject;
        fr.readAsDataURL(file);
      });
    }
    const [w, h] = dims(src);
    if (!w || !h) throw new Error('foto vacía');
    const k = Math.min(1, MAX_SIDE / Math.max(w, h));
    const cv = document.createElement('canvas'); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
    cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
    if (src.close) src.close();
    return cv;
  }

  // ── Overlay ────────────────────────────────────────────────
  let ui = null, _release = null, _returnEl = null, _searchToken = 0;
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function build() {
    const ov = el('div', 'ps-overlay'); ov.id = 'photo-search';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'psTitle');
    const box = el('div', 'ps-box');
    const close = el('button', 'ps-close', '✕'); close.type = 'button'; close.setAttribute('aria-label', T.close);
    const title = el('h2', 'ps-title', T.title); title.id = 'psTitle';
    const intro = el('p', 'ps-intro', T.intro);
    const input = el('input'); input.type = 'file'; input.accept = 'image/*'; input.hidden = true; input.setAttribute('aria-hidden', 'true'); input.tabIndex = -1;
    const pick = el('button', 'ps-pick', T.pick); pick.type = 'button';
    const preview = el('canvas', 'ps-preview'); preview.hidden = true; preview.setAttribute('role', 'img'); preview.setAttribute('aria-label', T.yourPhoto);
    const status = el('p', 'ps-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const results = el('div', 'cs-list ps-results');
    const privacy = el('p', 'ps-privacy', T.privacy);
    const top = el('div', 'ps-top'); top.append(preview, el('div', 'ps-actions'));
    top.lastChild.append(pick, status);
    box.append(close, title, intro, top, input, results, privacy);
    ov.appendChild(box);
    document.body.appendChild(ov);
    close.addEventListener('click', closeOverlay);
    ov.addEventListener('click', e => { if (e.target === ov) closeOverlay(); });
    pick.addEventListener('click', () => input.click());
    input.addEventListener('change', () => { const f = input.files && input.files[0]; input.value = ''; if (f) runSearch(f); });
    return { ov, pick, preview, status, results };
  }
  function setStatus(msg) { if (ui) ui.status.textContent = msg; }
  function saveData() { try { return !!(navigator.connection && navigator.connection.saveData); } catch (_) { return false; } }
  let _lastPct = -1;
  function progress(f) {
    const pct = Math.max(0, Math.min(100, Math.round((f || 0) * 100)));
    if (pct === _lastPct) return; _lastPct = pct;
    if (ui && !ui.busy) setStatus(T.preparing + (pct > 0 && pct < 100 ? ' (' + pct + ' %)' : ''));
  }
  function startEngine() {
    _lastPct = -1;
    setStatus(T.preparing);
    const p = loadEngine(progress);
    p.then(() => { if (ui && !ui.busy && !ui.searched) setStatus(T.ready); },
           () => { if (ui && !ui.busy) setStatus(T.errEngine); });
    return p;
  }
  function open(returnEl) {
    if (!ui) ui = build();
    _returnEl = returnEl || null;
    ui.ov.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (_release) _release();
    _release = trapFocus(ui.ov, closeOverlay);
    if (!ui.searched && !ui.busy) {
      if (saveData() && !window.tf) setStatus(T.saveData);
      else startEngine();
    }
  }
  function closeOverlay() {
    if (!ui || !ui.ov.classList.contains('open')) return;
    ui.ov.classList.remove('open');
    document.body.style.overflow = '';
    if (_release) { const r = _release; _release = null; r(); }
    if (_returnEl && document.contains(_returnEl) && document.activeElement !== _returnEl) { try { _returnEl.focus(); } catch (_) {} }
  }
  function resultCard(p) {
    const nm = EN && p.name_en ? p.name_en : p.name;
    const a = el('a', 'cs-item'); a.href = _pcardHref(p);
    a.addEventListener('click', e => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      closeOverlay();
      _pcardNav({ button: 0, preventDefault() {} }, p.id);
    });
    const im = el('div', 'cs-img'); const bg = imgBgStyle(p); if (bg) im.style.cssText = bg;
    if (p.imageUrl) {
      const img = el('img'); img.src = p.imageUrl; img.alt = nm; img.loading = 'lazy'; img.width = 220; img.height = 220;
      const pos = _focal(p.focalX) + '% ' + _focal(p.focalY) + '%';
      img.style.objectPosition = pos; img.style.transform = 'scale(' + _zoom(p.zoom) + ')'; img.style.transformOrigin = pos;
      im.appendChild(img);
    }
    a.append(im, el('div', 'cs-name', nm), el('div', 'cs-price', '$' + (+p.price).toFixed(2)));
    return a;
  }
  async function runSearch(file) {
    const token = ++_searchToken;
    ui.busy = true;
    ui.results.textContent = '';
    let cv;
    try { cv = await fileToCanvas(file); }
    catch (_) { if (token === _searchToken) { ui.busy = false; setStatus(T.errPhoto); } return; }
    if (token !== _searchToken) return;
    // Miniatura de la foto (queda en el navegador).
    const k = 120 / Math.max(cv.width, cv.height);
    ui.preview.width = Math.round(cv.width * k); ui.preview.height = Math.round(cv.height * k);
    ui.preview.getContext('2d').drawImage(cv, 0, 0, ui.preview.width, ui.preview.height);
    ui.preview.hidden = false;
    let eng;
    try {
      if (!_engineP) { ui.busy = false; startEngine(); ui.busy = true; }
      setStatus(window.tf && _engineP ? T.searching : T.preparing);
      eng = await loadEngine(progress);
    } catch (_) { if (token === _searchToken) { ui.busy = false; setStatus(T.errEngine); } return; }
    if (token !== _searchToken) return;
    setStatus(T.searching);
    await new Promise(r => setTimeout(r, 30)); // deja pintar el estado antes de calcular
    let list;
    try { list = rank(eng, embed(eng, cv), colorDescriptor(cv)); }
    catch (e) { if (token === _searchToken) { ui.busy = false; setStatus(T.errPhoto); } return; }
    if (token !== _searchToken) return;
    ui.busy = false; ui.searched = true;
    ui.pick.textContent = T.pickAgain;
    list.forEach(p => ui.results.appendChild(resultCard(p)));
    setStatus(list.length ? T.results(list.length) : T.none);
  }

  window.CacusaPhotoSearch = { open, close: closeOverlay, _loadEngine: loadEngine };
})();
