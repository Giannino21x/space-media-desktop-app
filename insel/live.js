// Live text while dictating at the island (Plan docs/plans/2026-11-25-live-text.md, Stufe 1): one session per take.
// The socket runs here in main, never in the pill: the single-use token stays in main, the pill needs no network and no
// new CSP, and the final text arrives where it is pasted. The pill sends 16 kHz PCM over IPC (32 KB/s) from the start
// of the take; main queues it (at most LIVE_SCHLANGE_BYTES) until the socket is open.
//
// The token is fetched only on 'gehalten' (key held ≥ 0.28 s, or hands-free): a shortcut tap never costs anything.
// Whatever fails (token refused, socket, network, service, no final text in time), the take goes today's way with the
// recording that stayed on this PC: this module only ever answers «here is the final text» or «null».
// The socket address carries the token in its query: it never goes into a log.
//
// Protocol (ElevenLabs Scribe realtime, as in the web app's voice-realtime-client.ts): input_audio_chunk with base64
// PCM, commit = empty chunk with commit: true (commit_strategy manual), partial_transcript / committed_transcript.

'use strict';

const { LIVE_SCHLANGE_BYTES } = require('./regeln');

const MODELL = 'scribe_v3_live'; // like SCRIBE_LIVE_MODELL in the web app (src/lib/ai/scribe-modell.ts)
const PFAD = '/v1/speech-to-text/realtime';
const VERBINDEN_MS = 5000;
const FEHLER_ARTEN = /error|exceeded|rate_limited|commit_throttled|unaccepted_terms|invalid_request|queue_overflow|resource_exhausted/;
/** Keyterms: realtime takes at most 100 and 1000 characters in all (ElevenLabs docs, read 25.11.2026). */
const KEYTERMS_MAX = 100;
const KEYTERMS_ZEICHEN = 1000;

/**
 * The socket address from the token answer. Only wss on *.elevenlabs.io with the realtime path; for tests (unpackaged
 * only, `testErlaubt`) also ws://127.0.0.1. Throws on anything else. Never log the result. Pure.
 */
function socketAdresse(zugang, { testErlaubt = false } = {}) {
  const url = new URL(zugang.websocketUrl);
  const echt = url.protocol === 'wss:' && url.hostname.endsWith('.elevenlabs.io') && url.pathname === PFAD;
  const test = testErlaubt && url.protocol === 'ws:' && url.hostname === '127.0.0.1';
  if ((!echt && !test) || url.username || url.password) throw new Error('ungültige Adresse');
  url.search = '';
  url.searchParams.set('token', zugang.token);
  url.searchParams.set('model_id', MODELL);
  url.searchParams.set('audio_format', 'pcm_16000');
  url.searchParams.set('commit_strategy', 'manual');
  url.searchParams.set('include_timestamps', 'false');
  if (zugang.languageCode === 'de') url.searchParams.set('language_code', 'de');
  let zeichen = 0;
  let n = 0;
  for (const w of Array.isArray(zugang.woerter) ? zugang.woerter : []) {
    const wort = typeof w === 'string' ? w.trim().slice(0, 50) : '';
    if (!wort || n >= KEYTERMS_MAX || zeichen + wort.length > KEYTERMS_ZEICHEN) continue;
    url.searchParams.append('keyterms', wort);
    zeichen += wort.length;
    n++;
  }
  return url.toString();
}

/** The token answer must look exactly like the web app's: token, sessionId (uuid), websocketUrl, languageCode de|null. */
function zugangPruefen(d) {
  return !!d && typeof d.token === 'string' && d.token.length > 0 && d.token.length <= 4096
    && typeof d.sessionId === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(d.sessionId)
    && typeof d.websocketUrl === 'string'
    && (d.languageCode === 'de' || d.languageCode === null);
}

/**
 * @param {object} d
 * @param {(pfad: string, opts?: object) => Promise<{ ok: boolean, status: number, daten: any }>} d.api  the app session
 * @param {typeof WebSocket} d.WebSocketImpl
 * @param {boolean} [d.testErlaubt]  unpackaged only: ws://127.0.0.1 (socket double)
 * @param {(s: string) => void} [d.log]  never gets the address or the token
 */
function createLive(d) {
  const log = d.log || (() => {});
  const KOPF = { 'x-space-insel': '1' };

  function sitzung(id, { onTeil, onWeg } = {}) {
    let zustand = 'wartet'; // wartet | verbindet | offen | festgehalten | fertig | aufgegeben | beendet
    let schlange = [];
    let schlangeBytes = 0;
    let gesendet = 0;
    let zugang = null;
    let socket = null;
    let schlussText = null;
    let verbindenUhr = null;
    // commits the service made on its own before ours (long takes): kept, they lead the final text
    let zwischen = '';
    // the pill's «all sound sent» (pille:pcm-ende) — it may come after pille:audio; whoever waits gets it
    let endeDa = false;
    const endeWarter = new Set();
    const warter = new Set(); // resolvers waiting in schluss()
    const mit = (text) => `${zwischen} ${text}`.trim();

    const melden = () => { for (const w of warter) w(); };

    function aufgeben(grund) {
      if (zustand === 'aufgegeben' || zustand === 'beendet' || zustand === 'fertig') return;
      log(`live ${id}: aufgegeben (${grund})`);
      zustand = 'aufgegeben';
      schlange = []; schlangeBytes = 0;
      zu();
      melden();
      if (onWeg) onWeg();
    }

    function zu() {
      clearTimeout(verbindenUhr);
      if (socket) {
        socket.onopen = null; socket.onmessage = null; socket.onerror = null; socket.onclose = null;
        try { socket.close(); } catch { /* already closed */ }
        socket = null;
      }
    }

    function schicken(pcm) {
      if (!socket || socket.readyState !== 1) return;
      if (socket.bufferedAmount > 160_000) { aufgeben('Netz zu langsam'); return; }
      try {
        socket.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: Buffer.from(pcm).toString('base64'), sample_rate: 16000 }));
        gesendet += pcm.byteLength;
      } catch { aufgeben('senden'); }
    }

    function commit() {
      try { socket.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: '', sample_rate: 16000, commit: true })); }
      catch { aufgeben('commit'); }
    }

    function nachricht(roh) {
      let m;
      try { m = JSON.parse(String(roh)); } catch { aufgeben('ungültige Daten'); return; }
      if (!m || typeof m !== 'object' || typeof m.message_type !== 'string') { aufgeben('ungültige Daten'); return; }
      if (m.message_type === 'session_started') {
        if (zustand !== 'verbindet') return;
        clearTimeout(verbindenUhr);
        zustand = 'offen';
        const wartend = schlange; schlange = []; schlangeBytes = 0;
        for (const pcm of wartend) schicken(pcm);
        log(`live ${id}: offen`);
      } else if (m.message_type === 'partial_transcript' && typeof m.text === 'string') {
        if ((zustand === 'offen' || zustand === 'festgehalten') && onTeil) onTeil(mit(m.text).slice(0, 12_000));
      } else if (m.message_type === 'committed_transcript' && typeof m.text === 'string') {
        if (zustand === 'offen') {
          // the service committed on its own (not asked): keep it, it is the start of the final text
          zwischen = mit(m.text).slice(0, 12_000);
          if (onTeil) onTeil(zwischen);
          return;
        }
        if (zustand !== 'festgehalten') return;
        schlussText = mit(m.text).slice(0, 12_000);
        zustand = 'fertig';
        melden();
      } else if (m.message_type === 'insufficient_audio_activity') {
        if (zustand === 'festgehalten') { schlussText = zwischen; zustand = 'fertig'; melden(); }
      } else if (FEHLER_ARTEN.test(m.message_type)) {
        aufgeben(m.message_type);
      }
    }

    const sitz = {
      get zustand() { return zustand; },
      get gesendetSekunden() { return gesendet / 32000; },

      /** A piece of 16 kHz mono PCM (Int16 little endian) from the pill, in order. */
      pcm(bytes) {
        if (!bytes || !bytes.byteLength) return;
        if (zustand === 'offen') { schicken(bytes); return; }
        if (zustand !== 'wartet' && zustand !== 'verbindet') return;
        if (schlangeBytes + bytes.byteLength > LIVE_SCHLANGE_BYTES) { aufgeben('Schlange voll'); return; }
        schlange.push(Buffer.from(bytes)); schlangeBytes += bytes.byteLength;
      },

      /** 'gehalten': fetch the token and open the socket. Resolves when done trying (never throws). */
      async verbinden() {
        if (zustand !== 'wartet') return;
        zustand = 'verbindet';
        let r;
        try {
          r = await d.api('/api/voice/realtime/token', { method: 'POST', headers: KOPF });
        } catch { aufgeben('Token: Netz'); return; }
        if (zustand !== 'verbindet') {
          // dropped meanwhile: the token was issued, report it as used for 0 s
          if (r && r.ok && zugangPruefen(r.daten)) { zugang = r.daten; zustand = 'aufgegeben'; sitz.beenden(); }
          return;
        }
        // 403 = this KI-Option never goes live (Sichere Cloud, Nur Schweiz, …), 429 = limit: silently today's way
        if (!r || !r.ok) { aufgeben(`Token ${r ? r.status : '?'}`); return; }
        if (!zugangPruefen(r.daten)) { aufgeben('Token ungültig'); return; }
        zugang = r.daten;
        let adresse;
        try { adresse = socketAdresse(zugang, { testErlaubt: !!d.testErlaubt }); } catch { aufgeben('Adresse'); return; }
        try { socket = new d.WebSocketImpl(adresse); } catch { aufgeben('Socket'); return; }
        adresse = null;
        verbindenUhr = setTimeout(() => aufgeben('Verbinden dauert zu lange'), VERBINDEN_MS);
        socket.onmessage = (e) => nachricht(e.data);
        socket.onerror = () => aufgeben('Socket-Fehler');
        socket.onclose = () => { if (zustand !== 'fertig' && zustand !== 'beendet') aufgeben('Socket zu'); };
      },

      /** The pill sent its last sound (pille:pcm-ende). */
      pcmEnde() {
        endeDa = true;
        for (const w of endeWarter) w();
      },
      /** Wait (at most `ms`) for the pill's last sound — pille:audio can arrive before pille:pcm-ende. */
      warteAufEnde(ms) {
        if (endeDa || zustand !== 'offen') return Promise.resolve();
        return new Promise((fertig) => {
          const w = () => { clearTimeout(uhr); endeWarter.delete(w); fertig(); };
          const uhr = setTimeout(w, ms);
          endeWarter.add(w);
        });
      },

      /** 'senden': ask for the final text. Not open yet → give up at once (no waiting: today's way starts now). */
      festhalten() {
        if (zustand === 'offen') { zustand = 'festgehalten'; commit(); return; }
        aufgeben(`festhalten im Zustand ${zustand}`);
      },

      /**
       * The final text, or null (→ today's way). Waits at most `ms` after the call for a commit asked earlier.
       * '' = the service heard nothing (the caller decides with the pill's level, liveErgebnis).
       */
      schluss(ms) {
        if (zustand === 'fertig') return Promise.resolve(schlussText);
        if (zustand !== 'festgehalten') { aufgeben(`schluss im Zustand ${zustand}`); return Promise.resolve(null); }
        return new Promise((fertig) => {
          let uhr = null;
          const w = () => { clearTimeout(uhr); warter.delete(w); fertig(zustand === 'fertig' ? schlussText : null); };
          warter.add(w);
          uhr = setTimeout(() => { aufgeben('kein Schlusstext in der Zeit'); w(); }, ms);
        });
      },

      /** Close everything and report the sound sent (finish, best effort). Idempotent. */
      beenden() {
        if (zustand === 'beendet') return;
        const warOffen = zustand !== 'wartet';
        if (zustand !== 'fertig' && zustand !== 'aufgegeben') zustand = 'aufgegeben';
        zu();
        melden();
        zustand = 'beendet';
        schlange = []; schlangeBytes = 0;
        if (warOffen && zugang) {
          const sekunden = Math.round((gesendet / 32000) * 100) / 100;
          d.api('/api/voice/realtime/finish', {
            method: 'POST',
            headers: { ...KOPF, 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: zugang.sessionId, audioSeconds: sekunden }),
          }).catch(() => { /* the server keeps unfinished sessions as issued */ });
        }
        zugang = null;
      },
    };
    return sitz;
  }

  return { sitzung };
}

module.exports = { createLive, socketAdresse, zugangPruefen, KEYTERMS_MAX, KEYTERMS_ZEICHEN, MODELL };
