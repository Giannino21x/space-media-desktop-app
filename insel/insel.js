// The island («Insel») — SPACE at the top edge of the screen, outside the app window, the way a notch companion
// lives in the notch. It keeps living when the app window is closed (tray, main.js): the SPACE face peeks out when
// the pointer touches the top centre, opens on a click, shows what the bots are doing, asks for approvals, takes a
// dropped file, and — the core — Flow dictation anywhere: hold the right Ctrl, speak, let go, the words are pasted
// where you type.
//
// Behaviour after Coucou for Windows (MIT code, Louis Raillé) — our own face, icons and sounds. Two windows, both
// transparent, always on top, never focused unless the person types into them:
//   insel  top centre. Hidden it is a small click-through strip; a slow poll here sees the pointer reach the top 10 px
//          (wakes the island) and the hook sees a press there (opens it) — the page itself gets no reliable mouse
//          events in such a small window. Visible it is a 720×320 panel, click-through outside the island's shape. The cursor poll decides click-through in the
//          same tick it reads the cursor (an IPC round trip loses clicks); while the left button is held inside the
//          panel it takes the mouse, so a file dragged from Explorer finds a drop target.
//   pille  bottom centre above the taskbar: the resting capsule, the toolbar on hover, the listening face.
//   pet    bottom right (pet.js): the SPACE Bot as a pixel astronaut; while it is on, the pill records unseen and the
//          pet shows the listening pill next to the figure and throws the words to the pointer before the paste.
// The UI is local (insel/ui); the data comes from the app's API through the app's own session (cookies), so the
// island signs in with the app and every AI step follows the person's KI-Option on the server (voice/transcribe).

const fs = require('fs');
const path = require('path');
const { BrowserWindow, screen, ipcMain, clipboard, session } = require('electron');
const {
  diktatTaste, inselRahmen, pillenRahmen, imRechteck, inselLage, multipart, diktatFehler,
} = require('./regeln');
const { createPet } = require('./pet');

const PANEL = { breite: 720, hoehe: 320 };
const STREIFEN = { breite: 300, hoehe: 10 }; // the hidden island: easy to hit at the top centre, a small handle shows where
const PILLE = { breite: 520, hoehe: 170, abstand: 4 };
const TREFFER_RAND = 14;          // a click near the island must never be swallowed
const ZIEH_RAND = 40;             // a file dragged this close to the island is meant for it
const STREIFEN_POLL_MS = 50;      // hidden: watch the top edge
const POLL_MS = 16;
const PILLE_POLL_MS = 33;
const LAGE_MS = 20_000;
const LAGE_OFFEN_MS = 6_000;
const EINFUEGEN_WARTE_MS = 40;
const ZURUECK_MS = 700;

const STANDARD = {
  an: true, diktat: true, toene: true, hoverOeffnen: false, begruesst: false,
  // the SPACE Pet (pet.js): on by default; its name, its spot, hidden until (ms, −1 = until brought back), its counter
  pet: true, petName: '', petLage: null, petVersteckt: 0, petZaehler: null,
};
/** What the app's settings (Einstellungen → Bot → Insel) may read and change — never the internal flags. */
const FUER_APP = ['an', 'diktat', 'toene', 'hoverOeffnen', 'pet'];
const fuerApp = (e) => ({ ...Object.fromEntries(FUER_APP.map((k) => [k, !!e[k]])), petName: typeof e.petName === 'string' ? e.petName : '' });

function createInselHost({ appUrl, appPartition, userDataDir, isDev, zeigen, navigieren, dateiZumChat, log, testText, demo, beiLage, beiEinstellungen, appFokussiert }) {
  const datei = path.join(userDataDir, 'insel.json');
  let einstellungen = { ...STANDARD };
  try { einstellungen = { ...STANDARD, ...JSON.parse(fs.readFileSync(datei, 'utf8')) }; } catch { /* first start */ }
  const speichern = () => { try { fs.writeFileSync(datei, JSON.stringify(einstellungen, null, 2)); } catch { /* best effort */ } };

  const appSession = session.fromPartition(appPartition);
  // The island's own pages live in their own session: local files only, the microphone (audio) only.
  const inselSession = session.fromPartition('insel');
  const lokal = (url) => typeof url === 'string' && url.startsWith('file://');
  inselSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    const nurTon = permission === 'media' && (!details.mediaTypes || details.mediaTypes.every((t) => t === 'audio'));
    callback(lokal((details && details.requestingUrl) || wc.getURL()) && nurTon);
  });
  inselSession.setPermissionCheckHandler((_wc, permission, origin) => permission === 'media' && (!origin || origin === 'file://' || lokal(origin)));

  let insel = null;
  let pille = null;
  let beendet = false;

  // island state
  let flaechen = [];            // island hit rects, window-local CSS px (from the renderer)
  let ansicht = 'versteckt';    // versteckt | kompakt | offen
  let eingeklappt = true;       // window is the wake strip
  let durchklick = null;        // cached setIgnoreMouseEvents state
  let fokussiert = false;
  let imStreifen = false;       // hidden: the pointer is in the wake zone at the top edge
  let pollTimer = null;
  let letzterZeiger = { x: -1e9, y: -1e9 }; // never NaN: NaN compares false and nothing would ever be sent
  let linksGedrueckt = false;   // left mouse button (global hook)

  // pill state
  let pillenFlaechen = [];
  let pillenDurchklick = null;
  let pillenPoll = null;
  let pillenZeigerDrin = null;

  let lageTimer = null;
  let lage = inselLage();
  // From the app window: the bot the person talks to, and the answer it is writing right now
  let aktiverBot = null;  // { id, name, farbe, schreibt, seit, laufId }
  let chatFertig = null;  // { id, titel, bot, ok, zeit } — the answer arrived while the app was not in front

  /** What the island shows: the app's answers plus the chat (active bot, an answer being written, one just done). */
  function lageMitApp() {
    if (!aktiverBot) return lage;
    const l = { ...lage, aktiverBot: { id: aktiverBot.id, name: aktiverBot.name, farbe: aktiverBot.farbe } };
    if (aktiverBot.schreibt) l.laufend = [{ id: aktiverBot.laufId, titel: 'Antwort im Chat', bot: aktiverBot.name, start: aktiverBot.seit, chat: true }, ...lage.laufend];
    if (chatFertig && Date.now() - chatFertig.zeit < 3 * 60 * 1000) l.fertig = [chatFertig, ...lage.fertig];
    return l;
  }
  function lageSenden() {
    const l = lageMitApp();
    senden(insel, 'insel:lage', l);
    senden(pille, 'insel:lage', l);
    if (pet) pet.lage(l);
    if (beiLage) beiLage(l);
  }

  const senden = (fenster, kanal, daten) => {
    if (fenster && !fenster.isDestroyed()) fenster.webContents.send(kanal, daten);
  };
  /** The settings as the island's own windows see them: plus whether the pet is active right now. */
  // testDiktat (unpackaged, SPACE_INSEL_TEST_TEXT): the pill keeps a silent take, so the paste can be tested without a voice
  const fuerFenster = () => ({ ...einstellungen, petAktiv: !!(pet && pet.aktiv()), testDiktat: !!testText });

  // ---- windows ----

  const anzeige = () => screen.getPrimaryDisplay();

  function fensterOptionen(extra) {
    return {
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      focusable: false,
      alwaysOnTop: true,
      type: process.platform === 'win32' ? 'toolbar' : undefined,
      roundedCorners: false,
      thickFrame: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        partition: 'insel',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        spellcheck: false,
      },
      ...extra,
    };
  }

  function fensterSichern(fenster) {
    fenster.setAlwaysOnTop(true, 'screen-saver');
    fenster.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    fenster.webContents.on('will-navigate', (e) => e.preventDefault());
    // No zoom by Ctrl+wheel / Ctrl+± in the island.
    fenster.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
    fenster.webContents.on('before-input-event', (e, input) => {
      if (input.control && ['+', '-', '=', '0'].includes(input.key)) e.preventDefault();
    });
  }

  function panelRahmen() { return inselRahmen(anzeige().bounds, PANEL.breite, PANEL.hoehe); }
  function streifenRahmen() { return inselRahmen(anzeige().bounds, STREIFEN.breite, STREIFEN.hoehe); }

  function inselAnlegen() {
    if (insel && !insel.isDestroyed()) return;
    insel = new BrowserWindow(fensterOptionen({ ...streifenRahmen(), title: 'SPACE Insel' }));
    fensterSichern(insel);
    streifenSetzen();
    eingeklappt = true;
    durchklick = false;
    insel.loadFile(path.join(__dirname, 'ui', 'insel.html'), { query: { demo: demo ? '1' : '0' } });
    insel.once('ready-to-show', () => {
      if (!insel || insel.isDestroyed()) return;
      insel.showInactive();
      senden(insel, 'insel:einstellungen', fuerFenster());
      senden(insel, 'insel:lage', lageMitApp());
    });
    insel.on('closed', () => { insel = null; });
    // Typing in the island, then a click into another app: the island lets go of the keyboard.
    insel.on('blur', () => {
      if (!fokussiert || !insel || insel.isDestroyed()) return;
      fokussiert = false;
      insel.setFocusable(false);
    });
    insel.webContents.on('render-process-gone', () => {
      const alt = insel;
      insel = null;
      inselZustandZurueck();
      try { if (alt && !alt.isDestroyed()) alt.destroy(); } catch { /* gone */ }
      if (!beendet) setTimeout(inselAnlegen, 1500);
    });
  }

  function inselZustandZurueck() {
    pollStoppen();
    letzterZeiger = { x: -1e9, y: -1e9 };
    flaechen = [];
    ansicht = 'versteckt';
    eingeklappt = true;
    durchklick = null;
    fokussiert = false;
  }

  function pilleAnlegen() {
    if (pille && !pille.isDestroyed()) return;
    const r = pillenRahmen(anzeige().workArea, PILLE.breite, PILLE.hoehe, PILLE.abstand);
    pille = new BrowserWindow(fensterOptionen({ ...r, title: 'SPACE Diktat' }));
    fensterSichern(pille);
    pille.setIgnoreMouseEvents(true, { forward: false });
    pillenDurchklick = true;
    pille.loadFile(path.join(__dirname, 'ui', 'pille.html'));
    pille.once('ready-to-show', () => {
      if (!pille || pille.isDestroyed()) return;
      if (einstellungen.diktat) pille.showInactive();
      senden(pille, 'insel:einstellungen', fuerFenster());
      senden(pille, 'insel:lage', lageMitApp());
    });
    pille.on('closed', () => { pille = null; });
    pille.webContents.on('render-process-gone', () => {
      const alt = pille;
      pille = null;
      pillenFlaechen = [];
      pillenDurchklick = null;
      pillenZeigerDrin = null;
      if (aufnahme) { aufnahme = null; taste.zuruecksetzen(); }
      try { if (alt && !alt.isDestroyed()) alt.destroy(); } catch { /* gone */ }
      if (!beendet) setTimeout(pilleAnlegen, 1500);
    });
    pillenPollStarten();
  }

  /** Hidden → the wake strip (click-through, slow poll of the top edge); visible → the panel with the cursor poll. */
  function einklappen(an) {
    if (!insel || insel.isDestroyed() || eingeklappt === an) return;
    eingeklappt = an;
    if (an) {
      pollStoppen();
      streifenSetzen();
      durchklick = null;
      imStreifen = false;
      durchklickSetzen(true);
      pollStarten(STREIFEN_POLL_MS);
    } else {
      insel.setBounds(panelRahmen());
      // re-assert: moving across displays can rescale the window
      insel.setBounds(panelRahmen());
      durchklick = null;
      letzterZeiger = { x: -1e9, y: -1e9 };
      pollStarten(POLL_MS);
    }
  }

  /** The strip stays fully on screen (Windows keeps it ≥ ~38 px high; only its top 10 px count). */
  function streifenSetzen() {
    insel.setBounds(streifenRahmen());
  }

  /** Wake zone: the top 10 px of the strip, in screen DIP. */
  function weckZone() {
    const b = insel.getBounds();
    return { x: b.x, y: b.y, width: b.width, height: STREIFEN.hoehe };
  }

  function neuAusrichten() {
    if (insel && !insel.isDestroyed()) { if (eingeklappt) streifenSetzen(); else insel.setBounds(panelRahmen()); }
    if (pille && !pille.isDestroyed()) pille.setBounds(pillenRahmen(anzeige().workArea, PILLE.breite, PILLE.hoehe, PILLE.abstand));
    if (pet) pet.neuAusrichten();
    senden(insel, 'insel:anzeige', null);
  }

  // ---- the cursor poll: click-through decided in the same tick the cursor is read ----

  function durchklickSetzen(an) {
    if (!insel || insel.isDestroyed() || durchklick === an) return;
    durchklick = an;
    insel.setIgnoreMouseEvents(an, { forward: false });
  }

  function pollTakt() {
    if (!insel || insel.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    const b = insel.getBounds();
    if (eingeklappt) {
      const drin = imRechteck(p, weckZone());
      // solid only under the pointer at the very edge: a file dragged there finds a drop target (dragenter opens it)
      durchklickSetzen(!drin);
      if (drin && !imStreifen && !linksGedrueckt) senden(insel, 'insel:wecken', null);
      imStreifen = drin;
      return;
    }
    const lx = p.x - b.x;
    const ly = p.y - b.y;
    const ueberInsel = flaechen.some((f) => imRechteck({ x: lx, y: ly }, f, TREFFER_RAND));
    // left button held near the island: a file dragged from Explorer must find a drop target here
    const ziehen = linksGedrueckt && flaechen.some((f) => imRechteck({ x: lx, y: ly }, f, ZIEH_RAND));
    durchklickSetzen(!(ueberInsel || ziehen));
    if (Math.abs(p.x - letzterZeiger.x) >= 1 || Math.abs(p.y - letzterZeiger.y) >= 1) {
      letzterZeiger = p;
      senden(insel, 'insel:zeiger', { x: lx, y: ly, drin: ueberInsel });
    }
  }

  function pollStarten(ms) {
    pollStoppen();
    if (beendet) return;
    pollTimer = setInterval(() => {
      try { pollTakt(); } catch (err) { log(`insel poll: ${err.message}`); }
    }, ms);
  }
  function pollStoppen() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function pillenTakt() {
    if (!pille || pille.isDestroyed() || !pille.isVisible()) return;
    const p = screen.getCursorScreenPoint();
    const b = pille.getBounds();
    const lokalP = { x: p.x - b.x, y: p.y - b.y };
    const drin = pillenFlaechen.some((f) => imRechteck(lokalP, f, 0));
    const an = !drin;
    if (pillenDurchklick !== an) {
      pillenDurchklick = an;
      pille.setIgnoreMouseEvents(an, { forward: false });
    }
    if (pillenZeigerDrin !== drin) {
      pillenZeigerDrin = drin;
      senden(pille, 'pille:zeiger', { drin });
    }
  }

  function pillenPollStarten() {
    if (pillenPoll || beendet) return;
    pillenPoll = setInterval(() => {
      try { pillenTakt(); } catch (err) { log(`pille poll: ${err.message}`); }
    }, PILLE_POLL_MS);
  }

  // ---- the app's API through the app's session ----

  async function api(pfad, opts = {}) {
    const res = await appSession.fetch(`${appUrl}${pfad}`, {
      method: opts.method || 'GET',
      headers: { accept: 'application/json', ...(opts.headers || {}) },
      body: opts.body,
      cache: 'no-store',
    });
    let daten = null;
    try { daten = await res.json(); } catch { /* not json */ }
    return { ok: res.ok, status: res.status, daten };
  }

  // Who the person is and their team change rarely: every 5 minutes (GET /api/team also seeds the plan's bots).
  // What runs and waits: every 20 s, every 6 s while the island is open.
  const STAMM_MS = 5 * 60 * 1000;
  let stamm = null; // { profil, team, zeit }
  let lageLaeuft = false;
  async function lageHolen() {
    if (beendet || lageLaeuft) return;
    lageLaeuft = true;
    try {
      if (!stamm || Date.now() - stamm.zeit > STAMM_MS) {
        const profil = await api('/api/profile');
        const team = profil.ok ? await api('/api/team') : { ok: false };
        stamm = profil.ok ? { profil: profil.daten, team: team.ok ? team.daten : null, zeit: Date.now() } : null;
      }
      if (!stamm) {
        lage = inselLage();
      } else {
        const steno = stamm.profil && stamm.profil.access && stamm.profil.access.plan === 'spacebot';
        const laufend = steno ? { ok: false } : await api('/api/runs/laufend');
        if (laufend.status === 401) stamm = null; // signed out meanwhile
        const zahl = laufend.ok && laufend.daten ? Number(laufend.daten.freigaben || 0) : 0;
        const freigaben = zahl > 0 ? await api('/api/approvals?runs=0') : { ok: false };
        lage = stamm ? inselLage({
          profil: stamm.profil,
          team: stamm.team,
          laufend: laufend.ok ? laufend.daten : null,
          freigaben: freigaben.ok ? freigaben.daten : null,
        }) : inselLage();
      }
    } catch (err) {
      log(`insel lage: ${err.message}`);
    } finally {
      lageLaeuft = false;
    }
    lageSenden();
  }

  function lagePlanen(sofort) {
    if (lageTimer) clearTimeout(lageTimer);
    if (beendet) return;
    lageTimer = setTimeout(async () => {
      await lageHolen();
      lagePlanen(false);
    }, sofort ? 0 : ansicht === 'offen' ? LAGE_OFFEN_MS : LAGE_MS);
  }

  // ---- the global hook: dictation key, left button (drops), clicks outside the island ----

  const taste = diktatTaste();
  let hook = null;
  let taktTimer = null;
  let aufnahme = null;          // { id } while the pill records
  let rechtsGedrueckt = false;
  let letztesDiktat = '';
  let transkription = null;     // { id, abgebrochen } while the app turns the take into text
  let eigeneTastenBis = 0;      // our own Ctrl+V is not «another key»
  let zurueckAusstehend = null; // { timer, vorher } — the clipboard to restore after a paste

  function diktatAktion(aktion) {
    const id = aufnahme ? aufnahme.id : null;
    log(`diktat: ${aktion}`);
    switch (aktion) {
      case 'aufnahmeStart':
        aufnahme = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` };
        senden(pille, 'pille:start', { id: aufnahme.id });
        senden(insel, 'insel:diktat', { zustand: 'hoert' });
        pet.diktat('hoert');
        taktStarten();
        break;
      case 'freihand':
        senden(pille, 'pille:freihand', { id });
        pet.diktat('freihand');
        break;
      case 'senden':
        senden(pille, 'pille:stopp', { id, senden: true });
        break;
      case 'abbrechen':
      case 'verwerfen':
        senden(pille, 'pille:stopp', { id, senden: false, still: aktion === 'verwerfen' });
        senden(insel, 'insel:diktat', { zustand: 'aus' });
        pet.diktat('aus');
        aufnahme = null;
        break;
      default:
    }
  }

  function tasteEreignis(art) {
    if (!einstellungen.diktat) return;
    for (const a of taste.ereignis({ art, zeit: Date.now() })) diktatAktion(a);
  }

  function taktStarten() {
    if (taktTimer) return;
    taktTimer = setInterval(() => {
      tasteEreignis('takt');
      if (taste.zustand === 'ruhe') { clearInterval(taktTimer); taktTimer = null; }
    }, 100);
  }

  function hookStarten() {
    if (hook) return;
    try {
      const { uIOhook, UiohookKey } = require('uiohook-napi');
      const runter = (e) => {
        if (e.keycode === UiohookKey.CtrlRight) { rechtsGedrueckt = true; tasteEreignis('diktatRunter'); return; }
        if (Date.now() < eigeneTastenBis) return; // the Ctrl+V we just sent
        if (e.keycode === UiohookKey.Escape) {
          // Esc while the text is being written: nothing gets pasted
          if (taste.zustand === 'ruhe' && transkription) { transkription.abgebrochen = true; return; }
          tasteEreignis('esc');
          return;
        }
        // Modifiers alone never cancel (AltGr sends a fake left Ctrl).
        const modifikator = [UiohookKey.Ctrl, UiohookKey.Alt, UiohookKey.AltRight, UiohookKey.Shift, UiohookKey.ShiftRight, UiohookKey.Meta, UiohookKey.MetaRight].includes(e.keycode);
        if (!modifikator) tasteEreignis('andere');
      };
      const hoch = (e) => {
        if (e.keycode === UiohookKey.CtrlRight) { rechtsGedrueckt = false; tasteEreignis('diktatHoch'); }
      };
      const mausRunter = (e) => {
        if (e.button === 1) linksGedrueckt = true;
        tasteEreignis('andere');
        pet.aussenKlick(screen.getCursorScreenPoint());
        // Hidden: a press at the top edge opens the island right away
        if (e.button === 1 && insel && !insel.isDestroyed() && eingeklappt && imRechteck(screen.getCursorScreenPoint(), weckZone())) {
          senden(insel, 'insel:aufklappen', null);
          return;
        }
        // A click outside the open island folds it (the window has no focus to lose).
        if (insel && !insel.isDestroyed() && ansicht === 'offen') {
          const b = insel.getBounds();
          const p = screen.getCursorScreenPoint();
          const drin = flaechen.some((f) => imRechteck({ x: p.x - b.x, y: p.y - b.y }, f, TREFFER_RAND));
          if (!drin) senden(insel, 'insel:aussen-klick', null);
        }
      };
      const mausHoch = (e) => { if (e.button === 1) { linksGedrueckt = false; pet.linksLos(); } };
      // Right Ctrl + wheel is zoom, not a dictation
      const rad = () => tasteEreignis('andere');
      uIOhook.on('wheel', rad);
      uIOhook.on('keydown', runter);
      uIOhook.on('keyup', hoch);
      uIOhook.on('mousedown', mausRunter);
      uIOhook.on('mouseup', mausHoch);
      uIOhook.start();
      hook = {
        uIOhook,
        UiohookKey,
        aus: () => {
          uIOhook.off('keydown', runter);
          uIOhook.off('keyup', hoch);
          uIOhook.off('mousedown', mausRunter);
          uIOhook.off('mouseup', mausHoch);
          uIOhook.off('wheel', rad);
          uIOhook.stop();
        },
      };
      log('insel: Tastatur-Hook bereit (rechte Strg)');
    } catch (err) {
      log(`insel: Tastatur-Hook nicht verfügbar: ${err.message}`);
    }
  }

  function hookStoppen() {
    if (!hook) return;
    try { hook.aus(); } catch { /* already stopped */ }
    hook = null;
    taste.zuruecksetzen();
  }

  const warten = (ms) => new Promise((r) => setTimeout(r, ms));

  // Electron 44.2 has no clipboard.readHTML/readRTF/readImage any more (only readText, read, write): read what this
  // Electron offers, never throw — a paste must not fail because the old clipboard could not be captured in full.
  const ablageVersuch = (fn) => { try { return fn(); } catch { return null; } };
  function ablageLesen() {
    const c = clipboard;
    return {
      text: ablageVersuch(() => c.readText()) || '',
      html: ablageVersuch(() => (typeof c.readHTML === 'function' ? c.readHTML() : c.read('text/html'))) || '',
      rtf: ablageVersuch(() => (typeof c.readRTF === 'function' ? c.readRTF() : c.read('text/rtf'))) || '',
      image: typeof c.readImage === 'function' ? ablageVersuch(() => c.readImage()) : null,
    };
  }

  function ablageZurueck(vorher, unser) {
    if (ablageVersuch(() => clipboard.readText()) !== unser) return; // somebody copied something meanwhile — keep it
    const zurueck = {};
    if (vorher.text) zurueck.text = vorher.text;
    if (vorher.html) zurueck.html = vorher.html;
    if (vorher.rtf) zurueck.rtf = vorher.rtf;
    if (vorher.image && typeof vorher.image.isEmpty === 'function' && !vorher.image.isEmpty()) zurueck.image = vorher.image;
    try {
      if (Object.keys(zurueck).length) clipboard.write(zurueck);
      else clipboard.clear();
    } catch {
      try { if (vorher.text) clipboard.writeText(vorher.text); else clipboard.clear(); } catch { /* the clipboard is busy */ }
    }
  }

  /**
   * Paste where the person types: clipboard in, Ctrl+V, the old clipboard back after 700 ms if nobody copied meanwhile.
   * Text, HTML, RTF and images come back; files copied in Explorer cannot be restored by Electron.
   * Two pastes in a row restore the clipboard from before the first one.
   */
  async function einfuegen(text) {
    // In hands-free mode the last tap ends it on key down: wait for the release, else the paste is Ctrl+Alt+V.
    for (let i = 0; rechtsGedrueckt && i < 66; i++) await warten(15);
    let vorher;
    if (zurueckAusstehend) {
      clearTimeout(zurueckAusstehend.timer);
      vorher = zurueckAusstehend.vorher;
      zurueckAusstehend = null;
    } else {
      vorher = ablageLesen();
    }
    clipboard.writeText(text);
    await warten(EINFUEGEN_WARTE_MS);
    if (!hook) return false; // no key injection: the text stays on the clipboard («Kopiert · Strg+V»)
    eigeneTastenBis = Date.now() + 250;
    hook.uIOhook.keyTap(hook.UiohookKey.V, [hook.UiohookKey.Ctrl]);
    const eintrag = { vorher, timer: null };
    eintrag.timer = setTimeout(() => {
      if (zurueckAusstehend === eintrag) zurueckAusstehend = null;
      ablageZurueck(vorher, text);
    }, ZURUECK_MS);
    zurueckAusstehend = eintrag;
    return true;
  }

  async function transkribieren(bytes, mime) {
    // Tests (unpackaged only): a fixed text instead of the app, so the key, the pill and the paste can be checked.
    if (testText) return testText;
    const endung = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
    const { typ, koerper } = multipart('audio', `diktat.${endung}`, mime || 'audio/webm', bytes);
    const r = await api('/api/voice/transcribe', { method: 'POST', headers: { 'content-type': typ }, body: koerper });
    if (!r.ok) throw new Error(diktatFehler(r.status, r.daten));
    return typeof (r.daten && r.daten.text) === 'string' ? r.daten.text.trim() : '';
  }

  // ---- IPC from the island and the pill ----

  const von = (fenster, event) => !!fenster && !fenster.isDestroyed() && event.sender === fenster.webContents;
  const vonInsel = (event) => von(insel, event);
  const vonPille = (event) => von(pille, event);
  const vonPet = (event) => !!pet && von(pet.fenster, event);
  const vonWurf = (event) => !!pet && von(pet.wurfFenster, event);
  const kanaele = [];
  /** wer: 'insel' | 'pille' | 'beide' (island + pill) | 'pet' | 'wurf' — the sender must be that window. */
  const kanal = (name, wer, handler) => {
    kanaele.push(name);
    ipcMain.handle(name, async (event, ...args) => {
      const erlaubt = wer === 'beide' ? vonInsel(event) || vonPille(event)
        : wer === 'insel' ? vonInsel(event) : wer === 'pille' ? vonPille(event)
          : wer === 'pet' ? vonPet(event) : wer === 'wurf' ? vonWurf(event) : false;
      if (!erlaubt) throw new Error('Nicht erlaubt.');
      return handler(event, ...args);
    });
  };

  // The pet (pet.js) registers its own channels here; its windows come and go with the switches.
  const pet = createPet({
    fensterOptionen,
    fensterSichern,
    anzeige,
    einstellungen: () => einstellungen,
    aendern: (patch, opts) => aendern(patch, opts),
    senden,
    kanal,
    taste: (was) => pillenTaste(was),
    oeffnen: (pfad) => { zeigen(); if (typeof pfad === 'string' && pfad.startsWith('/') && !pfad.startsWith('//')) navigieren(pfad); },
    log,
  });

  kanal('insel:flaechen', 'insel', (_e, rects) => {
    flaechen = Array.isArray(rects)
      ? rects.slice(0, 8).filter((r) => r && [r.x, r.y, r.width, r.height].every(Number.isFinite))
      : [];
  });
  kanal('insel:ansicht', 'insel', (_e, neu) => {
    const vorher = ansicht;
    ansicht = ['versteckt', 'kompakt', 'offen'].includes(neu) ? neu : 'versteckt';
    if (ansicht === 'versteckt') {
      flaechen = [];
      einklappen(true);
    } else {
      einklappen(false);
    }
    if (ansicht === 'offen' && vorher !== 'offen') lagePlanen(true);
  });
  kanal('insel:fokus', 'insel', (_e, an) => {
    if (!insel || insel.isDestroyed()) return;
    fokussiert = !!an;
    insel.setFocusable(fokussiert);
    if (fokussiert) { durchklickSetzen(false); insel.focus(); } else insel.blur();
  });
  kanal('insel:neu-laden', 'beide', () => lagePlanen(true));
  kanal('insel:oeffnen', 'beide', (_e, pfad) => {
    zeigen();
    if (typeof pfad === 'string' && pfad.startsWith('/') && !pfad.startsWith('//')) navigieren(pfad);
  });
  kanal('insel:fragen', 'insel', (_e, input) => {
    const text = input && typeof input.text === 'string' ? input.text.trim().slice(0, 2000) : '';
    if (!text) return;
    zeigen();
    navigieren('/chat?sagen=1', { sagen: { botId: (input && typeof input.botId === 'string' && input.botId) || null, text } });
  });
  kanal('insel:freigabe', 'insel', async (_e, input) => {
    const id = input && /^[0-9a-f-]{36}$/i.test(String(input.id)) ? input.id : null;
    const entscheid = input && (input.entscheid === 'approve' || input.entscheid === 'reject') ? input.entscheid : null;
    if (!id || !entscheid) return { ok: false, meldung: 'Ungültige Freigabe.' };
    try {
      const r = await api(`/api/approvals/${id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: entscheid }),
      });
      lagePlanen(true);
      if (!r.ok) return { ok: false, meldung: (r.daten && (r.daten.error || r.daten.message)) || 'Das ging nicht. Versuch es in SPACE.' };
      return { ok: true };
    } catch {
      return { ok: false, meldung: 'Keine Verbindung zu SPACE.' };
    }
  });
  kanal('insel:datei-chat', 'insel', (_e, input) => {
    if (!input || typeof input.name !== 'string' || !input.daten) return false;
    zeigen();
    dateiZumChat({ name: input.name.slice(0, 200), type: String(input.type || ''), daten: Buffer.from(input.daten) });
    return true;
  });
  kanal('insel:mail', 'insel', async (_e, input) => {
    try {
      const r = await api('/api/mail/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          to: String(input.an || ''),
          subject: String(input.betreff || ''),
          body: String(input.text || ''),
          attachments: [{ filename: String(input.datei.name), data: String(input.datei.base64), mimeType: String(input.datei.type || 'application/octet-stream') }],
        }),
      });
      if (!r.ok) return { ok: false, meldung: (r.daten && (r.daten.error || r.daten.message)) || 'Die Mail ging nicht raus. Versuch es nochmals.' };
      return { ok: true };
    } catch {
      return { ok: false, meldung: 'Keine Verbindung. Die Mail ging nicht raus.' };
    }
  });
  kanal('insel:einstellung', 'beide', (_e, input) => {
    if (!input || !(input.schluessel in STANDARD)) return fuerFenster();
    einstellungsAenderung(input.schluessel, !!input.wert);
    return fuerFenster();
  });

  kanal('pille:flaechen', 'pille', (_e, rects) => {
    pillenFlaechen = Array.isArray(rects)
      ? rects.slice(0, 6).filter((r) => r && [r.x, r.y, r.width, r.height].every(Number.isFinite))
      : [];
  });
  kanal('pille:pegel', 'pille', (_e, pegel, baender) => {
    const mittel = Number(pegel) || 0;
    senden(insel, 'insel:pegel', mittel);
    pet.pegel(mittel, Array.isArray(baender) ? baender.slice(0, 16).map((v) => Number(v) || 0) : null);
  });
  /** Buttons on the pill (and the pet's pill): dictate (hands-free now), ✓ finish, ✕ cancel. */
  function pillenTaste(was) {
    if (!einstellungen.diktat) return;
    let aktionen = [];
    if (was === 'freihand') aktionen = taste.freihand(Date.now());
    else if (was === 'fertig') aktionen = taste.fertig();
    else if (was === 'abbrechen') {
      if (taste.zustand === 'ruhe' && transkription) { transkription.abgebrochen = true; return; }
      aktionen = taste.ereignis({ art: 'esc', zeit: Date.now() });
    }
    for (const a of aktionen) diktatAktion(a);
  }
  kanal('pille:taste', 'pille', (_e, was) => pillenTaste(was));
  /** A message the pill would show («Kopiert · Strg+V», «Mikrofon nicht verfügbar») while the pet shows the pill instead. */
  kanal('pille:meldung', 'pille', (_e, input) => {
    if (!input || typeof input.text !== 'string') return;
    pet.diktat('meldung', { text: input.text.slice(0, 200), art: input.art === 'fehler' ? 'fehler' : 'info' });
  });
  kanal('pille:audio', 'pille', async (_e, input) => {
    if (!aufnahme || !input || input.id !== aufnahme.id) return { ok: false };
    aufnahme = null;
    const lauf = { id: input.id, abgebrochen: false };
    transkription = lauf;
    senden(insel, 'insel:diktat', { zustand: 'denkt' });
    pet.diktat('denkt');
    try {
      const text = await transkribieren(Buffer.from(input.daten), String(input.mime || 'audio/webm'));
      if (transkription === lauf) transkription = null;
      if (!text || lauf.abgebrochen) {
        senden(insel, 'insel:diktat', { zustand: 'aus' });
        pet.diktat('aus');
        return { ok: false, still: true };
      }
      letztesDiktat = text;
      const woerter = text.split(/\s+/).filter(Boolean).length;
      // The pet throws the words to the pointer first (≤ 450 ms); the paste lands on impact.
      await pet.werfen(text);
      const eingefuegt = await einfuegen(text);
      senden(insel, 'insel:diktat', { zustand: 'fertig', woerter });
      pet.diktat(eingefuegt ? 'fertig' : 'meldung', eingefuegt ? { woerter } : { text: 'Kopiert · Strg+V zum Einfügen', art: 'info' });
      pet.gezaehlt(text, woerter);
      return { ok: true, text, kopiert: !eingefuegt };
    } catch (err) {
      if (transkription === lauf) transkription = null;
      senden(insel, 'insel:diktat', { zustand: 'aus' });
      pet.diktat('fehler', { text: err.message });
      return { ok: false, meldung: err.message };
    }
  });
  kanal('pille:leer', 'pille', (_e, input) => {
    if (aufnahme && input && input.id === aufnahme.id) aufnahme = null;
    senden(insel, 'insel:diktat', { zustand: 'aus' });
    pet.diktat('aus');
  });
  kanal('pille:nochmals', 'pille', async () => {
    if (!letztesDiktat) return false;
    return einfuegen(letztesDiktat);
  });

  function einstellungsAenderung(schluessel, wert) {
    aendern({ [schluessel]: wert });
  }

  /**
   * Change settings: save, act (dictation off, island on/off, pet shown/hidden), tell the windows; the app's settings
   * page hears about it when one of its switches changed (or opts.app).
   */
  function aendern(patch, opts) {
    const vorher = einstellungen;
    einstellungen = { ...einstellungen, ...patch };
    speichern();
    const keys = Object.keys(patch);
    if (keys.includes('diktat') && vorher.diktat !== einstellungen.diktat) {
      const wert = einstellungen.diktat;
      if (!wert && aufnahme) diktatAktion('abbrechen');
      if (!wert && transkription) transkription.abgebrochen = true;
      taste.zuruecksetzen();
      if (pille && !pille.isDestroyed()) { if (wert) pille.showInactive(); else pille.hide(); }
    }
    if (keys.includes('an') && vorher.an !== einstellungen.an) { if (einstellungen.an) starten(); else stoppen(); }
    if (einstellungen.an && keys.some((k) => k === 'pet' || k === 'petName' || k === 'petVersteckt')) pet.einstellungen();
    senden(insel, 'insel:einstellungen', fuerFenster());
    senden(pille, 'insel:einstellungen', fuerFenster());
    const fuerDieApp = keys.some((k) => FUER_APP.includes(k) || k === 'petName') || (opts && opts.app);
    if (fuerDieApp && beiEinstellungen) beiEinstellungen(fuerApp(einstellungen));
  }

  // ---- lifecycle ----

  function starten() {
    if (!einstellungen.an) return;
    beendet = false;
    // Every window is created at launch (hidden), never later — first show stays instant.
    pilleAnlegen();
    inselAnlegen();
    pet.anlegen();
    hookStarten();
    lagePlanen(true);
  }

  function stoppen() {
    pollStoppen();
    if (pillenPoll) clearInterval(pillenPoll);
    pillenPoll = null;
    if (lageTimer) clearTimeout(lageTimer);
    lageTimer = null;
    hookStoppen();
    if (aufnahme) diktatAktion('abbrechen');
    pet.zerstoeren();
    for (const f of [insel, pille]) if (f && !f.isDestroyed()) f.destroy();
    insel = null;
    pille = null;
    inselZustandZurueck();
    pillenFlaechen = [];
    pillenDurchklick = null;
    pillenZeigerDrin = null;
  }

  screen.on('display-metrics-changed', neuAusrichten);
  screen.on('display-added', neuAusrichten);
  screen.on('display-removed', neuAusrichten);

  return {
    starten,
    get an() { return einstellungen.an; },
    get diktat() { return einstellungen.diktat; },
    /** The pet switch is on and the pet is not hidden for a while. */
    get pet() { return !!einstellungen.pet && pet.aktiv(); },
    /** Tray: island on/off, dictation on/off, pet shown (also brings a hidden pet back) / off. */
    schalten(an) { einstellungsAenderung('an', !!an); },
    diktatSchalten(an) { einstellungsAenderung('diktat', !!an); },
    petSchalten(an) { aendern(an ? { pet: true, petVersteckt: 0 } : { pet: false }); },
    /** The app's settings page: the switches the person may change there (petName: the pet's name, a string). */
    einstellungenFuerApp() { return fuerApp(einstellungen); },
    einstellungSetzen(schluessel, wert) {
      if (schluessel === 'petName') {
        const n = String(wert == null ? '' : wert).replace(/[\r\n\t]/g, ' ').trim().slice(0, 24);
        if (n !== einstellungen.petName) aendern({ petName: n });
      } else if (schluessel === 'pet') {
        if (!!wert !== (!!einstellungen.pet && pet.aktiv())) aendern(wert ? { pet: true, petVersteckt: 0 } : { pet: false });
      } else if (FUER_APP.includes(schluessel)) {
        if (einstellungen[schluessel] !== !!wert) einstellungsAenderung(schluessel, !!wert);
      }
      return fuerApp(einstellungen);
    },
    /** The chat in the app: which bot, and whether it is writing an answer. */
    aktiverBot(b) {
      if (!b || typeof b.id !== 'string') return;
      const vorher = aktiverBot;
      const schreibt = !!b.schreibt;
      const weiter = vorher && vorher.schreibt && schreibt;
      aktiverBot = {
        id: b.id,
        name: String(b.name || 'SPACE Bot'),
        farbe: String(b.farbe || 'sky'),
        schreibt,
        seit: weiter ? vorher.seit : schreibt ? new Date().toISOString() : null,
        laufId: weiter ? vorher.laufId : schreibt ? `chat-${Date.now().toString(36)}` : null,
      };
      // the answer arrived while the person was elsewhere: the island says so
      if (vorher && vorher.schreibt && !schreibt && !(appFokussiert && appFokussiert())) {
        chatFertig = { id: vorher.laufId, titel: 'Antwort im Chat', bot: vorher.name, ok: true, chat: true, zeit: Date.now() };
      }
      lageSenden();
    },
    /** Something changed in the app (sign-in, a run started): ask the API now, who-is-who included. */
    neuLaden() { stamm = null; lagePlanen(true); },
    shutdown() {
      beendet = true;
      stoppen();
      pet.shutdown();
      for (const k of kanaele) ipcMain.removeHandler(k);
    },
  };
}

module.exports = { createInselHost };
