/* =====================================================
   BEENest — demo.js: tryb demonstracyjny bez ula
   Wczytywany tylko w wersji demonstracyjnej (aplikacja na Androida: przycisk „Tryb Demo”, strona z plików aplikacji –
   android/make_demo.py). Podmienia fetch dla /api/... i odpowiada tak jak app.py, na losowych (płynnie zmiennych) danych.
   Ustawienia, wylotek i reguły zapamiętuje w localStorage. Reszta strony (app.js) działa bez zmian.
   ===================================================== */
(function () {
  "use strict";

  const STORE = 'beenest-demo';
  const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } })();
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch (e) { } };
  saved.settings = saved.settings || {};
  if (saved.outlet === undefined) saved.outlet = 100;
  saved.rules = saved.rules || [];

  // Ustawienia z poprzedniej wizyty w demo – zanim app.js je odczyta
  const device = window.BEENEST_DEVICE || (window.BEENEST_DEVICE = { settings: {}, known: true });
  Object.assign(device.settings, saved.settings);

  // Zakresy wykresów i strefy samopoczucia jak w app.py (CHART_RANGES, wellbeing_bands)
  const RANGES = { '12h': [43200, 900], '1d': [86400, 1800], '3d': [259200, 3600], '7d': [604800, 86400],
    '14d': [1209600, 86400], '30d': [2592000, 259200], '3m': [7776000, 604800], '6m': [15552000, 1209600] };
  const BANDS = [{ from: 80, to: 185, label: 'Dobre' }, { from: 185, to: 250, label: 'Niespokojne' },
    { from: 250, to: 300, label: 'Wściekłe' }];

  // Wartość czujnika w chwili ts: średnia + dobowa fala + wolne wahania + drobny szum (powtarzalny dla danego ts)
  const SENSORS = {
    temp_current: [34.6, 0.5, 0.3], temp_outside: [11.5, 5.5, 2.5],
    temp_humidity: [62, 3, 2], temp_outside_humidity: [76, 12, 5],
    temp_pressure: [1012.5, 1.5, 4], temp_outside_pressure: [1012.8, 1.5, 4],
    w_frequency: [150, 45, 30], w_sound: [44, 6, 4]
  };
  const noise = ts => { const x = Math.sin(ts * 12.9898) * 43758.5453; return x - Math.floor(x) - 0.5; };
  function value(key, ts) {
    const [mean, day, slow] = SENSORS[key];
    const hour = ((ts / 3600) % 24 + 24) % 24;
    const wave = key === 'temp_outside' || key === 'temp_outside_humidity'
      ? Math.sin((hour - 9) / 24 * 2 * Math.PI) * (key === 'temp_outside' ? 1 : -1)
      : Math.sin(hour / 24 * 2 * Math.PI);
    return mean + day * wave + slow * Math.sin(ts / 86400 / 2.3) + slow * 0.3 * noise(Math.floor(ts / 60) + key.length);
  }

  function wellbeing(freq, sound) {
    if (freq >= 250) return 'Wściekłe';
    if (freq >= 185 || sound > 70) return 'Niespokojne';
    return 'Dobre';
  }
  const outletStatus = p => p <= 5 ? 'Zablokowany' : p >= 95 ? 'Otwarty' : 'W ruchu';

  function data() {
    const now = Date.now() / 1000;
    const out = {};
    Object.keys(SENSORS).forEach(k => { out[k] = value(k, now); });
    // minimum i maksimum z ostatnich 24 godzin (co 30 minut)
    ['temp_current', 'temp_outside', 'temp_humidity', 'temp_outside_humidity', 'temp_pressure', 'temp_outside_pressure'].forEach(k => {
      let lo = Infinity, hi = -Infinity;
      for (let t = now - 86400; t <= now; t += 1800) { const v = value(k, t); lo = Math.min(lo, v); hi = Math.max(hi, v); }
      const name = k === 'temp_current' ? 'temp' : k;
      out[name + '_min'] = Math.min(lo, out[k]);
      out[name + '_max'] = Math.max(hi, out[k]);
    });
    // dokarmiaczka: pełna rano, potem stopniowo pustoszeje (100 / 80 / 40 / 15 %)
    const hour = new Date().getHours();
    out.f_level = hour < 6 ? 100 : hour < 12 ? 80 : hour < 19 ? 40 : 15;
    out.f_last = Math.floor(now / 86400) * 86400 - 3600 * 5;
    out.o_position = saved.outlet;
    out.o_status = outletStatus(saved.outlet);
    // akumulator i panel (battery_detector_driver.py): panel daje prąd tylko w dzień
    const sun = Math.max(0, Math.sin((hour - 6) / 12 * Math.PI));
    out.b_panel = Math.round(24 * sun);
    out.b_panel_percent = out.b_panel / 30 * 100;
    out.b_state = sun > 0 ? 3 : 0;
    out.b_error = 0;
    out.b_percent = 72;
    out.b_voltage = sun > 0 ? 13.4 : 12.56;
    out.b_current = 0.42 + Math.random() * 0.05;
    out.b_updated = Math.floor(now);
    out.w_status = wellbeing(out.w_frequency, out.w_sound);
    out.w_updated = Math.floor(now);
    out.m_status = 'Offline';
    out.m_signal = null;
    out.m_updated = null;
    out.sys_free_gb = 21.4;
    out.sys_total_gb = 32;
    return out;
  }

  function history(params) {
    const range = params.get('range') || '1d';
    const [span, step] = RANGES[range] || RANGES['1d'];
    const now = Math.floor(Date.now() / 1000);
    const keys = (params.get('keys') || '').split(',').filter(Boolean);
    const series = {};
    keys.forEach(k => {
      series[k] = [];
      for (let t = now - span + step / 2; t <= now; t += step) {
        const v = k === 'f_level' ? [100, 80, 40, 15][Math.floor(t / 21600) % 4] : value(k, t);
        series[k].push([Math.round(t), Math.round(v * 1000) / 1000]);
      }
    });
    const out = { range, from: now - span, to: now, step, save_interval: 300, series };
    if (keys.includes('w_frequency')) out.bands = BANDS;
    return out;
  }

  const SECURITY = { code: 0, decided: null, device: { name: 'Demo', remembered: true }, display: false, level: 'admin',
    lockout: 0, no_security: true, pin_length: 6, pin_set: true, request: null, via: 'no-security' };
  const NOT_IN_DEMO = 'W trybie demonstracyjnym ta opcja nie działa – nie ma połączenia z ulem.';

  function answer(method, path, params, body) {
    if (path === '/api/data') return [200, data()];
    if (path === '/api/history') return [200, history(params)];
    if (path === '/api/security/state') return [200, SECURITY];
    if (path === '/api/settings') {
      if (method === 'POST') { Object.assign(saved.settings, body || {}); save(); }
      return [200, Object.assign({}, device.settings, saved.settings)];
    }
    if (path === '/api/outlet' && method === 'POST') {
      saved.outlet = Math.max(0, Math.min(100, Number(body.position) || 0));
      save();
      return [200, { ok: true, position: saved.outlet }];
    }
    if (path === '/api/outlet/rules') {
      if (method === 'POST') { saved.rules = (body.rules || []).slice(0, 6); save(); }
      return [200, { max: 6, rules: saved.rules }];
    }
    if (path === '/api/devices') return [200, { devices: [] }];
    if (path === '/api/history/clear') return [200, { ok: true, deleted: 0 }];
    if (/^\/api\/(system|pairing|key|devices|security)\//.test(path) && method === 'POST') return [403, { error: NOT_IN_DEMO }];
    if (method === 'POST') return [200, { ok: true }];
    return [404, { error: NOT_IN_DEMO }];
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
    const method = (init.method || 'GET').toUpperCase();
    let body = null;
    try { body = init.body ? JSON.parse(init.body) : null; } catch (e) { }
    const [status, json] = answer(method, url.pathname, url.searchParams, body || {});
    await new Promise(r => setTimeout(r, 60));            // jak prawdziwa sieć: odpowiedź chwilę później
    return new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
  };

  // Znaczek „Tryb demonstracyjny” pod logo
  document.addEventListener('DOMContentLoaded', () => {
    document.body.classList.add('is-demo');
    const bar = document.querySelector('.topbar');
    if (!bar) return;
    const badge = document.createElement('span');
    badge.className = 'demo-badge';
    badge.textContent = 'Tryb demonstracyjny';
    bar.appendChild(badge);
  });
})();
