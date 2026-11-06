/* =====================================================
   BEENest — app.js
   ===================================================== */
(function () {
  "use strict";

  /* ===== 1. USTAWIENIA ===== */
  const defaultSettings = {
    theme: 'bialy-pylek',
    highContrast: true,
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

  let settings = Object.assign({}, defaultSettings, JSON.parse(localStorage.getItem('beenest-settings')) || {});
  function saveSettings() { localStorage.setItem('beenest-settings', JSON.stringify(settings)); }

  function applySettingsToUI() {
    document.body.setAttribute('data-theme', settings.theme);
    document.body.setAttribute('data-contrast', settings.highContrast ? 'high' : 'normal');

    const q = id => document.getElementById(id);
    if (q('theme-select')) q('theme-select').value = settings.theme;
    if (q('contrast-toggle')) q('contrast-toggle').checked = settings.highContrast;
    if (q('atmo-data-select')) q('atmo-data-select').value = settings.atmoData;
    if (q('temp-highlight-select')) q('temp-highlight-select').value = settings.tempHighlight;
    if (q('temp-range-select')) q('temp-range-select').value = settings.tempRange;
    if (q('wellbeing-data-select')) q('wellbeing-data-select').value = settings.wellbeingData;
    if (q('feeder-data-select')) q('feeder-data-select').value = settings.feederData;
    if (q('save-interval-select')) q('save-interval-select').value = settings.saveInterval;
    if (q('data-retention-select')) q('data-retention-select').value = settings.dataRetention;
    if (q('feeder-rate-toggle')) q('feeder-rate-toggle').checked = settings.feederRate;
    if (q('feeder-alarm-toggle')) q('feeder-alarm-toggle').checked = settings.feederAlarm;
  }

  function bindSetting(id, key, isCheckbox = false) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', e => {
      settings[key] = isCheckbox ? e.target.checked : e.target.value;
      saveSettings();
      if (key === 'theme' || key === 'highContrast') {
        document.body.setAttribute('data-theme', settings.theme);
        document.body.setAttribute('data-contrast', settings.highContrast ? 'high' : 'normal');
      }
    });
  }
  bindSetting('theme-select', 'theme');
  bindSetting('contrast-toggle', 'highContrast', true);
  bindSetting('atmo-data-select', 'atmoData');
  bindSetting('temp-highlight-select', 'tempHighlight');
  bindSetting('temp-range-select', 'tempRange');
  bindSetting('wellbeing-data-select', 'wellbeingData');
  bindSetting('feeder-data-select', 'feederData');
  bindSetting('save-interval-select', 'saveInterval');
  bindSetting('data-retention-select', 'dataRetention');
  bindSetting('feeder-rate-toggle', 'feederRate', true);
  bindSetting('feeder-alarm-toggle', 'feederAlarm', true);

  /* ===== 2. ZAKŁADKI USTAWIEŃ ===== */
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
      const target = document.getElementById(tab.getAttribute('data-target'));
      if (target) target.classList.add('active');
    });
  });

  /* ===== 3. ZEGAR ===== */
  const months = ["stycznia","lutego","marca","kwietnia","maja","czerwca","lipca","sierpnia","września","października","listopada","grudnia"];
  function updateDateTime() {
    const now = new Date();
    const d = now.getDate(), m = months[now.getMonth()], y = now.getFullYear();
    const h = String(now.getHours()).padStart(2,'0');
    const mi = String(now.getMinutes()).padStart(2,'0');
    const s = String(now.getSeconds()).padStart(2,'0');
    document.getElementById('datetime').textContent = `dziś jest ${d} ${m} ${y}, ${h}:${mi}:${s}`;
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
    document.getElementById('greeting-text').textContent = text;
  }
  setGreeting();
  setInterval(setGreeting, 60000);

  /* ===== 5. ROUTING ===== */
  const pages = Array.from(document.querySelectorAll(".page"));
  function route() {
    const id = (location.hash || "#home").slice(1);
    const page = document.getElementById(id) || document.getElementById("home");
    pages.forEach(p => p.classList.toggle("active", p === page));
    window.scrollTo({ top: 0, behavior: "auto" });
  }
  window.addEventListener("hashchange", route);
  route();

  /* ===== 6. KAMERA (dock) ===== */
  function applyCamera(cam) {
    settings.camera = cam;
    saveSettings();
    document.querySelectorAll('.camera-dock-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.camera === cam);
    });
    const status = document.getElementById('m-status');
    if (status) {
      status.textContent = cam === 'external' ? 'Zewnętrzna' : 'Wewnętrzna';
    }
  }
  document.querySelectorAll('.camera-dock-btn').forEach(btn => {
    btn.addEventListener('click', () => applyCamera(btn.dataset.camera));
  });

  /* ===== 7. API dla Pythona ===== */
  window.BEENest = {
    set(id, value) {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    },
    setBar(id, percent) {
      const el = document.getElementById(id);
      if (!el) return;
      const v = Math.max(0, Math.min(100, Number(percent) || 0));
      el.style.width = v + "%";
      this.set("f-level-label", Math.round(v));
    },
    data(obj) {
      if (!obj || typeof obj !== "object") return;
      Object.keys(obj).forEach(k => {
        const value = obj[k];
        if (k === "feeder_bar") { this.setBar("feeder-bar", value); return; }
        if (k === "f_level") {
          this.set("f_level", value);
          this.set("dash-feeder", value);
          this.set("dash-feeder-compact", value + " %");
          this.setBar("feeder-bar", value);
          return;
        }
        if (k === "temp_current") { this.set("dash-temp-in", value); this.set("dash-temp-compact", value + " °C"); }
        if (k === "temp_outside") { this.set("dash-temp-out", value); }
        if (k === "w_status") { this.set("dash-wellbeing", value); this.set("dash-wellbeing-compact", value); }
        if (k === "w_frequency") { this.set("dash-freq-large", value); }
        this.set(k, value);
      });
    }
  };

  /* ===== 8. POLLING ===== */
  let busy = false;
  async function poll() {
    if (busy) return;
    busy = true;
    try {
      const res = await fetch("/api/data", { cache: "no-store" });
      if (res.ok) window.BEENest.data(await res.json());
    } catch (e) { } finally { busy = false; }
  }
  poll();
  setInterval(poll, 5000);

  /* ===== 9. INIT ===== */
  applySettingsToUI();
  applyCamera(settings.camera);
})();