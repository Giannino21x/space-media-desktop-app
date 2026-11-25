// Live text at the island (insel/live.js) against a socket double — no service, no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLive, socketAdresse, zugangPruefen } = require('./live');

const SID = '11111111-2222-4333-8444-555555555555';
const zugang = (extra = {}) => ({ token: 'tok-geheim', sessionId: SID, websocketUrl: 'wss://api.elevenlabs.io/v1/speech-to-text/realtime', languageCode: 'de', ...extra });

/** A socket double: records what the island sends, the test plays the service. */
function attrappe() {
  const offen = [];
  class FakeSocket {
    constructor(url) { this.url = url; this.readyState = 0; this.bufferedAmount = 0; this.gesendet = []; this.geschlossen = false; offen.push(this); }
    send(s) { this.gesendet.push(JSON.parse(s)); }
    close() { this.geschlossen = true; this.readyState = 3; }
    // the service
    start() { this.readyState = 1; this.onmessage && this.onmessage({ data: JSON.stringify({ message_type: 'session_started', session_id: 'x' }) }); }
    sag(m) { this.onmessage && this.onmessage({ data: JSON.stringify(m) }); }
  }
  return { FakeSocket, offen };
}

function aufbau({ token = { ok: true, status: 200, daten: zugang() }, testErlaubt = false } = {}) {
  const aufrufe = [];
  const logs = [];
  const { FakeSocket, offen } = attrappe();
  const api = async (pfad, opts = {}) => {
    aufrufe.push({ pfad, opts });
    if (pfad === '/api/voice/realtime/token') return typeof token === 'function' ? token() : token;
    return { ok: true, status: 204, daten: null };
  };
  const live = createLive({ api, WebSocketImpl: FakeSocket, testErlaubt, log: (s) => logs.push(s) });
  return { live, aufrufe, logs, offen };
}
const pcm = (n) => new Uint8Array(n).fill(1);
const ruhe = () => new Promise((r) => setImmediate(r));

test('socketAdresse: nur wss auf elevenlabs.io, Token in der Adresse, Keyterms wiederholt, gekürzt', () => {
  const u = new URL(socketAdresse(zugang({ woerter: ['Tremola', 'Huber AG', '', 42] })));
  assert.equal(u.protocol, 'wss:');
  assert.equal(u.searchParams.get('token'), 'tok-geheim');
  assert.equal(u.searchParams.get('commit_strategy'), 'manual');
  assert.equal(u.searchParams.get('audio_format'), 'pcm_16000');
  assert.equal(u.searchParams.get('language_code'), 'de');
  assert.deepEqual(u.searchParams.getAll('keyterms'), ['Tremola', 'Huber AG']);
  const viele = Array.from({ length: 150 }, (_, i) => `Wort${i}`);
  assert.equal(new URL(socketAdresse(zugang({ woerter: viele }))).searchParams.getAll('keyterms').length, 100);
  const lange = Array.from({ length: 40 }, (_, i) => `${'x'.repeat(45)}${i}`);
  const summe = new URL(socketAdresse(zugang({ woerter: lange }))).searchParams.getAll('keyterms').join('').length;
  assert.ok(summe <= 1000, String(summe));
  for (const falsch of ['wss://evil.example.com/v1/speech-to-text/realtime', 'ws://api.elevenlabs.io/v1/speech-to-text/realtime', 'wss://api.elevenlabs.io/v1/other', 'wss://a:b@api.elevenlabs.io/v1/speech-to-text/realtime', 'ws://127.0.0.1:9/x']) {
    assert.throws(() => socketAdresse(zugang({ websocketUrl: falsch })), falsch);
  }
  assert.ok(socketAdresse(zugang({ websocketUrl: 'ws://127.0.0.1:9/x' }), { testErlaubt: true }).startsWith('ws://127.0.0.1:9/x?'));
  assert.throws(() => socketAdresse(zugang({ websocketUrl: 'ws://localhost:9/x' }), { testErlaubt: true }));
});

test('zugangPruefen: Form wie die Web-App', () => {
  assert.ok(zugangPruefen(zugang()));
  assert.ok(zugangPruefen(zugang({ languageCode: null })));
  assert.ok(!zugangPruefen(zugang({ sessionId: 'x' })));
  assert.ok(!zugangPruefen(zugang({ token: '' })));
  assert.ok(!zugangPruefen(zugang({ languageCode: 'en' })));
  assert.ok(!zugangPruefen(null));
});

test('ganzer Weg: Ton wartet bis zum Socket, Zwischentext, Commit, Schlusstext, finish mit den Sekunden', async () => {
  const { live, aufrufe, offen } = aufbau();
  const teile = [];
  const s = live.sitzung('a1', { onTeil: (t) => teile.push(t) });
  s.pcm(pcm(32000)); // 1 s before the token
  assert.equal(aufrufe.length, 0, 'kein Token vor «gehalten»');
  await s.verbinden();
  assert.equal(aufrufe[0].pfad, '/api/voice/realtime/token');
  assert.equal(aufrufe[0].opts.headers['x-space-insel'], '1');
  const sock = offen[0];
  s.pcm(pcm(16000));
  assert.equal(sock.gesendet.length, 0, 'vor session_started nichts gesendet');
  sock.start();
  assert.equal(sock.gesendet.length, 2, 'Schlange zuerst');
  s.pcm(pcm(16000));
  assert.equal(sock.gesendet.length, 3);
  assert.equal(sock.gesendet[0].message_type, 'input_audio_chunk');
  sock.sag({ message_type: 'partial_transcript', text: 'Ich schicke' });
  sock.sag({ message_type: 'partial_transcript', text: 'Ich schicke dir' });
  assert.deepEqual(teile, ['Ich schicke', 'Ich schicke dir']);
  s.festhalten();
  assert.deepEqual(sock.gesendet.at(-1), { message_type: 'input_audio_chunk', audio_base_64: '', sample_rate: 16000, commit: true });
  const schluss = s.schluss(800);
  setTimeout(() => sock.sag({ message_type: 'committed_transcript', text: 'Ich schicke dir die Offerte.' }), 20);
  assert.equal(await schluss, 'Ich schicke dir die Offerte.');
  s.beenden();
  assert.ok(sock.geschlossen);
  const fin = aufrufe.find((a) => a.pfad === '/api/voice/realtime/finish');
  assert.ok(fin, 'finish gemeldet');
  assert.equal(fin.opts.headers['x-space-insel'], '1');
  assert.deepEqual(JSON.parse(fin.opts.body), { sessionId: SID, audioSeconds: 2 });
  s.beenden();
  assert.equal(aufrufe.filter((a) => a.pfad === '/api/voice/realtime/finish').length, 1, 'nur einmal');
});

test('Token abgelehnt (403, KI-Option): still null, kein Socket, kein finish', async () => {
  const { live, aufrufe, offen, logs } = aufbau({ token: { ok: false, status: 403, daten: { error: 'x' } } });
  const s = live.sitzung('a2');
  s.pcm(pcm(1000));
  await s.verbinden();
  assert.equal(offen.length, 0);
  assert.equal(s.zustand, 'aufgegeben');
  s.festhalten();
  assert.equal(await s.schluss(800), null);
  s.beenden();
  assert.equal(aufrufe.filter((a) => a.pfad.endsWith('/finish')).length, 0);
  assert.ok(logs.some((l) => l.includes('Token 403')));
});

test('Netzfehler beim Token, ungültige Antwort, falsche Adresse: null', async () => {
  for (const token of [() => { throw new Error('offline'); }, { ok: true, status: 200, daten: { token: 'x' } }, { ok: true, status: 200, daten: zugang({ websocketUrl: 'wss://evil.example.com/v1/speech-to-text/realtime' }) }]) {
    const { live, offen } = aufbau({ token });
    const s = live.sitzung('a3');
    await s.verbinden();
    assert.equal(offen.length, 0);
    assert.equal(await s.schluss(50), null);
  }
});

test('Loslassen bevor der Socket offen ist: sofort null (kein Warten), finish trotzdem', async () => {
  const { live, aufrufe, offen } = aufbau();
  const s = live.sitzung('a4');
  await s.verbinden();
  assert.equal(offen.length, 1);
  const t0 = Date.now();
  s.festhalten();
  assert.equal(await s.schluss(800), null);
  assert.ok(Date.now() - t0 < 50);
  s.beenden();
  assert.ok(offen[0].geschlossen);
  assert.equal(aufrufe.filter((a) => a.pfad.endsWith('/finish')).length, 1);
});

test('kein Schlusstext in 0,8 s: null; ein später Schlusstext ändert nichts mehr', async () => {
  const { live, offen } = aufbau();
  const s = live.sitzung('a5');
  await s.verbinden();
  offen[0].start();
  s.festhalten();
  const t0 = Date.now();
  assert.equal(await s.schluss(120), null);
  assert.ok(Date.now() - t0 >= 100);
  offen[0].sag({ message_type: 'committed_transcript', text: 'spät' });
  assert.equal(await s.schluss(10), null);
});

test('Fehler vom Dienst oder Socket zu: null', async () => {
  for (const ende of [(k) => k.sag({ message_type: 'quota_exceeded', error: 'x' }), (k) => k.onclose(), (k) => k.onerror(), (k) => k.onmessage({ data: 'kein json' })]) {
    const { live, offen } = aufbau();
    const s = live.sitzung('a6');
    await s.verbinden();
    offen[0].start();
    ende(offen[0]);
    s.festhalten();
    assert.equal(await s.schluss(800), null);
  }
});

test('nichts gehört (insufficient_audio_activity) nach dem Commit: leerer Text', async () => {
  const { live, offen } = aufbau();
  const s = live.sitzung('a7');
  await s.verbinden();
  offen[0].start();
  s.festhalten();
  const p = s.schluss(800);
  offen[0].sag({ message_type: 'insufficient_audio_activity' });
  assert.equal(await p, '');
});

test('Schlange voll (Socket kommt nicht): aufgegeben, nichts gesendet', async () => {
  const { live, offen } = aufbau();
  const s = live.sitzung('a8');
  for (let i = 0; i < 11; i++) s.pcm(pcm(32000));
  assert.equal(s.zustand, 'aufgegeben');
  await s.verbinden();
  assert.equal(offen.length, 0);
});

test('verworfen, während der Token unterwegs ist: kein Socket, finish für den ausgegebenen Token', async () => {
  let freigeben;
  const { live, aufrufe, offen } = aufbau({ token: () => new Promise((r) => { freigeben = () => r({ ok: true, status: 200, daten: zugang() }); }) });
  const s = live.sitzung('a9');
  const v = s.verbinden();
  await ruhe();
  s.beenden();
  freigeben();
  await v;
  assert.equal(offen.length, 0);
  assert.equal(aufrufe.filter((a) => a.pfad.endsWith('/finish')).length, 1);
});

test('nie die Socket-Adresse oder den Token im Log', async () => {
  const { live, offen, logs } = aufbau();
  const s = live.sitzung('a10');
  await s.verbinden();
  offen[0].start();
  offen[0].sag({ message_type: 'auth_error', error: 'x' });
  s.beenden();
  assert.ok(logs.length > 0);
  for (const l of logs) { assert.ok(!l.includes('tok-geheim'), l); assert.ok(!l.includes('elevenlabs'), l); }
});

// ---- with a real WebSocket against the socket double (scripts/live-attrappe.mjs), in a child process ----
test('echter WebSocket gegen die Attrappe: Zwischentext wächst, Schlusstext nach dem Commit, Rückfall bei «stumm»', async () => {
  const { spawn } = require('node:child_process');
  const path = require('node:path');
  async function attrappe(modus, port) {
    const p = spawn(process.execPath, [path.join(__dirname, '..', 'scripts', 'live-attrappe.mjs'), '--port', String(port), '--modus', modus, '--verzoegerung', '150'], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise((r) => p.stdout.once('data', r));
    return p;
  }
  const api = (port) => async (pfad) => (pfad.endsWith('/token')
    ? { ok: true, status: 200, daten: { token: 't', sessionId: SID, websocketUrl: `ws://127.0.0.1:${port}/v1/speech-to-text/realtime`, languageCode: 'de', woerter: [] } }
    : { ok: true, status: 204, daten: null });
  const warte = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const [modus, port] of [['normal', 9581], ['stumm', 9582], ['zu', 9583], ['fehler', 9584]]) {
    const prozess = await attrappe(modus, port);
    try {
      const teile = [];
      const live = createLive({ api: api(port), WebSocketImpl: globalThis.WebSocket, testErlaubt: true });
      const s = live.sitzung(modus, { onTeil: (t) => teile.push(t) });
      for (let i = 0; i < 10; i++) s.pcm(pcm(3200)); // 1 s before the socket
      await s.verbinden();
      await warte(250);
      for (let i = 0; i < 10; i++) { s.pcm(pcm(3200)); await warte(10); }
      s.festhalten();
      const text = await s.schluss(800);
      s.beenden();
      if (modus === 'normal') {
        assert.ok(teile.length >= 3, `Zwischentexte: ${teile.length}`);
        assert.ok(teile.every((t, i) => i === 0 || t.startsWith(teile[i - 1])), 'wächst');
        assert.equal(text, teile.at(-1));
      } else {
        assert.equal(text, null, modus);
      }
    } finally { prozess.kill(); }
  }
});

test('Commits des Dienstes vor unserem (lange Diktate) bleiben vorn im Schlusstext und in der Zeile', async () => {
  const { live, offen } = aufbau();
  const teile = [];
  const s = live.sitzung('z1', { onTeil: (t) => teile.push(t) });
  await s.verbinden();
  offen[0].start();
  offen[0].sag({ message_type: 'partial_transcript', text: 'Erster Teil' });
  offen[0].sag({ message_type: 'committed_transcript', text: 'Erster Teil.' });
  offen[0].sag({ message_type: 'partial_transcript', text: 'zweiter' });
  assert.deepEqual(teile, ['Erster Teil', 'Erster Teil.', 'Erster Teil. zweiter']);
  s.festhalten();
  const p = s.schluss(800);
  offen[0].sag({ message_type: 'committed_transcript', text: 'zweiter Teil.' });
  assert.equal(await p, 'Erster Teil. zweiter Teil.');
});

test('audio vor pcm-ende: warteAufEnde wartet auf den letzten Ton, höchstens die Frist; aufgeben meldet onWeg', async () => {
  const { live, offen } = aufbau();
  let weg = 0;
  const s = live.sitzung('z2', { onWeg: () => weg++ });
  await s.verbinden();
  offen[0].start();
  const t0 = Date.now();
  const w = s.warteAufEnde(500);
  setTimeout(() => { s.pcm(pcm(2048)); s.pcmEnde(); }, 30);
  await w;
  assert.ok(Date.now() - t0 < 300);
  assert.equal(offen[0].gesendet.length, 1, 'das letzte Stück kam noch vor dem Commit');
  const t1 = Date.now();
  await live.sitzung('z3').warteAufEnde(80); // not open: no waiting
  assert.ok(Date.now() - t1 < 40);
  const s2 = live.sitzung('z4');
  await s2.verbinden(); offen[1].start();
  const t2 = Date.now();
  await s2.warteAufEnde(80);
  assert.ok(Date.now() - t2 >= 70, 'Frist');
  offen[0].sag({ message_type: 'quota_exceeded' });
  assert.equal(weg, 1);
});
