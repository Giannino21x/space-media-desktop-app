// Pure rules of the island (insel.js): the dictation key, where the windows sit, what the compact island shows,
// and the life of the SPACE Pet (pet.js): reactions, dozing, the throw, the word counter.
// No Electron here — tested in insel/regeln.test.js (`npm test`). Node: require('./regeln'); the island's own pages
// load the same file as a classic script → window.SpaceRegeln (the throw overlay needs the arc).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SpaceRegeln = factory();
})(typeof self !== 'undefined' ? self : this, function () {

// ---- dictation key: hold the right Ctrl, speak, let go ----
//
//   hold ≥ HALTEN_MIN_MS, let go   → the words are pasted where you type
//   two quick taps                 → hands-free; one more tap ends it
//   Esc                            → cancel
//   right Ctrl + another key/click → it was a shortcut (Ctrl+C …): silently dropped
//
// Recording starts on the first key down, so the first word is never lost; a tap or a shortcut throws it away.

const HALTEN_MIN_MS = 280;
const DOPPEL_MS = 420;
const MAX_AUFNAHME_MS = 6 * 60 * 1000;

function diktatTaste() {
  let zustand = 'ruhe'; // ruhe | gedrueckt | tipp | freihand | ende
  let seit = 0;
  let tippBis = 0;
  let aufnahmeSeit = 0;
  let gehalten = false; // 'gehalten' given for this take (live text: only now a token is fetched)

  /**
   * One input event → the actions for insel.js: aufnahmeStart | freihand | gehalten | senden | verwerfen | abbrechen.
   * 'gehalten' comes once per take, as soon as it is a real dictation: the key held ≥ HALTEN_MIN_MS (from `takt`), or
   * hands-free started. A shortcut tap (Ctrl+C) never gets it — live text fetches its token only on 'gehalten'.
   */
  function ereignis(e) {
    const t = e.zeit;
    switch (e.art) {
      case 'diktatRunter': {
        if (zustand === 'ruhe') {
          zustand = 'gedrueckt';
          seit = t;
          aufnahmeSeit = t;
          gehalten = false;
          return ['aufnahmeStart'];
        }
        if (zustand === 'tipp') {
          zustand = 'freihand';
          if (gehalten) return ['freihand'];
          gehalten = true;
          return ['freihand', 'gehalten'];
        }
        if (zustand === 'freihand') {
          zustand = 'ende';
          return ['senden'];
        }
        return []; // key repeat while held
      }
      case 'diktatHoch': {
        if (zustand === 'gedrueckt') {
          if (t - seit >= HALTEN_MIN_MS) {
            zustand = 'ruhe';
            return ['senden'];
          }
          zustand = 'tipp';
          tippBis = t + DOPPEL_MS;
          return [];
        }
        if (zustand === 'ende') zustand = 'ruhe';
        return [];
      }
      case 'esc': {
        if (zustand === 'gedrueckt' || zustand === 'freihand' || zustand === 'tipp') {
          const war = zustand;
          zustand = 'ruhe';
          return [war === 'tipp' ? 'verwerfen' : 'abbrechen'];
        }
        return [];
      }
      case 'andere': { // any other key or a mouse button
        if (zustand === 'gedrueckt' || zustand === 'tipp') {
          zustand = 'ruhe';
          return ['verwerfen'];
        }
        return [];
      }
      case 'takt': { // a clock tick (insel.js calls it every ~100 ms while not at rest)
        if (zustand === 'tipp' && t >= tippBis) {
          zustand = 'ruhe';
          return ['verwerfen'];
        }
        const aus = [];
        if (zustand === 'gedrueckt' && !gehalten && t - seit >= HALTEN_MIN_MS) { gehalten = true; aus.push('gehalten'); }
        if ((zustand === 'gedrueckt' || zustand === 'freihand') && t - aufnahmeSeit >= MAX_AUFNAHME_MS) {
          zustand = zustand === 'gedrueckt' ? 'ende' : 'ruhe';
          aus.push('senden');
        }
        return aus;
      }
      default:
        return [];
    }
  }

  /** The pill's mic button: hands-free right away. */
  function freihand(t) {
    if (zustand !== 'ruhe') return [];
    zustand = 'freihand';
    aufnahmeSeit = t;
    gehalten = true;
    return ['aufnahmeStart', 'freihand', 'gehalten'];
  }

  /** The pill's ✓: finish now (the key is not held). */
  function fertig() {
    if (zustand !== 'gedrueckt' && zustand !== 'freihand') return [];
    zustand = zustand === 'gedrueckt' ? 'ende' : 'ruhe';
    return ['senden'];
  }

  return {
    ereignis,
    freihand,
    fertig,
    get zustand() { return zustand; },
    zuruecksetzen() { zustand = 'ruhe'; },
  };
}

// ---- where the windows sit ----

/** The island window: top centre of a display, flush with the screen edge (no notch on a PC). */
// anteil: where the island's centre sits along the top edge (0 = left, 1 = right; dragged in S5), clamped on screen
function inselRahmen(bounds, breite, hoehe, anteil) {
  const a = Number.isFinite(anteil) ? Math.min(1, Math.max(0, anteil)) : 0.5;
  const x = bounds.x + a * bounds.width - breite / 2;
  return {
    x: Math.round(Math.min(bounds.x + bounds.width - breite, Math.max(bounds.x, x))),
    y: bounds.y,
    width: breite,
    height: hoehe,
  };
}

/** The dictation pill window: bottom centre of the work area (above the taskbar). */
function pillenRahmen(workArea, breite, hoehe, abstand) {
  return {
    x: Math.round(workArea.x + (workArea.width - breite) / 2),
    y: Math.round(workArea.y + workArea.height - hoehe - abstand),
    width: breite,
    height: hoehe,
  };
}

/** Is screen point p inside rectangle r (screen coordinates), grown by `rand` on every side? */
function imRechteck(p, r, rand) {
  const m = rand || 0;
  return !!r && p.x >= r.x - m && p.x < r.x + r.width + m && p.y >= r.y - m && p.y < r.y + r.height + m;
}

/** The hot strip at the top edge that wakes the hidden island. */
function weckStreifen(fenster, breite, hoehe) {
  return { x: Math.round(fenster.x + (fenster.width - breite) / 2), y: fenster.y, width: breite, height: hoehe };
}

// ---- what the island knows ----

/**
 * From the app's answers (GET /api/runs/laufend, /api/approvals, /api/team, /api/profile) to the island's state.
 * Never throws on odd input — a missing answer just means «nothing to show».
 */
/** Ab wie vielen Minuten vor Beginn die Insel einen Termin zum Aufnehmen zeigt (Plan «Treffen vor Ort», Teil 1) */
const TERMIN_VORLAUF_MIN = 10

/**
 * Der Termin, den die Insel zum Aufnehmen anbietet, aus GET /api/m2/steno/jetzt: nur einer vor Ort (ohne Meeting-Link:
 * ein Online-Meeting nimmt Steno als Gast auf), der läuft oder in höchstens 10 Minuten beginnt. Die Minuten rechnet
 * die Insel selbst (die Antwort ist bis 5 Minuten alt). Rein.
 */
function terminFuerInsel(termin, jetztMs) {
  if (!termin || typeof termin.id !== 'string' || !termin.id || termin.meetLink) return null;
  const beginn = Date.parse(termin.beginn);
  const ende = Date.parse(termin.ende);
  if (!Number.isFinite(beginn) || !Number.isFinite(ende) || ende <= jetztMs) return null;
  const titel = String(termin.titel || 'Termin').slice(0, 120);
  if (beginn <= jetztMs) {
    const bis = new Date(ende);
    return { id: termin.id, titel, kicker: `läuft · bis ${String(bis.getHours()).padStart(2, '0')}:${String(bis.getMinutes()).padStart(2, '0')}` };
  }
  const min = Math.ceil((beginn - jetztMs) / 60_000);
  if (min > TERMIN_VORLAUF_MIN) return null;
  return { id: termin.id, titel, kicker: `in ${min} Min.` };
}

/** Die zuletzt fertige Sitzung aus GET /api/m2/steno/jetzt, für die Insel (Titel und die zwei Zeilen). Rein. */
function fertigFuerInsel(f) {
  if (!f || typeof f.id !== 'string' || !f.id) return null;
  const zeile = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null);
  return { id: f.id, titel: String(f.titel || 'Sitzung').slice(0, 120), art: String(f.art || 'Protokoll'), entschieden: zeile(f.entschieden), alsNaechstes: zeile(f.alsNaechstes) };
}

function inselLage({ laufend, freigaben, team, profil, sprache, jetzt, jetztMs = Date.now() } = {}) {
  const laeufe = Array.isArray(laufend && laufend.laufend) ? laufend.laufend : [];
  const fertig = Array.isArray(laufend && laufend.fertig) ? laufend.fertig : [];
  const karten = Array.isArray(freigaben && freigaben.approvals) ? freigaben.approvals : [];
  const bots = Array.isArray(team && team.bots) ? team.bots.filter((b) => b && !b.archivedAt) : [];
  const access = (profil && profil.access) || {};
  const steno = access.plan === 'spacebot' || (profil && profil.produkt === 'steno');
  // which service turns dictation into text (GET /api/voice/status → dienst, the person's KI-Option on the server)
  const d = sprache && sprache.dienst;
  const diktatDienst = d && typeof d.name === 'string'
    ? { name: d.name, ort: typeof d.ort === 'string' ? d.ort : '', server: !!d.server }
    : null;
  return {
    angemeldet: !!profil,
    steno,
    diktatDienst,
    name: (profil && typeof profil.nickname === 'string' && profil.nickname.trim()) || null,
    laufend: laeufe.map((l) => ({ id: String(l.id), titel: String(l.titel || 'Auftrag'), bot: l.bot || null, start: l.start || null })),
    fertig: fertig.map((f) => ({ id: String(f.id), titel: String(f.titel || 'Auftrag'), bot: f.bot || null, ok: !!f.ok })),
    freigabenZahl: Number((laufend && laufend.freigaben) || karten.length || 0),
    freigaben: karten.slice(0, 5).map((a) => ({
      id: String(a.id),
      titel: String(a.title || 'Freigabe'),
      text: String(a.summary || ''),
      art: String(a.kind || ''),
      bot: a.bot_id || null,
    })),
    team: bots.slice(0, 8).map((b) => ({ id: String(b.id), name: String(b.name || 'Bot'), farbe: String(b.color || 'sky'), standard: !!b.isDefault })),
    // Plan «Treffen vor Ort»: der Termin zum Aufnehmen und die zuletzt fertige Sitzung (GET /api/m2/steno/jetzt)
    termin: terminFuerInsel(jetzt && jetzt.termin, jetztMs),
    fertigSitzung: fertigFuerInsel(jetzt && jetzt.letzteFertig),
  };
}

/** Bot colour token → rgb channel (same values as BOT_COLORS in the web app). */
const BOT_FARBEN = {
  sky: '51,170,255',
  amber: '251,191,36',
  emerald: '52,211,153',
  teal: '45,212,191',
  orange: '251,146,60',
  red: '248,113,113',
  gold: '234,179,8',
  slate: '148,163,184',
};

// ---- the SPACE Pet (pet.js): bottom right above the taskbar ----

/** The pet window: flush with the bottom-right corner of the work area (the figure keeps its own margin inside). */
function petRahmen(workArea, breite, hoehe) {
  return { x: Math.round(workArea.x + workArea.width - breite), y: Math.round(workArea.y + workArea.height - hoehe), width: breite, height: hoehe };
}

/**
 * Where the pet window goes: the remembered position, clamped so the figure (window-local rect) stays inside the
 * work area — or the bottom-right corner when nothing is remembered or the memory is junk.
 */
function petLage(gemerkt, workArea, fenster, figur) {
  const standard = petRahmen(workArea, fenster.breite, fenster.hoehe);
  if (!gemerkt || !Number.isFinite(gemerkt.x) || !Number.isFinite(gemerkt.y)) return { x: standard.x, y: standard.y };
  const minX = workArea.x - figur.x;
  const maxX = workArea.x + workArea.width - figur.x - figur.width;
  const minY = workArea.y - figur.y;
  const maxY = workArea.y + workArea.height - figur.y - figur.height;
  return {
    x: Math.round(Math.min(maxX, Math.max(minX, gemerkt.x))),
    y: Math.round(Math.min(maxY, Math.max(minY, gemerkt.y))),
  };
}

/**
 * Where the pet may live: the work area — minus the taskbar's height when the taskbar hides itself (then the work area
 * is the whole display, and a figure at the very bottom would sit where the taskbar slides up and takes every click).
 */
const TASKLEISTE_DIP = 48;
function petArbeitsbereich(workArea, bounds) {
  const versteckt = !!bounds && workArea.height >= bounds.height && workArea.width >= bounds.width;
  return versteckt ? { ...workArea, height: workArea.height - TASKLEISTE_DIP } : { ...workArea };
}

const ECKE_RAND = 8;
/** Dragged into the bottom-right corner (the figure touches both edges) → the hide menu. */
function inEcke(lage, workArea, figur, rand) {
  const m = rand == null ? ECKE_RAND : rand;
  const rechts = lage.x + figur.x + figur.width;
  const unten = lage.y + figur.y + figur.height;
  return rechts >= workArea.x + workArea.width - m && unten >= workArea.y + workArea.height - m;
}

/** «1 Minute» / «1 Stunde» / «bis ich es zurückhole» → the moment it comes back (ms), −1 = until brought back, 0 = never hidden. */
function petVersteckBis(wahl, jetzt) {
  if (wahl === '1min') return jetzt + 60 * 1000;
  if (wahl === '1std') return jetzt + 60 * 60 * 1000;
  if (wahl === 'immer') return -1;
  return 0;
}
function petVersteckt(bis, jetzt) {
  return bis === -1 || (Number.isFinite(bis) && bis > jetzt);
}

// Dozing after 2 minutes without a dictation (eyes half shut), asleep after 10 (zZz); the next dictation wakes it.
const DOESEN_MS = 2 * 60 * 1000;
const SCHLAFEN_MS = 10 * 60 * 1000;
function petWachheit(ruheMs) {
  if (ruheMs >= SCHLAFEN_MS) return 'schlaeft';
  if (ruheMs >= DOESEN_MS) return 'doest';
  return 'wach';
}

// Reactions to what was said — at most one every 30 s. The order is the priority.
const REAKTION_PAUSE_MS = 30 * 1000;
const DANKE = ['danke', 'dank', 'dankeschön', 'merci', 'thanks', 'thank'];
const FERTIG = ['fertig', 'erledigt'];
function petReaktion(text, woerter, zuletzt, jetzt) {
  if (Number.isFinite(zuletzt) && jetzt - zuletzt < REAKTION_PAUSE_MS) return null;
  const t = String(text || '').toLowerCase();
  const w = t.split(/[^a-zäöüß]+/).filter(Boolean);
  if (w.some((x) => DANKE.includes(x))) return 'herz';
  if (t.includes('?')) return 'frage';
  if (w.some((x) => FERTIG.includes(x))) return 'huepfer';
  if ((Number(woerter) || 0) >= 80) return 'daumen';
  return null;
}

// The counter: words today, words ever, a streak of days (local date), a level from the total. Only in insel.json.
const LEVEL_STUFEN = [1000, 5000, 25000, 100000];
const zweistellig = (n) => String(n).padStart(2, '0');
/** A Date → «YYYY-MM-DD» in local time. */
function lokalerTag(d) {
  return `${d.getFullYear()}-${zweistellig(d.getMonth() + 1)}-${zweistellig(d.getDate())}`;
}
function naechsterTag(tag) {
  const [j, m, t] = String(tag).split('-').map(Number);
  if (![j, m, t].every(Number.isFinite)) return null;
  const d = new Date(Date.UTC(j, m - 1, t + 1));
  return `${d.getUTCFullYear()}-${zweistellig(d.getUTCMonth() + 1)}-${zweistellig(d.getUTCDate())}`;
}
function petZaehlen(zaehler, woerter, tag) {
  const alt = zaehler && typeof zaehler === 'object' ? zaehler : {};
  const n = Math.max(0, Math.floor(Number(woerter) || 0));
  const gesamt = Math.max(0, Math.floor(Number(alt.gesamt) || 0)) + n;
  let heute = Math.max(0, Math.floor(Number(alt.heute) || 0));
  let streak = Math.max(0, Math.floor(Number(alt.streak) || 0));
  if (alt.tag === tag) {
    heute += n;
    if (n > 0) streak = Math.max(1, streak);
  } else if (n > 0) {
    heute = n;
    streak = alt.tag && naechsterTag(alt.tag) === tag ? streak + 1 : 1;
  } else {
    heute = 0; // a new day, nothing said yet — the streak only breaks with the next dictation
  }
  return { tag: n > 0 || alt.tag === tag ? tag : alt.tag || tag, heute, gesamt, streak };
}
function petLevel(gesamt) {
  const g = Number(gesamt) || 0;
  return 1 + LEVEL_STUFEN.filter((s) => g >= s).length;
}
/** «Heute 320 Wörter · Level 2 · 4 Tage» — with the pet's name in front when it has one. */
function petTooltip(zaehler, name) {
  const z = zaehler || {};
  const heute = Number(z.heute) || 0;
  const streak = Number(z.streak) || 0;
  const text = `Heute ${heute} ${heute === 1 ? 'Wort' : 'Wörter'} · Level ${petLevel(z.gesamt)} · ${streak} ${streak === 1 ? 'Tag' : 'Tage'}`;
  const n = typeof name === 'string' ? name.trim() : '';
  return n ? `${n} · ${text}` : text;
}

// The throw: a bubble with the first words flies in an arc from the pet to the pointer; on impact the text is pasted.
const WURF_MS = 400;
/** Point on the arc at progress p (0..1): straight line plus a parabola, higher for longer throws (36–160 px). */
function wurfBogen(von, nach, p) {
  const q = Math.min(1, Math.max(0, p));
  const dx = nach.x - von.x;
  const dy = nach.y - von.y;
  const hoehe = Math.min(160, Math.max(36, Math.hypot(dx, dy) * 0.28));
  return { x: von.x + dx * q, y: von.y + dy * q - hoehe * 4 * q * (1 - q) };
}
/** The first words for the bubble (at most ~24 characters, then …). */
function wurfText(text) {
  const w = String(text || '').trim().split(/\s+/).filter(Boolean);
  let aus = '';
  for (const x of w) {
    if (aus && aus.length + x.length + 1 > 24) return `${aus} …`;
    aus = aus ? `${aus} ${x}` : x;
    if (aus.length > 24) return `${aus.slice(0, 23)}…`;
  }
  return aus;
}

/** The bot colour the pet wears (rgb channels): the bot in the chat, else the team's default bot, else sky. */
function petFarbe(lage) {
  const l = lage || {};
  const name = (l.aktiverBot && l.aktiverBot.farbe) || ((l.team || []).find((b) => b.standard) || {}).farbe || 'sky';
  return BOT_FARBEN[name] || BOT_FARBEN.sky;
}

// ---- the upload to the app ----

// ---- clean-up of a dictation: filler words only (Plan 2026-11-25-insel-diktat.md, S4) ----
//
// Removes a standalone «äh», «ähm», «öhm», «hm» (with the comma that sets it off); «mhm» stays, it often means «yes».
// Nothing else: doubled words stay («die die» is correct German). Untouched: all caps («HM» is a brand), after a number
// («5 hm»), with a hyphen («äh-Laute»). Clean-up only where a filler was (mark): spaces, comma, its own punctuation at a
// sentence start, a line that held only the filler. A text without a filler comes back character for character.
// 1:1 as fuellwoerterWeg in the web app (src/lib/voice/fuellwoerter.ts) — change both together.
const FUELL_RE = /(^|[\s,;])[ \t ]*(äh|ähh|ähm|ähmm|öhm|hm|hmm)(?![\p{L}\p{N}-])(?:[ \t ]*(?:\.\.\.|…))?([ \t ]*[,;]|[ \t ]*[.?!]+)?/giu;
/** Where a filler was. */
const STELLE = '\u0002';
/** The removed filler was capitalised: capitalise the next word. */
const GROSS = '\u0001';
const RAUM = '[ \\t\\u00a0]*';
const AM_ANFANG = new RegExp(`^${RAUM}((?:${GROSS}?${STELLE}${RAUM})+)`);
const AM_ENDE = new RegExp(`${RAUM}(?:${GROSS}?${STELLE}${RAUM})+$`);
const VOR_ZEICHEN = new RegExp(`${RAUM}(?:${GROSS}?${STELLE}${RAUM})+(?=[.,;:!?…])`, 'g');
const DAZWISCHEN = new RegExp(`${RAUM}((?:${GROSS}?${STELLE}${RAUM})+)`, 'g');

function zeileAufraeumen(zeile) {
  return zeile
    .replace(AM_ANFANG, (_m, marken) => (marken.includes(GROSS) ? GROSS : ''))
    .replace(AM_ENDE, '')
    .replace(VOR_ZEICHEN, '')
    .replace(DAZWISCHEN, (_m, marken) => ` ${marken.includes(GROSS) ? GROSS : ''}`)
    .replace(/\u0001([^\p{L}]*)(\p{L})/gu, (_m, zwischen, b) => zwischen + b.toUpperCase())
    .split(GROSS).join('');
}

function aufraeumen(text) {
  if (typeof text !== 'string' || !text) return text;
  let entfernt = false;
  const roh = text.replace(FUELL_RE, (m, vor, wort, nach, pos, ganz) => {
    const kleinOderErstGross = wort === wort.toLowerCase() || wort.slice(1) === wort.slice(1).toLowerCase();
    if (!kleinOderErstGross || /\d[ \t ]*$/.test(ganz.slice(0, pos + vor.length))) return m;
    entfernt = true;
    const davor = ganz.slice(0, pos).replace(/[ \t ]+$/, '');
    const satzanfang = vor === '' || vor === '\n' || vor === '\r' || davor === '' || /[.!?…:\n]$/.test(davor);
    const eigenesZeichen = nach && /[.?!]/.test(nach) && !satzanfang ? nach.trim() : '';
    return (vor === ';' ? ';' : /[\r\n]/.test(vor) ? vor : '') + (wort[0] !== wort[0].toLowerCase() ? GROSS : '') + STELLE + eigenesZeichen;
  });
  if (!entfernt) return text;
  // line by line: only lines with a mark change; a line that held only fillers goes with its line break
  const teile = roh.split(/(\r?\n)/);
  const aus = [];
  for (let i = 0; i < teile.length; i += 2) {
    const zeile = teile[i];
    const umbruch = teile[i + 1] ?? '';
    if (!zeile.includes(STELLE)) { aus.push(zeile, umbruch); continue }
    const sauber = zeileAufraeumen(zeile);
    if (/[\p{L}\p{N}]/u.test(sauber)) { aus.push(sauber, umbruch); continue }
    // dropped line between two blank lines: one blank line is enough
    const vorigeLeer = aus.length >= 2 && aus[aus.length - 2] === '' && aus[aus.length - 1] !== '';
    const naechsteLeer = teile[i + 2] === '';
    if (vorigeLeer && naechsteLeer) { aus.pop(); aus.pop() }
    if (!umbruch && aus.length) aus.pop();
  }
  // a dropped first or last line leaves no empty line at the edge of the text
  const ersteWeg = !teile[0].includes(STELLE) ? false : !/[\p{L}\p{N}]/u.test(zeileAufraeumen(teile[0]));
  const letzteWeg = !teile[teile.length - 1].includes(STELLE) ? false : !/[\p{L}\p{N}]/u.test(zeileAufraeumen(teile[teile.length - 1]));
  let sauber = aus.join('');
  if (ersteWeg) sauber = sauber.replace(/^\r?\n/, '');
  if (letzteWeg) sauber = sauber.replace(/\r?\n$/, '');
  // only punctuation left («Hm.»): nothing was said
  return /[\p{L}\p{N}]/u.test(sauber) ? sauber : '';
}

// ---- settings the sheet «Diktat», the tray and the app may change (Plan 2026-11-25-insel-diktat.md, S1) ----
//
// The dictation key is stored as `diktat` (one source: «Strg rechts» = on, «Aus» = off), so a step back to 1.0.15
// keeps working. `hoverOeffnen` is still accepted (the app page of 1.0.15 sends it) but nothing reads it any more.
const TASTEN = ['strgRechts', 'aus'];
const SCHALTER_EINSTELLUNGEN = ['an', 'diktat', 'toene', 'hoverOeffnen', 'begruesst', 'pet', 'lokalDiktat', 'zeigtLaeufe', 'zeigtFreigaben'];
/** One change → the patch to store, or null when the key or the value is not allowed. */
function einstellungPruefen(schluessel, wert) {
  if (schluessel === 'taste') return TASTEN.includes(wert) ? { diktat: wert !== 'aus' } : null;
  if (schluessel === 'inselGroesse') return Object.prototype.hasOwnProperty.call(GROESSEN, wert) ? { inselGroesse: wert } : null;
  if (schluessel === 'inselAussehen') return AUSSEHEN.includes(wert) ? { inselAussehen: wert } : null;
  // «Zurück in die Mitte»: only null may come from a window; the dragged spot is set by main's drag alone
  if (schluessel === 'inselLage') return wert === null ? { inselLage: null } : null;
  if (schluessel === 'mikrofon') { const m = mikrofonPruefen(wert); return m === undefined ? null : { mikrofon: m }; }
  if (!SCHALTER_EINSTELLUNGEN.includes(schluessel)) return null;
  const patch = { [schluessel]: !!wert };
  // switching the pet on also brings back a pet hidden «until I fetch it»
  if (schluessel === 'pet' && wert) patch.petVersteckt = 0;
  return patch;
}
/** The dictation key as the sheet and the app show it. */
function tasteVon(e) { return e && e.diktat === false ? 'aus' : 'strgRechts'; }

// ---- the last dictation, once more (Plan 2026-11-25-insel-diktat.md, S2) ----
// Kept in memory only (never on disk), for LETZTES_MS after it was pasted.
const LETZTES_MS = 10 * 60 * 1000;
function letztesDiktatGueltig(gemerkt, jetzt) {
  return !!(gemerkt && typeof gemerkt.text === 'string' && gemerkt.text && jetzt - gemerkt.zeit < LETZTES_MS);
}

// ---- dragging the island along the top edge (S5) ----
const ZIEH_SCHWELLE = 6;
/** The window's x while dragging: start + movement, clamped on screen; null below the threshold (then it is a click). */
function inselZiehen(start, zeiger, bounds, breite) {
  const dx = zeiger.x - start.zeigerX;
  if (!start.gezogen && Math.abs(dx) < ZIEH_SCHWELLE) return null;
  return Math.round(Math.min(bounds.x + bounds.width - breite, Math.max(bounds.x, start.fensterX + dx)));
}
/**
 * The screen set-up the island sits on (primary display: size in DIP and scaling). A dragged spot belongs to one set-up;
 * on another monitor or resolution the island is back in the middle.
 */
function inselAufbau(display) {
  const b = (display && display.bounds) || {};
  return `${b.width}x${b.height}@${display && display.scaleFactor}`;
}
/** Where the island's centre sits (0–1 of the width): the dragged spot of this set-up, else the middle. */
function inselAnteilFuer(lage, aufbau) {
  if (!lage || lage.aufbau !== aufbau || !Number.isFinite(lage.x) || lage.x < 0 || lage.x > 1) return 0.5;
  return lage.x;
}
/** The share (0–1) along the screen width that inselRahmen puts the island's centre at. */
function inselAnteil(fensterX, bounds, breite) {
  if (!bounds.width) return 0.5;
  return Math.min(1, Math.max(0, (fensterX + breite / 2 - bounds.x) / bounds.width));
}

// ---- adapting the island (Plan 2026-11-25-insel-diktat.md, S7): size, look, what it shows, microphone ----

const GROESSEN = { klein: 0.85, normal: 1, gross: 1.2 };
/** The island's size factor; «gross» needs room (work area ≥ 1280 DIP), else it is «normal». */
function groesseFaktor(e, arbeitsBreite) {
  const g = e && GROESSEN[e.inselGroesse] ? e.inselGroesse : 'normal';
  if (g === 'gross' && arbeitsBreite < 1280) return 1;
  return GROESSEN[g];
}
const AUSSEHEN = ['app', 'hell', 'dunkel'];
/** «wie die App»: data-theme of the app page (liquid-glass = light, dark), else Windows; or fixed light / dark. */
function aussehenWirksam(e, systemDunkel) {
  const a = e && AUSSEHEN.includes(e.inselAussehen) ? e.inselAussehen : 'app';
  if (a !== 'app') return a;
  if (e && e.appAussehen === 'liquid-glass') return 'hell';
  if (e && e.appAussehen === 'dark') return 'dunkel';
  return systemDunkel ? 'dunkel' : 'hell';
}
/** What the island's windows get: runs and approvals only when shown. The tray keeps the full state (amber stays). */
function lageFuerInsel(l, e) {
  if (!l) return l;
  const out = { ...l };
  if (e && e.zeigtLaeufe === false) { out.laufend = []; out.fertig = []; }
  if (e && e.zeigtFreigaben === false) { out.freigaben = []; out.freigabenZahl = 0; }
  return out;
}
/** Fetch the approvals' cards only when they are shown and some are open (the count comes with /api/runs/laufend). */
function freigabenAbfragen(e, zahl) {
  return !(e && e.zeigtFreigaben === false) && zahl > 0;
}
/** A chosen microphone: { id, name } with sane lengths, or null (the system's default). */
function mikrofonPruefen(wert) {
  if (wert === null || wert === undefined || wert === '') return null;
  if (typeof wert !== 'object' || typeof wert.id !== 'string' || !wert.id || wert.id.length > 200) return undefined;
  if (wert.id === 'default' || wert.id === 'communications') return null;
  return { id: wert.id, name: typeof wert.name === 'string' ? wert.name.slice(0, 100) : '' };
}

/** A multipart/form-data body with one file field (net.fetch takes a Buffer, not FormData). */
function multipart(feld, dateiname, mime, bytes) {
  const grenze = `----spaceinsel${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const kopf = Buffer.from(
    `--${grenze}\r\nContent-Disposition: form-data; name="${feld}"; filename="${dateiname.replace(/"/g, '')}"\r\n`
    + `Content-Type: ${mime}\r\n\r\n`,
  );
  const fuss = Buffer.from(`\r\n--${grenze}--\r\n`);
  return { typ: `multipart/form-data; boundary=${grenze}`, koerper: Buffer.concat([kopf, Buffer.from(bytes), fuss]) };
}

/**
 * What the island says after a «Notiz an mich» reached the server (POST …/audio/finalize answered with `fertig`).
 * The sound is stored in every case: a warning (transcription did not start) or 409 (a finish is running) means the
 * text comes later; anything else (timeout, 5xx) leaves it unprocessed in «Sitzungen». Rein.
 */
function notizErgebnis(id, fertig) {
  const f = fertig || {};
  if (f.ok && !(f.daten && f.daten.warning)) return { id, text: 'Notiz gespeichert · die Zusagen kommen in deine To-dos', art: 'info' };
  if (f.ok || f.status === 409) return { id, text: 'Notiz gespeichert · der Text kommt etwas später', art: 'info' };
  return { id, text: 'Notiz gespeichert, aber noch nicht verarbeitet. Bitte in SME unter Sitzungen öffnen.', art: 'fehler' };
}

// ---- live text while dictating (Plan docs/plans/2026-11-25-live-text.md, Stufe 1) ----

/**
 * Which live way a dictation takes: 'scribe' only when the server says so (`/api/voice/status` inselLive — the server
 * gives it only for «Standard») and the dictation would go to the cloud anyway: «Diktat auf diesem PC» off, or on
 * while the model is not ready (missing, broken) — then today's way sends the sound through the app to the cloud, and
 * live changes nothing about that (Entscheid Chief 25.11.2026). Model ready → everything stays on this PC, never live.
 * The same condition as diktatWeg in lokal-regeln.js. A note («Notiz an mich») never goes live. Else null.
 * The server checks again on every token (403 for every other KI-Option); this is only the first door. Rein.
 */
function liveWeg({ realtime, lokalDiktat, lokalBereit, zweck } = {}) {
  if (realtime !== true) return null;
  if (lokalDiktat !== false && lokalBereit !== false) return null;
  if (zweck && zweck !== 'diktat') return null;
  return 'scribe';
}

/** How long the island waits for the final text after the commit before it takes today's way (measured 0.2 s). */
const LIVE_SCHLUSS_MS = 800;
/** At most this much sound waits in main for the socket (16 kHz PCM, 32 KB/s); then the live way gives up. */
const LIVE_SCHLANGE_BYTES = 10 * 32000;
/** The live line shows at most this many characters (one line in the pill). */
const LIVE_ZEICHEN = 64;

/**
 * The line the pill shows while the person speaks: the end of what was heard, cut at a word so the line never starts
 * in the middle of a word, with «…» in front when something was cut. Whitespace collapsed. Rein.
 */
function liveZeile(text, max = LIVE_ZEICHEN) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const ende = t.slice(t.length - (max - 2));
  const leer = ende.indexOf(' ');
  return `… ${leer >= 0 && leer < ende.length - 1 ? ende.slice(leer + 1) : ende}`;
}

/**
 * How a new partial text relates to the shown one, so the pill keeps the stable start still and only lets the new
 * end fade in (no jumping): the longest common start, cut back to a word boundary. Rein.
 */
function liveStabil(alt, neu) {
  const a = String(alt || '');
  const b = String(neu || '');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i < b.length && i > 0 && b[i - 1] !== ' ' && b[i] !== ' ') {
    const w = b.lastIndexOf(' ', i - 1);
    i = w >= 0 ? w + 1 : 0;
  }
  return { stabil: b.slice(0, i), neu: b.slice(i) };
}

/**
 * After the commit: which text goes in. The live final text when it came and is not empty; an empty final text only
 * when the take was silent (peak < 0.004, like the pill's own rule). Else null → today's way (/api/voice/transcribe
 * or the model on this PC) with the recording that stayed on this PC. Rein.
 */
function liveErgebnis({ text, peak } = {}) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (t) return { text: t };
  if (typeof text === 'string' && Number.isFinite(peak) && peak < 0.004) return { text: '' };
  return null;
}

/** A multipart/form-data body with several fields: { name, wert } or { name, datei, mime, bytes } (Notiz an mich). */
function formular(felder) {
  const grenze = `----spaceinsel${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const teile = [];
  for (const f of felder) {
    const name = String(f.name).replace(/"/g, '');
    if (f.datei !== undefined) {
      teile.push(Buffer.from(`--${grenze}\r\nContent-Disposition: form-data; name="${name}"; filename="${String(f.datei).replace(/"/g, '')}"\r\nContent-Type: ${f.mime}\r\n\r\n`));
      teile.push(Buffer.from(f.bytes));
      teile.push(Buffer.from('\r\n'));
    } else {
      teile.push(Buffer.from(`--${grenze}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${String(f.wert)}\r\n`));
    }
  }
  teile.push(Buffer.from(`--${grenze}--\r\n`));
  return { typ: `multipart/form-data; boundary=${grenze}`, koerper: Buffer.concat(teile) };
}

/** What a failed transcription tells the person (the app's German message when it has one). */
function diktatFehler(status, antwort) {
  if (status === 401) return 'Bitte zuerst in SME anmelden.';
  if (status === 429) return 'Kurz warten — zu viele Diktate hintereinander.';
  const meldung = antwort && (antwort.error || antwort.message);
  if (typeof meldung === 'string' && meldung.length < 200) return meldung;
  return 'Das Diktat liess sich nicht lesen.';
}

return {
  HALTEN_MIN_MS, DOPPEL_MS, MAX_AUFNAHME_MS,
  diktatTaste, inselRahmen, pillenRahmen, imRechteck, weckStreifen, inselLage, terminFuerInsel, fertigFuerInsel, TERMIN_VORLAUF_MIN, BOT_FARBEN, multipart, formular, notizErgebnis, liveWeg, liveZeile, liveStabil, liveErgebnis, LIVE_SCHLUSS_MS, LIVE_SCHLANGE_BYTES, LIVE_ZEICHEN, diktatFehler, aufraeumen, TASTEN, einstellungPruefen, tasteVon, LETZTES_MS, letztesDiktatGueltig, ZIEH_SCHWELLE, inselZiehen, inselAnteil, inselAufbau, inselAnteilFuer,
  GROESSEN, groesseFaktor, AUSSEHEN, aussehenWirksam, lageFuerInsel, freigabenAbfragen, mikrofonPruefen,
  // the pet
  DOESEN_MS, SCHLAFEN_MS, REAKTION_PAUSE_MS, WURF_MS, LEVEL_STUFEN, ECKE_RAND, TASKLEISTE_DIP,
  petRahmen, petLage, petArbeitsbereich, inEcke, petVersteckBis, petVersteckt, petWachheit, petReaktion,
  lokalerTag, naechsterTag, petZaehlen, petLevel, petTooltip, wurfBogen, wurfText, petFarbe,
};
});
