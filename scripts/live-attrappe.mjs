// Socket double for the island's live text (Plan docs/plans/2026-11-25-live-text.md, Abnahme 1 and 3) — no service,
// no network, no costs. Speaks the part of the ElevenLabs Scribe realtime protocol the island uses:
//   → session_started on connect
//   ← input_audio_chunk (base64 PCM 16 kHz): counts the seconds; every WORT_MS of sound one more word as partial_transcript
//   ← input_audio_chunk with commit: true → committed_transcript with the words so far, after --verzoegerung ms
// Start the unpacked app with SPACE_INSEL_LIVE_TEST=ws://127.0.0.1:<port>/v1/speech-to-text/realtime (main.js takes it only
// unpackaged and only for 127.0.0.1). Modes for the fallback: --modus stumm (never a final text), --modus zu (closes at
// once), --modus fehler (sends an error after the first sound).
//
//   node scripts/live-attrappe.mjs [--port 9571] [--text "…"] [--verzoegerung 200] [--modus normal|stumm|zu|fehler]

import http from 'node:http';
import crypto from 'node:crypto';

const arg = (name, standard) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : standard; };
const PORT = Number(arg('port', 9571));
const TEXT = arg('text', 'Ich schicke dir die Offerte heute noch und rufe dich morgen früh wegen dem Termin in Zürich an.');
const VERZOEGERUNG = Number(arg('verzoegerung', 200));
const MODUS = arg('modus', 'normal');
const WORT_MS = 330;
const woerter = TEXT.split(/\s+/);
const log = (s) => console.log(`${new Date().toISOString().slice(11, 23)} ${s}`);

function rahmen(text) {
  const daten = Buffer.from(text);
  const kopf = daten.length < 126 ? Buffer.from([0x81, daten.length])
    : daten.length < 65536 ? Buffer.from([0x81, 126, daten.length >> 8, daten.length & 255])
      : Buffer.concat([Buffer.from([0x81, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(daten.length)); return b; })()]);
  return Buffer.concat([kopf, daten]);
}

const server = http.createServer((_req, res) => { res.writeHead(426); res.end(); });
server.on('upgrade', (req, sock) => {
  const url = new URL(req.url, 'http://x');
  log(`verbunden ${url.pathname} (Modell ${url.searchParams.get('model_id')}, commit ${url.searchParams.get('commit_strategy')}, keyterms ${url.searchParams.getAll('keyterms').length})`);
  const accept = crypto.createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const schicken = (o) => { if (!sock.destroyed) sock.write(rahmen(JSON.stringify(o))); };
  if (MODUS === 'zu') { log('Modus zu: schliesse'); sock.end(); return; }
  schicken({ message_type: 'session_started', session_id: crypto.randomUUID(), config: { sample_rate: 16000 } });
  let bytes = 0;
  let gezeigt = 0;
  let puffer = Buffer.alloc(0);
  const nachricht = (text) => {
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (m.message_type !== 'input_audio_chunk') return;
    if (m.audio_base_64) bytes += Buffer.from(m.audio_base_64, 'base64').length;
    if (MODUS === 'fehler' && bytes > 0) { schicken({ message_type: 'transcriber_error', error: 'Attrappe: Fehler' }); return; }
    const n = Math.min(woerter.length, Math.floor((bytes / 32) / WORT_MS));
    if (n > gezeigt) { gezeigt = n; schicken({ message_type: 'partial_transcript', text: woerter.slice(0, n).join(' ') }); }
    if (m.commit) {
      log(`commit nach ${(bytes / 32000).toFixed(2)} s Ton, ${gezeigt} Wörter`);
      if (MODUS === 'stumm') return;
      setTimeout(() => schicken({ message_type: 'committed_transcript', text: woerter.slice(0, Math.max(gezeigt, 1)).join(' ') }), VERZOEGERUNG);
    }
  };
  sock.on('data', (stueck) => {
    puffer = Buffer.concat([puffer, stueck]);
    for (;;) {
      if (puffer.length < 2) return;
      const op = puffer[0] & 15;
      let len = puffer[1] & 127;
      let o = 2;
      if (len === 126) { if (puffer.length < 4) return; len = puffer.readUInt16BE(2); o = 4; }
      else if (len === 127) { if (puffer.length < 10) return; len = Number(puffer.readBigUInt64BE(2)); o = 10; }
      const maske = puffer[1] & 128 ? puffer.subarray(o, o + 4) : null;
      if (maske) o += 4;
      if (puffer.length < o + len) return;
      const daten = Buffer.from(puffer.subarray(o, o + len));
      if (maske) for (let i = 0; i < daten.length; i++) daten[i] ^= maske[i & 3];
      puffer = puffer.subarray(o + len);
      if (op === 8) { log('vom Client geschlossen'); sock.end(); return; }
      if (op === 1) nachricht(daten.toString('utf8'));
    }
  });
  sock.on('error', () => {});
});
server.listen(PORT, '127.0.0.1', () => log(`Attrappe auf ws://127.0.0.1:${PORT}/v1/speech-to-text/realtime (Modus ${MODUS})`));
