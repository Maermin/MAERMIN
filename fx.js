// ============================================================================
// MAERMIN — Aurora FX (motion engine)
// ----------------------------------------------------------------------------
// Views are built from inline-styled React elements, so instead of touching
// every view this module *observes* the rendered DOM and progressively tags
// surfaces with FX classes that styles.css animates:
//
//   .mx-card        elevated surface → cursor spotlight, glow border, reveal
//   .mx-primary     accent-filled button → shine sweep + glow
//   .mx-reveal/.is-in  staggered entrance when scrolled into view
//   .mx-count       big figures animate (count-up) on first appearance
//
// Global effects: cursor aura, pointer-tracked --mx-x/--mx-y per card, subtle
// 3D tilt on large cards. Everything is skipped under prefers-reduced-motion
// or when the user turns motion off (localStorage 'maermin_fx' = 'off').
// No dependencies; safe to load before React.
// ============================================================================
(function () {
  'use strict';

  var doc = document, win = window;
  var reduce = false;
  try { reduce = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  function motionOff() {
    try { return reduce || localStorage.getItem('maermin_fx') === 'off'; } catch (e) { return reduce; }
  }

  // ---- helpers -------------------------------------------------------------
  // Inline lengths arrive as px / rem / em — normalise to px.
  function px(v) {
    var n = parseFloat(v);
    if (isNaN(n)) return 0;
    return /r?em\s*$/.test(String(v).split(' ')[0]) ? n * 16 : n;
  }
  function parseRGB(str) {
    var m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/.exec(str || '');
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] } : null;
  }
  function accentRGB() {
    var v = getComputedStyle(doc.documentElement).getPropertyValue('--accent').trim();
    if (/^#([0-9a-f]{6})$/i.test(v)) {
      var n = parseInt(v.slice(1), 16);
      return { r: n >> 16 & 255, g: n >> 8 & 255, b: n & 255 };
    }
    return parseRGB(v);
  }
  function near(a, b) { return a && b && Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 24; }

  // ---- classification ------------------------------------------------------
  var ACC = null;
  function classify(el) {
    if (el.nodeType !== 1 || el.__mxSeen) return;
    var s = el.style;
    if (!s) return;
    var tag = el.tagName;
    // Not laid out yet (hidden tab, mounting) — leave unseen so a later scan retries.
    if (!el.offsetWidth && (tag === 'DIV' || tag === 'BUTTON')) return;
    el.__mxSeen = 1;

    if (tag === 'BUTTON') {
      var bg = parseRGB(s.backgroundColor) || null;
      if (!bg && s.background && s.background.indexOf('gradient') > -1 && ACC) {
        // gradient fills that start with the accent
        bg = parseRGB(s.background);
      }
      if (bg && bg.a > 0.85 && near(bg, ACC) && el.offsetWidth > 56) el.classList.add('mx-primary');
      return;
    }
    if (tag !== 'DIV' && tag !== 'SECTION' && tag !== 'ARTICLE') return;
    var radius = px(s.borderRadius);
    var hasBorder = (s.border && s.border.indexOf('1px') > -1) || px(s.borderWidth) >= 1;
    var padded = px(s.padding) >= 10 || px(s.paddingTop) >= 10;
    if (radius >= 12 && hasBorder && padded) {
      var w = el.offsetWidth, h = el.offsetHeight;
      if (w >= 180 && h >= 64 && !el.closest('.mx-popover, .command-palette, [role="dialog"], .mx-card-nested-stop')) {
        var parentCard = el.parentElement && el.parentElement.closest('.mx-card');
        el.classList.add(parentCard ? 'mx-subcard' : 'mx-card');
        if (!parentCard) {
          if (w * h > 180000) el.classList.add('mx-card-lg');
          queueReveal(el);
        }
      }
    }
  }

  // ---- reveal on scroll ----------------------------------------------------
  var io = null, revealBatch = 0, revealTimer = 0;
  function queueReveal(el) {
    if (motionOff() || !('IntersectionObserver' in win)) return;
    if (!io) {
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (!en.isIntersecting) return;
          var t = en.target;
          io.unobserve(t);
          t.style.setProperty('--mx-delay', (Math.min(revealBatch++, 10) * 55) + 'ms');
          t.classList.add('is-in');
          clearTimeout(revealTimer);
          revealTimer = setTimeout(function () { revealBatch = 0; }, 180);
        });
      }, { rootMargin: '0px 0px -6% 0px', threshold: 0.04 });
    }
    el.classList.add('mx-reveal');
    io.observe(el);
  }

  // ---- count-up for big figures -------------------------------------------
  // Only animates text nodes that look like a formatted number (e.g. 44,528 /
  // +20,440.40 € / 84.86%). Final text is always restored exactly, so the
  // formatting (and privacy masking) produced by the app is never altered.
  var NUM_RE = /^([+\-−]?)([\d.,]+)(.*)$/;
  function countUp(el) {
    if (el.__mxCounted || motionOff()) return;
    var txt = el.textContent.trim();
    if (!txt || txt.indexOf('•') > -1) return;
    var m = NUM_RE.exec(txt);
    if (!m) return;
    var raw = m[2], sep = raw.lastIndexOf('.') > raw.lastIndexOf(',') ? '.' : ',';
    var decimals = raw.indexOf(sep) > -1 && raw.split(sep).pop().length <= 2 ? raw.split(sep).pop().length : 0;
    var target = parseFloat(raw.replace(sep === '.' ? /,/g : /\./g, '').replace(',', '.'));
    if (!isFinite(target) || target < 10) return;
    el.__mxCounted = 1;
    var node = el.firstChild;
    if (!node || node.nodeType !== 3 || el.childNodes.length !== 1) return;
    var finalText = node.nodeValue;
    var thou = sep === '.' ? ',' : '.';
    var fmt = function (v) {
      var p = v.toFixed(decimals).split('.');
      p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, thou);
      return m[1] + p.join(sep) + m[3];
    };
    var t0 = performance.now(), dur = 900;
    node.__mxOwnUntil = t0 + dur + 120; // motion.js ignores our frames
    (function step(now) {
      if (node.nodeValue !== finalText && node.__mxLast !== node.nodeValue) return; // React changed it — stop
      var k = Math.min(1, (now - t0) / dur);
      var e = 1 - Math.pow(1 - k, 4);
      if (k < 1) { node.__mxLast = node.nodeValue = fmt(target * e); requestAnimationFrame(step); }
      else { node.nodeValue = finalText; }
    })(t0);
  }
  function scanFigures(root) {
    if (motionOff()) return;
    var els = root.querySelectorAll ? root.querySelectorAll('div, span') : [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.__mxCounted || el.childNodes.length !== 1 || el.firstChild.nodeType !== 3) continue;
      var fs = px(el.style.fontSize);
      if (fs >= 26) { el.classList.add('mx-figure'); countUp(el); }
    }
  }

  // ---- DOM observation -----------------------------------------------------
  var pending = [], scheduled = false;
  function flush() {
    scheduled = false;
    ACC = accentRGB();
    var list = pending; pending = [];
    for (var i = 0; i < list.length; i++) {
      var root = list[i];
      if (!root.isConnected || root.nodeType !== 1) continue;
      classify(root);
      var all = root.getElementsByTagName('*');
      for (var j = 0; j < all.length; j++) classify(all[j]);
      scanFigures(root);
    }
  }
  var settleTimer = 0;
  function settle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(function () { var r = doc.getElementById('root'); if (r) { pending.push(r); flush(); } }, 700);
  }
  function schedule(node) {
    settle();
    pending.push(node);
    if (!scheduled) { scheduled = true; (win.requestIdleCallback || requestAnimationFrame)(flush, { timeout: 120 }); }
  }

  function boot() {
    var root = doc.getElementById('root');
    if (!root) return;
    schedule(root);
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var add = muts[i].addedNodes;
        for (var j = 0; j < add.length; j++) if (add[j].nodeType === 1) schedule(add[j]);
      }
    }).observe(root, { childList: true, subtree: true });

    if (motionOff()) { doc.documentElement.classList.add('mx-still'); return; }
    doc.documentElement.classList.add('mx-motion');

    // Cursor aura + per-card spotlight/tilt (one listener, rAF-throttled).
    var aura = doc.createElement('div');
    aura.className = 'mx-aura';
    aura.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(aura);
    var lx = 0, ly = 0, raf = 0, hot = null;
    function paint() {
      raf = 0;
      aura.style.transform = 'translate3d(' + (lx - 300) + 'px,' + (ly - 300) + 'px,0)';
      if (hot) {
        var r = hot.getBoundingClientRect();
        var x = lx - r.left, y = ly - r.top;
        hot.style.setProperty('--mx-x', x + 'px');
        hot.style.setProperty('--mx-y', y + 'px');
        if (hot.classList.contains('mx-card-lg') || hot.classList.contains('mx-tilt')) return;
        var rx = ((y / r.height) - 0.5) * -3.2, ry = ((x / r.width) - 0.5) * 3.2;
        hot.style.setProperty('--mx-rx', rx.toFixed(2) + 'deg');
        hot.style.setProperty('--mx-ry', ry.toFixed(2) + 'deg');
      }
    }
    doc.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      lx = e.clientX; ly = e.clientY;
      var c = e.target && e.target.closest ? e.target.closest('.mx-card') : null;
      if (c !== hot) {
        if (hot) { hot.classList.remove('is-hot'); hot.style.removeProperty('--mx-rx'); hot.style.removeProperty('--mx-ry'); }
        hot = c;
        if (hot) hot.classList.add('is-hot');
      }
      if (!raf) raf = requestAnimationFrame(paint);
    }, { passive: true });
    doc.addEventListener('pointerleave', function () { aura.style.opacity = '0'; });
    doc.addEventListener('pointerenter', function () { aura.style.opacity = ''; });

    // Click ripple on buttons.
    doc.addEventListener('pointerdown', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button') : null;
      if (!b || b.disabled) return;
      var r = b.getBoundingClientRect();
      var d = Math.max(r.width, r.height) * 2.2;
      var ink = doc.createElement('span');
      ink.className = 'mx-ink';
      ink.style.cssText = 'width:' + d + 'px;height:' + d + 'px;left:' + (e.clientX - r.left - d / 2) + 'px;top:' + (e.clientY - r.top - d / 2) + 'px';
      if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
      if (getComputedStyle(b).overflow !== 'hidden') b.style.overflow = 'hidden';
      b.appendChild(ink);
      setTimeout(function () { ink.remove(); }, 650);
    }, { passive: true });
  }

  win.MaerminFX = {
    setEnabled: function (on) {
      try { localStorage.setItem('maermin_fx', on ? 'on' : 'off'); } catch (e) {}
      win.location.reload();
    },
    enabled: function () { return !motionOff(); },
    rescan: function () { var r = doc.getElementById('root'); if (r) schedule(r); }
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
