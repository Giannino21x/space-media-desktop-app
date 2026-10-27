// The island's UI: hidden → compact (288×32) → open (640 × view height), the SPACE face, the views
// (overview, approval, ask, drop, file, mail, settings, note, greeting). Geometry and timing after Coucou for
// Windows (MIT code): growing on a spring (response 0.5 s, damping 0.72), shrinking on a 340 ms curve; compact folds
// away 60 s after the pointer left, the open island 15 s after (a 2 px countdown in the last 9 s); waiting cards pin.
// Data comes from main (insel.js) as `lage`; actions go back through window.spaceInsel.

(function () {
  const bruecke = window.spaceInsel || null;
  const demo = !bruecke || new URLSearchParams(location.search).get('demo') === '1';
  const api = bruecke || demoBruecke();
  const S = window.SpaceSymbole;
  const K = window.SpaceKlang;
  const G = window.SpaceGesicht;
  const $ = (id) => document.getElementById(id);
  const insel = $('insel');
  const PANEL = 720;
  const OFFEN_B = 640;
  const reduziert = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const HOEHE = { uebersicht: 160, freigabe: 160, fragen: 160, ablage: 176, datei: 176, mail: 240, einstellungen: 228, hinweis: 160, begruessung: 150 };
  const TITEL = { uebersicht: '', freigabe: 'Freigabe', fragen: 'SPACE fragen', ablage: 'Datei ablegen', datei: '', mail: 'Per Mail senden', einstellungen: 'Insel', hinweis: '', begruessung: '' };
  const KOMPAKT_ZU_MS = 60_000;
  const OFFEN_ZU_MS = 15_000;
  const HOVER_ZU_MS = 600;
  const COUNTDOWN_MS = 9_000;

  // ---------------------------------------------------------------- state
  const st = {
    modus: 'versteckt',
    ansicht: 'uebersicht',
    gepinnt: false,
    durchHover: false,
    interagiert: false,
    drin: false,
    zeiger: null,
    lage: null,
    einstellungen: { diktat: true, toene: true, hoverOeffnen: false, begruesst: true },
    gesehenFreigaben: new Set(),
    gesehenLaeufe: new Set(),
    gemeldet: new Set(),
    ersteLage: true,
    geladen: false,          // the first real answer from the app arrived (approvals then are not «new»)
    meldung: null,           // { text, art, bis }
    diktat: 'aus',
    datei: null,             // { name, type, daten, base64 }
    freigabeSeit: 0,
    botWahl: null,
    begruessungBis: 0,
  };
  const uhren = {};
  const uhr = (name, ms, fn) => {
    clearTimeout(uhren[name]);
    uhren[name] = ms == null ? undefined : setTimeout(() => { uhren[name] = undefined; fn(); }, ms);
  };
  const laeuft = (name) => uhren[name] !== undefined;

  // ---------------------------------------------------------------- icons
  for (const b of document.querySelectorAll('[data-tab]')) b.innerHTML = S[b.dataset.tab];
  $('f-zu').innerHTML = S.zuklappen;
  $('q-senden').innerHTML = S.senden;
  $('d-ok').innerHTML = S.check;
  $('m-datei').innerHTML = S.datei + '<span></span>';

  // ---------------------------------------------------------------- faces
  const gesichtKlein = G.erstellen($('gesicht-klein'), { groesse: 24, rahmen: 'eng' });
  const grossCanvas = $('gesicht-gross');
  const GROSS = 110; // canvas size of the big face; scaled down per view, never up
  const gesichtGross = G.erstellen(grossCanvas, { groesse: GROSS, beiHerzen: () => K.spielen('herz') });
  const schein = $('schein');
  const fg = { x: 68, y: 100, d: 58, vx: 0, vy: 0, vd: 0, ziel: { x: 68, y: 100, d: 58 } };
  let minis = [];            // { engine, el }

  // ---------------------------------------------------------------- geometry: spring up, timed curve down
  const geo = { w: 184, h: 0, r: 14, vw: 0, vh: 0, vr: 0, ziel: { w: 184, h: 0, r: 14 }, zeit: null };
  let geoLaeuft = false;
  let gemeldetRect = null;

  function bezier(x1, y1, x2, y2) {
    const a = (a1, a2) => 1 - 3 * a2 + 3 * a1;
    const b = (a1, a2) => 3 * a2 - 6 * a1;
    const c = (a1) => 3 * a1;
    const kurve = (t, a1, a2) => ((a(a1, a2) * t + b(a1, a2)) * t + c(a1)) * t;
    const steigung = (t, a1, a2) => 3 * a(a1, a2) * t * t + 2 * b(a1, a2) * t + c(a1);
    return (x) => {
      let t = x;
      for (let i = 0; i < 6; i++) {
        const s = steigung(t, x1, x2);
        if (Math.abs(s) < 1e-6) break;
        t -= (kurve(t, x1, x2) - x) / s;
      }
      return kurve(Math.min(1, Math.max(0, t)), y1, y2);
    };
  }
  const zuKurve = bezier(0.45, 0, 0.2, 1);
  const OMEGA = (2 * Math.PI) / 0.5;
  const ZETA = 0.72;

  function geoZiel(w, h, r) {
    const schrumpft = h < geo.h - 0.5 || w < geo.w - 0.5;
    geo.ziel = { w, h, r };
    geo.zeit = schrumpft || reduziert ? { start: performance.now(), von: { w: geo.w, h: geo.h, r: geo.r }, dauer: reduziert ? 120 : 340 } : null;
    if (!geoLaeuft) { geoLaeuft = true; requestAnimationFrame(geoBild); }
  }

  let geoZuletzt = 0;
  function geoBild(t) {
    const dt = geoZuletzt ? Math.min(0.05, (t - geoZuletzt) / 1000) : 1 / 60;
    geoZuletzt = t;
    let fertig = false;
    if (geo.zeit) {
      const p = Math.min(1, (t - geo.zeit.start) / geo.zeit.dauer);
      const e = zuKurve(p);
      for (const k of ['w', 'h', 'r']) geo[k] = geo.zeit.von[k] + (geo.ziel[k] - geo.zeit.von[k]) * e;
      geo.vw = geo.vh = geo.vr = 0;
      fertig = p >= 1;
    } else {
      const schritte = Math.max(1, Math.round(dt * 240));
      const h = dt / schritte;
      for (let i = 0; i < schritte; i++) {
        for (const k of ['w', 'h', 'r']) {
          const v = 'v' + k;
          const a = -OMEGA * OMEGA * (geo[k] - geo.ziel[k]) - 2 * ZETA * OMEGA * geo[v];
          geo[v] += a * h;
          geo[k] += geo[v] * h;
        }
      }
      fertig = ['w', 'h', 'r'].every((k) => Math.abs(geo[k] - geo.ziel[k]) < 0.01 && Math.abs(geo['v' + k]) < 0.05);
    }
    if (fertig) { geo.w = geo.ziel.w; geo.h = geo.ziel.h; geo.r = geo.ziel.r; }
    insel.style.width = `${geo.w.toFixed(2)}px`;
    insel.style.height = `${Math.max(0, geo.h).toFixed(2)}px`;
    insel.style.borderRadius = `0 0 ${geo.r.toFixed(2)}px ${geo.r.toFixed(2)}px`;
    flaechenMelden();
    if (fertig) { geoLaeuft = false; geoZuletzt = 0; return; }
    requestAnimationFrame(geoBild);
  }

  /** The island's outline in window coordinates → main decides click-through with it. */
  function flaechenMelden() {
    if (st.modus === 'versteckt') return;
    const r = { x: (PANEL - geo.w) / 2, y: 0, width: geo.w, height: Math.max(2, geo.h) };
    const g = gemeldetRect;
    if (g && Math.abs(g.x - r.x) < 0.5 && Math.abs(g.width - r.width) < 0.5 && Math.abs(g.height - r.height) < 0.5) return;
    gemeldetRect = r;
    api.flaechen([r]);
  }

  // ---------------------------------------------------------------- the big face follows the view
  function gesichtZiel(x, y, d) {
    fg.ziel = { x, y, d };
    if (!fgLaeuft) { fgLaeuft = true; requestAnimationFrame(fgBild); }
  }
  let fgLaeuft = false;
  let fgZuletzt = 0;
  function fgBild(t) {
    const dt = fgZuletzt ? Math.min(0.05, (t - fgZuletzt) / 1000) : 1 / 60;
    fgZuletzt = t;
    const schritte = Math.max(1, Math.round(dt * 240));
    const h = dt / schritte;
    for (let i = 0; i < schritte; i++) {
      for (const k of ['x', 'y', 'd']) {
        const v = 'v' + k;
        const a = -OMEGA * OMEGA * (fg[k] - fg.ziel[k]) - 2 * ZETA * OMEGA * fg[v];
        fg[v] += a * h;
        fg[k] += fg[v] * h;
      }
    }
    const fertig = ['x', 'y', 'd'].every((k) => Math.abs(fg[k] - fg.ziel[k]) < 0.05 && Math.abs(fg['v' + k]) < 0.05);
    if (fertig) { fg.x = fg.ziel.x; fg.y = fg.ziel.y; fg.d = fg.ziel.d; }
    gesichtSetzen();
    if (fertig) { fgLaeuft = false; fgZuletzt = 0; return; }
    requestAnimationFrame(fgBild);
  }
  function gesichtSetzen() {
    // canvas = Ø/0.6 square, helmet width = Ø; the helmet's centre sits at 60 % of the canvas height
    const c = fg.d / 0.6;
    grossCanvas.style.transform = `translate(${(fg.x - c / 2).toFixed(1)}px, ${(fg.y - c * 0.6).toFixed(1)}px) scale(${(c / GROSS).toFixed(4)})`;
    grossCanvas.style.transformOrigin = '0 0';
    const s = fg.d * 2.2;
    schein.style.width = `${s}px`;
    schein.style.height = `${s}px`;
    schein.style.transform = `translate(${(fg.x - s / 2).toFixed(1)}px, ${(fg.y - s / 2).toFixed(1)}px)`;
  }
  grossCanvas.style.left = '0';
  grossCanvas.style.top = '0';
  gesichtSetzen();

  const FACE = {
    uebersicht: () => [68, karteMitte(160), 58],
    freigabe: () => [62, karteMitte(160), 56],
    fragen: () => [46, karteMitte(160) - 2, 46],
    ablage: () => [140, 104, 62],
    datei: () => [60, karteMitte(176), 56],
    hinweis: () => [62, karteMitte(160), 56],
    begruessung: () => [320, 50, 50],
    mail: null,
    einstellungen: null,
  };
  function karteMitte(h) { return 42 + (h - 52) / 2 + 2; }

  // ---------------------------------------------------------------- modes and views
  function modusSetzen(neu) {
    if (st.modus === neu) return;
    const vorher = st.modus;
    st.modus = neu;
    insel.dataset.modus = neu;
    if (neu === 'versteckt') {
      geoZiel(184, 0, 14);
      gesichtKlein.stoppen();
      gesichtGross.stoppen();
      minisStoppen();
      fokusAus();
      // let the 340 ms retract finish, then the window becomes the wake strip
      uhr('einklappen', 420, () => { if (st.modus === 'versteckt') { gemeldetRect = null; api.ansicht('versteckt'); } });
      return;
    }
    uhr('einklappen', null);
    delete document.documentElement.dataset.streifen;
    api.ansicht(neu);
    gemeldetRect = null;
    if (neu === 'kompakt') {
      geoZiel(288, 32, 14);
      gesichtKlein.starten();
      gesichtGross.stoppen();
      fokusAus();
      kompaktZeichnen();
      if (vorher === 'offen') K.spielen('stups');
    } else {
      const h = HOEHE[st.ansicht] || 160;
      geoZiel(OFFEN_B, h, 22);
      // the face grows out of its compact spot (window x 256 → island x 216, y 16, Ø 20)
      Object.assign(fg, { x: 216, y: 16, d: 20, vx: 0, vy: 0, vd: 0 });
      gesichtSetzen();
      gesichtKlein.stoppen();
      gesichtGross.starten();
      ansichtZeigen(st.ansicht, true);
    }
    minisStarten();
  }

  function ansichtZeigen(name, sofort) {
    const vorher = st.ansicht;
    st.ansicht = name;
    for (const s of document.querySelectorAll('.ansicht')) s.classList.toggle('an', s.dataset.name === name);
    for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-pressed', String(b.dataset.tab === name || (name === 'datei' && b.dataset.tab === 'ablage') || (name === 'mail' && b.dataset.tab === 'ablage')));
    $('kopf-titel').textContent = TITEL[name] || '';
    $('kopf').style.visibility = name === 'begruessung' ? 'hidden' : '';
    if (st.modus === 'offen') geoZiel(OFFEN_B, HOEHE[name] || 160, 22);
    const f = FACE[name] && FACE[name]();
    if (f) {
      grossCanvas.style.opacity = '1';
      if (sofort && vorher !== name && !fgLaeuft) { fg.x = f[0]; fg.y = f[1]; fg.d = f[2]; gesichtSetzen(); }
      gesichtZiel(f[0], f[1], f[2]);
    } else {
      grossCanvas.style.opacity = '0';
    }
    schein.hidden = !f;
    scheinFarbe();
    // keyboard only where the person types
    if (name === 'fragen' || name === 'mail') fokusAn(name === 'fragen' ? $('q-eingabe') : $('m-an'));
    else if (vorher === 'fragen' || vorher === 'mail') fokusAus();
    if (name === 'uebersicht') uebersichtZeichnen();
    if (name === 'einstellungen') einstellungenZeichnen();
    if (name === 'fragen') fragenZeichnen();
    flaechenMelden();
  }

  let fokus = false;
  function fokusAn(feld) {
    if (!fokus) { fokus = true; api.fokus(true); }
    st.gepinnt = true;
    setTimeout(() => feld && feld.focus({ preventScroll: true }), 120);
  }
  function fokusAus() {
    if (!fokus) return;
    fokus = false;
    api.fokus(false);
    if (document.activeElement) document.activeElement.blur();
    pinnenPruefen();
  }
  // The person clicked into another app while typing here: give the keyboard back, fold as usual.
  window.addEventListener('blur', () => {
    if (!fokus) return;
    fokusAus();
    zuPlanen();
  });

  /** Waiting cards, typing, a file on its way and a half-written mail keep the island open; pinning stops every fold. */
  function pinnenPruefen() {
    st.gepinnt = fokus || !!st.datei || (st.ansicht === 'freigabe' && st.modus === 'offen') || st.ansicht === 'datei'
      || st.ansicht === 'mail' || (st.ansicht === 'ablage' && ziehenTiefe > 0);
    if (st.gepinnt) { uhr('offenZu', null); uhr('hoverZu', null); countdownAus(); }
  }

  /** Open the island on a view, from any mode (alerts: approval, drop, greeting). */
  function alarm(name) {
    uhr('kompaktZu', null);
    uhr('offenZu', null);
    countdownAus();
    if (st.modus !== 'offen') {
      st.ansicht = name;
      modusSetzen('offen');
    } else {
      ansichtZeigen(name);
    }
    pinnenPruefen();
  }

  function standardAnsicht() {
    return freigabeOffen() ? 'freigabe' : 'uebersicht';
  }

  // ---------------------------------------------------------------- hover, timers, countdown
  function mausRein() {
    st.drin = true;
    uhr('kompaktZu', null);
    uhr('offenZu', null);
    uhr('hoverZu', null);
    countdownAus();
    if (st.modus === 'kompakt' && st.einstellungen.hoverOeffnen) {
      uhr('hoverAuf', 220, () => {
        if (!st.drin || st.modus !== 'kompakt') return;
        st.durchHover = true;
        st.interagiert = false;
        st.ansicht = standardAnsicht();
        modusSetzen('offen');
      });
    }
  }

  function mausRaus() {
    st.drin = false;
    uhr('hoverAuf', null);
    zuPlanen();
  }

  function etwasZuZeigen() {
    const l = st.lage;
    return !!(l && (l.laufend.length || freigabeOffen())) || !!(st.meldung && st.meldung.bis > Date.now()) || st.begruessungBis > Date.now();
  }

  /** Arm the fold timer for the current mode — once: new data every few seconds must not restart a running countdown. */
  function zuPlanen() {
    if (st.drin) return;
    if (st.modus === 'offen') {
      pinnenPruefen();
      if (st.gepinnt || laeuft('offenZu') || laeuft('hoverZu')) return;
      if (st.durchHover && !st.interagiert) {
        uhr('hoverZu', HOVER_ZU_MS, () => { if (!st.drin && !st.gepinnt && st.modus === 'offen') { modusSetzen('kompakt'); zuPlanen(); } });
        return;
      }
      countdownStarten(OFFEN_ZU_MS);
      uhr('offenZu', OFFEN_ZU_MS, () => {
        countdownAus();
        pinnenPruefen();
        if (st.drin || st.gepinnt || st.modus !== 'offen') return;
        modusSetzen('kompakt');
        zuPlanen();
      });
      return;
    }
    if (st.modus === 'kompakt') {
      if (etwasZuZeigen() || laeuft('kompaktZu')) return;
      uhr('kompaktZu', KOMPAKT_ZU_MS, () => { if (!st.drin && !etwasZuZeigen() && st.modus === 'kompakt') modusSetzen('versteckt'); });
    }
  }

  let countdownTimer = null;
  function countdownStarten(ms) {
    countdownAus();
    const ende = Date.now() + ms;
    const balken = $('countdown');
    countdownTimer = setInterval(() => {
      const rest = ende - Date.now();
      if (rest <= 0 || st.modus !== 'offen') { countdownAus(); return; }
      const fenster = Math.min(COUNTDOWN_MS, 0.6 * ms);
      if (rest > fenster) return;
      balken.classList.add('an');
      balken.style.width = `${(rest / fenster) * 160}px`;
    }, 100);
  }
  function countdownAus() {
    clearInterval(countdownTimer);
    countdownTimer = null;
    $('countdown').classList.remove('an');
  }

  // ---------------------------------------------------------------- pointer from main (eyes anywhere on screen)
  function zeigerFuer(canvas) {
    if (!st.zeiger) return null;
    const r = canvas.getBoundingClientRect();
    if (!r.width) return null;
    // the big face canvas is scaled; work in its unscaled 100-px space
    const skala = canvas === grossCanvas ? GROSS / r.width : 1;
    return { x: (st.zeiger.x - r.left) * skala, y: (st.zeiger.y - r.top) * skala };
  }

  let letzteHoverPos = null;
  function zeigerNeu(p) {
    st.zeiger = p;
    if (st.modus === 'kompakt') gesichtKlein.zeiger(zeigerFuer($('gesicht-klein')));
    if (st.modus === 'offen') {
      gesichtGross.zeiger(zeigerFuer(grossCanvas));
      // hover on the face → love after 1.9 s (moving > 40 px restarts)
      const ueber = grossCanvas.style.opacity !== '0' && Math.hypot(p.x - (40 + fg.x), p.y - fg.y) < fg.d / 1.2;
      if (ueber) {
        if (!letzteHoverPos) gesichtGross.hover(true);
        else if (Math.hypot(p.x - letzteHoverPos.x, p.y - letzteHoverPos.y) > 40) { gesichtGross.hoverBewegt(); letzteHoverPos = p; }
        if (!letzteHoverPos) letzteHoverPos = p;
      } else if (letzteHoverPos) {
        letzteHoverPos = null;
        gesichtGross.hover(false);
      }
    }
    for (const m of minis) m.engine.zeiger(zeigerFuer(m.el));
    if (ziehenTiefe > 0 && st.ansicht === 'ablage') ablageFolgen(p);
    if (p.drin !== st.drin) { if (p.drin) mausRein(); else mausRaus(); }
  }

  // ---------------------------------------------------------------- compact
  function kompaktZeichnen() {
    const l = st.lage;
    const mitte = $('k-mitte');
    const zeichen = $('k-zeichen');
    let text = '';
    let zeit = '';
    let art = '';
    if (st.meldung && st.meldung.bis > Date.now()) {
      text = st.meldung.text;
      art = st.meldung.art;
    } else if (l && freigabeOffen()) {
      text = l.freigaben.length > 1 ? `${l.freigaben.length} Freigaben warten` : 'Freigabe wartet';
    } else if (l && l.laufend.length) {
      const h = l.laufend[0];
      text = h.bot || 'Auftrag';
      zeit = h.start ? dauer(Date.now() - Date.parse(h.start)) : '';
    }
    mitte.dataset.art = art;
    zeichen.hidden = !art;
    zeichen.innerHTML = art === 'erfolg' ? S.check : art === 'fehler' ? S.kreuz : art ? S.glocke : '';
    $('k-text').textContent = text;
    $('k-zeit').textContent = zeit;
    teamKompakt();
  }

  function dauer(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    return h ? `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
  }

  function minisStoppen() { for (const m of minis) m.engine.stoppen(); }
  function minisStarten() {
    for (const m of minis) {
      const sichtbar = (st.modus === 'kompakt' && m.ort === 'kompakt') || (st.modus === 'offen' && m.ort === 'raster' && st.ansicht === 'uebersicht');
      if (sichtbar) m.engine.starten(); else m.engine.stoppen();
    }
  }
  function minisWeg(ort) {
    minis = minis.filter((m) => { if (m.ort === ort) { m.engine.stoppen(); return false; } return true; });
  }
  function mini(canvas, groesse, farbe, ort, status) {
    const engine = G.erstellen(canvas, { groesse, rahmen: 'eng', farbe, details: false });
    if (status === 'arbeitet') engine.zustand('arbeitet');
    if (status === 'wartet') engine.zustand('wartet');
    minis.push({ engine, el: canvas, ort });
    return engine;
  }

  const BOT_FARBEN = { sky: '51,170,255', amber: '251,191,36', emerald: '52,211,153', teal: '45,212,191', orange: '251,146,60', red: '248,113,113', gold: '234,179,8', slate: '148,163,184' };

  function botStatus(bot) {
    const l = st.lage;
    if (!l) return 'bereit';
    if (l.freigaben.some((f) => f.bot === bot.id)) return 'wartet';
    if (l.laufend.some((r) => r.bot && r.bot === bot.name)) return 'arbeitet';
    return 'bereit';
  }

  function teamKompakt() {
    const ziel = $('k-team');
    const l = st.lage;
    // the other team members as 13-px faces; the default bot is the big face
    const andere = l ? l.team.filter((b) => !b.standard).slice(0, 4) : [];
    const schluessel = andere.map((b) => `${b.id}:${botStatus(b)}`).join('|');
    if (ziel.dataset.schluessel === schluessel) return;
    ziel.dataset.schluessel = schluessel;
    minisWeg('kompakt');
    ziel.innerHTML = '';
    for (const b of andere) {
      const wrap = document.createElement('div');
      wrap.className = 'mini';
      const status = botStatus(b);
      if (status === 'wartet') wrap.dataset.badge = 'wartet';
      const c = document.createElement('canvas');
      wrap.appendChild(c);
      ziel.appendChild(wrap);
      mini(c, 13, BOT_FARBEN[b.farbe] || BOT_FARBEN.sky, 'kompakt', status);
    }
    if (st.modus === 'kompakt') minisStarten();
  }

  // ---------------------------------------------------------------- overview
  function knopf(text, klasse, fn, symbol) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `knopf ${klasse || ''}`.trim();
    b.innerHTML = (symbol ? S[symbol] : '') + `<span>${escape(text)}</span>`;
    b.addEventListener('click', fn);
    return b;
  }
  function escape(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function uebersichtZeichnen() {
    const l = st.lage;
    const name = $('u-name');
    const rolle = $('u-rolle');
    const titel = $('u-titel');
    const zeit = $('u-zeit');
    const knoepfe = $('u-knoepfe');
    const karte = $('u-karte');
    knoepfe.innerHTML = '';
    const standard = l && l.team.find((b) => b.standard);
    $('u-punkt').style.setProperty('--wer-farbe', `rgb(${(standard && BOT_FARBEN[standard.farbe]) || BOT_FARBEN.sky})`);
    if (!l || !l.angemeldet) {
      name.textContent = 'SPACE';
      rolle.textContent = 'nicht angemeldet';
      zeit.textContent = '';
      titel.className = 'titel';
      titel.textContent = 'Melde dich in SPACE an, dann bin ich hier oben für dich da.';
      knoepfe.append(knopf('SPACE öffnen', 'haupt', () => api.oeffnen('/'), 'oeffnen'));
      karte.dataset.wash = '';
    } else if (l.laufend.length) {
      const h = l.laufend[0];
      name.textContent = h.bot || (standard && standard.name) || 'SPACE Bot';
      rolle.textContent = 'arbeitet';
      zeit.textContent = h.start ? dauer(Date.now() - Date.parse(h.start)) : '';
      titel.className = 'titel schimmer';
      titel.textContent = h.titel;
      knoepfe.append(knopf('Ansehen', '', () => api.oeffnen('/aktivitaet'), 'oeffnen'));
      if (l.laufend.length > 1) knoepfe.append(knopf(`+${l.laufend.length - 1} weitere`, 'leise', () => api.oeffnen('/aktivitaet')));
      karte.dataset.wash = 'blau';
    } else {
      name.textContent = (standard && standard.name) || (l.steno ? 'Steno' : 'SPACE Bot');
      rolle.textContent = 'bereit';
      zeit.textContent = '';
      titel.className = 'titel';
      titel.innerHTML = st.einstellungen.diktat
        ? 'Halte <span class="taste">Strg</span> rechts, sprich, lass los.'
        : 'Frag mich etwas oder leg eine Datei ab.';
      knoepfe.append(knopf(l.steno ? 'Steno öffnen' : 'SPACE öffnen', '', () => api.oeffnen(l.steno ? '/sitzungen' : '/chat'), 'oeffnen'));
      karte.dataset.wash = '';
    }

    // right card: the team (several bots) or quick actions — rebuilt only when something changed
    const raster = $('u-raster');
    const bots = l && l.angemeldet ? l.team : [];
    const schluessel = `${!!(l && l.angemeldet)}|${l && l.steno}|${bots.map((b) => `${b.id}:${b.farbe}:${botStatus(b)}`).join(',')}`;
    if (raster.dataset.schluessel === schluessel) { minisStarten(); return; }
    raster.dataset.schluessel = schluessel;
    minisWeg('raster');
    raster.innerHTML = '';
    if (bots.length > 1) {
      for (const b of bots.slice(0, 8)) {
        const k = document.createElement('button');
        k.type = 'button';
        k.className = 'kachel';
        const status = botStatus(b);
        k.dataset.status = status;
        const c = document.createElement('canvas');
        k.append(c);
        const s = document.createElement('span');
        s.textContent = b.name;
        k.append(s);
        const p = document.createElement('i');
        p.className = 'k-punkt';
        k.append(p);
        k.title = `Mit ${b.name} chatten`;
        k.addEventListener('click', () => api.oeffnen(`/chat?bot=${encodeURIComponent(b.id)}`));
        raster.append(k);
        mini(c, 22, BOT_FARBEN[b.farbe] || BOT_FARBEN.sky, 'raster', status);
      }
    } else {
      const aktionen = !l || !l.angemeldet
        ? [['SPACE öffnen', '/', 'oeffnen']]
        : l.steno
          ? [['Aufnehmen', '/sitzungen/new', 'aufnahme'], ['Diktat', '/sitzungen/diktat', 'mikrofon'], ['Chat', '/chat', 'chat'], ['Dokumente', '/sitzungen/dokumente', 'datei']]
          : [['Chat', '/chat', 'chat'], ['Sitzung aufnehmen', '/sitzungen/new', 'aufnahme'], ['Mail', '/mail', 'mail'], ['Aktivität', '/aktivitaet', 'glocke']];
      for (const [label, pfad, symbol] of aktionen) {
        const k = document.createElement('button');
        k.type = 'button';
        k.className = 'kachel';
        k.innerHTML = `<i class="k-symbol">${S[symbol]}</i><span>${escape(label)}</span>`;
        k.addEventListener('click', () => api.oeffnen(pfad));
        raster.append(k);
      }
    }
    minisStarten();
  }

  // ---------------------------------------------------------------- approval
  function freigabeOffen() { return !!(st.lage && st.lage.freigaben.length); }

  function freigabeZeichnen() {
    const l = st.lage;
    const a = l && l.freigaben[0];
    if (!a) return;
    const bot = l.team.find((b) => b.id === a.bot) || l.team.find((b) => b.standard);
    $('f-name').textContent = bot ? bot.name : 'SPACE Bot';
    $('f-punkt').style.setProperty('--wer-farbe', `rgb(${(bot && BOT_FARBEN[bot.farbe]) || BOT_FARBEN.amber})`);
    const zeile = $('f-zeile');
    zeile.textContent = a.titel + (a.text ? ` · ${a.text}` : '');
    zeile.title = a.text || a.titel;
    $('f-zahl').textContent = l.freigaben.length > 1 ? `1/${l.freigaben.length}` : '';
    for (const id of ['f-ja', 'f-nein']) $(id).disabled = false;
  }

  async function entscheiden(entscheid) {
    // a card that pops up under a busy cursor must not take a stray click
    if (performance.now() - st.freigabeSeit < 600) return;
    const a = st.lage && st.lage.freigaben[0];
    if (!a) return;
    for (const id of ['f-ja', 'f-nein']) $(id).disabled = true;
    K.spielen(entscheid === 'approve' ? 'fertig' : 'stups');
    const r = await api.freigabe(a.id, entscheid);
    if (!r || !r.ok) {
      hinweis('Das ging nicht', (r && r.meldung) || 'Versuch es in SPACE.', 'rot', [['In SPACE ansehen', () => api.oeffnen('/aktivitaet')]]);
      return;
    }
    st.lage.freigaben.shift();
    st.gesehenFreigaben.add(a.id);
    if (entscheid === 'approve') gesichtGross.fertig();
    if (st.lage.freigaben.length) {
      st.freigabeSeit = performance.now();
      freigabeZeichnen();
    } else {
      st.gepinnt = false;
      gesichtZustand();
      ansichtZeigen('uebersicht');
      zuPlanen();
    }
  }

  // ---------------------------------------------------------------- ask
  function fragenZeichnen() {
    const l = st.lage;
    const bots = l ? l.team : [];
    const gewaehlt = bots.find((b) => b.id === st.botWahl) || bots.find((b) => b.standard) || null;
    const hinweisEl = $('q-hinweis');
    hinweisEl.innerHTML = `Frag <b>${escape(gewaehlt ? gewaehlt.name : 'SPACE')}</b> — die Antwort kommt im Chat.`;
    hinweisEl.classList.toggle('allein', bots.length <= 1);
    if (bots.length > 1) {
      const reihe = document.createElement('div');
      reihe.className = 'frage-bots';
      for (const b of bots.slice(0, 6)) {
        const k = document.createElement('button');
        k.type = 'button';
        k.style.setProperty('--bot-rgb', BOT_FARBEN[b.farbe] || BOT_FARBEN.sky);
        k.setAttribute('aria-pressed', String(gewaehlt && gewaehlt.id === b.id));
        k.innerHTML = `<i></i>${escape(b.name)}`;
        k.addEventListener('click', () => { st.botWahl = b.id; fragenZeichnen(); $('q-eingabe').focus(); });
        reihe.append(k);
      }
      hinweisEl.append(reihe);
    }
  }
  $('q-eingabe').addEventListener('input', () => { $('q-senden').disabled = !$('q-eingabe').value.trim(); });
  $('q-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('q-eingabe').value.trim();
    if (!text) return;
    K.spielen('diktatStart');
    $('q-eingabe').value = '';
    $('q-senden').disabled = true;
    fokusAus();
    await api.fragen(text, st.botWahl);
    hinweis('Unterwegs', 'Die Antwort kommt im Chat.', 'blau', []);
    uhr('nachHinweis', 1800, () => { if (st.ansicht === 'hinweis') { ansichtZeigen('uebersicht'); modusSetzen('kompakt'); zuPlanen(); } });
  });

  // ---------------------------------------------------------------- note
  function hinweis(titel, text, wash, knoepfe) {
    $('h-titel').textContent = titel;
    $('h-text').textContent = text;
    $('h-karte').dataset.wash = wash || '';
    const box = $('h-knoepfe');
    box.innerHTML = '';
    for (const [label, fn, klasse] of knoepfe || []) box.append(knopf(label, klasse || '', fn));
    if (st.modus === 'offen') ansichtZeigen('hinweis'); else alarm('hinweis');
    $('ansage').textContent = `${titel}. ${text}`;
  }

  // ---------------------------------------------------------------- settings
  const SCHALTER = [
    ['diktat', 'Diktieren mit der rechten Strg-Taste', 'Halten, sprechen, loslassen · zweimal tippen für freihändig · Esc bricht ab'],
    ['toene', 'Töne', 'Kurze, leise Klänge, wenn etwas passiert'],
    ['hoverOeffnen', 'Beim Darüberfahren öffnen', 'Sonst öffnet ein Klick die Insel'],
  ];
  function einstellungenZeichnen() {
    const liste = $('e-liste');
    liste.innerHTML = '';
    for (const [schluessel, titel, unter] of SCHALTER) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'schalter';
      b.setAttribute('role', 'switch');
      b.setAttribute('aria-checked', String(!!st.einstellungen[schluessel]));
      b.innerHTML = `<span class="s-text"><span class="s-titel">${escape(titel)}</span><span class="s-unter">${escape(unter)}</span></span><span class="s-knopf"></span>`;
      b.addEventListener('click', async () => {
        const neu = !st.einstellungen[schluessel];
        st.einstellungen = { ...st.einstellungen, [schluessel]: neu };
        b.setAttribute('aria-checked', String(neu));
        K.an = st.einstellungen.toene;
        tonSymbol();
        await api.einstellung(schluessel, neu);
      });
      liste.append(b);
    }
    const fuss = document.createElement('div');
    fuss.className = 'fuss';
    fuss.innerHTML = '<span>Diktate werden nach deiner KI-Option in SPACE zu Text.</span>';
    const aus = knopf('Insel ausblenden', 'leise', () => api.einstellung('an', false));
    aus.title = 'Wieder einschalten: SPACE-Symbol unten rechts';
    fuss.append(aus);
    liste.append(fuss);
  }
  function tonSymbol() {
    const b = $('ton');
    b.innerHTML = st.einstellungen.toene ? S.tonAn : S.tonAus;
    b.setAttribute('aria-label', st.einstellungen.toene ? 'Töne aus' : 'Töne an');
    b.title = b.getAttribute('aria-label');
  }
  $('ton').addEventListener('click', () => {
    const neu = !st.einstellungen.toene;
    st.einstellungen.toene = neu;
    K.an = neu;
    tonSymbol();
    if (neu) K.spielen('hallo');
    api.einstellung('toene', neu);
  });

  // ---------------------------------------------------------------- the face's state
  function gesichtZustand() {
    const l = st.lage;
    let z = 'bereit';
    if (st.diktat === 'hoert') z = 'hoert';
    else if (st.diktat === 'denkt') z = 'arbeitet';
    else if (l && freigabeOffen()) z = 'wartet';
    else if (l && l.laufend.length) z = 'arbeitet';
    gesichtKlein.zustand(z);
    gesichtGross.zustand(z);
    scheinFarbe();
  }
  function scheinFarbe() {
    const farben = { wartet: '245,165,36', arbeitet: '64,166,255', fertig: '52,211,153', fehler: '244,80,94', hoert: '120,224,255' };
    const l = st.lage;
    const z = l && freigabeOffen() ? 'wartet' : l && l.laufend.length ? 'arbeitet' : 'bereit';
    const rgb = farben[z] || '166,218,255';
    schein.style.background = `radial-gradient(closest-side, rgba(${rgb},0.55), rgba(${rgb},0))`;
    schein.style.setProperty('--schein-deckung', z === 'bereit' ? '0.15' : '0.65');
  }

  // ---------------------------------------------------------------- data from main
  function lageNeu(lage) {
    if (demo && bruecke && lage && !lage.demo) return; // demo mode keeps its own data
    const vorher = st.lage;
    st.lage = lage;
    const erste = st.ersteLage;
    st.ersteLage = false;
    const ersteGeladen = lage.angemeldet && !st.geladen;
    if (lage.angemeldet) st.geladen = true;

    // finished runs → «Erledigt: …»
    if (vorher) {
      for (const f of lage.fertig) {
        if (!st.gesehenLaeufe.has(f.id) || st.gemeldet.has(f.id)) continue;
        st.gemeldet.add(f.id);
        meldung(`${f.ok ? 'Erledigt' : 'Fehlgeschlagen'}: ${f.titel}`, f.ok ? 'erfolg' : 'fehler');
        if (f.ok) { gesichtKlein.fertig(); gesichtGross.fertig(); K.spielen('fertig'); } else K.spielen('fehler');
      }
    }
    for (const r of lage.laufend) st.gesehenLaeufe.add(r.id);

    // a new approval → the card opens and stays until answered (or folded)
    const neue = lage.freigaben.filter((a) => !st.gesehenFreigaben.has(a.id));
    for (const a of lage.freigaben) st.gesehenFreigaben.add(a.id);
    if (neue.length && !ersteGeladen && st.ansicht !== 'datei' && st.ansicht !== 'mail') {
      K.spielen('freigabe');
      st.freigabeSeit = performance.now();
      freigabeZeichnen();
      alarm('freigabe');
    } else if (lage.freigaben.length && st.ansicht === 'freigabe') {
      freigabeZeichnen();
    } else if (!lage.freigaben.length && st.ansicht === 'freigabe') {
      ansichtZeigen('uebersicht');
    }

    // Steno has its own robot (the protocol astronaut), the Bot-Team the SPACE helmet
    const figur = lage.steno ? 'steno' : 'space';
    insel.dataset.produkt = lage.steno ? 'steno' : 'team';
    gesichtKlein.figur(figur);
    gesichtGross.figur(figur);
    gesichtZustand();
    // work reveals the compact island
    if (st.modus === 'versteckt' && (lage.laufend.length || lage.freigaben.length)) modusSetzen('kompakt');
    if (st.modus === 'kompakt') kompaktZeichnen();
    if (st.modus === 'offen' && st.ansicht === 'uebersicht') uebersichtZeichnen();
    if (!st.einstellungen.begruesst && erste) begruessen(true);
    zuPlanen();
  }

  function meldung(text, art) {
    st.meldung = { text, art, bis: Date.now() + 5000 };
    if (st.modus === 'versteckt') modusSetzen('kompakt');
    if (st.modus === 'kompakt') kompaktZeichnen();
    $('ansage').textContent = text;
    uhr('meldung', 5100, () => { if (st.modus === 'kompakt') kompaktZeichnen(); zuPlanen(); });
  }

  // timers in the texts
  setInterval(() => {
    if (!st.lage || !st.lage.laufend.length) return;
    if (st.modus === 'kompakt') kompaktZeichnen();
    if (st.modus === 'offen' && st.ansicht === 'uebersicht') {
      const h = st.lage.laufend[0];
      if (h && h.start) $('u-zeit').textContent = dauer(Date.now() - Date.parse(h.start));
    }
  }, 1000);

  // ---------------------------------------------------------------- dictation (the pill does the work)
  function diktatNeu(d) {
    st.diktat = d.zustand;
    gesichtKlein.hoert(d.zustand === 'hoert');
    gesichtGross.hoert(d.zustand === 'hoert');
    if (d.zustand === 'fertig') {
      st.diktat = 'aus';
      if (st.modus !== 'versteckt') {
        gesichtKlein.fertig();
        gesichtGross.fertig();
        if (st.modus === 'kompakt') meldung(`Eingefügt · ${d.woerter} ${d.woerter === 1 ? 'Wort' : 'Wörter'}`, 'erfolg');
      }
    }
    gesichtZustand();
  }

  // ---------------------------------------------------------------- drop a file
  let ziehenTiefe = 0;
  const MAX_DATEI = 10 * 1024 * 1024;

  function hatDateien(e) { return !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')); }

  document.addEventListener('dragenter', (e) => {
    if (!hatDateien(e)) return;
    e.preventDefault();
    ziehenTiefe++;
    if (ziehenTiefe === 1) {
      if (st.ansicht !== 'ablage' || st.modus !== 'offen') alarm('ablage');
      $('zone').dataset.heiss = '';
      gesichtGross.visierOeffnen(0.35);
      K.spielen('hallo');
      pinnenPruefen();
    }
  });
  document.addEventListener('dragover', (e) => {
    if (!hatDateien(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    ablageFolgen({ x: e.clientX, y: e.clientY });
  });
  document.addEventListener('dragleave', (e) => {
    if (!hatDateien(e)) return;
    ziehenTiefe = Math.max(0, ziehenTiefe - 1);
    if (ziehenTiefe === 0) {
      delete $('zone').dataset.heiss;
      gesichtGross.visierOeffnen(0);
      const f = FACE.ablage();
      gesichtZiel(f[0], f[1], f[2]);
      pinnenPruefen();
      zuPlanen();
    }
  });
  document.addEventListener('drop', (e) => {
    if (!hatDateien(e)) return;
    e.preventDefault();
    ziehenTiefe = 0;
    delete $('zone').dataset.heiss;
    const datei = e.dataTransfer.files && e.dataTransfer.files[0];
    if (datei) dateiNehmen(datei, { x: e.clientX, y: e.clientY });
  });
  $('z-waehlen').addEventListener('click', () => $('z-input').click());
  $('z-input').addEventListener('change', () => {
    const datei = $('z-input').files && $('z-input').files[0];
    $('z-input').value = '';
    if (datei) dateiNehmen(datei, { x: 40 + 320, y: 110 });
  });

  /** While dragging: the face follows the cursor along the card, the visor opens wide when it is close. */
  function ablageFolgen(p) {
    if (st.ansicht !== 'ablage') return;
    const x = Math.min(580, Math.max(60, p.x - 40));
    const nah = Math.abs(x - fg.x) < 60;
    gesichtGross.visierOeffnen(nah ? 0.8 : 0.4);
    gesichtZiel(x, 104, 62);
  }

  function dateiArt(d) {
    const n = d.name.toLowerCase();
    if (d.type === 'application/pdf' || n.endsWith('.pdf')) return 'PDF';
    if (d.type.startsWith('image/')) return 'BILD';
    if (/\.(docx?|odt|rtf)$/.test(n)) return 'WORD';
    if (/\.(xlsx?|ods|csv)$/.test(n)) return 'EXCEL';
    if (/\.(pptx?|odp)$/.test(n)) return 'FOLIEN';
    return 'DATEI';
  }

  async function dateiNehmen(datei, punkt) {
    if (st.datei && !st.datei.daten) return; // one file at a time — the first is still being read
    if (datei.size > MAX_DATEI) {
      gesichtGross.visierOeffnen(0);
      K.spielen('fehler');
      hinweis('Zu gross', `${datei.name} ist grösser als 10 MB. Leg sie in SPACE unter «Dateien» ab.`, 'rot', [['Zurück', () => ansichtZeigen('ablage')]]);
      return;
    }
    const lesen = datei.arrayBuffer();
    const eintrag = { name: datei.name, type: datei.type || 'application/octet-stream', daten: null, base64: null };
    st.datei = eintrag;
    pinnenPruefen();
    const weg = () => st.datei !== eintrag; // cancelled meanwhile (Abbrechen, a new file)
    // the sheet flies from the cursor into the open visor
    const blatt = $('blatt');
    blatt.textContent = dateiArt(datei);
    const startX = punkt.x - 40 - 17;
    const startY = punkt.y - 21;
    const zielX = fg.x - 17;
    const zielY = fg.y - fg.d * 0.32 - 21;
    gesichtGross.visierOeffnen(1);
    if (!reduziert) {
      blatt.animate([
        { transform: `translate(${startX}px, ${startY}px) scale(1) rotate(-6deg)`, opacity: 0.95 },
        { transform: `translate(${(startX + zielX) / 2}px, ${Math.min(startY, zielY) - 18}px) scale(0.8) rotate(4deg)`, opacity: 0.95, offset: 0.55 },
        { transform: `translate(${zielX}px, ${zielY}px) scale(0.22) rotate(0deg)`, opacity: 0 },
      ], { duration: 380, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'forwards' });
    }
    await warten(reduziert ? 60 : 380);
    if (weg()) return;
    gesichtGross.schlucken();
    K.spielen('schluck');
    await warten(270);
    if (weg()) return;
    // reading: the face shrinks and rides the bar
    $('d-name').textContent = `Lese ${datei.name}`;
    $('d-prozent').textContent = '0 %';
    $('d-ok').classList.remove('an');
    $('d-wahl').classList.remove('an');
    $('d-fuellung').style.width = '0';
    ansichtZeigen('datei');
    gesichtZiel(46, 121, 22);
    await warten(250);
    if (weg()) return;
    $('d-balken').classList.add('an');
    $('d-btext').classList.add('an');
    const dauerMs = reduziert ? 400 : 2400;
    const start = performance.now();
    let daten = null;
    lesen.then((d) => { daten = d; }, () => { daten = false; });
    let zehntel = 0;
    await new Promise((fertig) => {
      // ends early when the file was dropped meanwhile
      const bild = (t) => {
        const p = Math.min(1, (t - start) / dauerMs);
        // 60 % by 40 % of the time, 92 % by 85 %, then the last push — and never ahead of the real read
        let w = p < 0.4 ? 0.6 * (1 - Math.pow(1 - p / 0.4, 2)) : p < 0.85 ? 0.6 + 0.32 * ((p - 0.4) / 0.45) : 0.92 + 0.08 * Math.pow((p - 0.85) / 0.15, 2);
        if (daten === null) w = Math.min(w, 0.9);
        $('d-fuellung').style.width = `${(w * 100).toFixed(2)}%`;
        $('d-prozent').textContent = `${Math.round(w * 100)} %`;
        gesichtZiel(46 + w * 474, 121, 22);
        const z = Math.floor(w * 10);
        if (z > zehntel) { zehntel = z; K.spielen('diktatStart'); }
        if ((p >= 1 && daten !== null) || daten === false || weg()) { fertig(); return; }
        requestAnimationFrame(bild);
      };
      requestAnimationFrame(bild);
    });
    if (weg()) return;
    if (!daten) {
      K.spielen('fehler');
      hinweis('Nicht lesbar', `${datei.name} liess sich nicht öffnen.`, 'rot', [['Zurück', () => ansichtZeigen('ablage')]]);
      st.datei = null;
      pinnenPruefen();
      return;
    }
    eintrag.daten = daten;
    $('d-prozent').textContent = '';
    $('d-ok').classList.add('an');
    K.spielen('fertig');
    gesichtGross.hupf(0.14);
    await warten(250);
    if (weg()) return;
    $('d-balken').classList.remove('an');
    $('d-btext').classList.remove('an');
    gesichtZiel(60, karteMitte(176), 56);
    await warten(150);
    if (weg()) return;
    $('d-titel').textContent = `${datei.name} ist bereit.`;
    $('d-wahl').classList.add('an');
    $('ansage').textContent = `${datei.name} ist bereit. Was soll ich damit tun?`;
  }

  const warten = (ms) => new Promise((r) => setTimeout(r, ms));

  function dateiWeg() {
    st.datei = null;
    $('d-wahl').classList.remove('an');
    pinnenPruefen();
  }

  $('d-chat').addEventListener('click', async () => {
    if (!st.datei || !st.datei.daten) return;
    const { name, type, daten } = st.datei;
    await api.dateiZumChat(name, type, daten);
    dateiWeg();
    hinweis('Liegt im Chat', `${name} ist im Chat bereit — frag, was du wissen willst.`, 'gruen', []);
    uhr('nachHinweis', 1800, () => { if (st.ansicht === 'hinweis') { ansichtZeigen('uebersicht'); modusSetzen('kompakt'); zuPlanen(); } });
  });
  $('d-mail').addEventListener('click', () => {
    if (!st.datei) return;
    $('m-datei').querySelector('span').textContent = st.datei.name;
    $('m-betreff').value = st.datei.name;
    $('m-fehler').textContent = '';
    ansichtZeigen('mail');
  });
  $('d-weg').addEventListener('click', () => { dateiWeg(); ansichtZeigen('uebersicht'); zuPlanen(); });
  $('m-zurueck').addEventListener('click', () => { fokusAus(); ansichtZeigen('datei'); $('d-wahl').classList.add('an'); });

  function base64(buffer) {
    const bytes = new Uint8Array(buffer);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  $('m-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!st.datei || !st.datei.daten) return;
    const an = $('m-an').value.trim();
    if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(an)) { $('m-fehler').textContent = 'Bitte eine gültige Adresse.'; return; }
    $('m-senden').disabled = true;
    $('m-fehler').textContent = '';
    if (!st.datei.base64) st.datei.base64 = base64(st.datei.daten);
    const r = await api.mail({ an, betreff: $('m-betreff').value.trim() || st.datei.name, text: $('m-text').value, datei: { name: st.datei.name, type: st.datei.type, base64: st.datei.base64 } });
    $('m-senden').disabled = false;
    if (!r || !r.ok) { $('m-fehler').textContent = (r && r.meldung) || 'Die Mail ging nicht raus.'; K.spielen('fehler'); return; }
    fokusAus();
    const name = st.datei.name;
    dateiWeg();
    $('m-an').value = '';
    $('m-text').value = '';
    K.spielen('fertig');
    hinweis('Gesendet', `${name} ist an ${an} unterwegs.`, 'gruen', []);
    gesichtGross.fertig();
    uhr('nachHinweis', 2400, () => { if (st.ansicht === 'hinweis') { ansichtZeigen('uebersicht'); modusSetzen('kompakt'); zuPlanen(); } });
  });

  // ---------------------------------------------------------------- greeting
  function begruessen(erstesMal) {
    const l = st.lage;
    const name = l && l.name ? ` ${l.name.split(' ')[0]}` : '';
    $('b-titel').textContent = erstesMal ? `Hallo${name}! Ich wohne jetzt hier oben.` : `Hallo${name}!`;
    $('b-unter').innerHTML = 'Halte <span class="taste">Strg</span> rechts, sprich und lass los — der Text steht da, wo du gerade schreibst.';
    st.begruessungBis = Date.now() + (erstesMal ? 9000 : 4600);
    alarm('begruessung');
    gesichtGross.zustand('bereit');
    sterneStarten();
    K.spielen('hallo');
    setTimeout(() => gesichtGross.winken(), 900);
    setTimeout(() => $('b-text').classList.add('an'), 1200);
    if (erstesMal) { st.einstellungen.begruesst = true; api.einstellung('begruesst', true); }
    uhr('begruessung', erstesMal ? 9000 : 4600, () => {
      $('b-text').classList.remove('an');
      sterneStoppen();
      if (st.ansicht !== 'begruessung') return;
      st.ansicht = standardAnsicht();
      if (st.drin) { ansichtZeigen(st.ansicht); return; }
      modusSetzen('kompakt');
      setTimeout(zuPlanen, 600);
    });
  }

  let sterneLauf = null;
  function sterneStarten() {
    const c = $('sterne');
    c.hidden = false;
    const dpr = Math.min(2, devicePixelRatio || 1);
    c.width = OFFEN_B * dpr;
    c.height = 160 * dpr;
    c.style.width = `${OFFEN_B}px`;
    c.style.height = '160px';
    const ctx = c.getContext('2d');
    let seed = 7;
    const zufall = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const sterne = Array.from({ length: 90 }, () => ({ x: zufall() * OFFEN_B, y: zufall() * 150, r: 0.4 + zufall() * 1.1, v: 4 + zufall() * 14, a: 0.25 + zufall() * 0.6 }));
    const streifen = Array.from({ length: 50 }, () => ({ x: zufall() * OFFEN_B, y: -zufall() * 160, l: 10 + zufall() * 30, v: 500 + zufall() * 500 }));
    const start = performance.now();
    const bild = (t) => {
      const s = (t - start) / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, OFFEN_B, 160);
      for (const p of sterne) {
        ctx.globalAlpha = p.a * Math.min(1, s / 0.6) * (0.75 + 0.25 * Math.sin(t / 400 + p.x));
        ctx.fillStyle = '#dfe9ff';
        ctx.beginPath();
        ctx.arc((p.x + s * p.v) % OFFEN_B, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (s < 0.6) {
        ctx.strokeStyle = 'rgba(200,225,255,0.55)';
        ctx.lineWidth = 1;
        for (const q of streifen) {
          const y = q.y + s * q.v;
          ctx.globalAlpha = 1 - s / 0.6;
          ctx.beginPath();
          ctx.moveTo(q.x, y);
          ctx.lineTo(q.x, y + q.l);
          ctx.stroke();
        }
      }
      // ring burst at 0.45 s
      if (s > 0.45 && s < 1.8) {
        const p = (s - 0.45) / 1.35;
        ctx.globalAlpha = (1 - p) * 0.7;
        ctx.fillStyle = '#a6daff';
        for (let i = 0; i < 48; i++) {
          const a = (i / 48) * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(320 + Math.cos(a) * (30 + p * 220), 64 + Math.sin(a) * (20 + p * 70), 1.2 * (1 - p) + 0.3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      sterneLauf = requestAnimationFrame(bild);
    };
    cancelAnimationFrame(sterneLauf);
    sterneLauf = requestAnimationFrame(bild);
  }
  function sterneStoppen() {
    cancelAnimationFrame(sterneLauf);
    sterneLauf = null;
    $('sterne').hidden = true;
  }

  // ---------------------------------------------------------------- input
  /** Open on the press, not on the click: from the hidden strip the window grows to the panel between press and
   *  release, so a «click» never completes there. In compact the window only takes the mouse over the island. */
  function aufklappen() {
    st.durchHover = false;
    st.interagiert = true;
    st.ansicht = standardAnsicht();
    if (st.ansicht === 'freigabe') { st.freigabeSeit = performance.now() - 600; freigabeZeichnen(); }
    modusSetzen('offen');
    K.spielen('hallo');
  }
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (st.modus === 'versteckt' || (st.modus === 'kompakt' && !e.target.closest('.offen'))) {
      e.preventDefault();
      aufklappen();
    }
  });
  document.querySelector('.kompakt').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); aufklappen(); }
  });
  for (const b of document.querySelectorAll('[data-tab]')) {
    b.addEventListener('click', () => {
      const ziel = b.dataset.tab;
      if (ziel === 'uebersicht' && freigabeOffen()) { freigabeZeichnen(); ansichtZeigen('freigabe'); return; }
      ansichtZeigen(st.ansicht === ziel && ziel !== 'uebersicht' ? 'uebersicht' : ziel);
    });
  }
  insel.addEventListener('mousedown', (e) => {
    st.interagiert = true;
    uhr('hoverZu', null);
    if (st.modus !== 'offen' || grossCanvas.style.opacity === '0') return;
    // a poke on the face (hit circle a little larger than the helmet)
    const x = e.clientX - 40;
    if (Math.hypot(x - fg.x, e.clientY - fg.y) < fg.d / 1.2 && !st.datei) {
      const r = gesichtGross.stups();
      if (r === 'schwindlig') {
        K.spielen('schwindlig');
        const zurueck = st.ansicht;
        hinweis('Huch …', 'Zu viele Stupser auf einmal.', 'pink', []);
        uhr('schwindlig', 3300, () => { if (st.ansicht === 'hinweis') { ansichtZeigen(zurueck === 'hinweis' ? 'uebersicht' : zurueck); gesichtGross.ausdruck('bogen', 1200); } });
      } else {
        K.spielen('stups');
      }
    }
  });
  $('f-ja').addEventListener('click', () => entscheiden('approve'));
  $('f-nein').addEventListener('click', () => entscheiden('reject'));
  $('f-ansehen').addEventListener('click', () => api.oeffnen('/aktivitaet'));
  $('f-zu').addEventListener('click', () => { st.gepinnt = false; modusSetzen('kompakt'); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    if (st.ansicht === 'freigabe' || st.modus === 'offen') {
      if (st.datei) dateiWeg(); // Esc during the file or the mail = cancel it
      st.gepinnt = false;
      fokusAus();
      modusSetzen('kompakt');
      zuPlanen();
    }
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

  // wake: the hidden window is the 240×6 strip — touching it peeks out
  function wecken() {
    if (st.modus !== 'versteckt') return;
    st.durchHover = false;
    st.interagiert = false;
    modusSetzen('kompakt');
    K.spielen('hallo');
    gesichtKlein.ausdruck('bogen', 900);
    if (st.einstellungen.hoverOeffnen) { st.ansicht = standardAnsicht(); modusSetzen('offen'); st.durchHover = true; }
  }
  // The handle shows only while the window is the strip (after the 420 ms retract)
  function griffPruefen() {
    const streifen = st.modus === 'versteckt' && window.innerHeight < 80;
    if (streifen) document.documentElement.dataset.streifen = 'oben';
    else delete document.documentElement.dataset.streifen;
  }
  window.addEventListener('resize', griffPruefen);
  setTimeout(griffPruefen, 400);
  window.addEventListener('mouseover', () => { if (st.modus === 'versteckt') wecken(); });
  window.addEventListener('mousemove', () => { if (st.modus === 'versteckt') wecken(); });

  // ---------------------------------------------------------------- wiring
  api.onLage(lageNeu);
  api.onEinstellungen((e) => {
    st.einstellungen = { ...st.einstellungen, ...e };
    K.an = st.einstellungen.toene;
    tonSymbol();
    if (st.ansicht === 'einstellungen' && st.modus === 'offen') einstellungenZeichnen();
    if (st.ansicht === 'uebersicht' && st.modus === 'offen') uebersichtZeichnen();
  });
  api.onZeiger(zeigerNeu);
  api.onAussenKlick(() => {
    if (st.modus !== 'offen') return;
    pinnenPruefen();
    if (st.gepinnt) return;
    modusSetzen('kompakt');
    zuPlanen();
  });
  if (api.onWecken) api.onWecken(wecken);
  if (api.onAufklappen) api.onAufklappen(aufklappen);
  api.onDiktat(diktatNeu);
  api.onPegel((p) => { gesichtKlein.pegel(p); gesichtGross.pegel(p); });

  tonSymbol();
  insel.dataset.modus = 'versteckt';

  // first contact: a short hello (the long greeting only the very first time — lageNeu decides)
  setTimeout(() => {
    if (st.einstellungen.begruesst && st.modus === 'versteckt') {
      modusSetzen('kompakt');
      gesichtKlein.winken();
      st.begruessungBis = Date.now() + 2600;
      uhr('hallo', 2600, zuPlanen);
    }
  }, 1200);

  // ---------------------------------------------------------------- demo (tests, screenshots)
  function demoBruecke() {
    const leer = () => () => {};
    const log = (n) => (...a) => { console.log('[insel demo]', n, JSON.stringify(a).slice(0, 200)); return Promise.resolve({ ok: true }); };
    return {
      flaechen: log('flaechen'), ansicht: log('ansicht'), fokus: log('fokus'), neuLaden: log('neuLaden'), oeffnen: log('oeffnen'),
      fragen: log('fragen'), freigabe: log('freigabe'), dateiZumChat: log('dateiZumChat'), mail: log('mail'), einstellung: log('einstellung'),
      onLage: leer, onEinstellungen: leer, onZeiger: leer, onAussenKlick: leer, onAnzeige: leer, onDiktat: leer, onPegel: leer,
    };
  }
  if (demo) {
    window.inselDemo = {
      lage: (l) => lageNeu({ demo: true, angemeldet: true, steno: false, name: 'Giannino', laufend: [], fertig: [], freigabenZahl: 0, freigaben: [], team: [], ...l }),
      modus: modusSetzen,
      ansicht: (n) => { if (st.modus !== 'offen') { st.ansicht = n; modusSetzen('offen'); } else ansichtZeigen(n); },
      zeiger: zeigerNeu,
      begruessen,
      datei: (name, groesse) => dateiNehmen(new File([new Uint8Array(groesse || 2000)], name || 'Offerte Huber.pdf', { type: 'application/pdf' }), { x: 500, y: 90 }),
      diktat: diktatNeu,
      st,
    };
  }
})();
