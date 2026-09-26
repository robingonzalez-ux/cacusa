/* Animaciones finas del landing (index.html y en/index.html):
   - títulos con máscara (.mask-h): cada línea sube desde detrás de una máscara
   - hero: capas que se despegan a distinta velocidad al bajar (sin anclar ni desvanecer)
   - parallax en capas en Colecciones y Nuestra historia
   Sin librerías. Usa la propiedad CSS `translate` (no `transform`) para no chocar con el
   zoom de .col-bg, las clases .reveal* ni la animación fUp del hero. */
(function () {
  'use strict';
  if (!window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!('IntersectionObserver' in window)) return;

  var root = document.documentElement;
  root.classList.add('lm');

  // ── TÍTULOS CON MÁSCARA ─────────────────────────────────────
  // Se divide recién al entrar en pantalla: para entonces loadHomeContent() y el bloque de
  // idioma ya pusieron el texto final. Si algo reemplaza el título después, los spans
  // desaparecen y el texto queda visible (el estado oculto solo afecta a .ml-i).
  function split(el) {
    if (el.classList.contains('lm-split')) return;
    var parts = el.innerHTML.split(/<br\s*\/?>/i);
    el.innerHTML = parts.map(function (p) {
      return '<span class="ml"><span class="ml-i">' + p + '</span></span>';
    }).join('');
    var base = parseFloat(el.getAttribute('data-mask-delay') || '0');
    var lines = el.querySelectorAll('.ml-i');
    for (var i = 0; i < lines.length; i++) lines[i].style.transitionDelay = (base + i * 0.09) + 's';
    el.classList.add('lm-split');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { el.classList.add('lm-in'); });
    });
  }

  var maskObs = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      maskObs.unobserve(e.target);
      split(e.target);
    });
  }, { threshold: 0.2 });

  // ── PARALLAX ────────────────────────────────────────────────
  var mobile = false;
  var vh = window.innerHeight;
  var hero, heroTop = 0, heroH = 0, heroOn = true;
  var heroLayers = []; // [el, fracción del scroll]
  var items = [];      // { el, measure, amp, active, apply }
  var ticking = false;

  function measureLayout() {
    mobile = window.matchMedia('(max-width: 768px)').matches;
    vh = window.innerHeight;
    if (hero) {
      heroTop = hero.getBoundingClientRect().top + window.scrollY;
      heroH = hero.offsetHeight;
    }
  }

  // p: 1 cuando el elemento asoma por abajo, 0 en el centro de la pantalla, -1 al salir por arriba.
  function progress(r) {
    var p = (r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2);
    return p > 1 ? 1 : p < -1 ? -1 : p;
  }

  function update() {
    ticking = false;
    var k = mobile ? 0.5 : 1;
    var writes = [];

    if (hero && heroOn) {
      var s = window.scrollY - heroTop;
      s = s < 0 ? 0 : s > heroH ? heroH : s;
      for (var h = 0; h < heroLayers.length; h++) {
        writes.push([heroLayers[h][0], s * heroLayers[h][1] * k]);
      }
    }
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it.active) continue;
      it.p = progress(it.measure.getBoundingClientRect());
    }
    for (var w = 0; w < writes.length; w++) {
      writes[w][0].style.translate = '0 ' + writes[w][1].toFixed(1) + 'px';
    }
    for (var j = 0; j < items.length; j++) {
      if (items[j].active) items[j].apply(items[j].p * items[j].amp * k);
    }
  }

  function requestUpdate() {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }

  var itemObs = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.target === hero) { heroOn = e.isIntersecting; return; }
      items.forEach(function (it) {
        if (it.measure !== e.target) return;
        it.active = e.isIntersecting;
        if (it.usesTranslate) it.el.style.willChange = it.active ? 'translate' : '';
      });
    });
    requestUpdate();
  }, { rootMargin: '120px 0px' });

  function addItem(el, measure, amp, apply) {
    var it = {
      el: el, measure: measure, amp: amp, active: false, p: 0, usesTranslate: !apply,
      apply: apply || function (v) { el.style.translate = '0 ' + v.toFixed(1) + 'px'; }
    };
    items.push(it);
    itemObs.observe(measure);
  }

  function init() {
    document.querySelectorAll('.mask-h').forEach(function (el) { maskObs.observe(el); });

    // Hero: el fondo se queda atrás (lejos), la foto a velocidad media, el texto se va
    // apenas más rápido (cerca). Las capas que bajan dejan su hueco arriba del hero,
    // que en ese momento ya está fuera de pantalla (#hero tiene overflow:hidden).
    hero = document.getElementById('hero');
    if (hero) {
      [['#hero-canvas', 0.20], ['.hero-stage', 0.10], ['.hero-content', -0.06]].forEach(function (d) {
        var el = hero.querySelector(d[0]);
        if (el) heroLayers.push([el, d[1]]);
      });
      itemObs.observe(hero);
    }

    // Colecciones: la foto se desplaza dentro de su marco, en sentido contrario al scroll.
    document.querySelectorAll('#collections .col-card').forEach(function (card) {
      var bg = card.querySelector('.col-bg');
      if (bg) addItem(bg, card, -20);
    });

    // Nuestra historia: los 3 marcos a velocidades distintas (los de abajo, más rápido)
    // y los 2 círculos decorativos del fondo en sentidos opuestos.
    var storyAmps = [6, 16, 24];
    document.querySelectorAll('#story .s-img').forEach(function (img, i) {
      addItem(img, img, storyAmps[i] || 16);
    });
    var story = document.getElementById('story');
    if (story) {
      addItem(story, story, 30, function (v) {
        story.style.setProperty('--sp1', v.toFixed(1) + 'px');
        story.style.setProperty('--sp2', (-v * 0.7).toFixed(1) + 'px');
      });
    }

    measureLayout();
    update();
    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', function () { measureLayout(); requestUpdate(); });
    window.addEventListener('load', function () { measureLayout(); requestUpdate(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
