// Pure rules of the island (insel.js): the dictation key, where the windows sit, what the compact island shows.
// No Electron here — tested in insel/regeln.test.js (`npm test`).

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

module.exports = {
  HALTEN_MIN_MS, DOPPEL_MS, MAX_AUFNAHME_MS,
  diktatTaste, inselRahmen, pillenRahmen, imRechteck, weckStreifen, inselLage, BOT_FARBEN, multipart, diktatFehler,
};
