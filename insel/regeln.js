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

  /** One input event → the actions for insel.js: aufnahmeStart | zeigen | senden | verwerfen | abbrechen. */
  function ereignis(e) {
    const t = e.zeit;
    switch (e.art) {
      case 'diktatRunter': {
        if (zustand === 'ruhe') {
          zustand = 'gedrueckt';
          seit = t;
          aufnahmeSeit = t;
          return ['aufnahmeStart'];
        }
        if (zustand === 'tipp') {
          zustand = 'freihand';
          return ['freihand'];
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
        if ((zustand === 'gedrueckt' || zustand === 'freihand') && t - aufnahmeSeit >= MAX_AUFNAHME_MS) {
          zustand = zustand === 'gedrueckt' ? 'ende' : 'ruhe';
          return ['senden'];
        }
        return [];
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
    return ['aufnahmeStart', 'freihand'];
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
function inselRahmen(bounds, breite, hoehe) {
  return {
    x: Math.round(bounds.x + (bounds.width - breite) / 2),
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
function inselLage({ laufend, freigaben, team, profil } = {}) {
  const laeufe = Array.isArray(laufend && laufend.laufend) ? laufend.laufend : [];
  const fertig = Array.isArray(laufend && laufend.fertig) ? laufend.fertig : [];
  const karten = Array.isArray(freigaben && freigaben.approvals) ? freigaben.approvals : [];
  const bots = Array.isArray(team && team.bots) ? team.bots.filter((b) => b && !b.archivedAt) : [];
  const access = (profil && profil.access) || {};
  const steno = access.plan === 'spacebot' || (profil && profil.produkt === 'steno');
  return {
    angemeldet: !!profil,
    steno,
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

/** What a failed transcription tells the person (the app's German message when it has one). */
function diktatFehler(status, antwort) {
  if (status === 401) return 'Bitte zuerst in SPACE anmelden.';
  if (status === 429) return 'Kurz warten — zu viele Diktate hintereinander.';
  const meldung = antwort && (antwort.error || antwort.message);
  if (typeof meldung === 'string' && meldung.length < 200) return meldung;
  return 'Das Diktat liess sich nicht lesen.';
}

return {
  HALTEN_MIN_MS, DOPPEL_MS, MAX_AUFNAHME_MS,
  diktatTaste, inselRahmen, pillenRahmen, imRechteck, weckStreifen, inselLage, BOT_FARBEN, multipart, diktatFehler,
  // the pet
  DOESEN_MS, SCHLAFEN_MS, REAKTION_PAUSE_MS, WURF_MS, LEVEL_STUFEN, ECKE_RAND, TASKLEISTE_DIP,
  petRahmen, petLage, petArbeitsbereich, inEcke, petVersteckBis, petVersteckt, petWachheit, petReaktion,
  lokalerTag, naechsterTag, petZaehlen, petLevel, petTooltip, wurfBogen, wurfText, petFarbe,
};
});
