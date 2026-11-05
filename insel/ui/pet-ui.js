// The SPACE Pet page: the island's head on its own (gesicht.js: the real helmet with the LED eyes, in the bot's
// colour), with eyes that follow the pointer anywhere on screen. The engine runs its own loop: up to 60 fps while
// something moves, 12 while it only breathes, 4 asleep.
// Next to it the dictation pill («Diktiert mit SPACE Bot» + the nine level dots, fed by the pill window through main),
// the tooltip with the counter, the menu (right click; or the hide menu after a drag into the corner).
// Silent on purpose. Main (pet.js) owns the clock, the counters, the reactions and the throw; this page shows them.

(function () {
  const api = window.spaceInsel || demoBruecke();
  const G = window.SpaceGesicht;
  const Sym = window.SpaceSymbole;
  const $ = (id) => document.getElementById(id);
  const kopfCanvas = $('kopf');
  const pille = $('pille');
  const tipp = $('tipp');
  const menue = $('menue');
  const eingabe = $('m-eingabe');
  const BAENDER = 9;
  const GROESSE = 110;                       // the canvas of the island's big face: a 66 px helmet, room above for hops and hearts
  const RAND = { rechts: 6, unten: -8 };     // the canvas inside the window: the helmet sits 28 px from the right, 8 px above the bottom
  const MENUE_UNTEN = 6;
  const MELDUNG_MS = { info: 1800, fehler: 4000 };

  const kopf = G.erstellen(kopfCanvas, { groesse: GROESSE, nurBild: true, boden: true, kontur: true, bewegtMs: 16 });

  $('p-weg').innerHTML = Sym.kreuz;
  $('p-fertig').innerHTML = Sym.check;
  const punkte = $('punkte');
  for (let i = 0; i < BAENDER; i++) punkte.appendChild(document.createElement('i'));
  const punktEls = Array.from(punkte.children);

  // ---- geometry ----

  let W = 0;
  let H = 0;
  let figur = null;             // the helmet in the window, CSS px → main (clamping, the corner, the throw, the hit rect)
  let kopfLage = { x: 0, y: 0 };

  function messen() {
    W = window.innerWidth;
    H = window.innerHeight;
    kopf.groesse(GROESSE); // follows the display's scale when the window moves to another monitor
    kopfLage = { x: W - RAND.rechts - GROESSE, y: H - RAND.unten - GROESSE };
    kopfCanvas.style.left = `${kopfLage.x}px`;
    kopfCanvas.style.top = `${kopfLage.y}px`;
    const r = kopf.rahmen();
    figur = { x: kopfLage.x + r.x, y: kopfLage.y + r.y, width: r.width, height: r.height };
    layout();
    flaechenMelden();
  }
  window.addEventListener('resize', messen);

  // ---- state ----

  const z = {
    farbe: '51,170,255', name: '', steno: false, tooltip: '', wachheit: 'wach',
    diktat: 'aus',
    hover: false, menueOffen: null, nameOffen: false, druck: null,
    pegel: new Array(BAENDER).fill(0), ziel: new Array(BAENDER).fill(0),
  };
  const uhren = {};
  const uhr = (name, ms, fn) => { clearTimeout(uhren[name]); uhren[name] = ms == null ? undefined : setTimeout(fn, ms); };

  function botName() { return z.steno ? 'Steno' : 'SPACE Bot'; }

  /** Hidden for a while: nothing to draw. */
  document.addEventListener('visibilitychange', () => { if (document.hidden) kopf.stoppen(); else kopf.starten(); });

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
    punkteStarten();
    layout();
    flaechenMelden();
    setTimeout(flaechenMelden, 320);
  }

  // The level dots move only while the pill listens or thinks.
  let punkteFrame = null;
  let punkteZuletzt = 0;
  function punkteStarten() {
    const look = pille.dataset.look;
    if (punkteFrame !== null || look === 'aus' || look === 'meldung') return;
    punkteZuletzt = performance.now();
    punkteFrame = requestAnimationFrame(punkteSchritt);
  }
  function punkteSchritt() {
    punkteFrame = null;
    const look = pille.dataset.look;
    if (look === 'aus' || look === 'meldung') return;
    const t = performance.now();
    const dt = Math.min(0.05, (t - punkteZuletzt) / 1000);
    punkteZuletzt = t;
    if (look === 'denkt') for (let i = 0; i < BAENDER; i++) z.ziel[i] = 0.25 + 0.25 * Math.sin(t / 160 - 0.7 * i);
    for (let i = 0; i < BAENDER; i++) {
      z.pegel[i] += (z.ziel[i] - z.pegel[i]) * Math.min(1, 14 * dt);
      punktEls[i].style.height = `${(3.4 + 16 * z.pegel[i]).toFixed(1)}px`;
    }
    punkteFrame = requestAnimationFrame(punkteSchritt);
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
    pille.style.top = `${Math.round(figur.y + figur.height / 2 - 17)}px`;
    // offsetWidth, not getBoundingClientRect: the pop transition starts at scale 0.85, and a width measured mid-pop
    // placed the tooltip too far right — its last characters ran off the window («… · 0 Ta»)
    const tb = tipp.offsetWidth || 160;
    // beside the head, where the pill would be (it never shows together with the tooltip): above it, the hearts rise.
    // Pulled to the left edge of the screen there is no room beside it, then it goes above after all.
    const links = figur.x - tb - 10;
    const platz = window.screenX + links >= window.screen.availLeft;
    tipp.style.left = `${Math.round(platz ? links : Math.min(W - tb - 4, Math.max(4, figur.x + figur.width / 2 - tb / 2)))}px`;
    tipp.style.top = `${Math.round(platz ? figur.y + figur.height / 2 - 14 : Math.max(4, figur.y - 36))}px`;
    menue.style.right = `${Math.round(W - figur.x + 8)}px`;
    menue.style.bottom = `${MENUE_UNTEN}px`;
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

  // hover: the tooltip, and the head's love after a moment (the engine's hearts; silent here)
  api.onPetZeiger(({ drin }) => {
    z.hover = drin;
    kopf.hover(drin);
    if (drin) uhr('tipp', 350, () => { if (z.hover && !z.menueOffen && z.diktat === 'aus' && z.tooltip) { tipp.textContent = z.tooltip; tipp.classList.add('an'); layout(); } });
    else { uhr('tipp', null); tipp.classList.remove('an'); }
  });

  // the eyes, anywhere on screen (main sends the pointer in window px)
  api.onPetBlick((p) => { if (p) kopf.zeiger({ x: p.x - kopfLage.x, y: p.y - kopfLage.y }); });

  const imKoerper = (e) => figur && e.clientX >= figur.x && e.clientX < figur.x + figur.width && e.clientY >= figur.y && e.clientY < figur.y + figur.height;
  const imDom = (e, el) => el.contains(e.target);

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || imDom(e, pille) || imDom(e, menue)) return;
    if (!imKoerper(e)) return;
    if (z.menueOffen) menueSchliessen(true);
    z.druck = { x: e.screenX, y: e.screenY };
    tipp.classList.remove('an');
    kopf.hover(false); // no hearts while it is carried
    kopf.ausdruck('gross', 700); // picked up
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

  /** A poke: squash and an annoyed look; three within 1.7 s → dizzy (the engine, same as on the island). */
  function stups() { kopf.stups(); }

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
    // the app's settings page, Bot tab: island switches, the pet, which service turns dictation into text
    else if (a === 'einstellungen') { menueSchliessen(false); api.petOeffnen('/settings?tab=bot'); }
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
    if (s.farbe) z.farbe = String(s.farbe);
    z.name = String(s.name || '');
    z.steno = !!s.steno;
    z.tooltip = String(s.tooltip || '');
    kopf.figur(z.steno ? 'steno' : 'space');
    kopf.farbe(z.steno ? null : z.farbe); // Steno keeps its gold and amber, like on the island
    if (s.wachheit && s.wachheit !== z.wachheit) {
      z.wachheit = s.wachheit;
      kopf.doesen(z.wachheit === 'doest');
      kopf.schlaf(z.wachheit === 'schlaeft');
    }
    if (tipp.classList.contains('an')) tipp.textContent = z.tooltip;
    if (!menue.hidden) $('m-fuss').textContent = z.tooltip;
  });

  api.onPetDiktat((d) => {
    if (!d) return;
    const vorher = z.diktat;
    z.diktat = d.zustand === 'hoert' || d.zustand === 'freihand' || d.zustand === 'denkt' ? d.zustand : 'aus';
    if (z.diktat !== 'aus' && vorher === 'aus') tipp.classList.remove('an');
    const hoert = z.diktat === 'hoert' || z.diktat === 'freihand';
    kopf.hoert(hoert);
    uhr('fehler', null);
    if (hoert) kopf.zustand('hoert');
    else if (z.diktat === 'denkt') kopf.zustand('arbeitet');
    else if (d.zustand === 'fehler') { kopf.zustand('fehler'); uhr('fehler', MELDUNG_MS.fehler, () => kopf.zustand('bereit')); }
    else kopf.zustand('bereit');
    if (d.zustand === 'hoert' || d.zustand === 'freihand' || d.zustand === 'denkt') pilleLook(d.zustand);
    else if (d.zustand === 'meldung') pilleLook('meldung', { text: d.text, art: d.art });
    else if (d.zustand === 'fehler') pilleLook('meldung', { text: d.text || 'Das Diktat liess sich nicht lesen.', art: 'fehler' });
    else pilleLook('aus');
  });

  api.onPetPegel((p) => {
    if (!p) return;
    kopf.pegel(Math.min(1, Math.max(0, Number(p.mittel) || 0)));
    if (Array.isArray(p.baender) && p.baender.length) for (let i = 0; i < BAENDER; i++) z.ziel[i] = Math.min(1, Math.max(0, Number(p.baender[i % p.baender.length]) || 0));
    else for (let i = 0; i < BAENDER; i++) z.ziel[i] = Math.min(1, Math.max(0, (Number(p.mittel) || 0) * (0.7 + 0.6 * Math.abs(Math.sin(i * 1.7)))));
  });

  api.onPetReaktion((r) => {
    if (!r) return;
    if (r.art === 'herz') kopf.herzenZeigen();
    else if (r.art === 'frage') { kopf.ausdruck('gross', 1400); kopf.abzeichenKurz('?', 1500); }
    else if (r.art === 'huepfer') { kopf.hupf(0.24); kopf.ausdruck('bogen', 1200); }
    else if (r.art === 'daumen') kopf.fertig();
  });

  // The throw: a small hop with happy eyes as the words leave.
  api.onPetWurf((w) => {
    kopf.hupf(0.14);
    kopf.ausdruck('bogen', (Number(w && w.dauer) || 400) + 300);
  });

  messen();
  kopf.starten();
  api.petBereit();

  function demoBruecke() {
    const leer = () => () => {};
    const ok = () => Promise.resolve(true);
    return {
      petFlaechen: ok, petBereit: ok, petZiehen: ok, petFokus: ok, petTaste: ok, petOeffnen: ok, petVerstecken: ok, petName: ok,
      onPetZustand: leer, onPetDiktat: leer, onPetPegel: leer, onPetZeiger: leer, onPetBlick: leer, onPetEcke: leer, onPetAussenKlick: leer, onPetReaktion: leer, onPetWurf: leer, onPetFokusWeg: leer,
    };
  }
  if (!window.spaceInsel) window.petDemo = { z, kopf, pilleLook, stups, menueOeffnen };
})();
