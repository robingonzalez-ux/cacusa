// ════════════════════════════════════════════════════════════════
//  CACUSA — home-motion.js
//  Lógica GSAP compartida del home (ES/EN) — timeline del hero (scroll
//  scrubbed, 3 estados A/B/C) + tratamientos de movimiento por sección,
//  reemplazando el sistema genérico .reveal/.reveal-left/.reveal-right/
//  .reveal-scale que animaba TODO igual (fade-up repetitivo).
//
//  Cargado idéntico por index.html (<script defer src="./assets/home-motion.js">)
//  y en/index.html (<script defer src="../assets/home-motion.js">) — nunca
//  diverge entre idiomas, porque no depende de ningún texto ni copy.
//
//  Progressive enhancement: si GSAP/ScrollTrigger no cargaron (CDN bloqueado,
//  offline) o si prefers-reduced-motion está activo, este archivo no hace NADA —
//  el HTML/CSS de base ya deja todo visible en su estado final sin animación,
//  nunca depende de que este script corra para mostrar contenido.
// ════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // ── HERO_CUTOUTS ────────────────────────────────────────────────
  // Mapa id de producto → PNG con fondo removido, para el camino de paralaje
  // de 2 capas del hero. VACÍO por ahora: los 2 PNG reales
  // (hand-chain-rombos-cutout.png, pulseras-cutout.png) están pendientes de
  // que el usuario los prepare y entregue (bloqueo de remoción de fondo en
  // este sandbox, ver plan/CLAUDE.md). heroSlideshow() (inline en cada HTML)
  // ya sabe leer este mapa por id y usar el paralaje de 2 capas cuando
  // encuentra una entrada, cayendo al camino fotográfico (Ken Burns) de una
  // sola capa para cualquier producto que no esté acá — que es exactamente
  // lo que pasa hoy con el mapa vacío. Agregar las 2 entradas más adelante es
  // el ÚNICO cambio necesario: ningún otro código (ni acá ni en heroSlideshow)
  // necesita tocarse.
  window.HERO_CUTOUTS = {
    // 1788540460219: './assets/hero/hand-chain-rombos-cutout.png', // Hand chain de rombos
    // 1788449850640: './assets/hero/pulseras-cutout.png'           // Pulseras hechas a mano
  };

  // Evita que el navegador restaure el scroll a mitad de una sección pineada
  // antes de que el timeline exista (gotcha conocido de ScrollTrigger en
  // recargas a mitad del hero) — inofensivo incluso si luego no se registra
  // ningún ScrollTrigger (reduced-motion / GSAP no cargó).
  try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (e) {}

  var _reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (_reduceMotion) return; // reversión estructural completa — ver plan, nada de esto se registra

  if (typeof gsap === 'undefined' || typeof ScrollTrigger === 'undefined') return; // CDN no cargó — el sitio sigue 100% funcional sin animación

  gsap.registerPlugin(ScrollTrigger);

  // API pequeña que el script inline de cada HTML (heroSlideshow/renderFeaturedProducts/
  // Instagram) puede llamar para contenido que se crea DESPUÉS de la carga inicial
  // (tarjetas de producto/feed de Instagram inyectadas por fetch) — mismo problema de
  // timing que el observer genérico de .reveal ya resolvía con obs.observe(card).
  var CacusaMotion = window.CacusaMotion = window.CacusaMotion || {};

  // Grupo simple de fade+lift para labels/headings de sección — tejido conector
  // entre secciones, no el "tratamiento firma" de cada una (eso va aparte, por sección).
  CacusaMotion.fadeUpGroup = function (selector, opts) {
    opts = opts || {};
    var els = typeof selector === 'string' ? gsap.utils.toArray(selector) : selector;
    if (!els || !els.length) return;
    gsap.set(els, { opacity: 0, y: opts.y != null ? opts.y : 28 });
    gsap.to(els, {
      opacity: 1, y: 0, duration: 0.75, ease: 'power2.out',
      stagger: opts.stagger != null ? opts.stagger : 0.1,
      scrollTrigger: { trigger: opts.trigger || els[0], start: opts.start || 'top 85%' }
    });
  };

  // #products (bestsellers) — scale-in con lift, "entrando en foco". Se usa tanto para
  // las tarjetas placeholder que ya están en el HTML al cargar, como para las reales que
  // renderFeaturedProducts() inyecta después del fetch (mismo tratamiento, mismo helper).
  CacusaMotion.animateProductCard = function (el, i) {
    if (!el) return;
    gsap.set(el, { opacity: 0, scale: 0.92, y: 24 });
    gsap.to(el, {
      opacity: 1, scale: 1, y: 0, duration: 0.6, ease: 'power2.out',
      delay: (i % 4) * 0.1,
      scrollTrigger: { trigger: el, start: 'top 90%' }
    });
  };

  // #instagram — fade+scale escalonado con delays semi-random ("feed en vivo"),
  // llamado tanto para el feed real de Behold como para el grid de placeholders.
  CacusaMotion.animateIgGrid = function (container) {
    if (!container || !container.children || !container.children.length) return;
    var items = container.children;
    gsap.set(items, { opacity: 0, scale: 0.85 });
    gsap.to(items, {
      opacity: 1, scale: 1, duration: 0.6, ease: 'power2.out',
      stagger: { each: 0.05, from: 'random' },
      scrollTrigger: { trigger: container, start: 'top 90%' }
    });
  };

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(function () {
    initHeroTimeline();
    initSectionMotion();
  });

  window.addEventListener('load', function () {
    if (typeof ScrollTrigger !== 'undefined') ScrollTrigger.refresh();
  });

  // ══════════════════════════════════════════════════════════════
  //  HERO — una sola línea de tiempo, progreso 0→1, 3 zonas (A/B/C)
  // ══════════════════════════════════════════════════════════════
  function initHeroTimeline() {
    var host = document.getElementById('hero-scroll-host');
    var hero = document.getElementById('hero');
    if (!host || !hero) return;

    var isMobile = window.matchMedia('(max-width:768px)').matches;
    var heroContent = hero.querySelector('.hero-content');
    var heroStage = document.getElementById('heroStage');
    var heroCanvas = document.getElementById('hero-canvas');
    var scrollInd = hero.querySelector('.hero-scroll');
    var cutFg = document.getElementById('hsCutFg');
    var cutBg = document.getElementById('hsCutBg');

    var yMid = isMobile ? -5 : -8;
    var yEnd = isMobile ? -10 : -14;

    // Pausa/reanuda el crossfade por tiempo de heroSlideshow() mientras el pin está
    // activo — usa las mismas closures pause()/resume() que heroSlideshow() ya expone
    // globalmente, para que crossfade y scroll-scrub nunca compitan en el mismo pixel.
    // Se resuelven al momento del evento, no acá: heroSlideshow() corre después del fetch
    // async de products.json, así que al registrar este trigger todavía no existen.
    function slidePause() { if (typeof window._heroSlideshowPause === 'function') window._heroSlideshowPause(); }
    function slideResume() { if (typeof window._heroSlideshowResume === 'function') window._heroSlideshowResume(); }
    var pinTrigger = ScrollTrigger.create({
      trigger: host, start: 'top top', end: 'bottom top',
      onEnter: slidePause, onEnterBack: slidePause,
      onLeave: slideResume, onLeaveBack: slideResume
    });
    window._heroPinActive = function () { return pinTrigger.isActive; };

    var tl = gsap.timeline({
      scrollTrigger: {
        trigger: host, start: 'top top', end: 'bottom top',
        scrub: 0.6, pin: hero, anticipatePin: 1, invalidateOnRefresh: true
      }
    });

    // A (0–25%): reposo — ningún tween arranca antes de este punto, así un scroll
    // mínimo (1-2 notches) no dispara nada todavía.

    // B (25–65%): movimiento principal.
    if (heroContent) tl.to(heroContent, { yPercent: yMid, opacity: 0.35, ease: 'none', duration: 0.4 }, 0.25);
    if (heroCanvas) tl.to(heroCanvas, { opacity: 0.55, ease: 'none', duration: 0.4 }, 0.25);
    if (scrollInd) tl.to(scrollInd, { opacity: 0, ease: 'none', duration: 0.05 }, 0.25);
    // Camino fotográfico (todo producto SIN cutout): Ken Burns restringido en todo el panel.
    if (heroStage) tl.to(heroStage, { scale: 1.08, xPercent: 6, ease: 'none', duration: 0.4, transformOrigin: 'center center' }, 0.25);
    // Camino cutout (solo productos en HERO_CUTOUTS): paralaje real de 2 planos — estos
    // 2 elementos existen siempre en el HTML pero solo quedan visibles (.on) cuando
    // heroSlideshow() encuentra una entrada en HERO_CUTOUTS para el producto actual;
    // animarlos aunque estén invisibles no tiene costo ni efecto visual.
    if (cutFg) tl.to(cutFg, { yPercent: -18, ease: 'none', duration: 0.4 }, 0.25);
    if (cutBg) tl.to(cutBg, { yPercent: -6, ease: 'none', duration: 0.4 }, 0.25);

    // C (65–100%): asentamiento — el texto termina en yEnd/opacity 0; el visual del
    // producto ya se estabilizó al final de B y no se mueve más en este rango.
    if (heroContent) tl.to(heroContent, { yPercent: yEnd, opacity: 0, ease: 'none', duration: 0.35 }, 0.65);
  }

  // ══════════════════════════════════════════════════════════════
  //  RESTO DE LA PÁGINA — un tratamiento de movimiento distinto por sección
  // ══════════════════════════════════════════════════════════════
  function initSectionMotion() {
    // #collections — stagger horizontal alternado por card + fade simple en label/heading
    CacusaMotion.fadeUpGroup('#collections .section-label, #collectionsH2');
    gsap.utils.toArray('#collections .col-card').forEach(function (card, i) {
      gsap.set(card, { opacity: 0, xPercent: i % 2 === 0 ? -12 : 12 });
      gsap.to(card, {
        opacity: 1, xPercent: 0, duration: 0.8, ease: 'power2.out', delay: i * 0.08,
        scrollTrigger: { trigger: card, start: 'top 88%' }
      });
    });

    // #products — label/heading simples + tarjetas "entrando en foco" (scale-in con lift).
    // Las tarjetas placeholder que ya están en el HTML al cargar reciben el tratamiento acá;
    // las reales que renderFeaturedProducts() inyecta después del fetch llaman a
    // CacusaMotion.animateProductCard() ellas mismas, mismo helper, mismo resultado.
    CacusaMotion.fadeUpGroup('#products .section-label, #bestsellersH2, #products .reveal', { trigger: '#products' });
    gsap.utils.toArray('#products .prod-card').forEach(function (card, i) {
      CacusaMotion.animateProductCard(card, i);
    });

    // #story — paralaje real de las 3 imágenes apiladas (firma de la sección) + el bloque
    // de texto con un fade+lift simple de una sola vez (contenido de lectura, no scrubbed).
    CacusaMotion.fadeUpGroup(
      '#story .story-label, #story .story-h, #story .story-quote, #story .story-body, #story .story-stats',
      { trigger: '#story', start: 'top 70%', y: 30 }
    );
    gsap.utils.toArray('#story .s-img').forEach(function (img, i) {
      gsap.to(img, {
        yPercent: -4 * (i + 1), ease: 'none',
        scrollTrigger: { trigger: '#story', start: 'top bottom', end: 'bottom top', scrub: true }
      });
    });

    // #personalize — reveal secuencial de los 3 pasos (refuerza el "1,2,3" procedural) +
    // label/heading/form con fade simple.
    CacusaMotion.fadeUpGroup('#personalize .section-label, #hPersonTitle, #hPersonSub, #personalize .person-form');
    gsap.utils.toArray('#personalize .step').forEach(function (step, i) {
      gsap.set(step, { opacity: 0, x: -40 });
      gsap.to(step, {
        opacity: 1, x: 0, duration: 0.7, ease: 'power2.out', delay: i * 0.15,
        scrollTrigger: { trigger: '#personalize .person-steps', start: 'top 85%' }
      });
    });

    // #why-cacusa — único lugar con un "delight" pequeño: pop-in de rotación/escala
    // acotado al glifo (.wc-symbol, 20-30px), el resto de cada card con fade normal.
    CacusaMotion.fadeUpGroup('#why-cacusa .section-label, #whyH2');
    gsap.utils.toArray('#why-cacusa .wc-card').forEach(function (card, i) {
      var symbol = card.querySelector('.wc-symbol');
      gsap.set(card, { opacity: 0 });
      if (symbol) gsap.set(symbol, { opacity: 0, scale: 0.3, rotate: -45 });
      var stl = gsap.timeline({ scrollTrigger: { trigger: card, start: 'top 88%' }, delay: i * 0.1 });
      stl.to(card, { opacity: 1, duration: 0.5, ease: 'power1.out' }, 0);
      if (symbol) stl.to(symbol, { opacity: 1, scale: 1, rotate: 0, duration: 0.6, ease: 'back.out(2)' }, 0.1);
    });

    // #testimonials — label/heading con fade simple; el marquee horizontal existente se
    // conserva tal cual como firma de movimiento de la sección (el pausado por
    // prefers-reduced-motion vive en el <script> inline junto al resto de los guards de
    // _reduceMotion, para que funcione aunque GSAP no llegue a cargar).
    CacusaMotion.fadeUpGroup('#testimonials .section-label, #testiH2');

    // #instagram — label/heading/CTA con fade simple; el grid en sí (feed real o
    // placeholders) se anima desde el <script> inline vía CacusaMotion.animateIgGrid()
    // apenas se puebla, porque su contenido llega async (fetch a Behold.so o fallback).
    CacusaMotion.fadeUpGroup('#instagram .section-label, #instagram > .container > div > h2, #instagram .container p, #instagram .container a');
  }
})();
