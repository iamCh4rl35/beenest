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
    wellbeingData: 'stan',
    feederData: 'poziom',
    saveInterval: '60',
    dataRetention: '12',
    feederRate: true,
    feederAlarm: true,
    camera: 'external'
  };

  // Te trzy dotyczą zapisu danych na Raspberry, więc są trzymane na serwerze (wspólne dla
  // wszystkich telefonów). Reszta (wygląd, alarm, kamera) jest osobno w każdej przeglądarce.
  const SERVER_KEYS = ['saveInterval', 'dataRetention', 'feederRate'];

  // id elementu w main.html -> nazwa ustawienia
  const SELECTS = {
    'theme-select': 'theme',
    'atmo-data-select': 'atmoData',
    'temp-highlight-select': 'tempHighlight',
    'temp-range-select': 'tempRange',
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

  const SETTINGS_VERSION = 2;

  function readStored() {
    try {
      const v = JSON.parse(localStorage.getItem('beenest-settings'));
      if (!v || typeof v !== 'object') return {};
      // Wersja 1 zapisywała też wartości domyślne, a domyślny kontrast zmienił się na wyłączony.
      // Stary zapis "highContrast" nie jest więc świadomym wyborem – pomijamy go (raz).
      if (v._v !== SETTINGS_VERSION) delete v.highContrast;
      delete v._v;
      return v;
    } catch (e) { return {}; }   // pusty / uszkodzony wpis albo zablokowany localStorage
  }
  const settings = Object.assign({}, defaultSettings, readStored());

  // Zapisujemy tylko to, co różni się od domyślnych – dzięki temu zmiana wartości domyślnych
  // w nowej wersji strony dociera do urządzeń, które niczego świadomie nie zmieniały.
  function saveSettings() {
    const changed = { _v: SETTINGS_VERSION };
    Object.keys(settings).forEach(k => { if (settings[k] !== defaultSettings[k]) changed[k] = settings[k]; });
    try { localStorage.setItem('beenest-settings', JSON.stringify(changed)); } catch (e) { }
  }

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

  async function pullServerSettings() {
    try {
      const res = await fetch('/api/settings', { cache: 'no-store' });
      if (!res.ok) return;
      const s = await res.json();
      SERVER_KEYS.forEach(k => { if (k in s) settings[k] = s[k]; });
      saveSettings();
      applySettingsToUI();
    } catch (e) { }
  }

  async function pushServerSetting(key, value) {
    try { await postJSON('/api/settings', { [key]: value }); }
    catch (e) { showPopup('Nie udało się zapisać ustawienia na urządzeniu: ' + e.message, 6000, false); }
  }

  function onSettingChange(key, value) {
    settings[key] = value;
    saveSettings();
    if (key === 'theme' || key === 'highContrast') applyTheme();
    if (SERVER_KEYS.includes(key)) pushServerSetting(key, value);
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
      ind.style.setProperty('--ind-x', active.offsetLeft + 'px');
      ind.style.setProperty('--ind-w', active.offsetWidth + 'px');
      if (!animate) { void ind.offsetWidth; ind.classList.remove('no-anim'); }   // przeładuj układ, potem włącz animacje
    }
    // Zmiana klasy 'active' (kliknięcie) = animowany ruch; zmiana rozmiaru / pokazanie podstrony = skok bez animacji.
    new MutationObserver(muts => { if (muts.some(m => m.target !== ind)) place(true); })
      .observe(dock, { subtree: true, attributes: true, attributeFilter: ['class'] });
    if (window.ResizeObserver) new ResizeObserver(() => place(false)).observe(dock);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => place(false));
    place(false);

    // Strzałki lewo/prawo przełączają pozycje także z klawiatury.
    dock.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const btns = [...dock.querySelectorAll('.camera-dock-btn')];
      const next = btns[(btns.indexOf(document.activeElement) + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length];
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
  function applyCamera(cam) {
    if (!CAMERA_NAMES[cam]) cam = 'external';
    if (cam !== settings.camera) {           // dane kamery należą do poprzedniej kamery
      state.m_signal = state.m_updated = state.m_status = null;
    }
    settings.camera = cam;
    saveSettings();
    document.querySelectorAll('.camera-dock-btn[data-camera]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.camera === cam);
    });
    render();
    syncStream();
    poll();
  }
  document.querySelectorAll('.camera-dock-btn[data-camera]').forEach(btn => {
    btn.addEventListener('click', () => applyCamera(btn.dataset.camera));
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
    check: '<path d="M20 6L9 17l-5-5"/>'
  };
  const modal = { resolve: null, busy: false, lastFocus: null };
  const pageParts = () => document.querySelectorAll('header.topbar, .divider, main');

  function modalRender(o) {
    modal.busy = !!o.busy;
    $('modal-icon').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' + (MODAL_ICONS[o.icon] || MODAL_ICONS.alert) + '</svg>';
    $('modal-title').textContent = o.title || '';
    $('modal-text').textContent = o.text || '';
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
    temp_humidity: 0, temp_pressure: 0,
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
  const TEMP_KEYS = {
    in:  { 'obecna': 'temp_current', 'min-24h': 'temp_min',         'max-24h': 'temp_max' },
    out: { 'obecna': 'temp_outside', 'min-24h': 'temp_outside_min', 'max-24h': 'temp_outside_max' }
  };
  const RANGE_LABEL = { 'obecna': '', 'min-24h': ' · min. 24 h', 'max-24h': ' · maks. 24 h' };
  const LOC_LABEL = { in: 'Wewnętrzna', out: 'Zewnętrzna' };

  // Duży panel atmosfery: ustawienia "Dane panelu atmosfery", "Wyróżniona temperatura"
  // i "Zakres wyróżnionej temperatury".
  function renderAtmo() {
    const mode = ATMO_ICONS[settings.atmoData] ? settings.atmoData : 'temperatura';
    // Ustawienia dotyczące tylko temperatury chowamy, gdy panel pokazuje ciśnienie albo wilgoć.
    document.querySelectorAll('.temp-only').forEach(el => { el.hidden = mode !== 'temperatura'; });
    if ($('dash-atmo-icon')) $('dash-atmo-icon').innerHTML = ATMO_ICONS[mode];
    if (!$('dash-sec-in') || !$('dash-sec-out')) return;

    if (mode === 'temperatura') {
      const main = settings.tempHighlight === 'na-zewnatrz' ? 'out' : 'in';
      const range = TEMP_KEYS.in[settings.tempRange] ? settings.tempRange : 'obecna';
      ['out', 'in'].forEach(loc => {
        const isMain = loc === main;
        const key = TEMP_KEYS[loc][range];   // zakres (obecna / min / maks 24 h) dotyczy obu wartości
        $('dash-temp-' + loc).textContent = format(key, state[key]);
        $('dash-unit-' + loc).textContent = '°C';
        $('dash-label-' + loc).textContent = LOC_LABEL[loc] + RANGE_LABEL[range];
        $('dash-sec-' + loc).classList.toggle('is-minor', !isMain);
      });
      $('dash-sec-in').hidden = false;
      $('dash-atmo').classList.remove('single');
    } else {
      const one = mode === 'wilgoc' ? ['Wilgotność', 'temp_humidity', '%'] : ['Ciśnienie', 'temp_pressure', 'hPa'];
      $('dash-label-out').textContent = one[0];
      $('dash-temp-out').textContent = format(one[1], state[one[1]]);
      $('dash-unit-out').textContent = one[2];
      $('dash-sec-out').classList.remove('is-minor');
      $('dash-sec-in').hidden = true;
      $('dash-atmo').classList.add('single');
    }
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

    const main = settings.tempHighlight === 'na-zewnatrz' ? 'out' : 'in';
    if ($('temp-tile-in')) $('temp-tile-in').classList.toggle('primary', main === 'in');
    if ($('temp-tile-out')) $('temp-tile-out').classList.toggle('primary', main === 'out');

    renderAtmo();
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
  pullServerSettings();
})();
