// ============================================================================
// MAERMIN — Aurora Motion (purposeful micro-interactions)
// ----------------------------------------------------------------------------
// Where fx.js is atmosphere, this module is *feedback*: motion that tells you
// something happened or where you are. Works by observing the rendered DOM, so
// no view needs to change. Disabled with the same switch as fx.js
// (MaerminFX.enabled()) and under prefers-reduced-motion.
//
//   • Value ticks      a number that changes flashes green/red with an arrow
//                      nudge — you see *what* moved after a price refresh.
//   • Decode reveal    leaving privacy mode "decrypts" masked amounts.
//   • Nav glider       one indicator glides between sidebar items.
//   • Chip glide       selecting 1D/1W/1M-style chips slides a pill across.
//   • Chart reveal     charts wipe in (line/area) or sweep in (donut).
//   • Bar growth       progress / weight bars grow from zero.
//   • Row cascade      table rows cascade in on first render.
//   • Dialog spring    overlays blur in, dialogs spring up.
//   • Busy state       refresh/sync buttons show a scanning progress sweep.
//   • Scroll progress  a thin luminous bar under the header; header condenses.
//   • Haptics          light taps on touch devices for nav + primary actions.
// ============================================================================
(function () {
  'use strict';

  var doc = document, win = window;
  function enabled() {
    try { if (win.matchMedia('(prefers-reduced-motion: reduce)').matches) return false; } catch (e) {}
    return !win.MaerminFX || win.MaerminFX.enabled();
  }
  // Restart a one-shot animation class. The class is removed now and re-added
  // in the next frame - all restarts of a frame are batched. (It used to force
  // a synchronous reflow with offsetWidth per element, so a price refresh that
  // ticks 30 numbers did 30 layouts in a row.)
  var restarts = [], restartRaf = 0;
  function once(el, cls, ms) {
    el.classList.remove(cls);
    restarts.push([el, cls, ms]);
    if (!restartRaf) restartRaf = requestAnimationFrame(function () {
      restartRaf = 0;
      var list = restarts; restarts = [];
      for (var i = 0; i < list.length; i++) {
        var e = list[i][0], c = list[i][1];
        e.classList.add(c);
        clearTimeout(e['__t_' + c]);
        e['__t_' + c] = setTimeout(function (x, y) { return function () { x.classList.remove(y); }; }(e, c), list[i][2] || 900);
      }
    });
  }
  function haptic(ms) { try { if (navigator.vibrate && matchMedia('(hover: none)').matches) navigator.vibrate(ms || 8); } catch (e) {} }

  // ---- number parsing ------------------------------------------------------
  function toNum(txt) {
    if (!txt) return null;
    var m = /([+\-−]?)\s*([\d][\d.,]*)/.exec(txt);
    if (!m) return null;
    var raw = m[2];
    var lastDot = raw.lastIndexOf('.'), lastComma = raw.lastIndexOf(',');
    var dec = lastDot > lastComma ? '.' : ',';
    var decPart = raw.split(dec).pop();
    var norm = (raw.indexOf(dec) > -1 && decPart.length <= 2)
      ? raw.split(dec).slice(0, -1).join('').replace(/[.,]/g, '') + '.' + decPart
      : raw.replace(/[.,]/g, '');
    var v = parseFloat(norm);
    if (!isFinite(v)) return null;
    return (m[1] === '-' || m[1] === '−') ? -v : v;
  }

  // ---- decode (privacy reveal) ---------------------------------------------
  var GLYPHS = '0123456789#%&$@*';
  function decode(node) {
    var final = node.nodeValue, t0 = performance.now(), dur = 520;
    node.__mxOwnUntil = t0 + dur + 120;
    node.__mxBusy = 1;
    (function step(now) {
      if (node.__mxStarted && node.nodeValue !== node.__mxLast) { node.__mxBusy = 0; node.__mxStarted = 0; return; } // React replaced it
      node.__mxStarted = 1;
      var k = Math.min(1, (now - t0) / dur);
      if (k >= 1) { node.__mxLast = node.nodeValue; node.nodeValue = final; node.__mxBusy = 0; node.__mxStarted = 0; return; }
      var settled = Math.floor(final.length * k), out = '';
      for (var i = 0; i < final.length; i++) {
        var c = final.charAt(i);
        out += (i < settled || !/\d/.test(c)) ? c : GLYPHS.charAt((Math.random() * GLYPHS.length) | 0);
      }
      node.__mxLast = node.nodeValue = out;
      requestAnimationFrame(step);
    })(t0);
  }

  // ---- value change handling ----------------------------------------------
  function onText(node, oldVal) {
    // Our own animation frames (count-up in fx.js, decode here) are tagged via
    // __mxLast; any record whose old OR new value is one of them is ours.
    if ((node.__mxOwnUntil || 0) > performance.now()) return;
    if (node.__mxBusy) return;
    var el = node.parentElement;
    if (!el || !el.closest('.maermin-main')) return;
    var now = node.nodeValue;
    if (oldVal == null || oldVal === now) return;
    if (oldVal.indexOf('•') > -1 && now.indexOf('•') === -1 && /\d/.test(now)) { decode(node); return; }
    if (now.indexOf('•') > -1) { once(el, 'mx-mask', 500); return; }
    var a = toNum(oldVal), b = toNum(now);
    if (a == null || b == null || a === b) return;
    // Only react to value-ish text (keeps clocks / counters in prose quiet).
    if (!/[€$%]|\d[.,]\d/.test(now)) return;
    once(el, b > a ? 'mx-tick-up' : 'mx-tick-down', 1300);
  }

  // ---- sidebar glider ------------------------------------------------------
  var glider = null, sidebar = null;
  function placeGlider() {
    sidebar = doc.querySelector('.maermin-sidebar');
    if (!sidebar) return;
    if (!glider || !glider.isConnected) {
      glider = doc.createElement('div');
      glider.className = 'mx-glider';
      glider.setAttribute('aria-hidden', 'true');
      sidebar.insertBefore(glider, sidebar.firstChild);
      sidebar.classList.add('has-glider');
    }
    var act = sidebar.querySelector('.mx-nav.is-active');
    if (!act) { glider.style.opacity = '0'; return; }
    var sr = sidebar.getBoundingClientRect(), ar = act.getBoundingClientRect();
    var top = ar.top - sr.top + sidebar.scrollTop, left = ar.left - sr.left;
    glider.style.opacity = '1';
    glider.style.transform = 'translate3d(' + left + 'px,' + top + 'px,0)';
    glider.style.width = ar.width + 'px';
    glider.style.height = ar.height + 'px';
    glider.classList.toggle('is-child', act.classList.contains('is-child'));
  }

  // ---- chip-group glide (FLIP ghost) ----------------------------------------
  function isActiveChip(b) {
    var cs = getComputedStyle(b);
    var acc = getComputedStyle(doc.documentElement).getPropertyValue('--accent').trim();
    if (b.classList.contains('is-on') || b.getAttribute('aria-pressed') === 'true') return true;
    var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(cs.backgroundColor);
    if (!m || (m[4] != null && +m[4] < 0.5)) return false;
    var n = parseInt(acc.slice(1), 16);
    if (!/^#[0-9a-f]{6}$/i.test(acc)) return false;
    return Math.abs(m[1] - (n >> 16 & 255)) + Math.abs(m[2] - (n >> 8 & 255)) + Math.abs(m[3] - (n & 255)) < 40;
  }
  function chipGroup(btn) {
    var p = btn.parentElement;
    if (!p) return null;
    var kids = p.children, btns = 0;
    for (var i = 0; i < kids.length; i++) if (kids[i].tagName === 'BUTTON') btns++;
    return (btns >= 3 && btns === kids.length) ? p : null;
  }
  function glideChips(btn) {
    var group = chipGroup(btn);
    if (!group) return;
    var prev = null;
    Array.prototype.forEach.call(group.children, function (b) { if (!prev && isActiveChip(b)) prev = b; });
    if (!prev || prev === btn) return;
    var from = prev.getBoundingClientRect();
    var bg = getComputedStyle(prev).backgroundColor, rad = getComputedStyle(prev).borderRadius;
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      var now = null;
      Array.prototype.forEach.call(group.children, function (b) { if (!now && isActiveChip(b)) now = b; });
      if (!now || now === prev) return;
      var to = now.getBoundingClientRect();
      var ghost = doc.createElement('div');
      ghost.className = 'mx-chip-ghost';
      ghost.style.cssText = 'left:' + from.left + 'px;top:' + from.top + 'px;width:' + from.width + 'px;height:' + from.height + 'px;background:' + bg + ';border-radius:' + rad;
      doc.body.appendChild(ghost);
      now.classList.add('mx-chip-hide');
      requestAnimationFrame(function () {
        ghost.style.transform = 'translate3d(' + (to.left - from.left) + 'px,' + (to.top - from.top) + 'px,0)';
        ghost.style.width = to.width + 'px';
      });
      setTimeout(function () { now.classList.remove('mx-chip-hide'); once(now, 'mx-pop', 400); ghost.remove(); }, 320);
    }); });
  }

  // ---- structural enhancements on added nodes ------------------------------
  function enhance(root) {
    if (root.nodeType !== 1) return;
    var main = root.closest ? root.closest('.maermin-main') : null;
    var list = [root].concat(Array.prototype.slice.call(root.getElementsByTagName('*')));
    var rows = 0;
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.__mxEnh) continue;
      var s = el.style, tag = el.tagName;

      // Overlays / dialogs
      if (s && s.position === 'fixed' && (s.inset === '0px' || (s.top === '0px' && s.left === '0px' && (s.right === '0px' || s.width === '100%'))) && el.children.length) {
        el.__mxEnh = 1;
        if (!el.classList.contains('command-palette-overlay')) {
          el.classList.add('mx-overlay');
          var d = el.firstElementChild;
          if (d) d.classList.add('mx-dialog');
        }
        continue;
      }
      if (!main && !(el.closest && el.closest('.maermin-main'))) continue;

      // Charts
      if (tag === 'svg' || tag === 'SVG') {
        el.__mxEnh = 1;
        var w = el.getBoundingClientRect().width, h = el.getBoundingClientRect().height;
        if (w >= 90 && h >= 60 && !el.closest('button')) {
          var round = Math.abs(w - h) < Math.min(w, h) * 0.25 && el.querySelector('circle');
          el.classList.add(round ? 'mx-sweep' : 'mx-wipe');
        }
        continue;
      }
      // Bars: thin fills sized by % inside a clipped track
      if (tag === 'DIV' && s && /%$/.test(s.width) && el.offsetHeight > 0 && el.offsetHeight <= 14) {
        el.__mxEnh = 1;
        var par = el.parentElement;
        if (par && par.offsetHeight <= 16) el.classList.add('mx-grow');
        continue;
      }
      // Table rows cascade (first render of a table only)
      if (tag === 'TR' && el.parentElement && el.parentElement.tagName === 'TBODY') {
        el.__mxEnh = 1;
        if (!el.parentElement.__mxCascaded) {
          el.style.setProperty('--mx-row', Math.min(rows++, 14));
          el.classList.add('mx-row-in');
        }
        continue;
      }
    }
    // Mark tbodies after their first batch so later updates don't re-cascade.
    Array.prototype.forEach.call(root.querySelectorAll ? root.querySelectorAll('tbody') : [], function (tb) {
      setTimeout(function () { tb.__mxCascaded = 1; }, 50);
    });
  }

  // ---- busy state for refresh/sync style actions ---------------------------
  var BUSY_RE = /refresh|sync|aktualis|scan|fetch|update prices|load/i;

  // ---- boot ----------------------------------------------------------------
  function boot() {
    var rootEl = doc.getElementById('root');
    if (!rootEl) return;
    var on = enabled();
    if (on) doc.documentElement.classList.add('mx-anim');

    // The glider is re-measured only when the sidebar changed (its active item
    // or its children). It used to be measured - two forced layouts - after
    // EVERY class change anywhere in the app (card hover, reveals, ticks).
    var pend = [], sched = false, navDirty = true;
    function inSidebar(n) {
      var e = n && (n.nodeType === 1 ? n : n.parentElement);
      return !!(e && e.closest && e.closest('.maermin-sidebar'));
    }
    function flush() {
      sched = false;
      var l = pend; pend = [];
      if (on) l.forEach(function (n) { if (n.isConnected) enhance(n); });
      if (navDirty || (glider && !glider.isConnected)) { navDirty = false; placeGlider(); }
    }
    function kick() { if (!sched) { sched = true; requestAnimationFrame(flush); } }
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'characterData') { if (on) onText(m.target, m.oldValue); continue; }
        if (m.type === 'attributes') {
          if (m.target.classList && m.target.classList.contains('mx-nav')) { navDirty = true; kick(); }
          continue;
        }
        if (!navDirty && (inSidebar(m.target) || m.target === rootEl)) navDirty = true;
        for (var j = 0; j < m.addedNodes.length; j++) {
          var n = m.addedNodes[j];
          if (n.nodeType === 1) pend.push(n);
          else if (n.nodeType === 3 && on && m.removedNodes.length === 1 && m.removedNodes[0].nodeType === 3) onText(n, m.removedNodes[0].nodeValue);
        }
      }
      if (pend.length || navDirty) kick();
    }).observe(rootEl, { childList: true, subtree: true, characterData: true, characterDataOldValue: true, attributes: true, attributeFilter: ['class'] });
    // Portals (modals appended to body) — overlays only.
    new MutationObserver(function (muts) {
      if (!on) return;
      muts.forEach(function (m) { Array.prototype.forEach.call(m.addedNodes, function (n) { if (n.nodeType === 1 && n.id !== 'root') enhance(n); }); });
    }).observe(doc.body, { childList: true });

    win.addEventListener('resize', function () { navDirty = true; kick(); }, { passive: true });

    // Header condense + scroll progress
    var prog = doc.createElement('div');
    prog.className = 'mx-scrollbar';
    prog.setAttribute('aria-hidden', 'true');
    doc.body.appendChild(prog);
    var ticking = false;
    function onScroll() {
      ticking = false;
      var se = doc.scrollingElement || doc.documentElement;
      var max = se.scrollHeight - se.clientHeight;
      var y = se.scrollTop;
      prog.style.transform = 'scaleX(' + (max > 40 ? Math.min(1, y / max) : 0) + ')';
      doc.documentElement.classList.toggle('mx-scrolled', y > 8);
    }
    win.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });

    // Click-driven feedback
    doc.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      if (b.closest('.mx-bottom-nav') || b.classList.contains('mx-nav')) haptic(6);
      if (b.classList.contains('mx-primary')) haptic(10);
      if (!on) return;
      glideChips(b);
      if (BUSY_RE.test(b.textContent || '') && b.textContent.length < 40) once(b, 'mx-busy', 1600);
      if (b.classList.contains('mx-nav') || b.closest('.mx-bottom-nav')) {
        // Instant scroll to top on view change so the new view's entrance is seen.
        var se = doc.scrollingElement || doc.documentElement;
        if (se.scrollTop > 200) se.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }, true);

    pend.push(rootEl); flush();
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
