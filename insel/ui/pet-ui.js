// The SPACE Pet page: the bot as a pixel astronaut (sprite.js, the Pixel-Büro sheet recoloured to the bot's colour),
// drawn crisp at an integer scale on one canvas, 30 fps while something moves, 12 while it only breathes, 4 asleep.
// Next to it the dictation pill («Diktiert mit SPACE» + the nine level dots, fed by the pill window through main),
// the tooltip with the counter, the menu (right click; or the hide menu after a drag into the corner).
// Silent on purpose. Main (pet.js) owns the clock, the counters, the reactions and the throw; this page shows them.

(function () {
  const api = window.spaceInsel || demoBruecke();
  const S = window.SpaceSprite;
  const Sym = window.SpaceSymbole;
  const $ = (id) => document.getElementById(id);
  const buehne = $('buehne');
  const ctx = buehne.getContext('2d');
  const pille = $('pille');
  const tipp = $('tipp');
  const menue = $('menue');
  const eingabe = $('m-eingabe');
  const BAENDER = 9;
  const RAND = { rechts: 28, unten: 6 };     // the figure's margin inside the window (CSS px)
  const MELDUNG_MS = { info: 1800, fehler: 4000 };
  const reduziert = matchMedia('(prefers-reduced-motion: reduce)').matches;

  $('p-weg').innerHTML = Sym.kreuz;
  $('p-fertig').innerHTML = Sym.check;
  const punkte = $('punkte');
  for (let i = 0; i < BAENDER; i++) punkte.appendChild(document.createElement('i'));
  const punktEls = Array.from(punkte.children);

  // ---- geometry: device pixels for the sprite, CSS pixels for the DOM ----

  let dpr = 1;
  let D = 2;          // device px per sprite px (integer → crisp)
  let k = 2;          // CSS px per sprite px
  let W = 0;
  let H = 0;
  let zelle = { x: 0, y: 0 };   // top-left of the sprite cell, device px
  let koerper = null;           // the body inside the cell (sprite px), from the sheet's alpha
  let figur = null;             // the body in the window, CSS px → main (clamping, the corner, the throw)

  function messen() {
    dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    D = Math.max(2, Math.round(1.6 * dpr));
    k = D / dpr;
    W = window.innerWidth;
    H = window.innerHeight;
    buehne.width = Math.round(W * dpr);
    buehne.height = Math.round(H * dpr);
    buehne.style.width = `${W}px`;
    buehne.style.height = `${H}px`;
    zelle = { x: buehne.width - Math.round(RAND.rechts * dpr) - S.ZELLE_B * D, y: buehne.height - Math.round(RAND.unten * dpr) - S.ZELLE_H * D };
    if (koerper) figur = { x: (zelle.x + koerper.x * D) / dpr, y: (zelle.y + koerper.y * D) / dpr, width: koerper.w * k, height: koerper.h * k };
    layout();
    flaechenMelden();
  }
  window.addEventListener('resize', messen);

  // ---- the sheet, recoloured per bot colour ----

  const roh = document.createElement('canvas');
  const blaetter = {};
  let blattBereit = false;

  function blatt(farbe) {
    if (!blattBereit) return null;
    if (!blaetter[farbe]) {
      const c = document.createElement('canvas');
      c.width = roh.width;
      c.height = roh.height;
      const cx = c.getContext('2d');
      cx.drawImage(roh, 0, 0);
      const id = cx.getImageData(0, 0, c.width, c.height);
      S.umfaerben(id.data, farbe.split(',').map(Number));
      cx.putImageData(id, 0, 0);
      blaetter[farbe] = c;
    }
    return blaetter[farbe];
  }

  async function sheetLaden() {
    const url = await api.petSprite();
    if (!url) return;
    const bild = new Image();
    bild.decoding = 'async';
    bild.src = url;
    await bild.decode();
    roh.width = bild.naturalWidth;
    roh.height = bild.naturalHeight;
    const cx = roh.getContext('2d');
    cx.drawImage(bild, 0, 0);
    koerper = S.koerper(cx.getImageData(0, 0, S.ZELLE_B, S.ZELLE_H).data, S.ZELLE_B, S.ZELLE_H);
    blattBereit = true;
    messen();
    starten();
    api.petBereit();
  }

  // ---- state ----

  const z = {
    farbe: '51,170,255', name: '', steno: false, tooltip: '', wachheit: 'wach',
    pose: 'stehen', poseSeit: 0, poseBis: 0,
    diktat: 'aus',
    blinzelAb: 0,
    squash: -1e9, stupse: [], schwindligBis: 0,
    hupf: -1e9, schuetteln: -1e9, wurfBis: 0,
    emote: null, zs: [], zuletztZ: 0,
    hover: false, menueOffen: null, nameOffen: false, druck: null,
    pegel: new Array(BAENDER).fill(0), ziel: new Array(BAENDER).fill(0),
  };
  const jetzt = () => performance.now();
  const uhren = {};
  const uhr = (name, ms, fn) => { clearTimeout(uhren[name]); uhren[name] = ms == null ? undefined : setTimeout(fn, ms); };

  function botName() { return z.steno ? 'Steno' : 'SPACE'; }

  // ---- the idle pool: stand (breathe), a coffee, a look at the clipboard — never twice the same in a row ----

  const POSEN = [
    { pose: 'stehen', w: 5, min: 10000, max: 30000 },
    { pose: 'kaffee', w: 3, min: 3000, max: 6000 },
    { pose: 'klemmbrett', w: 2, min: 4000, max: 8000 },
  ];
  function poseSetzen(pose, t, dauer) {
    z.pose = pose;
    z.poseSeit = t;
    z.poseBis = t + (dauer || 0);
  }
  function poseWaehlen(t) {
    const pool = POSEN.filter((p) => p.pose !== z.pose);
    const summe = pool.reduce((s, p) => s + p.w, 0);
    let r = Math.random() * summe;
    let wahl = pool[pool.length - 1];
    for (const p of pool) { if (r < p.w) { wahl = p; break; } r -= p.w; }
    poseSetzen(wahl.pose, t, wahl.min + Math.random() * (wahl.max - wahl.min));
    if (wahl.pose === 'kaffee' && Math.random() < 0.5) z.emote = { art: 'note', start: t + 600 };
  }

  // ---- drawing ----

  function glyph(name, cx, top, skala, alpha, spiegeln) {
    const px = S.glyphPixel(name);
    if (!px.length) return;
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.fillStyle = S.GLYPH_FARBE[name] || '#fff';
    const b = S.GLYPH_B * D;
    const h = S.GLYPH_H * D;
    ctx.translate(cx, top + h / 2);
    ctx.scale((spiegeln ? -1 : 1) * (skala || 1), skala || 1);
    ctx.translate(-b / 2, -h / 2);
    for (const p of px) ctx.fillRect(p.x * D, p.y * D, D, D);
    ctx.restore();
  }

  function zeichnen(t) {
    const sheet = blatt(z.farbe);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, buehne.width, buehne.height);
    if (!sheet) return;
    ctx.imageSmoothingEnabled = false;

    const schlaeft = z.wachheit === 'schlaeft';
    const doest = z.wachheit === 'doest';
    const schwindlig = t < z.schwindligBis;
    const pose = t < z.wurfBis ? 'winken' : z.pose;
    const c = S.zelle(pose, 'unten');
    const kopfHoch = !reduziert && S.atmet((t - z.poseSeit) / 1000, schlaeft ? 4 : S.ATEM_S) ? -D : 0;
    const kopfDx = S.kopfSchuetteln(z.schuetteln, t) * D;
    const hupf = S.hupfHoehe(z.hupf, t) * D;

    // body transforms around the feet: hop, squash, the dizzy sway
    const fussX = zelle.x + (S.ZELLE_B / 2) * D;
    const fussY = zelle.y + S.ZELLE_H * D;
    const [sx, sy] = reduziert ? [1, 1] : S.squash(z.squash, t);
    const sway = schwindlig && !reduziert ? Math.sin(t / 110) : 0;
    ctx.translate(fussX + sway * D, fussY - hupf);
    ctx.rotate(sway * 0.06);
    ctx.scale(sx, sy);
    ctx.translate(-fussX, -fussY);

    const KZ = S.KOPF_ZEILEN;
    ctx.drawImage(sheet, c.sx, c.sy + KZ, S.ZELLE_B, S.ZELLE_H - KZ, zelle.x, zelle.y + KZ * D, S.ZELLE_B * D, (S.ZELLE_H - KZ) * D);
    ctx.drawImage(sheet, c.sx, c.sy, S.ZELLE_B, KZ, zelle.x + kopfDx, zelle.y + kopfHoch, S.ZELLE_B * D, KZ * D);

    // the visor: blink (dark 120 ms), dozing (the upper half dark), asleep (all dark)
    const V = S.VISIER;
    const vx = zelle.x + kopfDx + V.x * D;
    const vy = zelle.y + kopfHoch + V.y * D;
    ctx.fillStyle = '#0f1a2e';
    if (schlaeft) ctx.fillRect(vx, vy, V.w * D, V.h * D);
    else {
      if (doest) ctx.fillRect(vx, vy, V.w * D, 4 * D);
      if (!schwindlig && !reduziert) {
        if (t >= z.blinzelAb) {
          if (t < z.blinzelAb + S.BLINZELN_MS) ctx.fillRect(vx, vy, V.w * D, V.h * D);
          else z.blinzelAb = t + (doest ? 2 : 1) * (S.BLINZELN_MIN_MS + Math.random() * (S.BLINZELN_MAX_MS - S.BLINZELN_MIN_MS));
        }
      }
    }

    // above the helmet: the emote, the dizzy spiral, zZz
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const kopfMitte = zelle.x + (S.ZELLE_B / 2) * D + kopfDx;
    const ueberKopf = zelle.y + kopfHoch - hupf - (S.GLYPH_H + 2) * D;
    if (z.emote && t - z.emote.start >= S.EMOTE_MS) z.emote = null;
    if (z.emote && t >= z.emote.start) glyph(z.emote.art, kopfMitte, ueberKopf + S.schweben(z.emote.start, t) * D, S.popSkala(z.emote.start, t), 1, false);
    if (schwindlig) glyph('spirale', kopfMitte, ueberKopf, 1, 1, Math.floor(t / 150) % 2 === 1);
    if (schlaeft) {
      if (!z.zs.length || t - z.zuletztZ > 1300) { z.zs.push({ start: t }); z.zuletztZ = t; }
      z.zs = z.zs.filter((q) => t - q.start < 2600);
      for (const q of z.zs) {
        const p = (t - q.start) / 2600;
        glyph('z', zelle.x + (S.ZELLE_B - 4) * D + p * 10 * D, zelle.y + 6 * D - p * 16 * D, 0.6 + p * 0.5, 1 - p * p, false);
      }
    } else z.zs = [];
  }

  // ---- the frame loop: 30 fps while something moves, 12 while it only breathes, 4 asleep ----

  let timer = null;
  let laeuft = false;
  let zuletzt = 0;

  function bewegt(t) {
    return z.diktat !== 'aus' || !!z.emote || t < z.schwindligBis || t - z.squash < 400 || t - z.hupf < S.HUPF_MS
      || t - z.schuetteln < 500 || t < z.wurfBis || t < z.blinzelAb + S.BLINZELN_MS + 40;
  }
  function bild() {
    timer = null;
    if (!laeuft) return;
    const t = jetzt();
    const dt = zuletzt ? Math.min(0.05, (t - zuletzt) / 1000) : 1 / 30;
    zuletzt = t;
    if (z.wachheit === 'wach' && z.diktat === 'aus' && !z.menueOffen && t >= z.poseBis) poseWaehlen(t);
    punkteSchritt(t, dt);
    zeichnen(t);
    const ruhe = z.wachheit === 'schlaeft' ? 125 : 83;
    timer = setTimeout(bild, bewegt(t) ? 33 : ruhe);
  }
  function starten() {
    if (laeuft) return;
    laeuft = true;
    zuletzt = 0;
    z.blinzelAb = jetzt() + 1500 + Math.random() * 2000;
    poseSetzen('stehen', jetzt(), 8000 + Math.random() * 8000);
    bild();
  }
  /** Something moved: draw now instead of at the slow tick. */
  function aufwecken() {
    if (!laeuft || !timer) return;
    clearTimeout(timer);
    timer = setTimeout(bild, 0);
  }

  // ---- the dictation pill ----

  function pilleLook(look, extra) {
    const e = extra || {};
    pille.dataset.look = look;
    pille.dataset.art = e.art || '';
    const n = botName();
    if (look === 'hoert' || look === 'freihand') $('p-text').textContent = `Diktiert mit ${n}`;
    else if (look === 'denkt') $('p-text').textContent = `${n} schreibt …`;
    else if (look === 'meldung') $('p-text').textContent = e.text || '';
    $('ansage').textContent = look === 'aus' ? '' : $('p-text').textContent;
    uhr('meldung', null);
    if (look === 'meldung') uhr('meldung', MELDUNG_MS[e.art] || MELDUNG_MS.info, () => { if (pille.dataset.look === 'meldung') pilleLook('aus'); });
    if (look === 'aus') { z.ziel.fill(0); }
    layout();
    flaechenMelden();
    setTimeout(flaechenMelden, 320);
  }

  function punkteSchritt(t, dt) {
    const look = pille.dataset.look;
    if (look === 'aus' || look === 'meldung') return;
    if (look === 'denkt') for (let i = 0; i < BAENDER; i++) z.ziel[i] = 0.25 + 0.25 * Math.sin(t / 160 - 0.7 * i);
    for (let i = 0; i < BAENDER; i++) {
      z.pegel[i] += (z.ziel[i] - z.pegel[i]) * Math.min(1, 14 * dt);
      punktEls[i].style.height = `${(3.4 + 16 * z.pegel[i]).toFixed(1)}px`;
    }
  }

  $('p-weg').addEventListener('click', () => api.petTaste('abbrechen'));
  $('p-fertig').addEventListener('click', () => api.petTaste('fertig'));
  // A button must never take the keyboard focus: that would activate this never-focused window and steal the
  // foreground from where the person types (the paste goes there). The name field asks main for focus itself.
  for (const el of [pille, menue]) el.addEventListener('mousedown', (e) => { if (e.target !== eingabe) e.preventDefault(); });

  // ---- layout of the DOM pieces around the figure, and the hit rects for main ----

  function layout() {
    if (!figur) return;
    pille.style.right = `${Math.round(W - figur.x + 10)}px`;
    pille.style.top = `${Math.round(figur.y + figur.height * 0.28 - 17)}px`;
    const tb = tipp.getBoundingClientRect().width || 160;
    tipp.style.left = `${Math.round(Math.min(W - tb - 4, Math.max(4, figur.x + figur.width / 2 - tb / 2)))}px`;
    tipp.style.top = `${Math.round(Math.max(4, figur.y - 36))}px`;
    menue.style.right = `${Math.round(W - figur.x + 8)}px`;
    menue.style.bottom = `${RAND.unten}px`;
  }

  /** The layout box without the pop transition's scale (offset*, not getBoundingClientRect), grown by 4 px. */
  const kasten = (el) => ({ x: el.offsetLeft - 4, y: el.offsetTop - 4, width: el.offsetWidth + 8, height: el.offsetHeight + 8 });
  function flaechenMelden() {
    if (!figur) return;
    const rects = [{ x: figur.x - 2, y: figur.y - 2, width: figur.width + 4, height: figur.height + 4 }];
    if (pille.dataset.look !== 'aus') rects.push(kasten(pille));
    if (!menue.hidden) rects.push(kasten(menue));
    api.petFlaechen(rects, figur);
  }

  // ---- hover → the tooltip; click → a poke; drag → main moves the window ----

  api.onPetZeiger(({ drin }) => {
    z.hover = drin;
    if (drin) uhr('tipp', 350, () => { if (z.hover && !z.menueOffen && z.diktat === 'aus' && z.tooltip) { tipp.textContent = z.tooltip; tipp.classList.add('an'); layout(); } });
    else { uhr('tipp', null); tipp.classList.remove('an'); }
  });

  const imKoerper = (e) => figur && e.clientX >= figur.x && e.clientX < figur.x + figur.width && e.clientY >= figur.y && e.clientY < figur.y + figur.height;
  const imDom = (e, el) => el.contains(e.target);

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || imDom(e, pille) || imDom(e, menue)) return;
    if (!imKoerper(e)) return;
    if (z.menueOffen) menueSchliessen(true);
    z.druck = { x: e.screenX, y: e.screenY };
    tipp.classList.remove('an');
    api.petZiehen();
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button !== 0 || !z.druck) return;
    const d = Math.hypot(e.screenX - z.druck.x, e.screenY - z.druck.y);
    z.druck = null;
    if (d < 4) stups();
  });
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (imDom(e, menue)) return;
    if (imKoerper(e) || imDom(e, pille)) menueOeffnen('voll');
  });

  /** A poke: squash; three within 1.7 s → dizzy for 3.3 s (after the SPACE face). */
  function stups() {
    const t = jetzt();
    z.stupse = z.stupse.filter((s) => t - s < 1700);
    z.stupse.push(t);
    z.squash = t;
    if (z.stupse.length >= 3) { z.stupse = []; z.schwindligBis = t + 3300; }
    aufwecken();
  }

  // ---- the menu ----

  function menueOeffnen(art) {
    z.menueOffen = art;
    menue.dataset.nur = art === 'verstecken' ? 'verstecken' : '';
    $('m-titel').hidden = art !== 'verstecken';
    $('m-fuss').textContent = z.tooltip;
    $('m-name').hidden = true;
    z.nameOffen = false;
    menue.hidden = false;
    tipp.classList.remove('an');
    layout();
    flaechenMelden();
    setTimeout(flaechenMelden, 60);
  }
  function menueSchliessen(abbrechen) {
    if (!z.menueOffen) return;
    const war = z.menueOffen;
    z.menueOffen = null;
    menue.hidden = true;
    if (z.nameOffen) { z.nameOffen = false; api.petFokus(false); }
    if (war === 'verstecken' && abbrechen) api.petVerstecken('abbrechen');
    flaechenMelden();
  }
  menue.addEventListener('click', (e) => {
    const knopf = e.target.closest('.m-eintrag');
    if (!knopf) return;
    const a = knopf.dataset.aktion;
    if (a === 'diktieren') { menueSchliessen(false); api.petTaste('freihand'); }
    else if (a === 'oeffnen') { menueSchliessen(false); api.petOeffnen('/'); }
    else if (a === '1min' || a === '1std' || a === 'immer') { z.menueOffen = null; menue.hidden = true; flaechenMelden(); api.petVerstecken(a); }
    else if (a === 'name') {
      $('m-name').hidden = false;
      eingabe.value = z.name;
      z.nameOffen = true;
      api.petFokus(true);
      setTimeout(() => { eingabe.focus(); eingabe.select(); }, 30);
      flaechenMelden();
      setTimeout(flaechenMelden, 60);
    }
  });
  eingabe.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); api.petName(eingabe.value); menueSchliessen(false); }
    else if (e.key === 'Escape') { e.preventDefault(); menueSchliessen(true); }
  });
  api.onPetAussenKlick(() => menueSchliessen(true));
  api.onPetFokusWeg(() => { if (z.nameOffen) menueSchliessen(true); });
  api.onPetEcke(() => menueOeffnen('verstecken'));

  // ---- from main: state, dictation, levels, reactions, the throw ----

  api.onPetZustand((s) => {
    if (!s) return;
    const t = jetzt();
    if (s.farbe && s.farbe !== z.farbe) z.farbe = String(s.farbe);
    z.name = String(s.name || '');
    z.steno = !!s.steno;
    z.tooltip = String(s.tooltip || '');
    if (s.wachheit && s.wachheit !== z.wachheit) {
      z.wachheit = s.wachheit;
      if (z.wachheit !== 'wach') { poseSetzen('stehen', t, 0); z.emote = null; }
      else poseSetzen('stehen', t, 6000 + Math.random() * 6000);
    }
    if (tipp.classList.contains('an')) tipp.textContent = z.tooltip;
    if (!menue.hidden) $('m-fuss').textContent = z.tooltip;
    aufwecken();
  });

  api.onPetDiktat((d) => {
    if (!d) return;
    const t = jetzt();
    const vorher = z.diktat;
    z.diktat = d.zustand === 'hoert' || d.zustand === 'freihand' || d.zustand === 'denkt' ? d.zustand : 'aus';
    if (z.diktat !== 'aus' && vorher === 'aus') { poseSetzen('stehen', t, 0); tipp.classList.remove('an'); }
    if (d.zustand === 'hoert' || d.zustand === 'freihand' || d.zustand === 'denkt') pilleLook(d.zustand);
    else if (d.zustand === 'meldung') pilleLook('meldung', { text: d.text, art: d.art });
    else if (d.zustand === 'fehler') { pilleLook('meldung', { text: d.text || 'Das Diktat liess sich nicht lesen.', art: 'fehler' }); z.schuetteln = t; }
    else pilleLook('aus');
    if (z.diktat === 'aus' && z.wachheit === 'wach') poseSetzen('stehen', t, 4000 + Math.random() * 6000);
    aufwecken();
  });

  api.onPetPegel((p) => {
    if (!p) return;
    if (Array.isArray(p.baender) && p.baender.length) for (let i = 0; i < BAENDER; i++) z.ziel[i] = Math.min(1, Math.max(0, Number(p.baender[i % p.baender.length]) || 0));
    else for (let i = 0; i < BAENDER; i++) z.ziel[i] = Math.min(1, Math.max(0, (Number(p.mittel) || 0) * (0.7 + 0.6 * Math.abs(Math.sin(i * 1.7)))));
  });

  api.onPetReaktion((r) => {
    if (!r) return;
    const t = jetzt();
    if (r.art === 'herz') { z.emote = { art: 'herz', start: t }; z.hupf = t; }
    else if (r.art === 'frage') z.emote = { art: 'frage', start: t };
    else if (r.art === 'huepfer') { z.hupf = t; z.emote = { art: 'fertig', start: t + 120 }; }
    else if (r.art === 'daumen') { z.emote = { art: 'daumen', start: t }; z.hupf = t; }
    aufwecken();
  });

  api.onPetWurf((w) => {
    const t = jetzt();
    z.wurfBis = t + (Number(w && w.dauer) || 400) + 120;
    z.hupf = t;
    aufwecken();
  });

  sheetLaden().catch((err) => console.error('[pet] sheet', err));

  function demoBruecke() {
    const leer = () => () => {};
    const ok = () => Promise.resolve(true);
    return {
      petSprite: () => Promise.resolve('astronaut-36.png'), petFlaechen: ok, petBereit: ok, petZiehen: ok, petFokus: ok, petTaste: ok, petOeffnen: ok, petVerstecken: ok, petName: ok,
      onPetZustand: leer, onPetDiktat: leer, onPetPegel: leer, onPetZeiger: leer, onPetEcke: leer, onPetAussenKlick: leer, onPetReaktion: leer, onPetWurf: leer, onPetFokusWeg: leer,
    };
  }
  if (!window.spaceInsel) window.petDemo = { z, pilleLook, stups, menueOeffnen };
})();
