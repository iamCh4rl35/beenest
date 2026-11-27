/* =====================================================
   BEENest — app.js
   ===================================================== */
(function () {
  "use strict";

  const $ = id => document.getElementById(id);

  /* ===== 0. NIESPAROWANE URZĄDZENIE: tylko ekran parowania ===== */
  // Stan zabezpieczeń wkleja serwer (app.py -> security_state). Bez parowania reszta API odpowiada 401.
  const AUTH = window.BEENEST_AUTH || { level: 'admin', display: true, no_security: true };

  /* ===== 0a. APLIKACJA NA ANDROIDA: wygląd z telefonu ===== */
  // Most window.BeeNestAndroid daje aplikacja (android/app/src/main/kotlin/pl/beenest/app/MainActivity.kt):
  // kolory Material You, tryb ciemny, wcięcia ekranu (pasek stanu, nawigacja). W przeglądarce APP = null.
  // Gest cofania i odświeżanie: sekcja 18.
  const APP = readApp();
  const UA = navigator.userAgent;
  const IS_IOS = /iPhone|iPad|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
  const IS_ANDROID_BROWSER = /Android/.test(UA) && !APP;
  if (APP) { document.body.dataset.app = 'android'; applyAppLook(APP); }

  // Aplikacja zapamiętuje motyw: ekran startowy, ekran „Szukam ula…” i paski systemowe w tych samych kolorach
  function reportThemeToApp() {
    if (!APP || !window.BeeNestAndroid.setTheme) return;
    const cs = getComputedStyle(document.body);
    try {
      window.BeeNestAndroid.setTheme(document.body.dataset.theme || 'material-you', cs.getPropertyValue('--bg').trim(),
        cs.getPropertyValue('--black').trim(), document.body.dataset.theme === 'material-you' ? !!APP.dark
          : ['night-black', 'honey-grey'].includes(document.body.dataset.theme), cs.getPropertyValue('--orange').trim());
    } catch (e) { }
  }

  function readApp() {
    try { return window.BeeNestAndroid ? JSON.parse(window.BeeNestAndroid.info()) : null; } catch (e) { return null; }
  }

  // Palety Androida: odcień 0 = biel, 1000 = czerń (odwrotnie niż tony Material 3). Z nich role kolorów motywu.
  function applyAppLook(info) {
    if (!info) return;
    const root = document.documentElement.style;
    ['top', 'right', 'bottom', 'left'].forEach((side, i) => root.setProperty('--safe-' + side, (info.insets[i] || 0) + 'px'));
    document.body.dataset.scheme = info.dark ? 'dark' : 'light';
    const c = info.colors;
    if (!c) return;                       // Android 10–11: kolory zapasowe z CSS
    const t = (p, n) => (c[p] || {})[n];
    const roles = info.dark ? {
      surface: t('neutral1', 900), container: t('neutral1', 800), 'on-surface': t('neutral1', 100),
      'on-surface-variant': t('neutral2', 200), outline: t('neutral2', 700), primary: t('accent1', 200),
      'primary-strong': t('accent1', 300), 'on-primary': t('accent1', 800), 'primary-container': t('accent1', 700),
      'secondary-container': t('accent2', 700)
    } : {
      surface: t('neutral1', 10), container: t('neutral1', 50), 'on-surface': t('neutral1', 900),
      'on-surface-variant': t('neutral2', 700), outline: t('neutral2', 200), primary: t('accent1', 600),
      'primary-strong': t('accent1', 700), 'on-primary': t('accent1', 0), 'primary-container': t('accent1', 100),
      'secondary-container': t('accent2', 100)
    };
    Object.entries(roles).forEach(([k, v]) => { if (v) document.body.style.setProperty('--m3-' + k, v); });
  }

  if (AUTH.level === 'unpaired') {
    // Ikona z ekranu początkowego iPhone'a / iPada ma własne ciasteczka: klucz przeniesienia z adresu startowego
    // zamienia się na ciasteczko tego urządzenia (app.py: api_pair_transfer), potem strona ładuje się od nowa.
    // Aplikacja na Androida przejmuje sparowanie przeglądarki, z której ten telefon pobrał przed chwilą plik .apk
    // (app.py: api_pair_adopt) – nie trzeba parować drugi raz.
    const transfer = new URLSearchParams(location.search).get('transfer');
    const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(r => { if (!r.ok) throw new Error(); location.replace('/'); });
    if (transfer) post('/api/pairing/transfer', { token: transfer }).catch(() => { history.replaceState(null, '', '/'); showPairScreen(); });
    else if (APP) post('/api/pairing/adopt', {}).catch(showPairScreen);
    else showPairScreen();
    return;
  }

  function guessDeviceName() {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Telefon z Androidem' : 'Tablet z Androidem';
    if (/Windows/.test(ua)) return 'Komputer z Windows';
    if (/Macintosh/.test(ua)) return 'Komputer Mac';
    if (/Linux/.test(ua)) return 'Komputer z Linuksem';
    return 'Telefon';
  }

  // Motyw z systemu urządzenia (tryb ciemny, zwiększony kontrast) – tylko przy pierwszym wejściu,
  // potem obowiązuje to, co zapisano w global.conf.
  function systemLook() {
    const mq = q => window.matchMedia && window.matchMedia(q).matches;
    // Aplikacja na Androida: domyślny motyw Material You (kolory z telefonu). Strona: Biały Pyłek / Nocna Czerń.
    return { theme: APP ? 'material-you' : mq('(prefers-color-scheme: dark)') ? 'night-black' : 'white-pollen',
      highContrast: mq('(prefers-contrast: more)') };
  }

  function showPairScreen() {
    const dev = window.BEENEST_DEVICE || {};
    const s = dev.known ? (dev.settings || {}) : systemLook();
    document.body.setAttribute('data-theme', s.theme || 'white-pollen');
    document.body.setAttribute('data-contrast', s.highContrast ? 'high' : 'normal');
    reportThemeToApp();
    document.querySelectorAll('header.topbar, .divider, main').forEach(el => { el.hidden = true; });
    $('pair-screen').hidden = false;

    // „Zainstaluj aplikację”: Android w przeglądarce – plik .apk z ula; iPhone / iPad – ikona na ekranie początkowym
    // (ikona ma własne ciasteczka, więc sparuje się sama po otwarciu)
    const install = $('pair-install'), help = $('pair-install-help');
    if (IS_ANDROID_BROWSER && dev.apk) {
      install.hidden = false;
      install.href = '/static/beenest.apk';
      install.setAttribute('download', 'beenest.apk');
      install.addEventListener('click', () => {
        help.textContent = 'Po pobraniu otwórz plik beenest.apk. Android zapyta o zgodę na instalowanie aplikacji z przeglądarki – zezwól i stuknij Zainstaluj.';
        help.hidden = false;
      });
    } else if (IS_IOS && !navigator.standalone) {
      install.hidden = false;
      install.setAttribute('role', 'button');
      install.addEventListener('click', () => {
        help.textContent = 'Stuknij przycisk Udostępnij (kwadrat ze strzałką w górę), wybierz Do ekranu początkowego, a potem Dodaj. Otwórz ikonę z pszczółką i sparuj ją z ulem.';
        help.hidden = false;
      });
    }

    // Kod QR z wyświetlacza otwiera adres .../#pair=<kod> – wtedy nie trzeba przepisywać cyfr.
    const m = /pair=([\w-]+)/.exec(location.hash);
    let token = m ? m[1] : null;
    const useDigits = () => {
      token = null;
      $('pair-code-field').hidden = false;
      $('pair-lead').textContent = 'Na wyświetlaczu ula otwórz Ustawienia → Działanie → Sparuj urządzenie i wpisz tu 6 cyfr.';
    };
    if (token) {
      $('pair-code-field').hidden = true;
      $('pair-lead').textContent = 'Kod z wyświetlacza jest już wczytany. Podaj nazwę tego urządzenia i naciśnij Sparuj.';
    }
    $('pair-name').value = dev.network_name || guessDeviceName();   // nazwa z DHCP hotspotu, np. „Pixel 9 Pro Karol”

    const fail = text => {
      $('pair-wait').hidden = true;
      $('pair-form').hidden = false;
      $('pair-submit').disabled = false;
      $('pair-error').textContent = text;
    };
    function waitForDecision() {
      $('pair-form').hidden = true;
      $('pair-wait').hidden = false;
      const timer = setInterval(async () => {
        let st;
        try { st = await (await fetch('/api/pairing/status', { cache: 'no-store' })).json(); } catch (e) { return; }
        if (st.status === 'waiting') return;
        clearInterval(timer);
        if (st.status === 'accepted') {
          try { sessionStorage.setItem('beenest-setup', '1'); } catch (e) { }   // po przeładowaniu: szybki konfigurator
          location.replace(location.pathname);
          return;
        }
        useDigits();
        fail(st.status === 'rejected' ? 'Wyświetlacz ula odrzucił to urządzenie.'
          : 'Minął czas na zatwierdzenie. Wygeneruj nowy kod na wyświetlaczu ula.');
      }, 1500);
    }

    $('pair-form').addEventListener('submit', async e => {
      e.preventDefault();
      $('pair-error').textContent = '';
      const body = { name: $('pair-name').value.trim() };
      if (token) body.token = token;
      else {
        body.code = $('pair-code').value.replace(/\D/g, '');
        if (body.code.length !== 6) { $('pair-error').textContent = 'Wpisz 6 cyfr z wyświetlacza ula.'; return; }
      }
      $('pair-submit').disabled = true;
      try { await postJSON('/api/pairing/claim', body); }
      catch (err) {
        if (token) useDigits();                     // kod z QR wygasł – zostaje wpisanie cyfr
        const left = err.data && err.data.remaining;
        fail(err.message + (left ? '. Pozostało prób: ' + left + '.' : ''));
        return;
      }
      waitForDecision();
    });
  }

  // Ostatnie dane z serwera. Wyświetlanie (render) zawsze rysuje się z tego + z ustawień,
  // więc zmiana ustawienia działa od razu, bez czekania na kolejne odpytanie.
  const state = {};

  /* ===== 1. USTAWIENIA ===== */
  const defaultSettings = {
    theme: 'white-pollen',
    highContrast: false,
    atmoData: 'temperature',
    tempHighlight: 'inside',
    tempRange: 'current',
    humidityHighlight: 'inside',
    humidityRange: 'current',
    pressureHighlight: 'inside',
    pressureRange: 'current',
    wellbeingData: 'status',
    feederData: 'level',
    saveInterval: '60',
    dataRetention: '12',
    feederRate: true,
    feederAlarm: true,
    feederWords: true,          // poziom dokarmiaczki słownie zamiast w %
    camera: 'external',
    brightness: '100'          // % – tylko wyświetlacz przy ulu (sekcja 14)
  };

  // Wszystkie ustawienia są na Raspberry w data/global.conf: [storage] wspólne dla wszystkich,
  // reszta (wygląd, karty, alarm, kamera) osobno dla każdego urządzenia (po adresie IP).
  // Serwer wkleja je do strony (window.BEENEST_DEVICE), więc są od razu, bez czekania.

  // id elementu w main.html -> nazwa ustawienia
  const SELECTS = {
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
    'feeder-rate-toggle': 'feederRate',
    'feeder-alarm-toggle': 'feederAlarm',
    'feeder-words-toggle': 'feederWords'
  };

  const device = window.BEENEST_DEVICE || { settings: {}, known: true };
  const settings = Object.assign({}, defaultSettings, device.settings);
  // Pierwsze wejście z tego urządzenia (brak sekcji w global.conf): motyw jak w systemie urządzenia.
  // Zapis (17. INIT) zakłada sekcję, więc później obowiązuje już wybór z Ustawień.
  const firstVisit = !device.known && !AUTH.display;
  if (firstVisit) Object.assign(settings, systemLook());
  // Material You jest tylko w aplikacji. Ten sam telefon w Chrome ma te same ustawienia (według adresu IP) – strona
  // pokazuje wtedy Biały Pyłek, ale nie zapisuje go (aplikacja zostaje przy Material You).
  if (!APP && settings.theme === 'material-you') settings.theme = 'white-pollen';

  function applyTheme() {
    document.body.setAttribute('data-theme', settings.theme);
    document.body.setAttribute('data-contrast', settings.highContrast ? 'high' : 'normal');
    reportThemeToApp();
  }

  function applySettingsToUI() {
    applyTheme();
    applyBrightness(settings.brightness);
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
    return readJSON(res);
  }

  async function getJSON(url) {
    return readJSON(await fetch(url, { cache: 'no-store' }));
  }

  // Błąd ma .status i .data (odpowiedź serwera). 401 = urządzenie przestało być sparowane -> ekran parowania.
  async function readJSON(res) {
    let data = {};
    try { data = await res.json(); } catch (e) { }
    if (res.status === 401 && data.unpaired && AUTH.level !== 'unpaired') location.reload();
    if (!res.ok) {
      const err = new Error(data.error || ('błąd HTTP ' + res.status));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function pushSettings(changes) {
    try { await postJSON('/api/settings', changes); }
    catch (e) {
      showPopup('Nie udało się zapisać ustawienia na urządzeniu: ' + e.message, 6000, false);
      try {                                       // np. brak uprawnień – pokaż z powrotem to, co jest zapisane
        Object.assign(settings, await getJSON('/api/settings'));
        applySettingsToUI();
        render();
      } catch (e2) { }
    }
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
    if (key === 'brightness') applyBrightness(value);
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
      if (settingsPhone()) openSettingsDetail(tab.textContent.trim());
    });
  });

  // Telefon: najpierw lista kategorii na całym ekranie, potem wybrana kategoria wjeżdża od prawej (jak w iOS).
  // W przeglądarce wpis w historii – systemowe „wstecz” wraca do listy; w aplikacji robi to gest (sekcja 18).
  function settingsPhone() { return window.matchMedia('(max-width: 850px)').matches; }
  const settingsBox = document.querySelector('.settings-container');
  function openSettingsDetail(title) {
    $('settings-detail-title').textContent = title;
    document.querySelector('.settings-content').scrollTop = 0;
    settingsBox.classList.add('is-detail');
    if (!APP && !(history.state && history.state.settingsDetail)) history.pushState({ settingsDetail: true }, '');
  }
  function closeSettingsDetail(instant) {
    if (!settingsBox.classList.contains('is-detail')) return;
    settingsBox.classList.toggle('is-instant', !!instant);
    settingsBox.classList.remove('is-detail');
    if (instant) requestAnimationFrame(() => requestAnimationFrame(() => settingsBox.classList.remove('is-instant')));
  }
  $('settings-back').addEventListener('click', () => {
    if (history.state && history.state.settingsDetail) history.back();      // popstate zamknie kategorię
    else closeSettingsDetail();
  });
  window.addEventListener('popstate', () => closeSettingsDetail());
  window.addEventListener('hashchange', () => { if (location.hash !== '#settings') closeSettingsDetail(true); });

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
  // Przejście między stronami (--page-duration w style.css): otwierana karta wjeżdża z prawej, poprzednia zanika
  // i maleje ku środkowi. Powrót do panelu głównego – odwrotnie. Stara strona na czas animacji leży nad
  // nową (position: absolute w <main>); po animacji klasy znikają, żeby nie zostawał transform.
  const PAGE_TIME = 400;          // ms – tyle co --page-duration
  const PAGE_ANIM = ['page-leaving', 'page-entering', 'from-right', 'to-back', 'from-back', 'to-right'];
  const main = document.querySelector("main");   // na desktopie przewija się <main>, nie okno
  let pageTimer = null;

  function finishPageAnim() {
    clearTimeout(pageTimer);
    pages.forEach(p => {
      p.classList.remove(...PAGE_ANIM);
      p.style.top = p.style.left = p.style.width = p.style.height = '';
    });
    main.classList.remove('is-turning');
  }

  function route() {
    const id = (location.hash || "#home").slice(1);
    const page = $(id) || $("home");
    const current = pages.find(p => p.classList.contains("active"));
    finishPageAnim();
    const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (current && current !== page && !still) {
      const back = page.id === 'home';
      Object.assign(current.style, { top: current.offsetTop + 'px', left: current.offsetLeft + 'px',
        width: current.offsetWidth + 'px', height: current.offsetHeight + 'px' });
      current.classList.add('page-leaving', back ? 'to-right' : 'to-back');
      page.classList.add('page-entering', back ? 'from-back' : 'from-right');
      main.classList.add('is-turning');
      pageTimer = setTimeout(finishPageAnim, PAGE_TIME);
    }
    pages.forEach(p => p.classList.toggle("active", p === page));
    const toHome = page.id === 'home';
    const restore = () => {
      window.scrollTo({ top: toHome ? homeScroll.win : 0, behavior: "auto" });
      main.scrollTop = toHome ? homeScroll.main : 0;
    };
    restore();
    // w trakcie animacji strona jest krótsza (przewinięcie się przycina) – jeszcze raz po jej końcu
    if (toHome) setTimeout(() => { if ((location.hash || '#home') === '#home') restore(); }, PAGE_TIME + 20);
  }
  // Menu główne pamięta, gdzie było przewinięte – powrót z karty wraca w to samo miejsce; podstrony od góry.
  // Zapis przy kliknięciu (przed nawigacją): zmiana #adresu najpierw sama przewija do sekcji o tym id.
  let homeScroll = { win: 0, main: 0 };
  $('home').addEventListener('click', () => { homeScroll = { win: window.scrollY, main: main.scrollTop }; }, true);
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

  // cfg: { id, page, host, rangeDock, paramDock?, params: { name: { keys, labels, unit, decimals } }, onParam? }
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
    id: 'atmo', page: 'atmosphere', host: $('atmo-chart'),
    rangeDock: $('atmo-range-dock'), paramDock: $('atmo-param-dock'),
    params: {
      temperature: { keys: ['temp_current', 'temp_outside'], labels: ['W ulu', 'Na zewnątrz'], unit: '°C', decimals: 1 },
      humidity:      { keys: ['temp_humidity', 'temp_outside_humidity'], labels: ['W ulu', 'Na zewnątrz'], unit: '%', decimals: 0 },
      pressure:   { keys: ['temp_pressure', 'temp_outside_pressure'], labels: ['W ulu', 'Na zewnątrz'], unit: 'hPa', decimals: 1 }
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
    id: 'wellbeing', page: 'wellbeing', host: $('wellbeing-chart'),
    rangeDock: $('wellbeing-range-dock'),
    params: { frequency: { keys: ['w_frequency'], labels: ['Częstotliwość'], unit: 'Hz', decimals: 0 } }
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
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    usb: '<rect x="7" y="9" width="10" height="13" rx="2"/><path d="M9 9V3h6v6"/><line x1="11" y1="5.5" x2="11" y2="6.5"/><line x1="13" y1="5.5" x2="13" y2="6.5"/>',
    wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
    phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
    crown: '<path d="M3 17L2 7l5 4 5-7 5 7 5-4-1 10z"/><path d="M3 21h18"/>',
    crownOff: '<path d="M3 17L2 7l5 4 5-7 5 7 5-4-1 10z"/><path d="M3 21h18"/><line x1="2" y1="2" x2="22" y2="22"/>'
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
    $('modal-icon').hidden = o.icon === false;              // icon: false = bez ikony (okna z kodem QR)
    $('modal-icon').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' + (MODAL_ICONS[o.icon] || MODAL_ICONS.alert) + '</svg>';
    $('modal-extra').replaceChildren(...(o.content ? [o.content] : []));   // content: własny element (kod QR, przełączniki)
    $('modal-extra').hidden = !o.content;
    $('modal-card').classList.toggle('is-wide', !!o.wide);
    $('modal-card').classList.toggle('is-center', !!o.center);   // center: wyśrodkowany tytuł i treść
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
    if (!document.querySelector('.side-panel.open')) pageParts().forEach(el => { el.inert = false; });
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
    if (!$('modal').classList.contains('open') || $('pin-modal').classList.contains('open')) return;
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
    f_level: 0,
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
    temperature: '<path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>',
    humidity: '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
    pressure: '<circle cx="12" cy="12" r="9"/><path d="M12 12l3.5-3.5"/><path d="M12 3v2M3 12h2M21 12h-2"/>'
  };
  // Każdy parametr atmosfery: jednostka, nazwy ustawień (wyróżniona wartość, zakres) i klucze z serwera.
  // Dla każdego jest to samo: dwie wartości (w ulu / na zewnątrz), jedna wyróżniona, zakres dotyczy obu.
  const ATMO = {
    temperature: {
      name: 'Temperatura', unit: '°C', hl: 'tempHighlight', rg: 'tempRange',
      keys: {
        in:  { 'current': 'temp_current', 'min-24h': 'temp_min',         'max-24h': 'temp_max' },
        out: { 'current': 'temp_outside', 'min-24h': 'temp_outside_min', 'max-24h': 'temp_outside_max' }
      }
    },
    humidity: {
      name: 'Wilgotność', unit: '%', hl: 'humidityHighlight', rg: 'humidityRange',
      keys: {
        in:  { 'current': 'temp_humidity',         'min-24h': 'temp_humidity_min',         'max-24h': 'temp_humidity_max' },
        out: { 'current': 'temp_outside_humidity', 'min-24h': 'temp_outside_humidity_min', 'max-24h': 'temp_outside_humidity_max' }
      }
    },
    pressure: {
      name: 'Ciśnienie', unit: 'hPa', hl: 'pressureHighlight', rg: 'pressureRange',
      keys: {
        in:  { 'current': 'temp_pressure',         'min-24h': 'temp_pressure_min',         'max-24h': 'temp_pressure_max' },
        out: { 'current': 'temp_outside_pressure', 'min-24h': 'temp_outside_pressure_min', 'max-24h': 'temp_outside_pressure_max' }
      }
    }
  };
  const RANGE_LABEL = { 'current': '', 'min-24h': ' · minimum z 24 godzin', 'max-24h': ' · maksimum z 24 godzin' };
  const LOC_LABEL = { in: 'Wewnętrzna', out: 'Zewnętrzna' };

  // Które wartości (w ulu / na zewnątrz) i jaki zakres wybrano dla danego parametru
  function atmoChoice(mode) {
    const a = ATMO[mode];
    return {
      main: settings[a.hl] === 'outside' ? 'out' : 'in',
      range: a.keys.in[settings[a.rg]] ? settings[a.rg] : 'current'
    };
  }

  // Duży panel atmosfery w Menu Głównym: ustawienia "Dane panelu atmosfery" oraz, dla wybranego parametru,
  // "Wyróżniona …" i "Zakres wyróżnionej …".
  function renderAtmo() {
    const mode = ATMO[settings.atmoData] ? settings.atmoData : 'temperature';
    const a = ATMO[mode];
    // W ustawieniach widać tylko wiersze wybranego parametru.
    document.querySelectorAll('[data-atmo-mode]').forEach(el => { el.hidden = el.dataset.atmoMode !== mode; });
    if ($('dash-atmo-icon')) $('dash-atmo-icon').innerHTML = ATMO_ICONS[mode];
    if (!$('dash-sec-in') || !$('dash-sec-out')) return;

    const { main, range } = atmoChoice(mode);
    $('dash-atmo').classList.toggle('is-long', mode === 'pressure');   // 4 cyfry + hPa: mniejsza czcionka
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
    // Model wylotka: zasuwa (88 jednostek szerokości) odsuwa się w lewo o całą szerokość przy 100 %
    if ($('outlet-door-slide')) {
      const p = isNum(state.o_position) ? Math.max(0, Math.min(100, Number(state.o_position))) : 0;
      $('outlet-door-slide').style.transform = 'translateX(' + (-88 * p / 100) + 'px)';
      $('outlet-door').classList.toggle('is-unknown', !isNum(state.o_position));
    }
    if ($('o-position-label')) $('o-position-label').textContent = withUnit('o_position', '%');
    const range = $('outlet-range');
    if (range && !(range.matches(':active') && outletAllowedNow())) {
      range.value = isNum(state.o_position) ? Math.round(state.o_position) : 0;
      $('outlet-range-value').textContent = isNum(state.o_position) ? range.value + ' %' : '--';
    }
  }
  function outletAllowedNow() { try { return sec.no_security || isAdmin(); } catch (e) { return false; } }   // sec: sekcja 15

  // Kafelek "Samopoczucie": ustawienie "Dane panelu samopoczucia".
  function renderWellbeing() {
    let text, caption;
    if (settings.wellbeingData === 'loudness')           { caption = 'Natężenie dźwięku'; text = withUnit('w_sound', 'dB'); }
    else if (settings.wellbeingData === 'frequency') { caption = 'Częstotliwość';     text = withUnit('w_frequency', 'Hz'); }
    else                                                  { caption = 'Stan rodziny';      text = format('w_status', state.w_status); }
    if ($('dash-wellbeing-compact')) $('dash-wellbeing-compact').textContent = text;
    if ($('dash-wellbeing-caption')) $('dash-wellbeing-caption').textContent = caption;
  }

  // Poziom dokarmiaczki słownie. Sterownik podaje 100 / 80 / 40 / 15 % (3 / 2 / 1 / 0 czujników widzi ciecz,
  // feeder_detector_driver.py) – progi pośrodku, żeby słowo wynikało z poziomu, a nie z dokładnej liczby.
  const FEEDER_WORDS = ['Wymaga napełnienia', 'Połowa zbiornika', 'Zapas płynu', 'Pełny'];
  // Ile czujników widzi ciecz (0–3), null = brak odczytu
  function feederSensors(v) {
    if (!isNum(v)) return null;
    v = Number(v);
    return v >= 90 ? 3 : v >= 60 ? 2 : v >= 28 ? 1 : 0;
  }
  function feederWord(v) {
    const n = feederSensors(v);
    return n === null ? '--' : FEEDER_WORDS[n];
  }

  // Wejście na stronę Dokarmiaczka: model zbiornika „ładuje się” od dołu do obecnego poziomu w TANK_FILL_MS.
  // Bez danych (pierwsze wejście prosto na #dokarmiaczka) animacja czeka na pierwszy odczyt.
  const TANK_FILL_MS = 500;
  let tankPending = location.hash === '#feeder', tankAnimating = false;
  function fillTank(n) {
    const segs = [...document.querySelectorAll('#feeder-tank .tank-seg')];
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    tankAnimating = true;
    segs.forEach(seg => { seg.style.transition = 'none'; seg.classList.remove('is-on'); });
    void document.body.offsetHeight;                   // przeglądarka musi najpierw narysować pusty zbiornik
    const lit = n + 1, step = TANK_FILL_MS / lit;      // każda część zapala się po poprzedniej
    segs.forEach((seg, i) => {
      seg.style.transition = 'background ' + step + 'ms linear ' + (i * step) + 'ms';
      seg.classList.toggle('is-on', i < lit);
    });
    setTimeout(() => {
      segs.forEach(seg => { seg.style.transition = ''; });
      tankAnimating = false;
      renderFeeder();                                  // poziom mógł się zmienić w trakcie
    }, TANK_FILL_MS);
    return true;
  }
  window.addEventListener('hashchange', () => {
    if (location.hash === '#feeder') { tankPending = true; renderFeeder(); }
  });

  // Kafelek "Stan dokarmiaczki": ustawienie "Stan dokarmiaczki (duży panel)".
  // "Słowny stan dokarmiaczki": słowo zamiast procentów na kafelku i na stronie Dokarmiaczka (pasek zostaje).
  function renderFeeder() {
    const words = !!settings.feederWords;
    let text, caption;
    if (settings.feederData === 'last-refill') {
      const d = toDate(state.f_last);
      caption = 'Ostatnie napełnienie';
      text = d ? d.toLocaleDateString('pl-PL', { dateStyle: 'medium' }) : '--';
    } else {
      caption = 'Poziom zbiornika';
      text = words ? feederWord(state.f_level) : withUnit('f_level', '%');
    }
    if (words && $('f-level')) $('f-level').textContent = feederWord(state.f_level);
    if ($('f-level-value')) $('f-level-value').classList.toggle('small', words);
    if ($('f-level-unit')) $('f-level-unit').hidden = words;

    // Model zbiornika (strona Dokarmiaczka): części od dołu – 1 część = żaden czujnik nie widzi cieczy (15 %)
    const n = feederSensors(state.f_level);
    if ($('f-level-label')) $('f-level-label').textContent = words ? feederWord(state.f_level) : withUnit('f_level', '%');
    if (tankPending && n !== null && $('feeder') && $('feeder').classList.contains('active')) {
      tankPending = false;
      fillTank(n) || document.querySelectorAll('#feeder-tank .tank-seg').forEach((seg, i) => seg.classList.toggle('is-on', i <= n));
    } else if (!tankAnimating) {
      document.querySelectorAll('#feeder-tank .tank-seg').forEach((seg, i) => seg.classList.toggle('is-on', n !== null && i <= n));
    }
    if ($('f-level-desc')) {
      $('f-level-desc').textContent = n === null ? 'Brak odczytu z czujników cieczy.'
        : n === 0 ? 'Żaden z trzech czujników nie wykrywa cieczy.'
        : 'Ciecz wykrywa ' + n + ' z 3 czujników.';
    }
    if ($('dash-feeder-compact')) {
      $('dash-feeder-compact').textContent = text;
      $('dash-feeder-compact').classList.toggle('is-long', text.length > 12);
    }
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


    if ($('m-status')) {
      $('m-status').textContent = CAMERA_NAMES[settings.camera] + (state.m_status ? ' · ' + state.m_status : '');
    }
    if ($('dash-camera-compact')) $('dash-camera-compact').textContent = CAMERA_NAMES[settings.camera] || '--';   // kafelek Monitoring

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
      if (res.status === 401) { location.reload(); return; }     // urządzenie odłączone od ula -> ekran parowania
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

  /* ===== 12a. KAFELKI NA STRONIE GŁÓWNEJ: Parowanie, Zasilanie, Szybkie ustawienia ===== */
  // Parowanie i Wyłącz / Uruchom ponownie wołają te same przyciski co zakładka Działanie,
  // więc uprawnienia (PIN na wyświetlaczu, brak uprawnień na telefonie) sprawdzają się tak samo.
  const ICON_MOON = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  const THEMES = [
    ['white-pollen', 'Biały Pyłek', '#FFFFFF', '#FF8A00'],
    ['light-honey', 'Lekki Miodek', '#FFF8E7', '#FF9E00'],
    ['night-black', 'Nocna Czerń', '#000000', '#FF8A00'],
    ['honey-grey', 'Miodna Szarość', '#1A1408', '#FFB800']
  ];
  // Tylko aplikacja na Androida: ostatni motyw = Material You (kolory z telefonu)
  if (APP) THEMES.push(['material-you', 'Material You', 'var(--m3-surface, #FFFBFE)', 'var(--m3-primary, #6750A4)']);

  $('tile-pair').addEventListener('click', () => $('btn-pair').click());

  // Zasilanie. Telefon: zamiast „Uśpij ekran” – „Zgaś ekran ula” (wyświetlacz robi animację sam).
  // „Usuń z pamięci ula” – tylko telefon: usuwa sam siebie (jak „Odłącz od ula”).
  $('tile-power').addEventListener('click', async () => {
    const box = document.createElement('div');
    box.className = 'power-options';
    [
      { value: 'shutdown', label: 'Wyłącz', icon: MODAL_ICONS.power, danger: true },
      { value: 'reboot', label: 'Uruchom ponownie', icon: MODAL_ICONS.update },
      sec.display ? { value: 'sleep', label: 'Uśpij ekran', icon: ICON_MOON }
        : { value: 'sleep-remote', label: 'Zgaś ekran ula', icon: ICON_MOON },
      ...(sec.display ? [] : [{ value: 'leave', label: 'Usuń z pamięci ula', icon: MODAL_ICONS.trash }])
    ].forEach(o => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'power-option' + (o.danger ? ' is-danger' : '');
      b.innerHTML = '<svg viewBox="0 0 24 24">' + o.icon + '</svg><span></span>';
      b.querySelector('span').textContent = o.label;
      b.addEventListener('click', () => modalAnswer(o.value));
      box.appendChild(b);
    });
    const r = await askModal({ icon: false, center: true, title: 'Zasilanie', content: box, buttons: [{ label: 'Zamknij', value: 'cancel' }] });
    modalClose();
    if (r.value === 'sleep') setTimeout(sleepScreen, 300);          // po zamknięciu okna
    else if (r.value === 'reboot') $('btn-reboot').click();
    else if (r.value === 'shutdown') $('btn-shutdown').click();
    else if (r.value === 'sleep-remote') {
      try { await postJSON('/api/screen/sleep'); showPopup('Ekran ula zgaśnie za chwilę. Dotyk ekranu go obudzi.', 5000, false); }
      catch (e) { showPopup('Nie udało się zgasić ekranu ula: ' + e.message, 6000, false); }
    }
    else if (r.value === 'leave') $('btn-leave').click();          // potwierdzenie i odłączenie jak w Działaniu
  });

  function quickRow(label, control) {
    const row = document.createElement('div');
    row.className = 'quick-row';
    const name = document.createElement('div');
    name.className = 'setting-label';
    name.textContent = label;
    row.append(name, control);
    return row;
  }

  // Panel Estetyka: z menu głównego (z linkiem do Ustawień) i z zakładki Wygląd (strzałka, bez linku)
  $('tile-quick').addEventListener('click', () => openAesthetics(true));
  if ($('btn-aesthetics')) $('btn-aesthetics').addEventListener('click', () => openAesthetics(false));

  async function openAesthetics(withLink) {
    const box = document.createElement('div');
    box.className = 'quick';
    if (sec.display) {
      const wrap = document.createElement('div');
      wrap.className = 'range-box';
      wrap.innerHTML = '<input type="range" class="range" min="1" max="100" step="1" aria-label="Jasność ekranu"><span class="range-value"></span>';
      const range = wrap.querySelector('input'), out = wrap.querySelector('span');
      const show = v => { out.textContent = v + ' %'; };
      range.value = settings.brightness;
      show(settings.brightness);
      range.addEventListener('input', () => { show(range.value); applyBrightness(range.value); });
      range.addEventListener('change', () => { onSettingChange('brightness', String(range.value)); applySettingsToUI(); });
      box.appendChild(quickRow('Jasność ekranu', wrap));
    }
    const themes = document.createElement('div');
    themes.className = 'theme-chips';
    let contrastRow = null;      // przy Material You wysoki kontrast jest ukryty (kolory daje telefon)
    const paintThemes = () => {
      themes.querySelectorAll('.theme-chip').forEach(c => c.classList.toggle('active', c.dataset.value === settings.theme));
      if (contrastRow) contrastRow.hidden = settings.theme === 'material-you';
    };
    THEMES.forEach(([value, label, bg, accent]) => {
      const c = document.createElement('button');
      c.type = 'button';
      c.className = 'theme-chip';
      c.dataset.value = value;
      c.innerHTML = '<span class="theme-swatch"></span><span></span>';
      c.firstChild.style.background = 'linear-gradient(135deg, ' + bg + ' 50%, ' + accent + ' 50%)';
      c.lastChild.textContent = label;
      c.addEventListener('click', () => { onSettingChange('theme', value); applySettingsToUI(); paintThemes(); });
      themes.appendChild(c);
    });
    paintThemes();
    box.appendChild(quickRow('Motyw', themes));
    const toggle = document.createElement('label');
    toggle.className = 'toggle-switch';
    toggle.innerHTML = '<input type="checkbox" aria-label="Wysoki kontrast"><span class="slider"></span>';
    toggle.firstChild.checked = !!settings.highContrast;
    toggle.firstChild.addEventListener('change', e => { onSettingChange('highContrast', e.target.checked); applySettingsToUI(); });
    contrastRow = quickRow('Wysoki kontrast', toggle);
    box.appendChild(contrastRow);
    paintThemes();
    if (withLink) {
      const link = document.createElement('button');
      link.type = 'button';
      link.className = 'quick-link';
      link.textContent = 'Przejdź do ustawień';
      link.addEventListener('click', () => { closeSheet(); location.hash = '#settings'; });
      box.appendChild(link);
    }
    await openSheet({ title: 'Estetyka', content: box,
      desc: sec.display ? 'Jasność ekranu, motyw i wysoki kontrast.' : 'Motyw i wysoki kontrast.' });
  }

  /* ===== 12b. PANEL USTAWIEŃ OD PRAWEJ (wygląda jak Urządzenia) ===== */
  // openSheet({title, desc, content, onClose}) – Promise kończy się po zamknięciu.
  // onClose: po animacji zamykania (np. oddanie przeniesionych wierszy na miejsce).
  let sheetDone = null;
  function openSheet(o) {
    if (sheetDone) closeSheet();
    closeDropdown();
    $('sheet-title').textContent = o.title;
    $('sheet-desc').textContent = o.desc || '';
    $('sheet-desc').hidden = !o.desc;
    $('sheet-body').replaceChildren(o.content);
    $('sheet-body').scrollTop = 0;
    const opener = document.activeElement;
    $('sheet-panel').classList.add('open');
    pageParts().forEach(el => { el.inert = true; });
    $('sheet-close').focus({ preventScroll: true });
    return new Promise(resolve => {
      sheetDone = () => {
        const content = o.content;
        setTimeout(() => {                      // po animacji wysuwania (--anim-duration)
          if (o.onClose) o.onClose();
          if ($('sheet-body').firstChild === content && !$('sheet-panel').classList.contains('open')) $('sheet-body').replaceChildren();
        }, 450);
        if (opener && opener.focus) opener.focus({ preventScroll: true });
        resolve();
      };
    });
  }
  function closeSheet() {
    if (!sheetDone) return;
    closeDropdown();
    $('sheet-panel').classList.remove('open');
    if (!$('modal').classList.contains('open') && !document.querySelector('.side-panel.open')) {
      pageParts().forEach(el => { el.inert = false; });
    }
    const done = sheetDone;
    sheetDone = null;
    done();
  }
  $('sheet-close').addEventListener('click', closeSheet);
  $('sheet-backdrop').addEventListener('click', closeSheet);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !e.defaultPrevented && sheetDone && !$('modal').classList.contains('open')   // defaultPrevented: Escape zamknął listę rozwijaną
      && !$('pin-modal').classList.contains('open') && !document.querySelector('.numpad-layer')) closeSheet();
  });

  // Działanie → Zapisy i odczyty: prawdziwe wiersze (z ich obsługą) przenoszone na czas otwarcia do panelu
  let savingBox = null;
  async function openSaving() {
    const source = $('saving-source');
    if (savingBox) source.append(...savingBox.children);   // szybkie ponowne otwarcie: wiersze jeszcze nie wróciły
    const box = savingBox = document.createElement('div');
    box.className = 'sheet-rows';
    box.append(...source.children);
    await openSheet({ title: 'Zapisy i odczyty', desc: 'Historia pomiarów do wykresów: jak często zapisywać i jak długo trzymać.',
      content: box, onClose: () => { if (savingBox === box) { source.append(...box.children); savingBox = null; } } });
  }
  $('btn-saving').addEventListener('click', openSaving);

  /* ===== 13. WYLOTEK: suwak i przyciski na stronie, okno „Programowanie czasowe wylotka” (reguły o godzinie) ===== */
  // Serwer: POST /api/outlet {pozycja}, GET/POST /api/outlet/rules (app.py). Uprawnienia: data-admin w main.html.
  const OUTLET_SEND_EVERY = 150;     // ms – suwak wysyła pozycję najwyżej tak często (serwo i tak jedzie płynnie)

  async function moveOutlet(value) {
    state.o_position = value;
    state.o_status = value <= 5 ? 'Zablokowany' : value >= 95 ? 'Otwarty' : 'W ruchu';
    render();
    try { await postJSON('/api/outlet', { position: value }); }
    catch (e) { showPopup(e.message, 5000, false); poll(); }
  }
  $('btn-outlet-open').addEventListener('click', () => moveOutlet(100));
  $('btn-outlet-close').addEventListener('click', () => moveOutlet(0));
  $('btn-outlet-panel').addEventListener('click', () => openOutlet());

  // Suwak na stronie Stan wylotka: pozycja jedzie do serwa w trakcie przesuwania (co OUTLET_SEND_EVERY ms) i na koniec.
  // Bez uprawnień administratora suwak wraca na miejsce, a puszczenie go pokazuje okno uprawnień (bramka data-admin).
  const outletRange = $('outlet-range');
  let outletLastSent = 0, outletPending = null;
  const outletSend = () => { outletLastSent = Date.now(); outletPending = null; moveOutlet(+outletRange.value); };
  outletRange.addEventListener('input', () => {
    if (!outletAllowedNow()) { renderOutlet(); return; }
    $('outlet-range-value').textContent = outletRange.value + ' %';
    clearTimeout(outletPending);
    const wait = OUTLET_SEND_EVERY - (Date.now() - outletLastSent);
    if (wait <= 0) outletSend(); else outletPending = setTimeout(outletSend, wait);
  });
  outletRange.addEventListener('change', () => { if (!outletAllowedNow()) return; clearTimeout(outletPending); outletSend(); });
  if ($('btn-outlet-settings')) $('btn-outlet-settings').addEventListener('click', () => openOutlet());

  // Klawiatura numeryczna nad oknem: „wyrasta” z klikniętej wartości (przybliżenie). kind: 'position' | 'time'
  function numpad(from, kind, current) {
    return new Promise(resolve => {
      const layer = document.createElement('div');
      layer.className = 'numpad-layer';
      const pad = document.createElement('div');
      pad.className = 'numpad';
      layer.appendChild(pad);
      pad.innerHTML = '<div class="numpad-title"></div><div class="numpad-display"></div>' +
        '<div class="pin-pad">' + [1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => '<button type="button" data-key="' + d + '">' + d + '</button>').join('') +
        '<button type="button" data-key="cancel" class="pin-side">Anuluj</button><button type="button" data-key="0">0</button>' +
        '<button type="button" data-key="delete" class="pin-side" aria-label="Usuń ostatnią cyfrę"><svg viewBox="0 0 24 24"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg></button></div>' +
        '<button type="button" class="back-btn btn-primary numpad-ok">Zatwierdź</button>';
      pad.querySelector('.numpad-title').textContent = kind === 'time' ? 'Godzina' : 'Otwarcie wylotka';
      const display = pad.querySelector('.numpad-display'), ok = pad.querySelector('.numpad-ok');
      let digits = '';
      const value = () => {
        if (kind === 'time') {
          if (digits.length !== 4 || +digits.slice(0, 2) > 23 || +digits.slice(2) > 59) return null;
          return digits.slice(0, 2) + ':' + digits.slice(2);
        }
        return digits === '' || +digits > 100 ? null : +digits;
      };
      const paint = () => {
        if (kind === 'time') {
          const d = (digits + '----').slice(0, 4);
          display.textContent = digits ? d.slice(0, 2) + ':' + d.slice(2) : current;
        } else {
          display.textContent = (digits || current) + ' %';
        }
        display.classList.toggle('is-placeholder', !digits);
        ok.disabled = !!digits && value() === null;
      };
      const close = result => {
        layer.classList.remove('open');
        setTimeout(() => layer.remove(), 400);
        resolve(result);
      };
      layer.addEventListener('click', e => { if (e.target === layer) close(null); });
      pad.addEventListener('click', e => {
        const key = e.target.closest('[data-key]');
        if (e.target.closest('.numpad-ok')) { close(digits ? value() : null); return; }
        if (!key) return;
        const k = key.dataset.key;
        if (k === 'cancel') { close(null); return; }
        if (k === 'delete') { digits = digits.slice(0, -1); paint(); return; }
        const next = digits + k;
        if (kind === 'time' ? next.length > 4 : (next.length > 3 || +next > 100)) return;
        digits = kind === 'time' ? next : String(+next);    // procent bez zer na początku („05” = 5)
        paint();
      });
      // Przybliżenie: klawiatura rośnie od środka klikniętej wartości (offsetLeft/Top – położenie bez skalowania)
      paint();
      document.body.appendChild(layer);
      const f = from.getBoundingClientRect();
      pad.style.transformOrigin = (f.left + f.width / 2 - pad.offsetLeft) + 'px ' + (f.top + f.height / 2 - pad.offsetTop) + 'px';
      requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('open')));
    });
  }

  async function openOutlet() {
    const box = document.createElement('div');
    box.className = 'quick';

    // Reguły: „Ustaw na x % o GG:MM” – zapis na serwerze po każdej zmianie
    let rules = [], max = 6;
    const list = document.createElement('div');
    list.className = 'rules';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'rule-add';
    add.textContent = '+ Dodaj regułę otwarcia';
    const err = document.createElement('div');
    err.className = 'pin-error';
    const save = async () => {
      try { err.textContent = ''; rules = (await postJSON('/api/outlet/rules', { rules: rules })).rules; }
      catch (e) { err.textContent = e.message; }
      paintRules();
    };
    const paintRules = () => {
      list.innerHTML = '';
      rules.forEach((r, i) => {
        const row = document.createElement('div');
        row.className = 'rule-row';
        row.innerHTML = '<span>Ustaw na</span><button type="button" class="rule-value" data-k="position"></button>' +
          '<span>o</span><button type="button" class="rule-value" data-k="time"></button>' +
          '<button type="button" class="rule-delete">Kasuj warunek</button>';
        row.querySelector('[data-k="position"]').textContent = r.position + ' %';
        row.querySelector('[data-k="time"]').textContent = r.time;
        row.querySelectorAll('.rule-value').forEach(btn => btn.addEventListener('click', async () => {
          const k = btn.dataset.k;
          btn.classList.add('is-zoom');
          const v = await numpad(btn, k, String(r[k]));
          btn.classList.remove('is-zoom');
          if (v === null || v === r[k]) return;
          rules[i] = Object.assign({}, r, { [k]: v });
          save();
        }));
        row.querySelector('.rule-delete').addEventListener('click', () => { rules.splice(i, 1); save(); });
        list.appendChild(row);
      });
      add.hidden = rules.length >= max;
    };
    add.addEventListener('click', () => {
      if (rules.length >= max) return;
      rules.push({ time: '08:00', position: 100 });
      save();
    });
    const rulesBox = document.createElement('div');
    rulesBox.className = 'rules-box';
    rulesBox.append(list, add, err);
    box.appendChild(quickRow('Reguły otwarcia', rulesBox));
    getJSON('/api/outlet/rules').then(d => { rules = d.rules || []; max = d.max || 6; paintRules(); })
      .catch(e => { err.textContent = e.message; });
    paintRules();

    await openSheet({ title: 'Programowanie czasowe wylotka', desc: 'Reguły otwarcia wylotka o wybranych godzinach.', content: box });
  }

  /* ===== 14. EKRAN PRZY ULU: jasność i uśpienie (animacja jak gaszenie starego telewizora) ===== */
  // Jasność: czarna warstwa #dim (wyświetlacz na HDMI nie ma sterowania podświetleniem).
  // Uśpienie: animacja .crt-off na stronie (style.css), potem czarna zasłona #sleep, a serwer gasi
  // obraz (wlopm). Dotyk zasłony budzi ekran. Usypia się samo po SLEEP_AFTER bez dotyku (nie, gdy
  // Klucz jest w porcie), a przy blokadzie po błędnych PIN-ach – po LOCKOUT_SHOW pokazywania blokady.
  const SLEEP_AFTER = 10 * 60 * 1000, LOCKOUT_SHOW = 10 * 1000, CRT_TIME = 375;   // CRT_TIME = .crt-off w style.css
  const DIM_FLOOR = 60;      // % prawdziwej jasności przy 1 % na suwaku (ciemniej panel ma błędy obrazu)
  const nap = { asleep: false, busy: false, lastActivity: Date.now(), lockoutTimer: null };

  function applyBrightness(value) {
    const b = Math.min(100, Math.max(1, Number(value) || 100));       // to, co widać na suwaku
    const real = DIM_FLOOR + (b - 1) * (100 - DIM_FLOOR) / 99;          // 1 → 60 %, 100 → 100 %
    $('dim').style.opacity = AUTH.display ? String((100 - real) / 100) : '0';
  }

  async function sleepScreen() {
    if (!AUTH.display || nap.asleep || nap.busy) return;
    nap.busy = true;
    clearTimeout(nap.lockoutTimer);
    closeDropdown();
    const dim = $('dim');
    dim.classList.add('is-fading');                       // LCD świeci czernią – ściemniamy w trakcie animacji
    dim.style.opacity = String(Math.max(Number(dim.style.opacity) || 0, .6));
    document.documentElement.classList.add('crt-off');
    await new Promise(r => setTimeout(r, CRT_TIME));
    $('sleep').hidden = false;
    document.documentElement.classList.remove('crt-off');
    dim.classList.remove('is-fading');
    applyBrightness(settings.brightness);
    nap.asleep = true;
    nap.busy = false;
    postJSON('/api/screen/sleep').catch(() => { });
  }

  function wakeScreen() {
    if (!nap.asleep) return;
    nap.asleep = false;
    nap.lastActivity = Date.now();
    postJSON('/api/screen/wake').catch(() => { });
    const curtain = $('sleep');
    curtain.classList.add('is-waking');
    setTimeout(() => { curtain.hidden = true; curtain.classList.remove('is-waking'); }, 500);
    if ((sec.lockout || 0) > 0) scheduleLockoutSleep();  // przy blokadzie: znów 10 s i gaśnie
  }

  // Blokada po błędnych PIN-ach na wyświetlaczu: widać ją przez LOCKOUT_SHOW, potem ekran gaśnie
  function scheduleLockoutSleep() {
    clearTimeout(nap.lockoutTimer);
    nap.lockoutTimer = setTimeout(() => { if ((sec.lockout || 0) > 0) sleepScreen(); }, LOCKOUT_SHOW);
  }

  // Dotyk uśpionego ekranu tylko go budzi – nie klika w to, co pod spodem
  $('sleep').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); wakeScreen(); });
  $('sleep').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });
  document.addEventListener('keydown', e => {
    if (!nap.asleep) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    wakeScreen();
  }, true);
  ['pointerdown', 'keydown', 'wheel'].forEach(ev => document.addEventListener(ev, () => {
    nap.lastActivity = Date.now();
    if ((sec.lockout || 0) > 0 && !nap.asleep && sec.display) scheduleLockoutSleep();
  }, { capture: true, passive: true }));
  if (AUTH.display) {
    setInterval(() => {
      const keyIn = sec.key && sec.key.inserted;
      if (!nap.asleep && !keyIn && Date.now() - nap.lastActivity > SLEEP_AFTER) sleepScreen();
    }, 5000);
  }

  /* ===== 15. ZABEZPIECZENIA ===== */
  // Opis całości: app.py, sekcja "Zabezpieczenia". Tu: przycisk z kłódką, PIN (numpad), blokada,
  // uprawnienia przycisków, parowanie, lista urządzeń, Klucz, zmiana PIN-u.
  // Atrybuty w main.html: data-admin (opcja administratora), data-only="display|phone" (gdzie ją widać).
  let sec = AUTH;
  const PIN_LEN = AUTH.pin_length || 6;
  const isAdmin = () => sec.level === 'admin';
  const watchers = new Set();       // wołane po każdym odczycie stanu (czekanie na pendrive, na prośbę o parowanie)
  let lastKeyEvent = null, keyFlow = false;

  async function refreshSecurity() {
    try { applySecurity(await getJSON('/api/security/state')); } catch (e) { }
  }

  let lastSleepRequest = null;     // licznik próśb telefonów o zgaszenie ekranu (tylko wyświetlacz)
  let lastAccess = '';             // gdzie / jakie uprawnienia – elementy strony przestawiamy tylko po zmianie
  function applySecurity(s) {
    sec = s;
    if (s.display && 'sleep_request' in s) {
      if (lastSleepRequest !== null && s.sleep_request !== lastSleepRequest) sleepScreen();
      lastSleepRequest = s.sleep_request;
    }
    if (s.level === 'unpaired') { location.reload(); return; }
    const where = s.display ? 'display' : 'phone';
    // Telefon użytkownika: opcje administratora wyszarzone (na wyświetlaczu nie – tam klik prosi o PIN)
    const deny = !s.display && !isAdmin();
    const access = [s.level, where, deny, !!s.no_security].join('|');
    if (access !== lastAccess) {      // stan przychodzi co 1–2 s; przechodzenie po całej stronie tylko po zmianie
      lastAccess = access;
      document.body.dataset.level = s.level;
      document.body.dataset.device = where;
      document.querySelectorAll('[data-only]').forEach(el => { el.hidden = el.dataset.only !== where; });
      if ($('security-group')) $('security-group').hidden = !!s.no_security;
      document.querySelectorAll('[data-admin]').forEach(el => el.classList.toggle('is-denied', deny));
    }
    renderLockButton();
    renderLockout();
    // Powiadomienie o wpięciu / wyjęciu Klucza (w trakcie operacji na Kluczu prowadzą własne okna)
    if (s.display && s.key) {
      if (lastKeyEvent !== null && s.key.event !== lastKeyEvent && !keyFlow) {
        showPopup(s.key.type === 'inserted'
          ? 'Klucz podłączony – panel ma uprawnienia administratora.'
          : 'Klucz odłączony – panel wrócił do poziomu użytkownika.', 5000, false);
      }
      lastKeyEvent = s.key.event;
    }
    watchers.forEach(fn => fn(s));
  }

  /* --- 15a. Przycisk z kłódką w górnym pasku (tylko wyświetlacz) --- */
  const LOCK_ICONS = {
    locked: MODAL_ICONS.lock,
    pin: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.6-1.8"/>',
    key: MODAL_ICONS.usb,
    none: MODAL_ICONS.lock
  };
  const LOCK_TEXT = {
    locked: 'Odblokuj Panel', pin: 'Zahasłuj Panel', key: 'Klucz zainstalowany w USB', none: 'Ustaw PIN'
  };

  function renderLockButton() {
    const btn = $('lock-btn');
    btn.hidden = !sec.display || !!sec.no_security;
    if (btn.hidden) return;
    const mode = sec.via === 'key' ? 'key' : sec.via === 'pin' ? 'pin' : sec.pin_set ? 'locked' : 'none';
    if (btn.dataset.mode === mode) return;
    btn.dataset.mode = mode;
    $('lock-btn-icon').innerHTML = LOCK_ICONS[mode];
    $('lock-btn-text').textContent = LOCK_TEXT[mode];
  }

  $('lock-btn').addEventListener('click', async () => {
    const mode = $('lock-btn').dataset.mode;
    if (mode === 'pin') {
      try { await postJSON('/api/security/lock'); } catch (e) { }
      await refreshSecurity();
      showPopup('Panel zahasłowany.', 3000, false);
    } else if (mode === 'locked') {
      unlockPanel();
    } else if (mode === 'key') {
      showPopup('Panel ma uprawnienia administratora, dopóki Klucz jest wpięty. Wyjmij Klucz, aby zahasłować panel.', 5000, false);
    } else {
      noticeDialog({ icon: 'lock', title: 'PIN nie jest ustawiony', text: 'Ustaw PIN administratora w konsoli Raspberry Pi:\n*python3 app.py --set-pin*' });
    }
  });

  // Dotyk ekranu przedłuża odblokowanie (najwyżej co 20 s); samo odpytywanie serwera go nie przedłuża.
  let lastPing = 0;
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => {
    if (!sec.display || sec.via !== 'pin' || Date.now() - lastPing < 20000) return;
    lastPing = Date.now();
    postJSON('/api/security/activity').catch(() => { });
  }, true));

  /* --- 15b. PIN: własny numpad, zatwierdza się sam po ostatniej cyfrze --- */
  // pinDialog({title, text, submit}) -> Promise<PIN | null>. submit(pin) sprawdza (serwer albo lokalnie);
  // wyjątek = komunikat w oknie i wpisywanie od nowa, 423 = blokada (okno się zamyka).
  const pinState = { resolve: null, submit: null, digits: '', busy: false, lastFocus: null };
  const pinCard = document.querySelector('.pin-card');

  function renderPinDots() {
    $('pin-dots').replaceChildren(...Array.from({ length: PIN_LEN }, (_, i) => {
      const dot = document.createElement('i');
      if (i < pinState.digits.length) dot.className = 'on';
      return dot;
    }));
  }

  function pinDialog(o) {
    if (pinState.resolve) pinClose(null);
    return new Promise(resolve => {
      Object.assign(pinState, { resolve, submit: o.submit, digits: '', busy: false });
      $('pin-title').textContent = o.title;
      $('pin-text').textContent = o.text || '';
      $('pin-text').hidden = !o.text;
      $('pin-error').textContent = '';
      renderPinDots();
      if (!$('pin-modal').classList.contains('open')) pinState.lastFocus = document.activeElement;
      pageParts().forEach(el => { el.inert = true; });
      $('pin-modal').classList.add('open');
      $('pin-pad').querySelector('[data-key="5"]').focus({ preventScroll: true });
    });
  }

  function pinClose(result) {
    $('pin-modal').classList.remove('open');
    if (!$('modal').classList.contains('open') && !document.querySelector('.side-panel.open')) {
      pageParts().forEach(el => { el.inert = false; });
    }
    const r = pinState.resolve;
    pinState.resolve = null;
    if (pinState.lastFocus && pinState.lastFocus.focus && !$('modal').classList.contains('open')) {
      pinState.lastFocus.focus({ preventScroll: true });
    }
    if (r) r(result);
  }

  async function pinKey(k) {
    if (!pinState.resolve || pinState.busy) return;
    if (k === 'cancel') { pinClose(null); return; }
    if (k === 'delete') { pinState.digits = pinState.digits.slice(0, -1); renderPinDots(); return; }
    if (!/^\d$/.test(k) || pinState.digits.length >= PIN_LEN) return;
    pinState.digits += k;
    $('pin-error').textContent = '';
    renderPinDots();
    if (pinState.digits.length < PIN_LEN) return;
    const value = pinState.digits;
    pinState.busy = true;
    pinCard.classList.add('is-busy');
    try {
      await pinState.submit(value);
      pinClose(value);
    } catch (e) {
      if (e.status === 423) { pinClose(null); refreshSecurity(); return; }
      const left = e.data && e.data.remaining;
      $('pin-error').textContent = e.message + (left ? '. Pozostało prób: ' + left + '.' : '');
      pinState.digits = '';
      renderPinDots();
      pinCard.classList.remove('shake');
      void pinCard.offsetWidth;
      pinCard.classList.add('shake');
    } finally {
      pinState.busy = false;
      pinCard.classList.remove('is-busy');
    }
  }

  $('pin-pad').addEventListener('click', e => {
    const b = e.target.closest('[data-key]');
    if (b) pinKey(b.dataset.key);
  });
  $('pin-backdrop').addEventListener('click', () => pinKey('cancel'));
  pinCard.addEventListener('animationend', () => pinCard.classList.remove('shake'));
  document.addEventListener('keydown', e => {
    if (!$('pin-modal').classList.contains('open')) return;
    if (/^\d$/.test(e.key)) pinKey(e.key);
    else if (e.key === 'Backspace') pinKey('delete');
    else if (e.key === 'Escape') pinKey('cancel');
    else if (e.key === 'Tab') {                                // fokus krąży po klawiszach numpadu
      const keys = [...$('pin-pad').querySelectorAll('button')];
      const i = keys.indexOf(document.activeElement);
      keys[(i + (e.shiftKey ? -1 : 1) + keys.length) % keys.length].focus();
    } else return;
    e.preventDefault();
  });

  async function unlockPanel(text) {
    const pin = await pinDialog({
      title: 'Podaj PIN administratora',
      text: text || 'Panel odblokuje się na 5 minut od ostatniego dotknięcia ekranu.',
      submit: p => postJSON('/api/security/pin', { pin: p })
    });
    if (pin) { lastPing = Date.now(); await refreshSecurity(); }
    return !!pin;
  }

  /* --- 15c. Opcje administratora: na wyświetlaczu klik prosi o PIN, na telefonie użytkownika – okno o braku uprawnień --- */
  document.addEventListener('click', e => {
    const gate = e.target.closest('[data-admin]');
    if (!gate || isAdmin() || sec.no_security) return;
    if (gate.dataset.admin === 'phone' && sec.display) return;
    const ctrl = e.target.closest('button, label, input, .dd-trigger');
    if (!ctrl || !gate.contains(ctrl)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (sec.display) {
      unlockPanel('Ta opcja wymaga uprawnień administratora.').then(ok => { if (ok) ctrl.click(); });
    } else {
      noticeDialog({
        icon: 'lock', title: 'Brak uprawnień',
        text: 'Ta opcja wymaga urządzenia z uprawnieniami administratora.\nUprawnienia nadaje administrator: Ustawienia → Działanie → Urządzenia.'
      });
    }
  }, true);

  /* --- 15d. Blokada po 5 błędnych PIN-ach: licznik MM:SS:setne --- */
  let lockoutEnd = 0, lockoutHiddenFor = 0, lockoutFrame = null;
  const two = n => String(n).padStart(2, '0');

  function lockoutTick() {
    const ms = Math.max(0, lockoutEnd - performance.now());
    $('lockout-timer').textContent = two(Math.floor(ms / 60000)) + ':' + two(Math.floor(ms / 1000) % 60) + ':' + two(Math.floor(ms / 10) % 100);
    if (ms > 0 && !$('lockout').hidden) lockoutFrame = requestAnimationFrame(lockoutTick);
  }

  function renderLockout() {
    const left = sec.lockout || 0, box = $('lockout');
    box.classList.toggle('is-display', !!sec.display);   // wyświetlacz: czarny z bordowym akcentem w każdym motywie
    if (left <= 0) {
      box.hidden = true;
      lockoutEnd = 0;
      cancelAnimationFrame(lockoutFrame);
      clearTimeout(nap.lockoutTimer);
      return;
    }
    const end = performance.now() + left * 1000;
    if (!lockoutEnd || Math.abs(end - lockoutEnd) > 800) lockoutEnd = end;    // bez drgań licznika przy każdym odczycie
    const adminPhone = !sec.display && isAdmin();
    $('lockout-actions').hidden = !adminPhone;
    $('lockout-text').textContent = sec.display
      ? 'Pięć razy wpisano błędny PIN administratora. Panel odblokuje się sam za:'
      : 'Na wyświetlaczu ula pięć razy wpisano błędny PIN administratora. Ul odblokuje się sam za:';
    if (adminPhone && Math.abs(lockoutHiddenFor - lockoutEnd) < 2000) { box.hidden = true; return; }
    if (box.hidden) {
      box.hidden = false;
      if (pinState.resolve) pinClose(null);
      lockoutTick();
      if (sec.display) scheduleLockoutSleep();        // po 10 s ekran gaśnie; dotyk budzi na kolejne 10 s
    }
  }

  $('lockout-lift').addEventListener('click', async () => {
    try { await postJSON('/api/security/lift-lockout'); showPopup('Blokada zdjęta.', 4000, false); }
    catch (e) { showPopup('Nie udało się zdjąć blokady: ' + e.message, 6000, false); }
    refreshSecurity();
  });
  $('lockout-hide').addEventListener('click', () => {
    lockoutHiddenFor = lockoutEnd;
    $('lockout').hidden = true;
  });

  /* --- 15e. Parowanie (wyświetlacz): krok 1 Wi-Fi, krok 2 kod, potem decyzja --- */
  const wifiText = v => String(v).replace(/([\\;,:"])/g, '\\$1');
  const stickText = s => s.name + (s.size ? ', ' + (s.size / 1e9).toFixed(s.size < 1e10 ? 1 : 0).replace('.', ',') + ' GB' : '');

  function infoLine(label, value) {
    const row = document.createElement('div');
    row.className = 'qr-line';
    row.innerHTML = '<span class="setting-desc"></span><strong></strong>';
    row.firstChild.textContent = label;
    row.lastChild.textContent = value;
    return row;
  }

  function qrBox(text, label, lines) {
    const box = document.createElement('div');
    box.className = 'qr-box';
    const frame = document.createElement('div');
    frame.className = 'qr-frame';
    frame.appendChild(BeeQR.svg(text, label));
    const info = document.createElement('div');
    info.className = 'qr-info';
    lines.forEach(l => info.appendChild(l));
    box.append(frame, info);
    return box;
  }

  function toggleRow(label, hint, checked) {
    const row = document.createElement('label');
    row.className = 'modal-option';
    row.innerHTML = '<span><span class="setting-label"></span><span class="setting-desc"></span></span>'
      + '<span class="toggle-switch"><input type="checkbox"><span class="slider"></span></span>';
    row.querySelector('.setting-label').textContent = label;
    row.querySelector('.setting-desc').textContent = hint;
    const input = row.querySelector('input');
    input.checked = checked;
    return { row, input };
  }

  // Parowanie: wyświetlacz (Działanie → Sparuj, kafelek Parowanie) albo telefon administratora (Zasilanie)
  bindAction('btn-pair', () => pairStart());

  async function pairStart() {
    modalBusy('wifi', 'Wczytuję dane Wi-Fi…', '');
    let info;
    try { info = await getJSON('/api/pairing/wifi'); } catch (e) { info = { error: e.message }; }
    const w = info.wifi;
    const r = await askModal({
      icon: w ? false : 'wifi', wide: !!w,
      title: 'Krok 1 z 2: połącz telefon z Wi-Fi ula',
      text: w ? 'Zeskanuj kod aparatem telefonu albo wpisz dane ręcznie.'
        : info.error + '\nJeśli telefon jest już w sieci ula, przejdź dalej.',
      content: w ? qrBox('WIFI:T:WPA;S:' + wifiText(w.ssid) + ';P:' + wifiText(w.password) + ';;', 'Kod QR sieci Wi-Fi ula',
        [infoLine('Nazwa sieci', w.ssid), infoLine('Hasło', w.password)]) : null,
      buttons: [{ label: 'Anuluj', value: 'cancel' }, { label: 'Dalej', value: 'ok', kind: 'primary' }]
    });
    if (r.value !== 'ok') { modalClose(); return; }
    await pairCode();
  }

  async function pairCode() {
    modalBusy('phone', 'Tworzę kod parowania…', '');
    let code;
    try { code = await postJSON('/api/pairing/code'); }
    catch (e) { await noticeDialog({ icon: 'alert', danger: true, title: 'Nie udało się utworzyć kodu', text: e.message }); return; }
    const host = code.address.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const timeLine = infoLine('Kod ważny jeszcze', '');
    const box = qrBox(code.address, 'Kod QR parowania z ulem',
      [infoLine('Albo wejdź na', host), infoLine('i wpisz kod', code.digits.slice(0, 3) + ' ' + code.digits.slice(3)), timeLine]);
    box.querySelectorAll('strong')[1].classList.add('pair-digits');
    const end = Date.now() + code.seconds * 1000;
    const tick = () => {
      const s = Math.max(0, Math.round((end - Date.now()) / 1000));
      timeLine.lastChild.textContent = s ? Math.floor(s / 60) + ':' + two(s % 60) : 'kod wygasł – utwórz nowy';
    };
    tick();
    const timer = setInterval(tick, 1000);
    let watcher;
    const arrived = new Promise(res => {
      watcher = s => { if (s.request) res({ value: 'request', request: s.request }); };
      watchers.add(watcher);
    });
    const asked = askModal({
      icon: false, wide: true, title: 'Krok 2 z 2: sparuj telefon z ulem',
      text: 'Zeskanuj kod telefonem połączonym z Wi-Fi ula. Potem zatwierdzisz go tutaj.',
      content: box,
      buttons: [{ label: 'Anuluj', value: 'cancel' }, { label: 'Nowy kod', value: 'again' }]
    });
    const res = await Promise.race([asked, arrived]);
    clearInterval(timer);
    watchers.delete(watcher);
    if (res.value === 'again') return pairCode();
    if (res.value !== 'request') { postJSON('/api/pairing/cancel').catch(() => { }); modalClose(); return; }
    await pairDecision(res.request);
  }

  // Prośba o parowanie trafia naraz na wyświetlacz i na każdy telefon administratora (stan z serwera:
  // sec.request). Zatwierdzić może dowolne z nich; gdy decyzja zapadnie gdzie indziej, okno zamyka się samo
  // (sec.request znika, sec.decided mówi, jak skończyła się prośba). Gdy otwarte jest inne okno,
  // czekamy, aż się zamknie – urządzenie, które pokazuje kod parowania, przechodzi do decyzji samo.
  let pairShownId = null;
  watchers.add(s => {
    const p = s.request;
    if (!p || p.id === pairShownId || (s.lockout || 0) > 0) return;
    if ($('modal').classList.contains('open') || $('pin-modal').classList.contains('open')) return;
    pairDecision(p).catch(e => showPopup('Nie udało się: ' + e.message, 8000, false));
  });

  async function pairDecision(p) {
    pairShownId = p.id;
    if (nap.asleep) wakeScreen();                         // uśpiony wyświetlacz zapala się z prośbą
    const box = document.createElement('div');
    box.className = 'modal-toggles';
    const adm = toggleRow('Nadaj urządzeniu stałe uprawnienia administratora', 'Bez wymogu PIN-u, także zmiana PIN-u ula.', true);
    const rem = toggleRow('Zapamiętaj urządzenie', 'Wyłączone: ul zapomni urządzenie 10 minut po opuszczeniu strony lub rozłączeniu z siecią.', true);
    box.append(adm.row, rem.row);
    let watcher;
    const gone = new Promise(res => {
      watcher = s => { if (!s.request || s.request.id !== p.id) res({ value: 'gone', state: s }); };
      watchers.add(watcher);
    });
    const r = await Promise.race([askModal({
      icon: 'phone', title: 'Nowe urządzenie', text: '*' + p.name + '* chce połączyć się z ulem.', content: box,
      buttons: [{ label: 'Odrzuć', value: 'no' }, { label: 'Dodaj', value: 'ok', kind: 'primary' }]
    }), gone]);
    watchers.delete(watcher);
    if (r.value === 'gone') {                               // rozpatrzone na innym urządzeniu albo wygasło
      modalClose();
      const d = r.state.decided;
      showPopup(d && d.id === p.id
        ? (d.approved ? p.name + ' zostało dodane na innym urządzeniu.' : 'Odrzucono ' + p.name + ' na innym urządzeniu.')
        : 'Prośba o parowanie ' + p.name + ' wygasła.', 5000, false);
      return;
    }
    if (r.value !== 'ok' && r.value !== 'no') { modalClose(); return; }   // zamknięte tylko na tym urządzeniu
    const yes = r.value === 'ok', admin = adm.input.checked;
    // Wyświetlacz bez uprawnień administratora: najpierw PIN (decyzję serwer przyjmuje tylko od administratora)
    if (sec.display && !isAdmin() && !sec.no_security
      && !await unlockPanel('Decyzja o parowaniu wymaga uprawnień administratora.')) { modalClose(); return; }
    modalBusy('phone', yes ? 'Dodaję urządzenie…' : 'Odrzucam…', '');
    try {
      await postJSON('/api/pairing/decision', { request: p.id, approved: yes, admin, remember: rem.input.checked });
    } catch (e) {
      await noticeDialog({ icon: 'alert', danger: true, title: 'Nie udało się', text: e.message });
      return;
    }
    if (!yes) { modalClose(); showPopup('Odrzucono urządzenie ' + p.name + '.', 5000, false); return; }
    await noticeDialog({
      icon: 'check', title: 'Urządzenie sparowane',
      text: '*' + p.name + '* ma teraz dostęp do ula' + (admin ? ' z uprawnieniami administratora.' : ' (podgląd).')
    });
  }

  /* --- 15f. Urządzenia: panel wysuwany od prawej --- */
  const devicesPanel = $('devices-panel');

  function openDevices() {
    devicesPanel.classList.add('open');
    pageParts().forEach(el => { el.inert = true; });
    $('devices-close').focus({ preventScroll: true });
    return loadDevices();
  }
  function closeDevices() {
    devicesPanel.classList.remove('open');
    if (!$('modal').classList.contains('open')) pageParts().forEach(el => { el.inert = false; });
    $('btn-devices').focus({ preventScroll: true });
  }
  $('devices-close').addEventListener('click', closeDevices);
  $('devices-backdrop').addEventListener('click', closeDevices);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && devicesPanel.classList.contains('open') && !$('modal').classList.contains('open')
      && !$('pin-modal').classList.contains('open')) closeDevices();
  });

  function seenText(d) {
    if (d.last_seen) {
      const ago = Date.now() / 1000 - d.last_seen;
      return ago < 90 ? 'aktywne teraz' : 'ostatnio ' + new Date(d.last_seen * 1000).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });
    }
    return d.added ? 'dodane ' + d.added : '';
  }

  function iconButton(icon, label, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-btn ' + (cls || '');
    b.title = label;
    b.setAttribute('aria-label', label);
    b.innerHTML = '<svg viewBox="0 0 24 24">' + MODAL_ICONS[icon] + '</svg>';
    return b;
  }

  async function loadDevices() {
    const list = $('device-list');
    let data;
    try { data = await getJSON('/api/devices'); }
    catch (e) {
      const li = document.createElement('li');
      li.className = 'device-empty';
      li.textContent = 'Nie udało się pobrać listy: ' + e.message;
      list.replaceChildren(li);
      return;
    }
    if (!data.devices.length) {
      const li = document.createElement('li');
      li.className = 'device-empty';
      li.textContent = 'Brak zapamiętanych urządzeń. Telefon sparujesz na wyświetlaczu ula: Ustawienia → Działanie → Sparuj urządzenie.';
      list.replaceChildren(li);
      return;
    }
    list.replaceChildren(...data.devices.map(d => {
      const li = document.createElement('li');
      li.className = 'device-row' + (d.admin ? ' is-admin' : '');
      li.innerHTML = '<div class="ico"><svg viewBox="0 0 24 24">' + MODAL_ICONS.phone + '</svg></div>'
        + '<div class="device-text"><div class="setting-label"></div><div class="setting-desc"></div></div>';
      li.querySelector('.setting-label').textContent = d.name + (d.this_device ? ' (to urządzenie)' : '');
      li.querySelector('.setting-desc').textContent = [d.admin ? 'Administrator' : 'Podgląd', seenText(d)].filter(Boolean).join(' · ');
      // Korona = nadaj administratora, przekreślona korona = odbierz
      const crown = iconButton(d.admin ? 'crownOff' : 'crown', d.admin ? 'Odbierz uprawnienia administratora' : 'Nadaj uprawnienia administratora', 'crown-btn');
      const trash = iconButton('trash', 'Zapomnij urządzenie', 'trash-btn');
      crown.addEventListener('click', () => deviceAdmin(d));
      trash.addEventListener('click', () => deviceForget(d));
      li.append(crown, trash);
      return li;
    }));
  }

  async function deviceAdmin(d) {
    const ok = await confirmDialog({
      icon: d.admin ? 'crownOff' : 'crown',
      title: d.admin ? 'Odebrać uprawnienia administratora?' : 'Nadać uprawnienia administratora?',
      text: d.admin ? '*' + d.name + '* będzie mieć tylko podgląd ula.' : '*' + d.name + '* będzie mogło zmieniać wszystkie ustawienia ula bez PIN-u.',
      buttons: [{ label: 'Anuluj', value: 'cancel' }, { label: d.admin ? 'Odbierz' : 'Nadaj', value: 'ok', kind: 'primary' }]
    });
    if (!ok) return;
    modalClose();
    try { await postJSON('/api/devices/admin', { id: d.id, admin: !d.admin }); }
    catch (e) { showPopup('Nie udało się: ' + e.message, 6000, false); }
    if (d.this_device) await refreshSecurity();
    if (isAdmin()) loadDevices(); else closeDevices();
  }

  async function deviceForget(d) {
    const ok = await confirmDialog({
      icon: 'trash', danger: true, title: 'Zapomnieć urządzenie?',
      text: '*' + d.name + '* straci dostęp do ula i będzie musiało sparować się od nowa.',
      buttons: [{ label: 'Anuluj', value: 'cancel' }, { label: 'Zapomnij', value: 'ok', kind: 'danger' }]
    });
    if (!ok) return;
    modalClose();
    try { await postJSON('/api/devices/forget', { id: d.id }); }
    catch (e) { showPopup('Nie udało się: ' + e.message, 6000, false); return; }
    if (d.this_device) { location.replace('/'); return; }
    loadDevices();
  }

  bindAction('btn-devices', openDevices);

  /* --- 15g. Klucz (tylko wyświetlacz; jest tylko jeden port USB) --- */
  // Czeka, aż stan spełni warunek (np. wpięty pendrive). Okno z kręciołkiem i "Anuluj" -> wartość albo null.
  function waitFor(o, test) {
    return new Promise(resolve => {
      let done = false;
      const finish = v => { if (done) return; done = true; watchers.delete(w); resolve(v); };
      const w = s => { const v = test(s); if (v) finish(v); };
      askModal({ ...o, busy: true, buttons: [{ label: 'Anuluj', value: 'cancel' }] }).then(() => finish(null));
      watchers.add(w);
      w(sec);
    });
  }

  async function keyStep(fn) {                     // operacja na Kluczu: bez powiadomień o wpięciu / wyjęciu
    keyFlow = true;
    try { await fn(); }
    finally {
      await refreshSecurity();
      keyFlow = false;
      if (sec.key) lastKeyEvent = sec.key.event;
    }
  }

  bindAction('btn-key', async () => {
    const k = sec.key || {};
    const r = await askModal({
      icon: 'usb', title: 'Klucz',
      text: !k.set ? 'Brak Klucza. Klucz to pendrive, który zastępuje PIN administratora: wpięty daje panelowi uprawnienia administratora i zdejmuje blokadę.'
        : k.inserted ? 'Klucz jest ustawiony i wpięty – panel ma uprawnienia administratora.'
          : 'Klucz jest ustawiony. Wpięty Klucz daje panelowi uprawnienia administratora i zdejmuje blokadę.',
      buttons: k.set
        ? [{ label: 'Zamknij', value: 'cancel' }, { label: 'Unieważnij', value: 'revoke', kind: 'danger' }, { label: 'Duplikuj', value: 'dup', kind: 'primary' }]
        : [{ label: 'Zamknij', value: 'cancel' }, { label: 'Utwórz Klucz', value: 'create', kind: 'primary' }]
    });
    if (r.value === 'create') return keyStep(keyCreate);
    if (r.value === 'dup') return keyStep(keyDuplicate);
    if (r.value === 'revoke') return keyStep(keyRevoke);
    modalClose();
  });

  async function keyCreate() {
    const stick = await waitFor({ icon: 'usb', title: 'Wepnij pendrive', text: 'Wepnij pendrive, który ma zostać Kluczem. Pozostałe pliki na nim zostaną.' },
      s => (s.usb || [])[0]);
    if (!stick) { modalClose(); return; }
    const ok = await confirmDialog({
      icon: 'usb', title: 'Zapisać Klucz?', text: 'Zapisać Klucz na pendrive *' + stickText(stick) + '*?\nPozostałe pliki na nim zostaną.',
      buttons: [{ label: 'Anuluj', value: 'cancel' }, { label: 'Zapisz Klucz', value: 'ok', kind: 'primary' }]
    });
    if (!ok) return;
    modalBusy('usb', 'Zapisuję Klucz…', 'Nie wyjmuj pendrive\'a.');
    let res;
    try { res = await postJSON('/api/key/create', { pendrive: stick.name }); }
    catch (e) { await noticeDialog({ icon: 'alert', danger: true, title: 'Nie udało się utworzyć Klucza', text: e.message }); return; }
    // Serwer po zapisie bezpiecznie odłącza pendrive (safe_eject w app.py) – inaczej tani pendrive gubił zapis
    await noticeDialog({ icon: 'check', title: 'Klucz utworzony', text: (res && res.removed
      ? 'Pendrive został bezpiecznie odłączony – wyjmij go. Po ponownym wpięciu panel ma uprawnienia administratora.'
      : 'Odczekaj kilka sekund przed wyjęciem pendrive\'a. Dopóki jest wpięty, panel ma uprawnienia administratora.')
      + '\nPrzechowuj go w bezpiecznym miejscu.' });
  }

  async function keyDuplicate() {
    const cancel = () => { postJSON('/api/key/duplicate/cancel').catch(() => { }); modalClose(); };
    if (!(sec.key || {}).inserted) {
      const ok = await waitFor({ icon: 'usb', title: 'Wepnij oryginalny Klucz', text: 'Najpierw wepnij Klucz, który chcesz zduplikować.' },
        s => s.key && s.key.inserted);
      if (!ok) { modalClose(); return; }
    }
    try { await postJSON('/api/key/duplicate/start'); }
    catch (e) { await noticeDialog({ icon: 'alert', danger: true, title: 'Nie udało się', text: e.message }); return; }
    const out = await waitFor({ icon: 'usb', title: 'Wyjmij oryginalny Klucz', text: 'Klucz został sprawdzony. Wyjmij go teraz – w jego miejsce wepniesz pendrive na kopię.' },
      s => !(s.usb || []).length);
    if (!out) { cancel(); return; }
    const stick = await waitFor({ icon: 'usb', title: 'Wepnij pendrive na kopię', text: 'Wepnij pendrive, na który ma trafić kopia Klucza. Pozostałe pliki na nim zostaną.' },
      s => (s.usb || []).find(x => x.key !== 'valid'));
    if (!stick) { cancel(); return; }
    const ok = await confirmDialog({
      icon: 'usb', title: 'Skopiować Klucz?', text: 'Skopiować Klucz na pendrive *' + stickText(stick) + '*?\nPozostałe pliki na nim zostaną.',
      buttons: [{ label: 'Anuluj', value: 'cancel' }, { label: 'Skopiuj Klucz', value: 'ok', kind: 'primary' }]
    });
    if (!ok) { cancel(); return; }
    modalBusy('usb', 'Kopiuję Klucz…', 'Nie wyjmuj pendrive\'a.');
    let res;
    try { res = await postJSON('/api/key/duplicate/write', { pendrive: stick.name }); }
    catch (e) { await noticeDialog({ icon: 'alert', danger: true, title: 'Nie udało się skopiować Klucza', text: e.message }); return; }
    await noticeDialog({ icon: 'check', title: 'Kopia Klucza utworzona', text: (res && res.removed
      ? 'Pendrive został bezpiecznie odłączony – możesz go wyjąć.'
      : 'Odczekaj kilka sekund przed wyjęciem pendrive\'a.')
      + '\nOba pendrive\'y działają jako Klucz. Unieważnienie Klucza wyłącza wszystkie kopie naraz.' });
  }

  async function keyRevoke() {
    const ok = await confirmDialog({
      icon: 'usb', danger: true, title: 'Unieważnić Klucz?',
      text: '*Wszystkie* kopie Klucza przestaną działać. Do czasu utworzenia nowego działa tylko PIN.',
      buttons: [{ label: 'Anuluj', value: 'cancel' }, { label: 'Unieważnij', value: 'ok', kind: 'danger' }]
    });
    if (!ok) return;
    modalBusy('usb', 'Unieważniam Klucz…', '');
    try { await postJSON('/api/key/revoke'); await refreshSecurity(); }
    catch (e) { await noticeDialog({ icon: 'alert', danger: true, title: 'Nie udało się', text: e.message }); return; }
    const r = await askModal({
      icon: 'check', title: 'Klucz unieważniony', text: 'Utworzyć nowy Klucz teraz? Możesz użyć tego samego pendrive\'a.',
      buttons: [{ label: 'Później', value: 'cancel' }, { label: 'Utwórz nowy', value: 'ok', kind: 'primary' }]
    });
    if (r.value === 'ok') return keyCreate();
    modalClose();
  }

  /* --- 15h. Zmiana PIN-u i odłączenie telefonu --- */
  // Wyświetlacz z Kluczem i telefon administratora – bez starego PIN-u; wyświetlacz bez Klucza – ze starym.
  bindAction('btn-pin', async () => {
    let old = null;
    if (sec.display && !(sec.key || {}).inserted) {
      old = await pinDialog({ title: 'Podaj obecny PIN', text: 'Bez Klucza zmiana PIN-u wymaga obecnego PIN-u.', submit: p => postJSON('/api/security/pin', { pin: p }) });
      if (!old) return;
      lastPing = Date.now();
    }
    const first = await pinDialog({ title: 'Nowy PIN', text: 'Wpisz nowy PIN (' + PIN_LEN + ' cyfr).', submit: async () => true });
    if (!first) return;
    const second = await pinDialog({
      title: 'Powtórz nowy PIN', text: 'Wpisz nowy PIN jeszcze raz.',
      submit: async p => { if (p !== first) throw new Error('PIN-y się różnią. Wpisz nowy PIN ponownie'); }
    });
    if (!second) return;
    await postJSON('/api/security/change-pin', { old: old, new: first });
    refreshSecurity();
    showPopup('PIN administratora został zmieniony.', 5000, false);
  });

  bindAction('btn-leave', async () => {
    const ok = await confirmDialog({
      icon: 'phone', danger: true, title: 'Odłączyć od ula?',
      text: 'To urządzenie straci dostęp do ula. Żeby wrócić, trzeba je ponownie sparować na wyświetlaczu ula.',
      buttons: [{ label: 'Anuluj', value: 'cancel' }, { label: 'Odłącz', value: 'ok', kind: 'danger' }]
    });
    if (!ok) return;
    modalClose();
    await postJSON('/api/devices/leave');
    location.replace('/');
  });

  setInterval(refreshSecurity, AUTH.display ? 1000 : 2000);

  /* ===== 16. SZYBKI KONFIGURATOR po sparowaniu (karty przesuwane jak przy konfiguracji iPhone'a) ===== */
  // Skrót na ekranie głównym (karta 2 konfiguratora i O aplikacji). Ul działa na http, a przeglądarki pozwalają
  // stronie samej zaproponować instalację (beforeinstallprompt) tylko na https – zwykle więc okno mówi, gdzie stuknąć.
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });
  const openedFromHomeScreen = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  async function addToHomeScreen() {
    if (installPrompt) {
      const p = installPrompt;
      installPrompt = null;
      p.prompt();
      try { await p.userChoice; } catch (e) { }
      return;
    }
    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);   // iPad udaje Maca
    let text;
    if (openedFromHomeScreen()) text = 'Ta strona jest już otwarta ze skrótu na ekranie głównym.';
    else if (ios) {
      // Klucz przeniesienia w pasku adresu – na wypadek gdyby iOS wziął do ikony bieżący adres, a nie ten z manifestu
      const t = (window.BEENEST_DEVICE || {}).transfer;
      if (t) history.replaceState(null, '', '/?transfer=' + encodeURIComponent(t) + location.hash);
      text = 'Stuknij przycisk *Udostępnij* (kwadrat ze strzałką w górę), wybierz *Do ekranu początkowego*,'
      + ' a potem *Dodaj*.\nNa ekranie pojawi się pszczółka BEENest.';
    } else if (/Android/.test(ua)) text = 'Stuknij menu ⋮ w prawym górnym rogu przeglądarki, wybierz'
      + ' *Dodaj do ekranu głównego*, a potem *Utwórz skrót*.\nNa ekranie pojawi się pszczółka BEENest.';
    else text = 'Otwórz menu przeglądarki i wybierz *Zainstaluj stronę jako aplikację* albo *Utwórz skrót*.'
      + '\nMożesz też przeciągnąć adres z paska przeglądarki na pulpit.';
    await noticeDialog({ icon: 'phone', title: 'Dodaj do ekranu głównego', text });
  }
  $('btn-home-screen').addEventListener('click', addToHomeScreen);

  // Plik .apk z ula: O aplikacji (Android w przeglądarce) i konfigurator
  function apkHelp() {
    setTimeout(() => noticeDialog({ icon: 'phone', title: 'Instalacja aplikacji',
      text: 'Po pobraniu otwórz plik *beenest.apk*. Android zapyta o zgodę na instalowanie aplikacji z przeglądarki – zezwól i stuknij *Zainstaluj*.' }), 300);
  }
  // Android w przeglądarce: TYLKO aplikacja; skrót – pozostałe telefony (w aplikacji i na wyświetlaczu żadne)
  const offerApk = IS_ANDROID_BROWSER && !!device.apk;
  $('apk-row').hidden = !offerApk;
  $('shortcut-row').hidden = offerApk || !!APP || AUTH.display;
  $('btn-apk').href = '/static/beenest.apk';
  $('btn-apk').addEventListener('click', apkHelp);

  // Karta 1 to prawdziwa zakładka Wygląd, przeniesiona na chwilę z Ustawień (te same pola i ten sam zapis),
  // karta 2 proponuje skrót na ekranie głównym (pomijana, gdy strona już jest otwarta ze skrótu), karta 3 potwierdza.
  // Wygląd przesuwania: style.css -> .setup-card.
  function openSetup() {
    const setup = $('setup'), panel = $('settings-appearance');
    const home = panel.parentNode, after = panel.nextSibling, wasActive = panel.classList.contains('active');
    $('setup-appearance').appendChild(panel);
    panel.classList.add('active');
    $('setup-done-text').textContent = 'Twoje ustawienia wyglądu zostały zapisane na urządzeniu i możesz już '
      + (AUTH.level === 'admin' ? 'swobodnie zarządzać swoją pasieką.' : 'obserwować dane i informacje o pasiece.');
    const cards = [...setup.querySelectorAll('.setup-card')];
    const show = i => cards.forEach((card, n) => {
      card.classList.toggle('is-past', n < i);
      card.classList.toggle('is-next', n > i);
      card.inert = n !== i;
    });
    show(0);
    setup.hidden = false;
    const showDone = () => {
      show(2);
      $('setup-finish').focus({ preventScroll: true });
    };
    const apk = IS_ANDROID_BROWSER && device.apk;
    $('setup-home-apk').hidden = !apk;
    $('setup-home-add').hidden = !!apk;
    if (apk) {
      $('setup-home-apk').href = '/static/beenest.apk';
      $('setup-home-first').textContent = 'Zainstaluj aplikację BEENest na swoim telefonie.';
      $('setup-home-apk').onclick = () => { apkHelp(); showDone(); };
    }
    $('setup-next').onclick = () => {
      closeDropdown();
      if (openedFromHomeScreen() || APP) { showDone(); return; }
      show(1);
      (apk ? $('setup-home-apk') : $('setup-home-add')).focus({ preventScroll: true });
    };
    $('setup-home-add').onclick = async () => { await addToHomeScreen(); showDone(); };
    $('setup-home-later').onclick = showDone;
    $('setup-finish').onclick = () => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        setup.hidden = true;
        setup.classList.remove('is-closing');
        home.insertBefore(panel, after);          // zakładka Wygląd wraca do Ustawień
        panel.classList.toggle('active', wasActive);
      };
      setup.addEventListener('animationend', e => { if (e.target === setup) finish(); });
      setTimeout(finish, 1500);                   // gdyby animacja się nie odpaliła
      setup.classList.add('is-closing');
    };
  }

  /* ===== 17. INIT ===== */
  applySecurity(AUTH);
  applySettingsToUI();
  applyCamera(settings.camera);     // rysuje stronę i od razu odpytuje serwer
  if (firstVisit) pushSettings({ theme: settings.theme, highContrast: settings.highContrast });
  migrateBrowserSettings();
  let setupWanted = false;
  try { setupWanted = sessionStorage.getItem('beenest-setup') === '1'; sessionStorage.removeItem('beenest-setup'); } catch (e) { }
  if (setupWanted && !AUTH.display) openSetup();

  /* ===== 18. APLIKACJA NA ANDROIDA: gest cofania i odświeżanie wyglądu ===== */
  // Aplikacja pyta stronę, czy ma co cofnąć (setCanGoBack); jeśli nie – gest obsługuje system (wyjście z aplikacji).
  // Kolejność jak Escape: klawiatura numeryczna, PIN, okno, lista rozwijana, panel boczny, kamera, podstrona.
  if (APP) {
    const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    const backAction = () => {
      const numpadLayer = document.querySelector('.numpad-layer');
      if (numpadLayer) return { el: numpadLayer.querySelector('.numpad'), run: () => numpadLayer.querySelector('[data-key="cancel"]').click() };
      if ($('pin-modal').classList.contains('open')) return { el: $('pin-modal').querySelector('.modal-card'), run: escape };
      if ($('modal').classList.contains('open')) return { el: $('modal-card'), run: escape };
      const menu = document.querySelector('.dd-menu.open');
      if (menu) return { el: menu, run: escape };
      const side = document.querySelector('.side-panel.open');
      if (side) return { el: side.querySelector('.side-card'), run: escape };
      if (!$('setup').hidden) return null;
      if (document.querySelector('.cam-max')) return { el: null, run: escape };
      if (settingsBox.classList.contains('is-detail')) return { el: document.querySelector('.settings-content'), run: () => closeSettingsDetail() };
      if ((location.hash || '#home') !== '#home') return { el: document.querySelector('.page.active'), run: () => { location.hash = '#home'; } };
      return null;
    };

    let sent = null, queued = false;
    const syncBack = () => {
      queued = false;
      const can = !!backAction();
      if (can !== sent) { sent = can; try { window.BeeNestAndroid.setCanGoBack(can); } catch (e) { } }
    };
    const queueSync = () => { if (!queued) { queued = true; requestAnimationFrame(syncBack); } };
    new MutationObserver(queueSync).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    window.addEventListener('hashchange', queueSync);
    syncBack();

    // Przewidujące cofanie (Android 14+): element przesuwa się od krawędzi gestu i lekko maleje
    let gesture = null;
    const resetEl = (el, animate) => {
      if (!el) return;
      el.style.transition = animate ? 'transform .25s var(--anim-ease)' : '';
      el.style.transform = '';
      if (animate) setTimeout(() => { el.style.transition = ''; }, 300);
    };
    window.BeeNestApp = {
      backStart(dir) {
        const a = backAction();
        gesture = { dir, el: a && a.el };
        if (gesture.el) { gesture.el.style.transition = 'none'; gesture.el.style.transformOrigin = dir > 0 ? '100% 50%' : '0 50%'; }
      },
      backProgress(p) {
        if (gesture && gesture.el) gesture.el.style.transform = 'translateX(' + (gesture.dir * p * 32) + 'px) scale(' + (1 - p * 0.1) + ')';
      },
      backCancel() { if (gesture) resetEl(gesture.el, true); gesture = null; },
      backInvoke() {
        if (gesture) resetEl(gesture.el, false);
        gesture = null;
        const a = backAction();
        if (a) a.run();
        queueSync();
      },
      // Zmiana trybu ciemnego, kolorów telefonu albo wcięć ekranu
      update() { const info = readApp(); if (info) APP.dark = info.dark; applyAppLook(info); reportThemeToApp(); }
    };
  }
})();
