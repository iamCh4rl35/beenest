/* =============================================================
   BEENest – wykres liniowy w stylu notowań giełdowych.
   Czyste SVG, bez bibliotek (działa offline na hotspocie Raspberry).

   Użycie (app.js):
       const ch = new BeeChart(element);
       ch.show(dane, 'grow')     – linia wyrasta z osi X (wejście na stronę)
       ch.show(dane, 'domain')   – płynna zmiana zakresu osi X i Y (zmiana interwału)
       ch.show(dane, 'morph')    – linia przelewa się w nowy kształt (zmiana parametru)
       ch.show(dane, 'quiet')    – odświeżenie bez animacji (zachowuje przybliżenie)

   Kliknięcie w wykres = przybliżenie 2× w to miejsce (kolejne kliknięcia przybliżają dalej),
   dwa kliknięcia w ciągu 0,5 s = powrót do pełnego zakresu.

   Płynność i krzywe animacji ustawisz w style.css (:root):
       --chart-grow-duration   wejście linii z osi X
       --chart-zoom-duration   zmiana interwału / przybliżenie / zmiana parametru
       --chart-ease            krzywa (domyślnie ta sama co reszta strony: --anim-ease)
   ============================================================= */
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const M = { top: 30, right: 54, bottom: 26, left: 12 };   // marginesy obszaru z linią (px)
  const DOUBLE_CLICK_MS = 500;   // dwa kliknięcia w tym czasie = reset przybliżenia
  const ZOOM_FACTOR = 2;         // każde kliknięcie przybliża tyle razy
  const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
  let uid = 0;

  /* ---------- drobne narzędzia ---------- */
  function svg(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function div(cls, parent) {
    const n = document.createElement('div');
    n.className = cls;
    parent.appendChild(n);
    return n;
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const lerp = (a, b, p) => a + (b - a) * p;
  const pad = n => String(n).padStart(2, '0');
  const fmtDay = d => d.getDate() + ' ' + MONTHS[d.getMonth()];
  const fmtTime = d => pad(d.getHours()) + ':' + pad(d.getMinutes());

  /* ---------- krzywa animacji z CSS (cubic-bezier jak w przeglądarce) ---------- */
  const KEYWORDS = {
    ease: [.25, .1, .25, 1], 'ease-in': [.42, 0, 1, 1], 'ease-out': [0, 0, .58, 1],
    'ease-in-out': [.42, 0, .58, 1], linear: [0, 0, 1, 1]
  };
  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = t => ((ax * t + bx) * t + cx) * t;
    const sy = t => ((ay * t + by) * t + cy) * t;
    const dx = t => (3 * ax * t + 2 * bx) * t + cx;
    return x => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 8; i++) {           // Newton
        const e = sx(t) - x;
        if (Math.abs(e) < 1e-5) return sy(t);
        const d = dx(t);
        if (Math.abs(d) < 1e-6) break;
        t -= e / d;
      }
      let lo = 0, hi = 1;                     // bisekcja, gdy Newton nie zbiegł
      t = x;
      for (let i = 0; i < 30; i++) {
        const v = sx(t);
        if (Math.abs(v - x) < 1e-5) break;
        if (v < x) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return sy(t);
    };
  }
  const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  function cssEase() {
    const v = cssVar('--chart-ease') || cssVar('--anim-ease') || 'ease';
    const m = v.match(/cubic-bezier\(([^)]+)\)/);
    const p = m ? m[1].split(',').map(Number) : (KEYWORDS[v] || KEYWORDS.ease);
    return p.length === 4 && p.every(n => !isNaN(n)) ? bezier(...p) : bezier(...KEYWORDS.ease);
  }
  function cssMs(name, fallback) {
    const v = cssVar(name);
    const n = parseFloat(v);
    if (!v || isNaN(n)) return fallback;
    return /ms$/.test(v) ? n : n * 1000;
  }

  /* ---------- gładka linia bez "przestrzeliwania" (interpolacja monotoniczna) ---------- */
  function linePath(pts) {
    const n = pts.length;
    if (!n) return '';
    const f = v => Math.round(v * 10) / 10;
    if (n === 1) return `M${f(pts[0][0] - 2)},${f(pts[0][1])}L${f(pts[0][0] + 2)},${f(pts[0][1])}`;
    if (n === 2) return `M${f(pts[0][0])},${f(pts[0][1])}L${f(pts[1][0])},${f(pts[1][1])}`;
    const dx = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) {
      dx[i] = pts[i + 1][0] - pts[i][0];
      m[i] = dx[i] ? (pts[i + 1][1] - pts[i][1]) / dx[i] : 0;
    }
    t[0] = m[0];
    t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) {
      t[i] = m[i - 1] * m[i] <= 0 ? 0
        : 3 * (dx[i - 1] + dx[i]) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
    }
    let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += `C${f(pts[i][0] + h)},${f(pts[i][1] + t[i] * h)},${f(pts[i + 1][0] - h)},${f(pts[i + 1][1] - t[i + 1] * h)},${f(pts[i + 1][0])},${f(pts[i + 1][1])}`;
    }
    return d;
  }

  /* ---------- podziałki ---------- */
  function niceStep(range, count) {
    const raw = range / Math.max(1, count);
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  }
  const X_STEPS = [900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 2 * 86400, 7 * 86400, 14 * 86400, 30 * 86400, 61 * 86400];
  function timeTicks(x0, x1, maxTicks) {
    const span = x1 - x0;
    const step = X_STEPS.find(s => span / s <= maxTicks) || X_STEPS[X_STEPS.length - 1];
    const out = [];
    if (step >= 30 * 86400) {                              // pierwsze dni miesięcy
      const months = step > 31 * 86400 ? 2 : 1;
      const d = new Date(x0 * 1000);
      d.setDate(1); d.setHours(0, 0, 0, 0);
      while (d.getTime() / 1000 <= x1) {
        const t = d.getTime() / 1000;
        if (t >= x0 && d.getMonth() % months === 0) out.push({ t, label: MONTHS[d.getMonth()] + (d.getMonth() === 0 ? ' ' + d.getFullYear() : ''), major: true });
        d.setMonth(d.getMonth() + 1);
      }
      return out;
    }
    if (step >= 86400) {                                   // co n dni, wyrównane do lokalnej północy
      const n = step / 86400;
      const d = new Date(x0 * 1000);
      d.setHours(0, 0, 0, 0);
      while (d.getTime() / 1000 <= x1) {
        const t = d.getTime() / 1000;
        const dayNo = Math.round((t - d.getTimezoneOffset() * 60) / 86400);
        if (t >= x0 && dayNo % n === 0) out.push({ t, label: fmtDay(d), major: true });
        d.setDate(d.getDate() + 1);
      }
      return out;
    }
    const d = new Date(x0 * 1000);                         // godziny: od lokalnej północy co krok
    d.setHours(0, 0, 0, 0);
    let t = d.getTime() / 1000;
    while (t < x0) t += step;
    for (; t <= x1; t += step) {
      const dt = new Date(t * 1000);
      const midnight = dt.getHours() === 0 && dt.getMinutes() === 0;
      out.push({ t, label: midnight ? fmtDay(dt) : fmtTime(dt), major: midnight });
    }
    return out;
  }

  /* =============================================================
     Wykres
     ============================================================= */
  class BeeChart {
    constructor(host) {
      this.host = host;
      this.id = 'bc' + (++uid);
      host.classList.add('chart');
      this.grid = div('chart-grid', host);
      this.svg = svg('svg', { class: 'chart-svg', 'aria-hidden': 'true' }, host);
      const defs = svg('defs', {}, this.svg);
      const grad = svg('linearGradient', { id: this.id + 'g', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
      svg('stop', { offset: '0%', class: 'chart-grad-top' }, grad);
      svg('stop', { offset: '100%', class: 'chart-grad-bottom' }, grad);
      const clip = svg('clipPath', { id: this.id + 'c' }, defs);
      this.clipRect = svg('rect', {}, clip);

      this.gTicks = svg('g', { class: 'chart-axis chart-y' }, this.svg);
      this.gBands = svg('g', { class: 'chart-bands' }, this.svg);
      this.gPlot = svg('g', { 'clip-path': `url(#${this.id}c)` }, this.svg);
      this.gBandLabels = svg('g', { class: 'chart-bands' }, this.svg);   // nazwy stref nad linią danych
      this.base = svg('line', { class: 'chart-base' }, this.svg);
      this.gX = svg('g', { class: 'chart-axis chart-x' }, this.svg);
      this.gHover = svg('g', { class: 'chart-hover' }, this.svg);
      this.hoverLine = svg('line', {}, this.gHover);
      this.paths = [];   // [{area, line}] na każdą serię

      this.legend = div('chart-legend', host);
      this.hint = div('chart-hint', host);
      this.hint.textContent = 'Dwuklik – pełny zakres';
      this.tip = div('chart-tip', host);
      this.empty = div('chart-empty', host);

      this.data = null;     // { from, to, step, gap, unit, decimals, bands, avgLabel, series:[{label, points}] }
      this.view = null;     // aktualnie widoczny zakres { x0, x1, y0, y1 }
      this.full = null;     // pełny zakres bieżących danych
      this.zoomed = false;
      this.raf = 0;
      this.lastClick = 0;
      this.lastPx = [];     // ostatnio narysowane punkty (px) – do animacji "morph"
      this.pending = null;  // tryb animacji odłożony do momentu, gdy wykres będzie widoczny

      host.addEventListener('click', e => this.onClick(e));
      host.addEventListener('pointermove', e => this.onHover(e));
      host.addEventListener('pointerdown', e => this.onHover(e));
      host.addEventListener('pointerleave', () => this.hideTip());
      if (window.ResizeObserver) {
        new ResizeObserver(() => {
          if (!this.visible() || !this.data) return;
          if (this.pending) { const m = this.pending; this.pending = null; this.show(this.data, m); return; }
          if (!this.raf) this.draw(this.view);
        }).observe(host);
      }
    }

    visible() { return this.host.offsetWidth > 0 && this.host.offsetHeight > 0; }
    busy() { return !!this.raf; }
    dims() {
      const W = this.host.clientWidth, H = this.host.clientHeight;
      return { W, H, pw: Math.max(10, W - M.left - M.right), ph: Math.max(10, H - M.top - M.bottom) };
    }

    /* ---------- dane i tryby animacji ---------- */
    show(data, mode) {
      const old = this.data, oldView = this.view;
      this.data = data;
      this.renderLegend();
      const has = data.series.some(s => s.points.length);
      this.empty.textContent = has ? '' : (data.emptyText || 'Brak danych');
      this.host.classList.toggle('is-empty', !has);
      this.hideTip();

      if (mode === 'quiet' && this.zoomed && oldView) {      // odświeżenie bez gubienia przybliżenia
        this.full = this.fit(data.from, data.to);
        this.view = this.fit(oldView.x0, oldView.x1);
        if (this.visible() && !this.raf) this.draw(this.view);
        return;
      }
      this.full = this.fit(data.from, data.to);
      this.setZoomed(false);
      if (!this.visible()) { this.view = this.full; this.pending = mode === 'quiet' ? 'none' : (mode || 'grow'); return; }
      this.pending = null;

      const target = this.full;
      const zoomMs = cssMs('--chart-zoom-duration', 600);
      if (mode === 'domain' && old && oldView && !this.raf) {
        // W trakcie zmiany zakresu rysujemy dane o szerszym zasięgu, na końcu płynnie podmieniamy na nowe.
        const wide = (old.to - old.from) > (data.to - data.from) ? old : data;
        this.tween(oldView, target, zoomMs, wide, () => this.morphTo(target, 220));
      } else if ((mode === 'morph' || mode === 'domain') && this.lastPx.length) {
        this.view = target;
        this.morphTo(target, zoomMs, true);
      } else if (mode === 'none' || mode === 'quiet') {
        this.stop();
        this.view = target;
        this.draw(target);
      } else {                                                  // 'grow'
        this.view = target;
        this.animate(cssMs('--chart-grow-duration', 1100), p => this.draw(target, { grow: p }));
      }
    }

    error(text) {
      this.data = null;
      this.stop();
      this.paths.forEach(p => { p.line.setAttribute('d', ''); p.area.setAttribute('d', ''); });
      this.gTicks.innerHTML = this.gX.innerHTML = this.gBands.innerHTML = this.gBandLabels.innerHTML = '';
      this.legend.innerHTML = '';
      this.empty.textContent = text;
      this.host.classList.add('is-empty');
    }

    /* Zakres osi Y dopasowany do danych widocznych w [x0, x1] (+ granice stanów samopoczucia obok danych) */
    fit(x0, x1) {
      const d = this.data;
      let lo = Infinity, hi = -Infinity;
      d.series.forEach(s => {
        const p = s.points;
        for (let i = 0; i < p.length; i++) {
          const inside = p[i][0] >= x0 && p[i][0] <= x1;
          const edge = (p[i + 1] && p[i][0] < x0 && p[i + 1][0] >= x0) || (p[i - 1] && p[i][0] > x1 && p[i - 1][0] <= x1);
          if (inside || edge) { lo = Math.min(lo, p[i][1]); hi = Math.max(hi, p[i][1]); }
        }
      });
      if (lo === Infinity) { lo = 0; hi = 1; }
      if (d.bands && d.bands.length) {
        const edges = [...new Set(d.bands.flatMap(b => [b.from, b.to]))].sort((a, b) => a - b);
        const below = edges.filter(v => v <= lo).pop(), above = edges.find(v => v >= hi);
        if (below !== undefined) lo = below;
        if (above !== undefined) hi = above;
      }
      if (hi - lo < 1e-9) { const c = Math.abs(lo) * 0.02 || 1; lo -= c; hi += c; }
      const padY = (hi - lo) * 0.12;
      const step = niceStep(hi - lo + 2 * padY, 4);
      return { x0, x1, y0: Math.floor((lo - padY) / step) * step, y1: Math.ceil((hi + padY) / step) * step };
    }

    /* ---------- animacje ---------- */
    stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; }
    animate(ms, frame, done) {
      this.stop();
      if (ms <= 20) { frame(1); if (done) done(); return; }
      const ease = cssEase(), t0 = performance.now();
      const tick = now => {
        const k = Math.min(1, (now - t0) / ms);
        frame(ease(k), k);
        if (k < 1) this.raf = requestAnimationFrame(tick);
        else { this.raf = 0; if (done) done(); }
      };
      this.raf = requestAnimationFrame(tick);
    }
    tween(from, to, ms, data, done) {
      this.animate(ms, p => {
        this.view = { x0: lerp(from.x0, to.x0, p), x1: lerp(from.x1, to.x1, p), y0: lerp(from.y0, to.y0, p), y1: lerp(from.y1, to.y1, p) };
        this.draw(this.view, { data });
      }, () => { this.view = to; if (done) done(); else this.draw(to); });
    }
    morphTo(view, ms, fadeAxis) {
      const prev = this.lastPx.map(s => s.slice());
      this.animate(ms, p => this.draw(view, { morph: prev, p, axisAlpha: fadeAxis ? p : 1 }));
    }

    /* ---------- przybliżanie kliknięciem ---------- */
    setZoomed(on) {
      this.zoomed = on;
      this.host.classList.toggle('is-zoomed', on);
    }
    onClick(e) {
      if (!this.data || !this.view || this.host.classList.contains('is-empty')) return;
      const now = Date.now();
      if (now - this.lastClick <= DOUBLE_CLICK_MS) {           // dwuklik: reset
        this.lastClick = 0;
        this.setZoomed(false);
        this.tween(this.view, this.full, cssMs('--chart-zoom-duration', 600), this.data);
        return;
      }
      this.lastClick = now;
      const { pw } = this.dims();
      const r = this.host.getBoundingClientRect();
      const px = Math.min(Math.max(e.clientX - r.left - M.left, 0), pw);
      const v = this.view, t = v.x0 + (px / pw) * (v.x1 - v.x0);
      const minSpan = Math.max(this.data.step * 4, 3600);
      const span = Math.max((v.x1 - v.x0) / ZOOM_FACTOR, minSpan);
      if (span >= v.x1 - v.x0 - 1) return;                     // już maksymalne przybliżenie
      const x0 = Math.min(Math.max(t - span / 2, this.data.from), this.data.to - span);
      this.setZoomed(true);
      this.tween(v, this.fit(x0, x0 + span), cssMs('--chart-zoom-duration', 600), this.data);
    }

    /* ---------- dymek z wartościami ---------- */
    hideTip() {
      this.tip.classList.remove('show');
      this.gHover.classList.remove('show');
    }
    onHover(e) {
      const d = this.data, v = this.view;
      if (!d || !v || this.raf || this.host.classList.contains('is-empty')) return this.hideTip();
      const { W, pw, ph } = this.dims();
      const r = this.host.getBoundingClientRect();
      const px = e.clientX - r.left;
      if (px < M.left || px > M.left + pw) return this.hideTip();
      const t = v.x0 + ((px - M.left) / pw) * (v.x1 - v.x0);
      // najbliższy punkt (po czasie) spośród wszystkich serii
      let best = null;
      d.series.forEach(s => s.points.forEach(p => {
        if (p[0] < v.x0 || p[0] > v.x1) return;
        if (!best || Math.abs(p[0] - t) < Math.abs(best - t)) best = p[0];
      }));
      if (best === null) return this.hideTip();
      const sx = tt => M.left + (tt - v.x0) / (v.x1 - v.x0) * pw;
      const sy = val => M.top + (1 - (val - v.y0) / (v.y1 - v.y0)) * ph;
      const x = sx(best);
      this.hoverLine.setAttribute('x1', x); this.hoverLine.setAttribute('x2', x);
      this.hoverLine.setAttribute('y1', M.top); this.hoverLine.setAttribute('y2', M.top + ph);
      this.gHover.querySelectorAll('circle').forEach(c => c.remove());
      const rows = [];
      d.series.forEach((s, i) => {
        const p = s.points.find(q => q[0] === best) || s.points.reduce((a, q) => (Math.abs(q[0] - best) < Math.abs(a[0] - best) ? q : a), s.points[0] || [Infinity]);
        if (!p || !isFinite(p[0]) || Math.abs(p[0] - best) > d.step) return;
        svg('circle', { class: 'chart-dot s' + i, cx: x, cy: sy(p[1]), r: 4.5 }, this.gHover);
        rows.push(`<div class="chart-tip-row s${i}"><span>${esc(s.label)}</span><b>${p[1].toFixed(d.decimals)} ${esc(d.unit)}</b></div>`);
      });
      const dt = new Date(best * 1000);
      const when = d.step >= 86400 ? fmtDay(dt) + ' ' + dt.getFullYear() : fmtDay(dt) + ', ' + fmtTime(dt);
      this.tip.innerHTML = `<div class="chart-tip-when">${when}</div>${rows.join('')}<div class="chart-tip-avg">średnia z ${esc(d.avgLabel || '')}</div>`;
      const tw = this.tip.offsetWidth;
      this.tip.style.left = Math.min(Math.max(x - tw / 2, 4), W - tw - 4) + 'px';
      this.tip.classList.add('show');
      this.gHover.classList.add('show');
    }

    renderLegend() {
      const s = this.data.series;
      this.legend.innerHTML = s.length > 1
        ? s.map((x, i) => `<span class="chart-key s${i}">${esc(x.label)}</span>`).join('')
        : '';
    }

    /* ---------- rysowanie jednej klatki ---------- */
    draw(view, o = {}) {
      const d = o.data || this.data;
      if (!d || !view) return;
      const { W, H, pw, ph } = this.dims();
      const { x0, x1, y0, y1 } = view;
      const sx = t => M.left + (t - x0) / (x1 - x0) * pw;
      const sy = v => M.top + (1 - (v - y0) / (y1 - y0)) * ph;
      const base = M.top + ph;

      this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      this.clipRect.setAttribute('x', M.left); this.clipRect.setAttribute('y', M.top - 4);
      this.clipRect.setAttribute('width', pw); this.clipRect.setAttribute('height', ph + 8);
      this.grid.style.left = M.left + 'px'; this.grid.style.top = M.top + 'px';
      this.grid.style.width = pw + 'px'; this.grid.style.height = ph + 'px';
      this.base.setAttribute('x1', M.left); this.base.setAttribute('x2', M.left + pw);
      this.base.setAttribute('y1', base); this.base.setAttribute('y2', base);

      const axisAlpha = o.grow !== undefined ? o.grow : (o.axisAlpha !== undefined ? o.axisAlpha : 1);

      // oś Y (wartości po prawej, jak w notowaniach)
      const yStep = niceStep(y1 - y0, Math.max(2, Math.floor(ph / 48)));
      let yh = '';
      const yDec = Math.max(0, -Math.floor(Math.log10(yStep) + 1e-9));
      for (let v = Math.ceil(y0 / yStep) * yStep; v <= y1 + 1e-9; v += yStep) {
        const y = sy(v);
        if (y < M.top - 1 || y > base + 1) continue;
        yh += `<line class="chart-tick" x1="${M.left}" x2="${M.left + pw}" y1="${y}" y2="${y}"/>`
          + `<text x="${M.left + pw + 8}" y="${y + 4}">${v.toFixed(yDec)}</text>`;
      }
      this.gTicks.innerHTML = yh;
      this.gTicks.style.opacity = axisAlpha;

      // oś X (czas)
      let xh = '';
      timeTicks(x0, x1, Math.max(2, Math.floor(pw / 86))).forEach(tk => {
        const x = sx(tk.t);
        if (x < M.left + 14 || x > M.left + pw - 14) return;
        xh += `<text x="${x}" y="${H - 7}" text-anchor="middle"${tk.major ? ' class="major"' : ''}>${esc(tk.label)}</text>`;
      });
      this.gX.innerHTML = xh;

      // granice stanów samopoczucia: delikatne poziome linie + nazwy stref
      let bh = '', bl = '';
      if (d.bands) {
        const edges = [...new Set(d.bands.flatMap(b => [b.from, b.to]))];
        edges.forEach(v => {
          const y = sy(v);
          if (y > M.top && y < base) bh += `<line x1="${M.left}" x2="${M.left + pw}" y1="${y}" y2="${y}"/>`;
        });
        d.bands.forEach(b => {
          const top = Math.max(sy(b.to), M.top), bottom = Math.min(sy(b.from), base);
          if (bottom - top < 16) return;
          bl += `<text x="${M.left + 8}" y="${(top + bottom) / 2 + 4}">${esc(b.label)}</text>`;
        });
      }
      this.gBands.innerHTML = bh;
      this.gBandLabels.innerHTML = bl;
      this.gBands.style.opacity = this.gBandLabels.style.opacity = axisAlpha;

      // linie danych
      while (this.paths.length < d.series.length) {
        const i = this.paths.length;
        this.paths.push({
          area: svg('path', { class: 'chart-area s' + i, fill: i === 0 ? `url(#${this.id}g)` : 'none' }, this.gPlot),
          line: svg('path', { class: 'chart-line s' + i }, this.gPlot)
        });
      }
      const drawn = [];
      this.paths.forEach((p, i) => {
        const s = d.series[i];
        if (!s) { p.line.setAttribute('d', ''); p.area.setAttribute('d', ''); return; }
        // podział na odcinki, gdy w historii jest dziura (np. ul był wyłączony)
        const segs = [];
        let cur = [];
        s.points.forEach((pt, k) => {
          if (k && pt[0] - s.points[k - 1][0] > d.gap) { segs.push(cur); cur = []; }
          let y = sy(pt[1]);
          const x = sx(pt[0]);
          if (o.grow !== undefined) y = base + (y - base) * o.grow;                 // wyrasta z osi X
          else if (o.morph) y = lerp(pxAt(o.morph[i], x, base), y, o.p);           // przelewa się z poprzedniego kształtu
          cur.push([x, y]);
        });
        if (cur.length) segs.push(cur);
        drawn.push(segs.flat());
        p.line.setAttribute('d', segs.map(linePath).join(''));
        p.area.setAttribute('d', i === 0
          ? segs.filter(sg => sg.length > 1).map(sg => linePath(sg) + `L${sg[sg.length - 1][0]},${base}L${sg[0][0]},${base}Z`).join('')
          : '');
      });
      this.lastPx = drawn;
      this.host.dataset.span = Math.round(x1 - x0);   // widoczny zakres w sekundach (pomaga przy testach)
    }
  }

  // wysokość (px) poprzednio narysowanej linii w punkcie x – do animacji "morph"
  function pxAt(pts, x, fallback) {
    if (!pts || !pts.length) return fallback;
    if (x <= pts[0][0]) return pts[0][1];
    if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid][0] <= x) lo = mid; else hi = mid; }
    const a = pts[lo], b = pts[hi];
    return b[0] === a[0] ? a[1] : lerp(a[1], b[1], (x - a[0]) / (b[0] - a[0]));
  }

  window.BeeChart = BeeChart;
})();
