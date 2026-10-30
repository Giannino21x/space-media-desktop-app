// The SPACE Pet — our bot as a pixel astronaut living bottom right above the taskbar, wired into the island
// (insel.js): while the right Ctrl is held the dictation pill appears next to it, after the transcription it throws
// the words into the text field (a bubble flies in an arc to the pointer, the paste lands on impact). It reacts to
// what was said, dozes after two minutes, sleeps after ten, takes a poke, can be dragged, and hides when dragged into
// the corner. Behaviour after Aqua Voice's pet (pet of aquavoice.com, researched 30.10.2026) — figure, colours and
// motion are ours (the Pixel-Büro sprite of the web app).
//
// Two windows, both transparent, always on top, never focused (the name field asks for focus once):
//   pet   400×230 bottom right: the figure (canvas), the dictation pill left of it, the tooltip, the context menu.
//         Click-through outside the figure/pill/menu, decided by the cursor poll in main (same tick as the read).
//   wurf  the whole display, click-through, shown only for the throw (≈ 0.6 s), hidden again right after.
// Silent on purpose. Counters (words today, ever, streak, level) only in insel.json — no shop, no leaderboard.

const fs = require('fs');
const path = require('path');
const { BrowserWindow, screen } = require('electron');
const {
  imRechteck, petLage, petArbeitsbereich, inEcke, petVersteckBis, petVersteckt, petWachheit, petReaktion,
  lokalerTag, petZaehlen, petTooltip, wurfText, petFarbe, WURF_MS,
} = require('./regeln');

const FENSTER = { breite: 400, hoehe: 300 }; // room for the menu above the feet
const POLL_MS = 33;
const ZIEH_POLL_MS = 16;
const WACHHEIT_MS = 10_000;
const ZIEH_MIN_PX = 4;
const WURF_NACHLAUF_MS = 260; // the splash after the impact, then the overlay goes away

/**
 * @param {object} d
 * @param {(extra: object) => object} d.fensterOptionen   the island's window options (transparent, toolbar, never focused)
 * @param {(f: BrowserWindow) => void} d.fensterSichern   always on top, no navigation, no zoom
 * @param {() => Electron.Display} d.anzeige
 * @param {() => object} d.einstellungen                   the island's settings (pet, petName, petLage, petVersteckt, petZaehler)
 * @param {(patch: object, opts?: {app?: boolean}) => void} d.aendern  write settings; app: tell the app's settings page
 * @param {(fenster, kanal, daten) => void} d.senden
 * @param {(name, wer, handler) => void} d.kanal           IPC with a sender check ('pet' | 'wurf')
 * @param {(was: string) => void} d.taste                  the pill buttons: freihand | fertig | abbrechen
 * @param {(pfad?: string) => void} d.oeffnen              show the app window
 * @param {(zeile: string) => void} d.log
 */
function createPet(d) {
  let fenster = null;
  let wurf = null;
  let beendet = false;
  let flaechen = [];          // hit rects, window-local CSS px (from the renderer)
  let figur = null;           // the figure's body, window-local CSS px (from the renderer) — for clamping and the corner
  let durchklick = null;
  let zeigerDrin = null;
  let poll = null;
  let pollMs = 0;
  let zieh = null;            // { zeiger, fenster, bewegt } while the left button drags the figure
  let vorEcke = null;         // the position before a drag into the corner (restored when the menu is cancelled)
  let wachheit = 'wach';
  let letztesDiktat = Date.now();
  let wachheitTimer = null;
  let versteckTimer = null;
  let letzteReaktion = null;
  let lage = null;            // the island's state (bot colour, steno)
  let diktat = { zustand: 'aus' };

  const e = () => d.einstellungen();
  const jetzt = () => Date.now();

  /** The pet is on and not hidden right now. */
  function aktiv() {
    const s = e();
    return !!s.pet && !petVersteckt(s.petVersteckt, jetzt());
  }
  /** …and its window is there to show things. */
  function sichtbar() {
    return aktiv() && !!fenster && !fenster.isDestroyed() && fenster.isVisible();
  }

  // ---- windows ----

  /**
   * Where the pet may live: the work area — minus the taskbar's height when it hides itself (then the work area is the
   * whole display, and a figure at the very bottom would sit where the taskbar slides up and takes every click).
   */
  function arbeitsbereich() {
    const a = d.anzeige();
    return petArbeitsbereich(a.workArea, a.bounds);
  }

  function lageJetzt() {
    const f = figur || { x: 300, y: 100, width: 72, height: 124 };
    return petLage(e().petLage, arbeitsbereich(), FENSTER, f);
  }

  function anlegen() {
    if (beendet || !e().pet) return;
    if (!fenster || fenster.isDestroyed()) {
      const l = lageJetzt();
      fenster = new BrowserWindow(d.fensterOptionen({ x: l.x, y: l.y, width: FENSTER.breite, height: FENSTER.hoehe, title: 'SPACE Pet' }));
      d.log(`pet: Fenster bei ${l.x},${l.y} (${FENSTER.breite}×${FENSTER.hoehe} DIP, Skala ${d.anzeige().scaleFactor})`);
      d.fensterSichern(fenster);
      fenster.setIgnoreMouseEvents(true, { forward: false });
      durchklick = true;
      fenster.loadFile(path.join(__dirname, 'ui', 'pet.html'));
      fenster.once('ready-to-show', () => {
        if (!fenster || fenster.isDestroyed()) return;
        if (aktiv()) fenster.showInactive();
        zustandSenden();
      });
      fenster.on('closed', () => { fenster = null; });
      // Safety net: this window must never hold the foreground (the paste goes to the foreground window). Should it
      // get activated without the name field asking for it, hand the activation straight back.
      fenster.on('focus', () => {
        if (!fenster || fenster.isDestroyed() || fenster.isFocusable()) return;
        d.log('pet: Fenster wurde aktiviert — gebe den Fokus zurück');
        fenster.blur();
      });
      if (process.env.SPACE_INSEL_PET_LOG) fenster.webContents.on('console-message', (ev) => d.log(`pet-ui: ${ev.message || ev.level}`));
      fenster.on('blur', () => {
        if (!fenster || fenster.isDestroyed() || !fenster.isFocusable()) return;
        fenster.setFocusable(false);
        d.senden(fenster, 'pet:fokus-weg', null);
      });
      fenster.webContents.on('render-process-gone', () => {
        const alt = fenster;
        fenster = null;
        flaechen = [];
        durchklick = null;
        zieh = null;
        try { if (alt && !alt.isDestroyed()) alt.destroy(); } catch { /* gone */ }
        if (!beendet) setTimeout(anlegen, 1500);
      });
      pollStarten(POLL_MS);
    }
    if (!wurf || wurf.isDestroyed()) wurfAnlegen();
    wachheitPlanen();
    versteckPlanen();
  }

  function wurfAnlegen() {
    const b = d.anzeige().bounds;
    wurf = new BrowserWindow(d.fensterOptionen({ ...b, title: 'SPACE Wurf' }));
    d.fensterSichern(wurf);
    wurf.setIgnoreMouseEvents(true, { forward: false });
    wurf.loadFile(path.join(__dirname, 'ui', 'wurf.html'));
    wurf.on('closed', () => { wurf = null; });
    wurf.webContents.on('render-process-gone', () => {
      const alt = wurf;
      wurf = null;
      try { if (alt && !alt.isDestroyed()) alt.destroy(); } catch { /* gone */ }
    });
  }

  function zerstoeren() {
    pollStoppen();
    if (wachheitTimer) clearInterval(wachheitTimer);
    wachheitTimer = null;
    if (versteckTimer) clearTimeout(versteckTimer);
    versteckTimer = null;
    for (const f of [fenster, wurf]) { try { if (f && !f.isDestroyed()) f.destroy(); } catch { /* gone */ } }
    fenster = null;
    wurf = null;
    flaechen = [];
    durchklick = null;
    zeigerDrin = null;
    zieh = null;
  }

  function neuAusrichten() {
    if (fenster && !fenster.isDestroyed()) { const l = lageJetzt(); fenster.setPosition(l.x, l.y); }
    if (wurf && !wurf.isDestroyed()) wurf.setBounds(d.anzeige().bounds);
  }

  /** Show or hide after a settings change (pet on/off, hidden for a while). */
  function abgleichen() {
    if (beendet) return;
    if (!e().pet) { zerstoeren(); return; }
    anlegen();
    if (!fenster || fenster.isDestroyed()) return;
    if (aktiv()) { if (!fenster.isVisible()) { neuAusrichten(); fenster.showInactive(); } } else if (fenster.isVisible()) fenster.hide();
    versteckPlanen();
  }

  function versteckPlanen() {
    if (versteckTimer) clearTimeout(versteckTimer);
    versteckTimer = null;
    const bis = e().petVersteckt;
    if (!Number.isFinite(bis) || bis <= 0) return;
    const rest = bis - jetzt();
    if (rest <= 0) { d.aendern({ petVersteckt: 0 }); return; }
    versteckTimer = setTimeout(() => { versteckTimer = null; d.aendern({ petVersteckt: 0 }); abgleichen(); }, Math.min(rest, 2 ** 31 - 1));
  }

  // ---- the cursor poll: click-through, hover, dragging ----

  function durchklickSetzen(an) {
    if (!fenster || fenster.isDestroyed() || durchklick === an) return;
    durchklick = an;
    fenster.setIgnoreMouseEvents(an, { forward: false });
  }

  function takt() {
    if (!fenster || fenster.isDestroyed() || !fenster.isVisible()) return;
    const p = screen.getCursorScreenPoint();
    if (zieh) {
      const neu = { x: zieh.fenster.x + (p.x - zieh.zeiger.x), y: zieh.fenster.y + (p.y - zieh.zeiger.y) };
      if (!zieh.bewegt && Math.hypot(p.x - zieh.zeiger.x, p.y - zieh.zeiger.y) >= ZIEH_MIN_PX) zieh.bewegt = true;
      if (zieh.bewegt) {
        const l = petLage(neu, arbeitsbereich(), FENSTER, figur || { x: 0, y: 0, width: FENSTER.breite, height: FENSTER.hoehe });
        const b = fenster.getBounds();
        if (b.x !== l.x || b.y !== l.y) fenster.setPosition(l.x, l.y);
      }
      durchklickSetzen(false); // the button is held on the figure: keep the mouse until it is released
      return;
    }
    const b = fenster.getBounds();
    const lokal = { x: p.x - b.x, y: p.y - b.y };
    const drin = flaechen.some((f) => imRechteck(lokal, f, 0));
    durchklickSetzen(!drin);
    if (zeigerDrin !== drin) {
      zeigerDrin = drin;
      d.senden(fenster, 'pet:zeiger', { drin, x: lokal.x, y: lokal.y });
    }
  }

  function pollStarten(ms) {
    if (poll && pollMs === ms) return;
    pollStoppen();
    if (beendet) return;
    pollMs = ms;
    poll = setInterval(() => {
      try { takt(); } catch (err) { d.log(`pet poll: ${err.message}`); }
    }, ms);
  }
  function pollStoppen() {
    if (poll) clearInterval(poll);
    poll = null;
    pollMs = 0;
  }

  /** The renderer saw the left button go down on the figure: from now on the cursor moves the window. */
  function ziehStart() {
    if (!fenster || fenster.isDestroyed()) return;
    zieh = { zeiger: screen.getCursorScreenPoint(), fenster: fenster.getBounds(), bewegt: false };
    pollStarten(ZIEH_POLL_MS);
  }

  /** The global hook saw the left button go up (anywhere). */
  function linksLos() {
    if (!zieh) return;
    const z = zieh;
    zieh = null;
    pollStarten(POLL_MS);
    if (!fenster || fenster.isDestroyed() || !z.bewegt) return;
    const b = fenster.getBounds();
    const l = { x: b.x, y: b.y };
    if (figur && inEcke(l, arbeitsbereich(), figur)) {
      vorEcke = { x: z.fenster.x, y: z.fenster.y };
      d.senden(fenster, 'pet:ecke', null);
      return;
    }
    d.aendern({ petLage: l });
  }

  /** A click outside the pet while its menu is open closes it (the hook calls this on every press). */
  function aussenKlick(p) {
    if (!fenster || fenster.isDestroyed() || !fenster.isVisible() || zieh) return;
    const b = fenster.getBounds();
    const drin = flaechen.some((f) => imRechteck({ x: p.x - b.x, y: p.y - b.y }, f, 0));
    if (process.env.SPACE_INSEL_PET_LOG) d.log(`pet: klick ${p.x - b.x},${p.y - b.y} ${drin ? 'drin' : 'aussen'}`);
    if (!drin) d.senden(fenster, 'pet:aussen-klick', null);
  }

  // ---- the state the figure shows ----

  function wachheitPlanen() {
    if (wachheitTimer) return;
    wachheitTimer = setInterval(() => {
      const neu = petWachheit(jetzt() - letztesDiktat);
      if (neu !== wachheit) { wachheit = neu; zustandSenden(); }
    }, WACHHEIT_MS);
  }

  function aufwachen() {
    letztesDiktat = jetzt();
    if (wachheit !== 'wach') { wachheit = 'wach'; zustandSenden(); }
  }

  function zustandSenden() {
    if (!fenster || fenster.isDestroyed()) return;
    const s = e();
    d.senden(fenster, 'pet:zustand', {
      name: typeof s.petName === 'string' ? s.petName : '',
      farbe: petFarbe(lage),
      steno: !!(lage && lage.steno),
      wachheit,
      tooltip: petTooltip(s.petZaehler, s.petName),
      zaehler: s.petZaehler || null,
    });
  }

  function diktatSenden(zustand, extra) {
    diktat = { zustand, ...(extra || {}) };
    if (fenster && !fenster.isDestroyed()) d.senden(fenster, 'pet:diktat', diktat);
  }

  /** A dictation has been transcribed and pasted: count it, maybe react. */
  function gezaehlt(text, woerter) {
    const zaehler = petZaehlen(e().petZaehler, woerter, lokalerTag(new Date()));
    d.aendern({ petZaehler: zaehler });
    zustandSenden();
    const art = petReaktion(text, woerter, letzteReaktion, jetzt());
    if (art) {
      letzteReaktion = jetzt();
      if (fenster && !fenster.isDestroyed()) d.senden(fenster, 'pet:reaktion', { art });
    }
  }

  /**
   * The throw: the bubble flies from the figure to the pointer; resolves at the impact (WURF_MS), when the caller
   * pastes. Without a visible pet it resolves at once — the paste is never later than today + 450 ms.
   */
  function werfen(text) {
    if (!sichtbar() || !wurf || wurf.isDestroyed() || !figur) return Promise.resolve();
    const b = fenster.getBounds();
    const anzeige = d.anzeige().bounds;
    if (wurf.getBounds().width !== anzeige.width || wurf.getBounds().height !== anzeige.height) wurf.setBounds(anzeige);
    const von = { x: b.x + figur.x + figur.width / 2 - anzeige.x, y: b.y + figur.y + figur.height * 0.35 - anzeige.y };
    const ziel = screen.getCursorScreenPoint();
    const nach = { x: ziel.x - anzeige.x, y: ziel.y - anzeige.y };
    try { wurf.showInactive(); } catch { return Promise.resolve(); }
    d.senden(wurf, 'wurf:start', { von, nach, text: wurfText(text), farbe: petFarbe(lage), dauer: WURF_MS });
    d.senden(fenster, 'pet:wurf', { dauer: WURF_MS });
    return new Promise((resolve) => {
      setTimeout(resolve, WURF_MS);
      setTimeout(() => { try { if (wurf && !wurf.isDestroyed()) wurf.hide(); } catch { /* gone */ } }, WURF_MS + WURF_NACHLAUF_MS);
    });
  }

  // ---- IPC from the pet page ----

  d.kanal('pet:flaechen', 'pet', (_e, input) => {
    const rects = input && Array.isArray(input.flaechen) ? input.flaechen : [];
    flaechen = rects.slice(0, 8).filter((r) => r && [r.x, r.y, r.width, r.height].every(Number.isFinite));
    if (process.env.SPACE_INSEL_PET_LOG) d.log(`pet: flaechen ${flaechen.map((r) => [r.x, r.y, r.width, r.height].map(Math.round).join('/')).join(' ')}`);
    const f = input && input.figur;
    if (f && [f.x, f.y, f.width, f.height].every(Number.isFinite) && f.width > 0 && f.height > 0) {
      const erst = !figur;
      figur = f;
      if (erst) { d.log(`pet: Figur ${Math.round(f.x)},${Math.round(f.y)} ${Math.round(f.width)}×${Math.round(f.height)}`); neuAusrichten(); } // the window clamps to the real body now
    }
  });
  let spriteUrl = null;
  d.kanal('pet:sprite', 'pet', () => {
    if (!spriteUrl) spriteUrl = `data:image/png;base64,${fs.readFileSync(path.join(__dirname, 'ui', 'astronaut-36.png')).toString('base64')}`;
    return spriteUrl;
  });
  d.kanal('pet:bereit', 'pet', () => { zustandSenden(); if (diktat.zustand !== 'aus') diktatSenden(diktat.zustand, diktat); });
  d.kanal('pet:ziehen', 'pet', () => ziehStart());
  d.kanal('pet:fokus', 'pet', (_e, an) => {
    if (!fenster || fenster.isDestroyed()) return;
    fenster.setFocusable(!!an);
    if (an) { durchklickSetzen(false); fenster.focus(); } else fenster.blur();
  });
  d.kanal('pet:taste', 'pet', (_e, was) => d.taste(String(was)));
  d.kanal('pet:oeffnen', 'pet', (_e, pfad) => d.oeffnen(typeof pfad === 'string' ? pfad : undefined));
  d.kanal('pet:verstecken', 'pet', (_e, wahl) => {
    const bis = petVersteckBis(String(wahl), jetzt());
    if (bis === 0) {
      // cancelled: back to where it was before the drag into the corner
      if (vorEcke && fenster && !fenster.isDestroyed()) { fenster.setPosition(vorEcke.x, vorEcke.y); }
      vorEcke = null;
      return e().petVersteckt;
    }
    if (vorEcke) { d.aendern({ petLage: vorEcke }); vorEcke = null; }
    d.aendern({ petVersteckt: bis });
    abgleichen();
    return bis;
  });
  d.kanal('pet:name', 'pet', (_e, name) => {
    const n = String(name == null ? '' : name).replace(/[\r\n\t]/g, ' ').trim().slice(0, 24);
    d.aendern({ petName: n }, { app: true });
    zustandSenden();
    return n;
  });

  return {
    anlegen,
    zerstoeren,
    abgleichen,
    neuAusrichten,
    aktiv,
    sichtbar,
    linksLos,
    aussenKlick,
    werfen,
    gezaehlt,
    /** The island's state changed (bot colour, steno). */
    lage(l) { lage = l; zustandSenden(); },
    /** The dictation: hoert | freihand | denkt | fertig | fehler | meldung | aus. */
    diktat(zustand, extra) {
      if (zustand === 'hoert') aufwachen();
      diktatSenden(zustand, extra);
    },
    /** The level meter of the pill window (mean + the nine bands). */
    pegel(mittel, baender) {
      if (fenster && !fenster.isDestroyed() && diktat.zustand !== 'aus') d.senden(fenster, 'pet:pegel', { mittel, baender });
    },
    /** Settings changed (pet, petName, petVersteckt): show, hide, rename. */
    einstellungen() { abgleichen(); zustandSenden(); },
    get fenster() { return fenster; },
    get wurfFenster() { return wurf; },
    shutdown() { beendet = true; zerstoeren(); },
  };
}

module.exports = { createPet, FENSTER };
