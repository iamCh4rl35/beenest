/* =====================================================
   BEENest — app.js
   ===================================================== */
(function () {
  "use strict";

  const $ = id => document.getElementById(id);

  // Ostatnie dane z serwera. Wyświetlanie (render) zawsze rysuje się z tego + z ustawień,
  // więc zmiana ustawienia działa od razu, bez czekania na kolejne odpytanie.
  const state = {};

  /* ===== 1. USTAWIENIA ===== */
  const defaultSettings = {
    theme: 'bialy-pylek',
    highContrast: false,
    atmoData: 'temperatura',
    tempHighlight: 'w-ulu',
    tempRange: 'obecna',
    humidityHighlight: 'w-ulu',
    humidityRange: 'obecna',
    pressureHighlight: 'w-ulu',
    pressureRange: 'obecna',
    wellbeingData: 'stan',
    feederData: 'poziom',
    saveInterval: '60',
    dataRetention: '12',
    feederRate: true,
    feederAlarm: true,
    camera: 'external'
  };

  // Wszystkie ustawienia są na Raspberry w data/global.conf: [zapis] wspólne dla wszystkich,
  // reszta (wygląd, karty, alarm, kamera) osobno dla każdego urządzenia (po adresie IP).
  // Serwer wkleja je do strony (window.BEENEST_DEVICE), więc są od razu, bez czekania.

  // id elementu w main.html -> nazwa ustawienia
  const SELECTS = {
    'theme-select': 'theme',
    'atmo-data-select': 'atmoData',
    'temp-highlight-select': 'tempHighlight',
    'temp-range-select': 'tempRange',
    'humidity-highlight-select': 'humidityHighlight',
    'humidity-range-select': 'humidityRange',
    'pressure-highlight-select': 'pressureHighlight',
    'pressure-range-select': 'pressureRange',
    'wellbeing-data-select': 'wellbeingData',
    'feeder-data-select': 'feederData',
    'save-interval-select': 'saveInterval',
    'data-retention-select': 'dataRetention'
  };
  const TOGGLES = {
    'contrast-toggle': 'highContrast',
    'feeder-rate-toggle': 'feederRate',
    'feeder-alarm-toggle': 'feederAlarm'
  };

  const device = window.BEENEST_DEVICE || { settings: {}, known: true };
  const settings = Object.assign({}, defaultSettings, device.settings);

  function applyTheme() {
    document.body.setAttribute('data-theme', settings.theme);
    document.body.setAttribute('data-contrast', settings.highContrast ? 'high' : 'normal');
  }

  function applySettingsToUI() {
    applyTheme();
    Object.keys(SELECTS).forEach(id => { if ($(id)) $(id).value = settings[SELECTS[id]]; });
    syncDropdowns();
    Object.keys(TOGGLES).forEach(id => { if ($(id)) $(id).checked = settings[TOGGLES[id]]; });
  }

  async function postJSON(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    let data = {};
    try { data = await res.json(); } catch (e) { }
    if (!res.ok) throw new Error(data.error || ('błąd HTTP ' + res.status));
    return data;
  }

  async function pushSettings(changes) {
    try { await postJSON('/api/settings', changes); }
    catch (e) { showPopup('Nie udało się zapisać ustawienia na urządzeniu: ' + e.message, 6000, false); }
  }

  // Jednorazowo: starsze wersje trzymały ustawienia w przeglądarce. Nowe urządzenie (bez sekcji
  // w global.conf) przenosi je na Raspberry; potem wpis w przeglądarce jest usuwany.
  function migrateBrowserSettings() {
    let old = null;
    try { old = JSON.parse(localStorage.getItem('beenest-settings')); } catch (e) { }
    try { localStorage.removeItem('beenest-settings'); } catch (e) { }
    if (device.known || !old || typeof old !== 'object') return;
    if (old._v !== 2) delete old.highContrast;   // wersja 1 zapisywała dawny domyślny kontrast – to nie był wybór
    const changes = {};
    const valid = (k, v) => {                     // tylko wartości, które strona zna (lista w <select> / tak-nie / kamera)
      const id = Object.keys(SELECTS).find(i => SELECTS[i] === k);
      if (id) return !!$(id) && [...$(id).options].some(o => o.value === v);
      if (k === 'camera') return v === 'external' || v === 'internal';
      return typeof v === 'boolean';
    };
    Object.keys(defaultSettings).forEach(k => {
      if (k in old && !['saveInterval', 'dataRetention', 'feederRate'].includes(k) && valid(k, old[k])) changes[k] = old[k];
    });
    if (!Object.keys(changes).length) return;
    postJSON('/api/settings', changes).then(s => {
      Object.keys(defaultSettings).forEach(k => { if (k in s) settings[k] = s[k]; });
      applySettingsToUI();
      applyCamera(settings.camera);
    }).catch(() => { });
  }

  function onSettingChange(key, value) {
    settings[key] = value;
    if (key === 'theme' || key === 'highContrast') applyTheme();
    pushSettings({ [key]: value });
    render();
  }

  Object.keys(SELECTS).forEach(id => {
    if ($(id)) $(id).addEventListener('change', e => onSettingChange(SELECTS[id], e.target.value));
  });
  Object.keys(TOGGLES).forEach(id => {
    if ($(id)) $(id).addEventListener('change', e => onSettingChange(TOGGLES[id], e.target.checked));
  });

  /* ===== 2. ZAKŁADKI USTAWIEŃ ===== */
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
      const target = $(tab.getAttribute('data-target'));
      if (target) target.classList.add('active');
    });
  });

  /* ===== 2a. DOCK (przełącznik kamer i kategorie ustawień): płynny wskaźnik aktywnej pozycji ===== */
  // Wygląd i czas animacji: style.css -> .dock-indicator oraz --anim-duration / --anim-ease na górze pliku.
  function initDock(dock) {
    const ind = document.createElement('span');
    ind.className = 'dock-indicator';
    dock.prepend(ind);

    function place(animate) {
      const active = dock.querySelector('.camera-dock-btn.active');
      if (!active || !active.offsetWidth) return;            // dock jest ukryty (inna podstrona)
      if (!animate) ind.classList.add('no-anim');
      ind.style.setProperty('--ind-x', active.offsetLeft + 'px');     // działa i poziomo, i w pionowym docku
      ind.style.setProperty('--ind-y', active.offsetTop + 'px');
      ind.style.setProperty('--ind-w', active.offsetWidth + 'px');
      ind.style.setProperty('--ind-h', active.offsetHeight + 'px');
      if (!animate) { void ind.offsetWidth; ind.classList.remove('no-anim'); }   // przeładuj układ, potem włącz animacje
    }
    // Zmiana klasy 'active' (kliknięcie) = animowany ruch; zmiana rozmiaru / pokazanie podstrony = skok bez animacji.
    new MutationObserver(muts => { if (muts.some(m => m.target !== ind)) place(true); })
      .observe(dock, { subtree: true, attributes: true, attributeFilter: ['class'] });
    if (window.ResizeObserver) new ResizeObserver(() => place(false)).observe(dock);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => place(false));
    place(false);

    // Strzałki (lewo/prawo w poziomym, góra/dół w pionowym) przełączają pozycje także z klawiatury.
    dock.addEventListener('keydown', e => {
      const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown', back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
      if (!fwd && !back) return;
      const btns = [...dock.querySelectorAll('.camera-dock-btn')];
      const next = btns[(btns.indexOf(document.activeElement) + (fwd ? 1 : -1) + btns.length) % btns.length];
      if (next) { next.focus(); next.click(); e.preventDefault(); }
    });
  }
  document.querySelectorAll('.camera-dock').forEach(initDock);

  /* ===== 2b. WŁASNE LISTY ROZWIJANE (zamiast <select> renderowanego przez przeglądarkę) ===== */
  // Prawdziwy <select> zostaje w stronie (ukryty) jako źródło wartości, więc reszta kodu działa bez zmian.
  const dropdowns = [];
  let openMenu = null;           // { menu, trigger }

  function syncDropdowns() {
    dropdowns.forEach(d => {
      const opt = d.select.options[d.select.selectedIndex];
      d.label.textContent = opt ? opt.textContent : '';
    });
  }

  function closeDropdown(refocus) {
    if (!openMenu) return;
    const { menu, trigger } = openMenu;
    openMenu = null;
    trigger.setAttribute('aria-expanded', 'false');
    menu.classList.remove('open');
    setTimeout(() => menu.remove(), 600);                // po zakończeniu animacji zamykania
    if (refocus) trigger.focus();
  }

  function openDropdown(d) {
    closeDropdown();
    const menu = document.createElement('div');
    menu.className = 'dd-menu';
    menu.setAttribute('role', 'listbox');
    [...d.select.options].forEach(o => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dd-option';
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', o.value === d.select.value ? 'true' : 'false');
      b.dataset.value = o.value;
      b.textContent = o.textContent;
      b.addEventListener('click', () => {
        if (d.select.value !== o.value) {
          d.select.value = o.value;
          d.select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        closeDropdown(true);
      });
      menu.appendChild(b);
    });
    document.body.appendChild(menu);

    // Pozycja: pod przyciskiem, wyrównana do jego prawej krawędzi; gdy brak miejsca – nad nim.
    const r = d.trigger.getBoundingClientRect();
    menu.style.minWidth = r.width + 'px';
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    const up = r.bottom + 8 + mh > window.innerHeight - 8 && r.top - 8 - mh > 8;
    menu.classList.toggle('up', up);
    menu.style.left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8)) + 'px';
    menu.style.top = (up ? r.top - 8 - mh : r.bottom + 8) + 'px';

    d.trigger.setAttribute('aria-expanded', 'true');
    openMenu = { menu, trigger: d.trigger };
    requestAnimationFrame(() => menu.classList.add('open'));
    const sel = menu.querySelector('[aria-selected="true"]') || menu.firstChild;
    if (sel) sel.focus({ preventScroll: true });
  }

  document.querySelectorAll('.setting-control select').forEach(select => {
    const wrap = document.createElement('div');
    wrap.className = 'dd';
    select.parentNode.insertBefore(wrap, select);
    wrap.appendChild(select);
    select.classList.add('dd-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'dd-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const rowLabel = select.closest('.setting-row') && select.closest('.setting-row').querySelector('.setting-label');
    if (rowLabel) trigger.setAttribute('aria-label', rowLabel.textContent.trim());
    trigger.innerHTML = '<span class="dd-label"></span><svg class="dd-chevron" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>';
    wrap.appendChild(trigger);

    const d = { select, trigger, label: trigger.querySelector('.dd-label') };
    dropdowns.push(d);
    trigger.addEventListener('click', () => (openMenu && openMenu.trigger === trigger) ? closeDropdown(true) : openDropdown(d));
    select.addEventListener('change', syncDropdowns);   // także gdy wartość zmieni ktoś inny niż lista
  });
  syncDropdowns();

  document.addEventListener('pointerdown', e => {
    if (openMenu && !openMenu.menu.contains(e.target) && !openMenu.trigger.contains(e.target)) closeDropdown();
  });
  document.addEventListener('keydown', e => {
    if (!openMenu) return;
    const items = [...openMenu.menu.querySelectorAll('.dd-option')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { closeDropdown(true); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { items[(i + 1) % items.length].focus(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { items[(i - 1 + items.length) % items.length].focus(); e.preventDefault(); }
    else if (e.key === 'Home') { items[0].focus(); e.preventDefault(); }
    else if (e.key === 'End') { items[items.length - 1].focus(); e.preventDefault(); }
    else if (e.key === 'Tab') closeDropdown();
  });
  window.addEventListener('resize', () => closeDropdown());
  window.addEventListener('hashchange', () => closeDropdown());
  document.addEventListener('scroll', e => { if (openMenu && !openMenu.menu.contains(e.target)) closeDropdown(); }, true);

  /* ===== 3. ZEGAR ===== */
  const months = ["stycznia","lutego","marca","kwietnia","maja","czerwca","lipca","sierpnia","września","października","listopada","grudnia"];
  function updateDateTime() {
    const now = new Date();
    const d = now.getDate(), m = months[now.getMonth()], y = now.getFullYear();
    const h = String(now.getHours()).padStart(2,'0');
    const mi = String(now.getMinutes()).padStart(2,'0');
    const s = String(now.getSeconds()).padStart(2,'0');
    $('datetime').textContent = `dziś jest ${d} ${m} ${y}, ${h}:${mi}:${s}`;
  }
  updateDateTime();
  setInterval(updateDateTime, 1000);

  /* ===== 4. POWITANIE ===== */
  function setGreeting() {
    const hour = new Date().getHours();
    let text;
    if (hour >= 5 && hour < 9) text = "Ale z ciebie ranna pszczółka! Dzień dobry!";
    else if (hour >= 9 && hour < 18) text = "Pracowitego dnia!";
    else if (hour >= 18 && hour < 23) text = "Dobry wieczór, jak leci?";
    else text = "Co to za nocna pszczoła?";
    $('greeting-text').textContent = text;
  }
  setGreeting();
  setInterval(setGreeting, 60000);

  /* ===== 5. ROUTING ===== */
  const pages = Array.from(document.querySelectorAll(".page"));
  function route() {
    const id = (location.hash || "#home").slice(1);
    const page = $(id) || $("home");
    pages.forEach(p => p.classList.toggle("active", p === page));
    window.scrollTo({ top: 0, behavior: "auto" });
    const main = document.querySelector("main");   // na desktopie przewija się <main>, nie okno
    if (main) main.scrollTop = 0;
  }
  window.addEventListener("hashchange", route);
  route();

  /* ===== 6. KAMERA (dock) ===== */
  const CAMERA_NAMES = { external: 'Zewnętrzna', internal: 'Wewnętrzna' };
  function applyCamera(cam, persist) {
    if (!CAMERA_NAMES[cam]) cam = 'external';
    if (cam !== settings.camera) {           // dane kamery należą do poprzedniej kamery
      state.m_signal = state.m_updated = state.m_status = null;
    }
    if (persist && cam !== settings.camera) pushSettings({ camera: cam });
    settings.camera = cam;
    document.querySelectorAll('.camera-dock-btn[data-camera]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.camera === cam);
    });
    render();
    syncStream();
    poll();
  }
  document.querySelectorAll('.camera-dock-btn[data-camera]').forEach(btn => {
    btn.addEventListener('click', () => applyCamera(btn.dataset.camera, true));
  });

  /* ===== 6b. PODGLĄD NA ŻYWO ===== */
  // Obraz (<img>) istnieje tylko wtedy, gdy ktoś ogląda podstronę Monitoring na widocznej karcie.
  // Po wyjściu <img> znika, przeglądarka zrywa połączenie, a serwer wyłącza kamerę.
  let streamCam = null, streamImg = null, streamTimer = null, streamLive = false, stalledPolls = 0;
  const WAITING_TEXT = 'Oczekiwanie na strumień wideo…';

  function stopStream() {
    clearTimeout(streamTimer);
    streamCam = null;
    streamLive = false;
    if (streamImg) {                       // samo usunięcie <img> z strony NIE przerywa pobierania – trzeba wyzerować src
      streamImg.onload = streamImg.onerror = null;
      streamImg.src = '';
      streamImg = null;
    }
    if ($('camera')) $('camera').textContent = WAITING_TEXT;
  }

  function startStream(cam) {
    const box = $('camera');
    stopStream();                          // domknij poprzedni strumień, zanim otworzysz nowy
    streamCam = cam;
    stalledPolls = 0;
    box.textContent = 'Łączę z kamerą…';
    const img = streamImg = new Image();
    img.alt = 'Podgląd z kamery: ' + CAMERA_NAMES[cam];
    img.onload = () => { streamLive = true; };
    img.onerror = () => {                                         // np. kamera niepodłączona
      if (streamCam !== cam) return;
      streamLive = false;
      box.textContent = 'Kamera niedostępna – próbuję ponownie…';
      streamTimer = setTimeout(() => { if (streamCam === cam) startStream(cam); }, 3000);
    };
    img.src = '/api/camera/' + encodeURIComponent(cam) + '/stream?t=' + Date.now();
    box.appendChild(img);
  }

  function syncStream() {
    const want = $('camera') && !document.hidden && location.hash === '#monitoring' ? settings.camera : null;
    if (want === streamCam) return;
    if (want) startStream(want); else stopStream();
  }
  window.addEventListener('hashchange', syncStream);
  document.addEventListener('visibilitychange', syncStream);

  // Zawieszony strumień (serwer przestał dostawać klatki): dwa odczyty "Offline" z rzędu = start od nowa.
  function watchStream(data) {
    if (!streamLive || streamCam !== settings.camera) { stalledPolls = 0; return; }
    stalledPolls = data.m_status === 'Offline' ? stalledPolls + 1 : 0;
    if (stalledPolls >= 2) startStream(streamCam);
  }

  /* ===== 6c. POWIĘKSZANIE PODGLĄDU KAMERY NA CAŁY EKRAN ===== */
  // Płynność i krzywa: --anim-duration / --anim-ease (style.css, :root). Mały podgląd rośnie do pełnego ekranu (technika FLIP),
  // dock jedzie z środka paska w lewy róg, w prawym rogu pojawia się przycisk zamknięcia. Zamknięcie: przycisk X, Esc.
  (function initCameraZoom() {
    const page = $('monitoring'), cam = $('camera'), dock = $('camera-dock'), closeBtn = $('cam-close');
    if (!page || !cam || !closeBtn) return;
    const slot = cam.parentElement;
    let isMax = false, timer = null;

    const animMs = () => {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--anim-duration').trim();
      return (/ms$/.test(v) ? parseFloat(v) : parseFloat(v) * 1000) || 400;
    };
    const setBox = (r) => Object.assign(cam.style, {
      top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px', right: 'auto', bottom: 'auto'
    });
    // FLIP: zmierz element, zmień układ, odwróć różnicę transformacją i pozwól jej płynnie zejść do zera
    function flip(el, mutate) {
      const a = el.getBoundingClientRect();
      mutate();
      const b = el.getBoundingClientRect();
      el.style.transition = 'none';
      el.style.transform = 'translate(' + (a.left - b.left) + 'px,' + (a.top - b.top) + 'px)';
      void el.offsetWidth;
      el.style.transition = '';
      el.style.transform = '';
    }
    function cleanup() {
      cam.classList.remove('is-max', 'closing');
      cam.removeAttribute('style');
    }
    function open() {
      if (isMax) return;
      isMax = true; clearTimeout(timer);
      setBox(cam.getBoundingClientRect());
      cam.classList.remove('closing');
      flip(dock, () => { cam.classList.add('is-max'); page.classList.add('cam-max'); });
      void cam.offsetWidth;
      Object.assign(cam.style, { top: '0px', left: '0px', width: '100%', height: '100%' });
      cam.setAttribute('aria-label', 'Podgląd powiększony');
      cam.tabIndex = -1;
      closeBtn.focus({ preventScroll: true });
    }
    function close() {
      if (!isMax) return;
      isMax = false;
      cam.classList.add('closing');
      setBox(slot.getBoundingClientRect());
      flip(dock, () => page.classList.remove('cam-max'));
      clearTimeout(timer);
      timer = setTimeout(cleanup, animMs() + 60);
      cam.setAttribute('aria-label', 'Powiększ podgląd na cały ekran');
      cam.tabIndex = 0;
      cam.focus({ preventScroll: true });
    }
    // Wyjście z Monitoringu: natychmiast, bez animacji
    function reset() {
      if (!isMax && !cam.classList.contains('is-max')) return;
      isMax = false; clearTimeout(timer);
      page.classList.remove('cam-max');
      cleanup();
      dock.style.transform = '';
    }
    cam.addEventListener('click', () => { if (!isMax) open(); });
    cam.addEventListener('keydown', e => {
      if (!isMax && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); }
    });
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && isMax && !document.getElementById('modal').classList.contains('open')) close();
    });
    window.addEventListener('hashchange', () => { if (location.hash !== '#monitoring') reset(); });
  })();

  /* ===== 6d. WYKRESY (zakładki Atmosfera i Samopoczucie) ===== */
  // Rysuje je static/chart.js (BeeChart). Zakresy i szerokość uśredniania: app.py -> CHART_RANGES.
  // Animacje: style.css -> --chart-grow-duration, --chart-zoom-duration, --chart-ease.
  const CHART_AVG = { '12h': '15 minut', '1d': '30 minut', '3d': 'godziny', '7d': 'dnia', '14d': 'dnia', '30d': '3 dni', '3m': 'tygodnia', '6m': '2 tygodni' };
  const CHART_SPAN = { '12h': '12 godzin', '1d': '24 godzin', '3d': '3 dni', '7d': '7 dni', '14d': '14 dni', '30d': '30 dni', '3m': '3 miesięcy', '6m': '6 miesięcy' };
  const chartMemory = (() => { try { return JSON.parse(localStorage.getItem('beenest-charts')) || {}; } catch (e) { return {}; } })();
  const rememberCharts = () => { try { localStorage.setItem('beenest-charts', JSON.stringify(chartMemory)); } catch (e) { /* tryb prywatny */ } };
  const historyCache = new Map();   // ta sama prośba w ciągu minuty nie idzie drugi raz do Raspberry

  // "co 1 minutę", "co 2 minuty", "co 60 minut"
  const minutesText = n => n === 1 ? '1 minutę'
    : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)) ? n + ' minuty' : n + ' minut';
  async function fetchHistory(keys, range, fresh) {
    const id = keys.join(',') + '|' + range, hit = historyCache.get(id);
    if (!fresh && hit && Date.now() - hit.at < 60000) return hit.data;
    const r = await fetch('/api/history?keys=' + encodeURIComponent(keys.join(',')) + '&range=' + range, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    historyCache.set(id, { at: Date.now(), data });
    return data;
  }

  // cfg: { id, page, host, rangeDock, paramDock?, params: { nazwa: { keys, labels, unit, decimals } }, onParam? }
  function initChartPanel(cfg) {
    if (!window.BeeChart || !cfg.host) return null;
    const mem = chartMemory[cfg.id] || (chartMemory[cfg.id] = {});
    let range = CHART_AVG[mem.range] ? mem.range : '1d';
    let param = cfg.params[mem.param] ? mem.param : Object.keys(cfg.params)[0];
    const chart = new BeeChart(cfg.host);
    let seq = 0;

    const mark = (dock, attr, value) => dock && dock.querySelectorAll('.camera-dock-btn').forEach(b => {
      const on = b.dataset[attr] === value;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    async function load(mode, fresh) {
      const my = ++seq, p = cfg.params[param];
      try {
        const d = await fetchHistory(p.keys, range, fresh);
        if (my !== seq) return;                     // w międzyczasie kliknięto coś innego
        chart.show({
          from: d.from, to: d.to, step: d.step,
          gap: Math.max(4 * d.step, 2.5 * d.save_interval),   // przerwa w linii = brak zapisów dłużej niż tyle
          unit: p.unit, decimals: p.decimals, bands: d.bands || null, avgLabel: CHART_AVG[range],
          series: p.keys.map((k, i) => ({ label: p.labels[i], points: d.series[k] || [] })),
          emptyText: 'Brak zapisanych pomiarów z ostatnich ' + CHART_SPAN[range] + '. Pomiary zapisują się co '
            + minutesText(Math.round(d.save_interval / 60)) + ' (Ustawienia → Działanie).'
        }, mode);
      } catch (e) {
        if (my === seq) chart.error('Nie udało się pobrać danych wykresu.');
      }
    }

    function setRange(r) {
      if (r === range || !CHART_AVG[r]) return;
      range = mem.range = r; rememberCharts();
      mark(cfg.rangeDock, 'range', range);
      load('domain');
    }
    function setParam(name) {
      if (name === param || !cfg.params[name]) return;
      param = mem.param = name; rememberCharts();
      mark(cfg.paramDock, 'param', param);
      if (cfg.onParam) cfg.onParam(param);
      load('morph');
    }

    cfg.rangeDock.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => setRange(b.dataset.range)));
    if (cfg.paramDock) cfg.paramDock.querySelectorAll('[data-param]').forEach(b => b.addEventListener('click', () => setParam(b.dataset.param)));
    mark(cfg.rangeDock, 'range', range);
    mark(cfg.paramDock, 'param', param);
    if (cfg.onParam) cfg.onParam(param);

    // Wejście na zakładkę = linia wyrasta z osi X; potem co minutę ciche odświeżenie.
    const onPage = () => location.hash === '#' + cfg.page;
    const enter = () => { if (onPage()) load('grow', true); };
    window.addEventListener('hashchange', enter);
    enter();
    setInterval(() => { if (onPage() && !document.hidden && !chart.busy()) load('quiet', true); }, 60000);
    return { chart, setParam, setRange };
  }

  const atmoChart = initChartPanel({
    id: 'atmo', page: 'temperatura', host: $('atmo-chart'),
    rangeDock: $('atmo-range-dock'), paramDock: $('atmo-param-dock'),
    params: {
      temperatura: { keys: ['temp_current', 'temp_outside'], labels: ['W ulu', 'Na zewnątrz'], unit: '°C', decimals: 1 },
      wilgoc:      { keys: ['temp_humidity', 'temp_outside_humidity'], labels: ['W ulu', 'Na zewnątrz'], unit: '%', decimals: 0 },
      cisnienie:   { keys: ['temp_pressure', 'temp_outside_pressure'], labels: ['W ulu', 'Na zewnątrz'], unit: 'hPa', decimals: 1 }
    },
    // grupa odczytów nad wykresem podświetla się razem z wybranym parametrem
    onParam: name => document.querySelectorAll('.atmo-group').forEach(g => g.classList.toggle('is-selected', g.dataset.param === name))
  });
  document.querySelectorAll('.atmo-group').forEach(g => {
    const pick = () => { if (atmoChart) atmoChart.setParam(g.dataset.param); };
    g.addEventListener('click', pick);
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  });

  initChartPanel({
    id: 'wellbeing', page: 'samopoczucie', host: $('wellbeing-chart'),
    rangeDock: $('wellbeing-range-dock'),
    params: { czestotliwosc: { keys: ['w_frequency'], labels: ['Częstotliwość'], unit: 'Hz', decimals: 0 } }
  });

  /* ===== 7. KOMUNIKAT (popup) I DŹWIĘK ===== */
  let popupTimer = null, beepTimer = null, audioCtx = null;

  // Przeglądarki odblokowują dźwięk dopiero po pierwszym dotknięciu strony.
  function unlockAudio() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { }
  }
  document.addEventListener('pointerdown', unlockAudio, { once: true });
  document.addEventListener('keydown', unlockAudio, { once: true });

  function beep() {
    try {
      unlockAudio();
      const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.15;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.25);
    } catch (e) { }
  }

  function closePopup() {
    clearTimeout(popupTimer);
    clearInterval(beepTimer);
    if ($('popup')) $('popup').hidden = true;
  }

  function showPopup(text, ms, withSound) {
    if (!$('popup')) return;
    closePopup();
    $('popup-text').textContent = text;
    $('popup').hidden = false;
    popupTimer = setTimeout(closePopup, ms);
    if (withSound) { beep(); beepTimer = setInterval(beep, 2000); }
  }
  if ($('popup-close')) $('popup-close').addEventListener('click', closePopup);

  /* ===== 7b. OKNA DIALOGOWE (zamiast confirm() przeglądarki) ===== */
  // askModal({icon, title, text, option:{label,hint,checked}, buttons:[{label,value,kind}], danger}) -> Promise<{value, checked}>
  // Okno zostaje otwarte po odpowiedzi: wołający pokazuje kolejny stan (modalBusy / noticeDialog) albo woła modalClose().
  const MODAL_ICONS = {
    update: '<path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>',
    power: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>',
    alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>'
  };
  const modal = { resolve: null, busy: false, lastFocus: null };
  const pageParts = () => document.querySelectorAll('header.topbar, .divider, main');

  // Tekst okna: *słowo* = kursywa, \n = nowa linijka. Bez innerHTML – tekst z serwera nie wstrzyknie znaczników.
  function setModalText(el, text) {
    el.textContent = '';
    text.split(/(\*[^*]+\*)/).forEach(part => {
      if (/^\*[^*]+\*$/.test(part)) {
        const em = document.createElement('em');
        em.textContent = part.slice(1, -1);
        el.appendChild(em);
      } else if (part) el.appendChild(document.createTextNode(part));
    });
  }

  function modalRender(o) {
    modal.busy = !!o.busy;
    $('modal-icon').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' + (MODAL_ICONS[o.icon] || MODAL_ICONS.alert) + '</svg>';
    $('modal-title').textContent = o.title || '';
    setModalText($('modal-text'), o.text || '');
    $('modal-text').hidden = !o.text;
    $('modal-option').hidden = !o.option;
    if (o.option) {
      $('modal-option-label').textContent = o.option.label;
      $('modal-option-hint').textContent = o.option.hint || '';
      $('modal-option-check').checked = !!o.option.checked;
    }
    $('modal-spinner').hidden = !o.busy;
    $('modal-card').classList.toggle('is-danger', !!o.danger);
    const box = $('modal-actions');
    box.textContent = '';
    (o.buttons || []).forEach(b => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'modal-btn ' + (b.kind || 'ghost');
      btn.textContent = b.label;
      btn.dataset.value = b.value;
      btn.addEventListener('click', () => modalAnswer(b.value));
      box.appendChild(btn);
    });
    box.hidden = !(o.buttons && o.buttons.length);
    if (!$('modal').classList.contains('open')) {
      modal.lastFocus = document.activeElement;
      pageParts().forEach(el => { el.inert = true; });      // fokus i czytniki ekranu zostają w oknie
      $('modal').classList.add('open');
    }
    const first = box.querySelector('.modal-btn.primary, .modal-btn.danger') || box.querySelector('.modal-btn');
    if (first) first.focus({ preventScroll: true });
  }

  function modalAnswer(value) {
    const r = modal.resolve;
    modal.resolve = null;
    if (r) r({ value, checked: $('modal-option-check').checked });
  }

  function modalClose() {
    modal.resolve = null;
    modal.busy = false;
    $('modal').classList.remove('open');
    pageParts().forEach(el => { el.inert = false; });
    if (modal.lastFocus && modal.lastFocus.focus) modal.lastFocus.focus({ preventScroll: true });
  }

  function askModal(o) {
    return new Promise(resolve => { modal.resolve = resolve; modalRender(o); });
  }

  // Pytanie z przyciskami Anuluj / OK. Anulowanie zamyka okno i zwraca null; potwierdzenie zostawia je otwarte.
  async function confirmDialog(o) {
    const r = await askModal(o);
    if (r.value !== 'ok') { modalClose(); return null; }
    return r;
  }
  async function noticeDialog(o) {
    await askModal({ ...o, buttons: [{ label: 'OK', value: 'ok', kind: o.danger ? 'danger' : 'primary' }] });
    modalClose();
  }
  const modalBusy = (icon, title, text) => modalRender({ icon, title, text, busy: true, buttons: [] });

  $('modal-backdrop').addEventListener('click', () => { if (modal.resolve) modalAnswer('cancel'); });
  document.addEventListener('keydown', e => {
    if (!$('modal').classList.contains('open')) return;
    if (e.key === 'Escape') { if (modal.resolve) modalAnswer('cancel'); e.preventDefault(); }
    else if (e.key === 'Tab') {                              // fokus krąży tylko po przyciskach okna
      const f = [...$('modal-card').querySelectorAll('button, input')].filter(x => x.offsetParent !== null || x.type === 'checkbox');
      if (!f.length) { e.preventDefault(); return; }
      const i = f.indexOf(document.activeElement);
      const next = f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length];
      next.focus(); e.preventDefault();
    }
  });

  /* ===== 8. ALARM NAPEŁNIENIA DOKARMIACZKI ===== */
  // Serwer sam wykrywa napełnienie i podaje jego czas (f_last). Alarm dzwoni, gdy ten czas
  // się zmieni w trakcie otwartej strony. undefined = pierwsze odpytanie, wtedy bez alarmu.
  let lastRefill;
  function checkRefill(obj) {
    if (!('f_last' in obj)) return;
    const t = obj.f_last;
    if (lastRefill !== undefined && t !== null && t !== lastRefill && settings.feederAlarm) {
      showPopup('Dokarmiaczka została napełniona.', 15000, true);
    }
    lastRefill = t;
  }

  /* ===== 9. FORMATOWANIE I WYŚWIETLANIE ===== */
  // Serwer wysyła suche liczby; tu dodajemy miejsca po przecinku i jednostki.
  const DECIMALS = {
    temp_current: 1, temp_outside: 1, temp_min: 1, temp_max: 1,
    temp_outside_min: 1, temp_outside_max: 1,
    temp_humidity: 0, temp_humidity_min: 0, temp_humidity_max: 0,
    temp_outside_humidity: 0, temp_outside_humidity_min: 0, temp_outside_humidity_max: 0,
    temp_pressure: 0, temp_pressure_min: 0, temp_pressure_max: 0,
    temp_outside_pressure: 0, temp_outside_pressure_min: 0, temp_outside_pressure_max: 0,
    w_frequency: 0, w_sound: 0,
    f_level: 0, f_weight: 1,
    o_position: 0,
    m_signal: 0
  };

  const isNum = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  const toDate = v => (isNum(v) ? new Date(Number(v) * 1000) : null);   // czas z serwera: sekundy od 1970

  function format(key, v) {
    if (v === null || v === undefined || v === '') return '--';
    if (key === 'w_updated') { const d = toDate(v); return d ? d.toLocaleTimeString('pl-PL') : String(v); }
    if (key === 'f_last') {
      const d = toDate(v);
      return d ? d.toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }) : String(v);
    }
    if (key === 'm_updated') return isNum(v) ? Math.round(Number(v)) + ' s temu' : String(v);
    if (key in DECIMALS) {
      if (!isNum(v)) return '--';
      const s = Number(v).toFixed(DECIMALS[key]);
      return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;      // bez "-0.0 °C" przy zerze
    }
    return String(v);
  }

  const withUnit = (key, unit) => { const t = format(key, state[key]); return t === '--' ? t : t + ' ' + unit; };

  const ATMO_ICONS = {
    temperatura: '<path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>',
    wilgoc: '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
    cisnienie: '<circle cx="12" cy="12" r="9"/><path d="M12 12l3.5-3.5"/><path d="M12 3v2M3 12h2M21 12h-2"/>'
  };
  // Każdy parametr atmosfery: jednostka, nazwy ustawień (wyróżniona wartość, zakres) i klucze z serwera.
  // Dla każdego jest to samo: dwie wartości (w ulu / na zewnątrz), jedna wyróżniona, zakres dotyczy obu.
  const ATMO = {
    temperatura: {
      name: 'Temperatura', unit: '°C', hl: 'tempHighlight', rg: 'tempRange',
      keys: {
        in:  { 'obecna': 'temp_current', 'min-24h': 'temp_min',         'max-24h': 'temp_max' },
        out: { 'obecna': 'temp_outside', 'min-24h': 'temp_outside_min', 'max-24h': 'temp_outside_max' }
      }
    },
    wilgoc: {
      name: 'Wilgotność', unit: '%', hl: 'humidityHighlight', rg: 'humidityRange',
      keys: {
        in:  { 'obecna': 'temp_humidity',         'min-24h': 'temp_humidity_min',         'max-24h': 'temp_humidity_max' },
        out: { 'obecna': 'temp_outside_humidity', 'min-24h': 'temp_outside_humidity_min', 'max-24h': 'temp_outside_humidity_max' }
      }
    },
    cisnienie: {
      name: 'Ciśnienie', unit: 'hPa', hl: 'pressureHighlight', rg: 'pressureRange',
      keys: {
        in:  { 'obecna': 'temp_pressure',         'min-24h': 'temp_pressure_min',         'max-24h': 'temp_pressure_max' },
        out: { 'obecna': 'temp_outside_pressure', 'min-24h': 'temp_outside_pressure_min', 'max-24h': 'temp_outside_pressure_max' }
      }
    }
  };
  const RANGE_LABEL = { 'obecna': '', 'min-24h': ' · minimum z 24 godzin', 'max-24h': ' · maksimum z 24 godzin' };
  const LOC_LABEL = { in: 'Wewnętrzna', out: 'Zewnętrzna' };

  // Które wartości (w ulu / na zewnątrz) i jaki zakres wybrano dla danego parametru
  function atmoChoice(mode) {
    const a = ATMO[mode];
    return {
      main: settings[a.hl] === 'na-zewnatrz' ? 'out' : 'in',
      range: a.keys.in[settings[a.rg]] ? settings[a.rg] : 'obecna'
    };
  }

  // Duży panel atmosfery w Menu Głównym: ustawienia "Dane panelu atmosfery" oraz, dla wybranego parametru,
  // "Wyróżniona …" i "Zakres wyróżnionej …".
  function renderAtmo() {
    const mode = ATMO[settings.atmoData] ? settings.atmoData : 'temperatura';
    const a = ATMO[mode];
    // W ustawieniach widać tylko wiersze wybranego parametru.
    document.querySelectorAll('[data-atmo-mode]').forEach(el => { el.hidden = el.dataset.atmoMode !== mode; });
    if ($('dash-atmo-icon')) $('dash-atmo-icon').innerHTML = ATMO_ICONS[mode];
    if (!$('dash-sec-in') || !$('dash-sec-out')) return;

    const { main, range } = atmoChoice(mode);
    $('dash-atmo').classList.toggle('is-long', mode === 'cisnienie');   // 4 cyfry + hPa: mniejsza czcionka
    ['out', 'in'].forEach(loc => {
      const key = a.keys[loc][range];   // zakres (obecna / min / maks 24 h) dotyczy obu wartości
      $('dash-temp-' + loc).textContent = format(key, state[key]);
      $('dash-unit-' + loc).textContent = a.unit;
      // Parametr rozpoznajemy po ikonie karty i jednostce (°C / % / hPa), więc etykieta jest krótka.
      $('dash-label-' + loc).textContent = LOC_LABEL[loc] + RANGE_LABEL[range];
      $('dash-sec-' + loc).classList.toggle('is-minor', loc !== main);
    });
  }

  // Strona Atmosfera: wyróżniamy kafelek wybrany w ustawieniach dla każdego parametru.
  function renderAtmoPage() {
    Object.keys(ATMO).forEach(mode => {
      const main = atmoChoice(mode).main;
      ['in', 'out'].forEach(loc => {
        const el = $('atmo-cell-' + mode + '-' + loc);
        if (el) el.classList.toggle('primary', loc === main);
      });
    });
  }

  // Kafelek "Stan wylotka": status z serwera + pozycja serwa.
  function renderOutlet() {
    if ($('dash-outlet-compact')) {
      $('dash-outlet-compact').textContent = state.o_status || '--';
      $('dash-outlet-compact').classList.toggle('highlight', !!state.o_status && state.o_status !== 'Otwarty');
    }
    if ($('dash-outlet-caption')) {
      $('dash-outlet-caption').textContent = isNum(state.o_position)
        ? 'Otwarcie ' + format('o_position', state.o_position) + ' %'
        : 'Serwomechanizm';
    }
  }

  // Kafelek "Samopoczucie": ustawienie "Dane panelu samopoczucia".
  function renderWellbeing() {
    let text, caption;
    if (settings.wellbeingData === 'natezenie')           { caption = 'Natężenie dźwięku'; text = withUnit('w_sound', 'dB'); }
    else if (settings.wellbeingData === 'czestotliwosci') { caption = 'Częstotliwość';     text = withUnit('w_frequency', 'Hz'); }
    else                                                  { caption = 'Stan rodziny';      text = format('w_status', state.w_status); }
    if ($('dash-wellbeing-compact')) $('dash-wellbeing-compact').textContent = text;
    if ($('dash-wellbeing-caption')) $('dash-wellbeing-caption').textContent = caption;
  }

  // Kafelek "Stan dokarmiaczki": ustawienie "Stan dokarmiaczki (duży panel)".
  function renderFeeder() {
    let text, caption;
    if (settings.feederData === 'ostatnie') {
      const d = toDate(state.f_last);
      caption = 'Ostatnie napełnienie';
      text = d ? d.toLocaleDateString('pl-PL', { dateStyle: 'medium' }) : '--';
    } else {
      caption = 'Poziom zbiornika';
      text = withUnit('f_level', '%');
    }
    if ($('dash-feeder-compact')) $('dash-feeder-compact').textContent = text;
    if ($('dash-feeder-caption')) $('dash-feeder-caption').textContent = caption;
  }

  function render() {
    // Każdy klucz z serwera trafia do elementu o tym samym id, tylko z myślnikami
    // (temp_current -> #temp-current).
    Object.keys(state).forEach(k => {
      if (k === 'm_status') return;          // składane niżej razem z nazwą kamery
      const el = $(k.replace(/_/g, '-'));
      if (el) el.textContent = format(k, state[k]);
    });

    window.BEENest.setBar('feeder-bar', state.f_level);
    window.BEENest.setBar('outlet-bar', state.o_position, 'o-position-label');

    if ($('m-status')) {
      $('m-status').textContent = CAMERA_NAMES[settings.camera] + (state.m_status ? ' · ' + state.m_status : '');
    }

    if (isNum(state.sys_total_gb) && isNum(state.sys_free_gb) && $('memory-text')) {
      const total = Number(state.sys_total_gb), free = Number(state.sys_free_gb);
      $('memory-text').textContent = free.toFixed(1) + ' GB wolne / ' + total.toFixed(0) + ' GB';
      $('memory-bar-fill').style.width = Math.round((total - free) / total * 100) + '%';   // pasek = zajęte
    }

    renderAtmo();
    renderAtmoPage();
    renderWellbeing();
    renderFeeder();
    renderOutlet();
  }

  /* ===== 10. API dla Pythona / testów ===== */
  window.BEENest = {
    set(id, value) {
      const el = $(id);
      if (el) el.textContent = value;
    },
    setBar(id, percent, labelId = "f-level-label") {
      const el = $(id);
      if (!el) return;
      const known = isNum(percent);
      el.style.width = (known ? Math.max(0, Math.min(100, Number(percent))) : 0) + "%";
      this.set(labelId, known ? Math.round(Number(percent)) : '--');
    },
    data(obj) {
      if (!obj || typeof obj !== "object") return;
      Object.assign(state, obj);
      checkRefill(obj);
      render();
    }
  };

  /* ===== 11. POLLING ===== */
  let busy = false;
  async function poll() {
    if (busy) return;
    busy = true;
    const cam = settings.camera;
    try {
      const res = await fetch("/api/data?camera=" + encodeURIComponent(cam), { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (cam === settings.camera) { window.BEENest.data(data); watchStream(data); }   // kamerę zmieniono w trakcie – zignoruj
      }
    } catch (e) { } finally {
      busy = false;
      if (cam !== settings.camera) poll();
    }
  }
  setInterval(poll, 5000);

  /* ===== 12. PRZYCISKI W USTAWIENIACH (zasilanie, aktualizacja) ===== */
  function bindAction(id, handler) {
    const btn = $(id);
    if (!btn) return;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await handler(); }
      catch (e) { showPopup('Nie udało się: ' + e.message, 8000, false); }
      finally { btn.disabled = false; }
    });
  }

  bindAction('btn-reboot', async () => {
    const ok = await confirmDialog({
      icon: 'power', title: 'Uruchomić ponownie?',
      text: 'Ul na około minutę przestanie odpowiadać. Strona wróci sama.',
      buttons: [{ label: 'Anuluj', value: 'cancel' }, { label: 'Uruchom ponownie', value: 'ok', kind: 'primary' }]
    });
    if (!ok) return;
    modalClose();
    await postJSON('/api/system/reboot');
    showPopup('Restartuję… Strona wróci za około minutę.', 60000, false);
  });

  bindAction('btn-shutdown', async () => {
    const ok = await confirmDialog({
      icon: 'power', danger: true, title: 'Wyłączyć urządzenie?',
      text: 'Żeby je znów włączyć, trzeba odłączyć i podłączyć zasilanie.',
      buttons: [{ label: 'Anuluj', value: 'cancel' }, { label: 'Wyłącz', value: 'ok', kind: 'danger' }]
    });
    if (!ok) return;
    modalClose();
    await postJSON('/api/system/shutdown');
    showPopup('Wyłączam urządzenie…', 60000, false);
  });

  // Wymazanie historii atmosfery i samopoczucia (wykresy, minimum i maksimum z 24 godzin).
  bindAction('btn-clear-history', async () => {
    const ok = await confirmDialog({
      icon: 'trash', danger: true, title: 'UWAGA!',
      text: 'Ta operacja bezpowrotnie wymaże *WSZYSTKIE* zapisane dane atmosfery i samopoczucia.\nNa pewno chcesz to zrobić?',
      buttons: [{ label: 'Rozmyśliłem się', value: 'cancel' }, { label: 'Tak, wiem co robię', value: 'ok', kind: 'danger' }]
    });
    if (!ok) return;
    modalBusy('trash', 'Usuwam dane…', 'To może potrwać chwilę.');
    try { await postJSON('/api/history/clear'); }
    catch (e) {
      await noticeDialog({ icon: 'alert', danger: true, title: 'Nie udało się usunąć danych', text: e.message });
      return;
    }
    historyCache.clear();                                   // wykresy pobiorą pustą historię od nowa
    poll();                                                 // minimum i maksimum z 24 godzin też od nowa
    await noticeDialog({ icon: 'check', title: 'Dane usunięte', text: 'Zapisane dane atmosfery i samopoczucia zostały wymazane.' });
  });

  // Aktualizacja NIE restartuje ula sama: restart tylko po zaznaczeniu opcji w oknie.
  bindAction('btn-update', async () => {
    const r = await confirmDialog({
      icon: 'update', title: 'Sprawdzić aktualizacje?',
      text: 'Pobiorę nowe wersje z repozytorium, jeśli są dostępne.',
      option: { label: 'Uruchom ponownie po sprawdzeniu', hint: 'Restart nastąpi tylko wtedy, gdy zostaną pobrane zmiany.', checked: false },
      buttons: [{ label: 'Anuluj', value: 'cancel' }, { label: 'Sprawdź i zaktualizuj', value: 'ok', kind: 'primary' }]
    });
    if (!r) return;
    modalBusy('update', 'Sprawdzam aktualizacje…', 'To może potrwać chwilę.');
    let res;
    try { res = await postJSON('/api/system/update', { reboot: r.checked }); }
    catch (e) {
      await noticeDialog({ icon: 'alert', danger: true, title: 'Aktualizacja nie powiodła się', text: e.message });
      return;
    }
    if (!res.updated) await noticeDialog({ icon: 'check', title: 'Masz najnowszą wersję', text: 'Nie ma nic do pobrania.' });
    else if (res.rebooting) await noticeDialog({ icon: 'power', title: 'Zaktualizowano', text: 'Urządzenie uruchamia się ponownie. Strona wróci za około minutę.' });
    else await noticeDialog({ icon: 'check', title: 'Zaktualizowano', text: 'Nowa wersja jest pobrana. Pliki .py i main.html zadziałają po ponownym uruchomieniu aplikacji lub urządzenia, a style i skrypty strony po jej odświeżeniu.' });
  });

  /* ===== 13. INIT ===== */
  applySettingsToUI();
  applyCamera(settings.camera);     // rysuje stronę i od razu odpytuje serwer
  migrateBrowserSettings();
})();
