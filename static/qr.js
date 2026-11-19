/* =====================================================
   BEENest — qr.js
   window.BeeQR: własny generator kodów QR (bez bibliotek).
   Tryb bajtowy (UTF-8), poziom korekcji M, wersje 1–10 (do ok. 210 znaków) – wystarczy na
   adres parowania i dane Wi-Fi. Kolory rysunku są w style.css (.qr-bg, .qr-dot), więc kod
   przyjmuje barwy motywu.
   ===================================================== */
(function () {
  "use strict";

  // Poziom korekcji M: kody korekcyjne w jednym bloku i liczba bloków (indeks = wersja)
  const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
  const BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
  const MAX_VERSION = 10;

  // Liczba modułów na dane i korekcję (bez wzorów stałych) w danej wersji
  function rawModules(ver) {
    let r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const n = Math.floor(ver / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  const dataCodewords = ver => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * BLOCKS[ver];

  // Mnożenie w ciele GF(256) (wielomian 0x11D) i kod Reeda–Solomona
  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function rsDivisor(degree) {
    const r = new Array(degree).fill(0);
    r[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        r[j] = gfMul(r[j], root);
        if (j + 1 < degree) r[j] ^= r[j + 1];
      }
      root = gfMul(root, 2);
    }
    return r;
  }
  function rsRemainder(data, divisor) {
    const r = divisor.map(() => 0);
    data.forEach(b => {
      const factor = b ^ r.shift();
      r.push(0);
      divisor.forEach((c, i) => { r[i] ^= gfMul(c, factor); });
    });
    return r;
  }

  function alignPositions(ver, size) {
    if (ver === 1) return [];
    const n = Math.floor(ver / 7) + 2;
    const step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    const r = [6];
    for (let pos = size - 7; r.length < n; pos -= step) r.splice(1, 0, pos);
    return r;
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => x * y % 2 + x * y % 3 === 0,
    (x, y) => (x * y % 2 + x * y % 3) % 2 === 0,
    (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0
  ];

  // Uproszczona ocena maski (długie serie, kwadraty 2×2, równowaga ciemnych i jasnych)
  function penalty(m, n) {
    let score = 0, dark = 0;
    for (let a = 0; a < n; a++) {
      let runRow = 1, runCol = 1;
      for (let b = 1; b <= n; b++) {
        if (b < n && m[a][b] === m[a][b - 1]) runRow++; else { if (runRow >= 5) score += runRow - 2; runRow = 1; }
        if (b < n && m[b][a] === m[b - 1][a]) runCol++; else { if (runCol >= 5) score += runCol - 2; runCol = 1; }
      }
    }
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (m[y][x]) dark++;
        if (x < n - 1 && y < n - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
      }
    }
    const k = Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1;
    return score + Math.max(0, k) * 10;
  }

  // Tekst -> macierz modułów (true = ciemny). forceMask tylko do testów.
  function encode(text, forceMask) {
    const bytes = Array.from(new TextEncoder().encode(text));
    let ver = 1;
    while (ver <= MAX_VERSION && 4 + (ver < 10 ? 8 : 16) + bytes.length * 8 > dataCodewords(ver) * 8) ver++;
    if (ver > MAX_VERSION) throw new Error('Za dużo danych na kod QR');

    // Bity danych: tryb bajtowy, długość, bajty, zakończenie, dopełnienie
    const bits = [];
    const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
    put(4, 4);
    put(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach(b => put(b, 8));
    const cap = dataCodewords(ver) * 8;
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (let pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      data.push(b);
    }

    // Bloki z korekcją i przeplot
    const nb = BLOCKS[ver], ecLen = ECC_PER_BLOCK[ver], raw = Math.floor(rawModules(ver) / 8);
    const nShort = nb - raw % nb, shortLen = Math.floor(raw / nb), div = rsDivisor(ecLen);
    const blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const len = shortLen - ecLen + (i < nShort ? 0 : 1);
      const dat = data.slice(k, k + len);
      k += len;
      const ecc = rsRemainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const words = [];
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((b, j) => { if (i !== shortLen - ecLen || j >= nShort) words.push(b[i]); });
    }

    // Macierz i wzory stałe
    const size = ver * 4 + 17;
    const mod = Array.from({ length: size }, () => new Array(size).fill(false));
    const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => { mod[y][x] = dark; fixed[y][x] = true; };

    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(([cx, cy]) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    });
    const al = alignPositions(ver, size), last = al.length - 1;
    al.forEach((ax, i) => al.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }));

    function drawFormat(mask) {
      const fmt = (0 << 3) | mask;           // 0 = poziom korekcji M
      let rem = fmt;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const f = ((fmt << 10) | rem) ^ 0x5412, bit = i => ((f >>> i) & 1) === 1;
      for (let i = 0; i <= 5; i++) set(8, i, bit(i));
      set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
      for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
      for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
      for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
      set(8, size - 8, true);
    }
    drawFormat(0);                          // rezerwuje miejsce (właściwa maska niżej)
    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      const v = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const dark = ((v >>> i) & 1) === 1, a = size - 11 + i % 3, b = Math.floor(i / 3);
        set(a, b, dark); set(b, a, dark);
      }
    }

    // Dane wężykiem od prawego dolnego rogu, po dwie kolumny
    let n = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - v : v;
        if (!fixed[y][x] && n < words.length * 8) {
          mod[y][x] = ((words[n >>> 3] >>> (7 - (n & 7))) & 1) === 1;
          n++;
        }
      }
    }

    const applyMask = m => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y][x] && MASKS[m](x, y)) mod[y][x] = !mod[y][x];
    };
    let best = forceMask;
    if (best === undefined) {
      let bestScore = Infinity;
      for (let m = 0; m < 8; m++) {
        applyMask(m); drawFormat(m);
        const s = penalty(mod, size);
        if (s < bestScore) { best = m; bestScore = s; }
        applyMask(m);
      }
    }
    applyMask(best);
    drawFormat(best);
    return mod;
  }

  // Kod QR jako <svg> (z marginesem 4 modułów). Kolory: style.css -> .qr-bg, .qr-dot
  function svg(text, label) {
    const m = encode(text), size = m.length, full = size + 8;
    let d = '';
    m.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += 'M' + (x + 4) + ' ' + (y + 4) + 'h1v1h-1z'; }));
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    el.setAttribute('viewBox', '0 0 ' + full + ' ' + full);
    el.setAttribute('class', 'qr');
    el.setAttribute('shape-rendering', 'crispEdges');
    el.setAttribute('role', 'img');
    if (label) el.setAttribute('aria-label', label);
    el.innerHTML = '<rect class="qr-bg" width="' + full + '" height="' + full + '"/><path class="qr-dot" d="' + d + '"/>';
    return el;
  }

  window.BeeQR = { encode, svg };
})();
