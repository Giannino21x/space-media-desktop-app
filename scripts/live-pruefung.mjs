// Prüfskript für den echten Live-Weg (Plan live-text, Stufe 2) — läuft NUR mit --guthaben-freigegeben, weil jeder Lauf
// beim Dienst (ElevenLabs Scribe Live) Geld kostet. Ohne Flag bricht es ab, bevor irgendetwas gesendet wird.
//
// Misst je Datei (16 kHz mono 16-bit WAV), mit genau dem Code der Insel (insel/live.js):
//   - Zeit vom ersten Ton bis zum ersten Wort (partial_transcript)
//   - Zeit vom Loslassen (Commit) bis zum Schlusstext — der Wert, den die Person spürt; dazu +Einfügen (~30 ms)
//   - zum Vergleich: der heutige Weg (POST /api/voice/transcribe) mit derselben Datei, Zeit bis zum Text
//   - Kosten: gesendete Sekunden × Listenpreis (0,22 USD/h + 0,05 mit Keyterms), dazu die Zeile im Verbrauch der App
// Der Ton wird in Echtzeit gestreamt (wie beim Sprechen), in Stücken zu 64 ms.
//
//   SPACE_SITZUNG_COOKIE='<Cookie-Kopf der App-Sitzung>' node scripts/live-pruefung.mjs --app https://app.space-media.ch \
//     --guthaben-freigegeben datei1.wav [datei2.wav …] [--ohne-vergleich]
//
// Der Cookie kommt nur aus der Umgebung und wird nie ausgegeben; die Socket-Adresse (Token) auch nicht.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createLive } = require('../insel/live.js');

const args = process.argv.slice(2);
const wert = (n, s) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : s; };
if (!args.includes('--guthaben-freigegeben')) {
  console.error('Abbruch: Jeder Lauf kostet beim Dienst. Erst mit Gianninos Freigabe und --guthaben-freigegeben.');
  process.exit(2);
}
const APP = wert('app', null);
const COOKIE = process.env.SPACE_SITZUNG_COOKIE;
if (!APP || !COOKIE) { console.error('Abbruch: --app und SPACE_SITZUNG_COOKIE fehlen.'); process.exit(2); }
const dateien = args.filter((a, i) => a.endsWith('.wav') && args[i - 1] !== '--app');
if (!dateien.length) { console.error('Abbruch: keine .wav-Datei.'); process.exit(2); }

const api = async (pfad, opts = {}) => {
  const res = await fetch(`${APP}${pfad}`, { method: opts.method || 'GET', headers: { cookie: COOKIE, accept: 'application/json', ...(opts.headers || {}) }, body: opts.body });
  let daten = null; try { daten = await res.json(); } catch { /* none */ }
  return { ok: res.ok, status: res.status, daten };
};

function pcmAusWav(pfad) {
  const b = readFileSync(pfad);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${pfad}: kein WAV`);
  let o = 12; let fmt = null;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4); const n = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { kanaele: b.readUInt16LE(o + 10), rate: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    if (id === 'data') {
      if (!fmt || fmt.kanaele !== 1 || fmt.rate !== 16000 || fmt.bits !== 16) throw new Error(`${pfad}: bitte 16 kHz mono 16-bit (ffmpeg -i x -ar 16000 -ac 1 -c:a pcm_s16le y.wav)`);
      return b.subarray(o + 8, o + 8 + n);
    }
    o += 8 + n + (n & 1);
  }
  throw new Error(`${pfad}: kein data-Block`);
}
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (z) => { const s = [...z].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

const live = createLive({ api, WebSocketImpl: globalThis.WebSocket, log: (s) => console.log(`  [live] ${s}`) });
const ergebnisse = [];
for (const datei of dateien) {
  const pcm = pcmAusWav(datei);
  const sek = pcm.length / 32000;
  console.log(`\n${datei} (${sek.toFixed(1)} s)`);
  let erstesWort = null;
  const t0 = performance.now();
  const s = live.sitzung(datei, { onTeil: (t) => { if (erstesWort === null && t.trim()) erstesWort = performance.now() - t0; } });
  // like the island: the token after 0.28 s of holding, sound from the first moment
  const stueck = 2048; // 64 ms
  let verbunden = false;
  for (let i = 0; i < pcm.length; i += stueck) {
    s.pcm(pcm.subarray(i, i + stueck));
    if (!verbunden && performance.now() - t0 >= 280) { verbunden = true; s.verbinden(); }
    await warte(64);
  }
  if (!verbunden) await s.verbinden();
  const loslassen = performance.now();
  s.festhalten();
  const text = await s.schluss(5000);
  const schlussMs = performance.now() - loslassen;
  const gesendet = s.gesendetSekunden;
  s.beenden();
  const e = { datei, sek, erstesWortMs: erstesWort && Math.round(erstesWort), schlussMs: text === null ? null : Math.round(schlussMs), text, gesendet, usd: gesendet / 3600 * 0.27 };
  if (!args.includes('--ohne-vergleich')) {
    const fd = new FormData();
    fd.append('audio', new Blob([readFileSync(datei)], { type: 'audio/wav' }), 'pruefung.wav');
    const v0 = performance.now();
    const r = await fetch(`${APP}/api/voice/transcribe`, { method: 'POST', headers: { cookie: COOKIE }, body: fd });
    const j = await r.json().catch(() => null);
    e.heuteMs = Math.round(performance.now() - v0);
    e.heuteText = j && (j.text || j.transcript) || `(Status ${r.status})`;
  }
  console.log(`  erstes Wort nach ${e.erstesWortMs ?? '—'} ms · Loslassen → Schlusstext ${e.schlussMs ?? '— (Rückfall)'} ms${e.heuteMs ? ` · heutiger Weg ${e.heuteMs} ms` : ''}`);
  console.log(`  live:  ${text ?? '(kein Schlusstext)'}`);
  if (e.heuteText) console.log(`  heute: ${e.heuteText}`);
  console.log(`  gesendet ${gesendet.toFixed(1)} s ≈ ${e.usd.toFixed(4)} USD (Liste)`);
  ergebnisse.push(e);
}
const ok = ergebnisse.filter((e) => e.schlussMs !== null);
console.log(`\nMedian Loslassen → Schlusstext: ${median(ok.map((e) => e.schlussMs)) ?? '—'} ms (Ziel ≤ 500) · erstes Wort: ${median(ok.map((e) => e.erstesWortMs).filter(Boolean)) ?? '—'} ms`);
console.log(`Rückfälle: ${ergebnisse.length - ok.length} von ${ergebnisse.length} · Kosten zusammen ≈ ${ergebnisse.reduce((s, e) => s + e.usd, 0).toFixed(4)} USD`);
console.log('Abrechnung der App: api_usage_logs, model elevenlabs/scribe_v3_live, metadata.quelle = insel');
