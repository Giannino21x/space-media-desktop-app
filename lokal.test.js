// node --test lokal.test.js — the host of «KI auf dem Gerät» (lokal.js) without Electron, llama.cpp or the real model:
// a local http server stands in for Hugging Face and GitHub (small files, Range, sha256), a Node script for
// llama-server.exe (health, chat completions, a Vulkan build that dies). Downloads, resume, checksums, the server's
// life, the bridge's answers, the switch to the CPU build.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { createLokalHost } = require('./lokal');
const { MELDUNG } = require('./lokal-regeln');
const { pcmZuWav } = require('./lokal-wav');

// ── stand-ins ───────────────────────────────────────────────────────────────────────────────────────────────────────

const FAKE_SERVER = `
const http = require('http');
const a = process.argv;
const port = Number(a[a.indexOf('--port') + 1]);
const key = a[a.indexOf('--api-key') + 1];
const gpu = a[a.indexOf('--n-gpu-layers') + 1];
if (process.env.FAKE_VULKAN_FAIL === '1' && gpu === '99') {
  process.stderr.write('ggml_vulkan: Failed to initialize Vulkan: VK_ERROR_INCOMPATIBLE_DRIVER\\n');
  process.exit(1);
}
const srv = http.createServer((req, res) => {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"status":"ok"}'); }
  if (req.url === '/v1/chat/completions' && req.method === 'POST') {
    if (req.headers.authorization !== 'Bearer ' + key) { res.writeHead(401); return res.end('{"error":"key"}'); }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const b = JSON.parse(body);
      const teile = b.messages[1].content;
      const bild = teile.filter((t) => t.type === 'image_url').length;
      const ton = teile.filter((t) => t.type === 'input_audio').length;
      const text = teile.find((t) => t.type === 'text').text;
      const sys = b.messages[0].content.slice(0, 12);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '"bild:' + bild + ' ton:' + ton + ' text:' + text + ' sys:' + sys + '"' } }] }));
    });
    return;
  }
  res.writeHead(404); res.end();
});
setTimeout(() => srv.listen(port, '127.0.0.1', () => process.stdout.write('model loaded\\n')), 150);
`;

/** A small zip (deflated) with the structures zipEintraege reads (same writer as in lokal-regeln.test.js). */
function zipBauen(dateien) {
  const lokal = []; const zentral = []; let offset = 0;
  for (const [name, inhalt] of dateien) {
    const roh = Buffer.from(inhalt); const daten = zlib.deflateRawSync(roh); const n = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(daten.length, 18); lh.writeUInt32LE(roh.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(daten.length, 20); ch.writeUInt32LE(roh.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    lokal.push(lh, n, daten); zentral.push(ch, n); offset += lh.length + n.length + daten.length;
  }
  const zd = Buffer.concat(zentral); const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(dateien.length, 8); eocd.writeUInt16LE(dateien.length, 10); eocd.writeUInt32LE(zd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...lokal, zd, eocd]);
}

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const schlafen = (ms) => new Promise((r) => setTimeout(r, ms));
const bis = async (pruefen, ms = 5000) => { const ende = Date.now() + ms; while (Date.now() < ende) { if (await pruefen()) return true; await schlafen(25); } return false; };

/**
 * One world per test: temp userData, a "Hugging Face + GitHub" on 127.0.0.1 (with Range, throttle, a knob for a wrong
 * file), the fake llama-server, and the host wired to all of it.
 */
async function welt(opts = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'space-lokal-'));
  const fakeScript = path.join(tmp, 'fake-llama-server.js');
  fs.writeFileSync(fakeScript, FAKE_SERVER);

  const modellBytes = Buffer.alloc(20_000, 7);
  const projektorBytes = Buffer.alloc(6_000, 9);
  const zip = zipBauen([['llama-server.exe', 'MZ fake'], ['ggml.dll', 'g'], ['llama-cli.exe', 'cli'], ['LICENSE', 'mit']]);
  const inhalte = {
    '/LiquidAI/Test-GGUF/resolve/main/test-Q4_0.gguf': modellBytes,
    '/LiquidAI/Test-GGUF/resolve/main/mmproj-test-Q4_0.gguf': projektorBytes,
    '/zip/vulkan.zip': zip,
    '/zip/cpu.zip': zip,
  };
  const protokoll = []; // every request: { url, range }
  const knopf = { langsam: false, falscheDatei: null };
  const srv = http.createServer((req, res) => {
    const url = req.url;
    protokoll.push({ url, range: req.headers.range || null });
    if (url === '/api/models/LiquidAI/Test-GGUF/tree/main') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify([
        { path: 'test-Q4_0.gguf', lfs: { oid: sha(modellBytes), size: modellBytes.length } },
        { path: 'mmproj-test-Q4_0.gguf', lfs: { oid: knopf.falscheDatei === 'sha' ? 'a'.repeat(64) : sha(projektorBytes), size: projektorBytes.length } },
      ]));
    }
    let daten = inhalte[url];
    if (!daten) { res.writeHead(404); return res.end(); }
    if (knopf.falscheDatei === 'kurz' && url.endsWith('mmproj-test-Q4_0.gguf')) daten = daten.subarray(0, 100);
    let start = 0;
    const r = /^bytes=(\d+)-$/.exec(req.headers.range || '');
    if (r) { start = Number(r[1]); res.writeHead(206, { 'content-range': `bytes ${start}-${daten.length - 1}/${daten.length}`, 'content-length': daten.length - start }); }
    else res.writeHead(200, { 'content-length': daten.length });
    if (!knopf.langsam) return res.end(daten.subarray(start));
    // 1000 bytes every 20 ms — slow enough to abort in the middle
    let p = start;
    const takt = setInterval(() => {
      if (res.destroyed) return clearInterval(takt);
      const ende = Math.min(daten.length, p + 1000);
      res.write(daten.subarray(p, ende));
      p = ende;
      if (p >= daten.length) { clearInterval(takt); res.end(); }
    }, 20);
    req.on('close', () => clearInterval(takt));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const basis = `http://127.0.0.1:${srv.address().port}`;

  const modelle = {
    omni: {
      art: 'omni', name: 'Test-Omni', kann: { sehen: true, hoeren: true },
      dateien: [
        { datei: 'test-Q4_0.gguf', url: 'https://huggingface.co/LiquidAI/Test-GGUF/resolve/main/test-Q4_0.gguf', bytes: modellBytes.length, rolle: 'modell' },
        { datei: 'mmproj-test-Q4_0.gguf', url: 'https://huggingface.co/LiquidAI/Test-GGUF/resolve/main/mmproj-test-Q4_0.gguf', bytes: projektorBytes.length, rolle: 'projektor' },
      ],
    },
  };
  const llama = {
    tag: 'b11960',
    varianten: {
      vulkan: { datei: 'vulkan.zip', url: 'https://github.com/zip/vulkan.zip', bytes: zip.length, sha256: sha(zip) },
      cpu: { datei: 'cpu.zip', url: 'https://github.com/zip/cpu.zip', bytes: zip.length, sha256: sha(zip) },
    },
  };
  let staende = 0;
  const kinder = [];
  const host = createLokalHost({
    userDataDir: tmp,
    platform: 'win32',
    modelle,
    llama,
    leerlaufMs: opts.leerlaufMs,
    herunterladen: (url, init) => fetch(url.replace(/^https:\/\/[^/]+/, basis), init),
    onStand: () => { staende++; },
    log: opts.log,
    spawnServer: (exe, args, o) => {
      assert.ok(exe.endsWith(path.join('b11960-' + (args.includes('0') && args.includes('--no-mmproj-offload') ? 'cpu' : 'vulkan'), 'llama-server.exe')), exe);
      assert.ok(fs.existsSync(exe), 'the server binary was unpacked');
      const kind = spawn(process.execPath, [fakeScript, ...args], { ...o, env: { ...process.env, FAKE_VULKAN_FAIL: opts.vulkanFail ? '1' : '0' } });
      kinder.push(kind);
      return kind;
    },
  });
  const ende = async () => {
    host.shutdown();
    for (const k of kinder) { try { k.kill(); } catch { /* gone */ } }
    await new Promise((r) => srv.close(r));
    await schlafen(100);
    fs.rmSync(tmp, { recursive: true, force: true });
  };
  return { tmp, host, protokoll, knopf, ende, staende: () => staende, kinder, basis };
}

const dataUrl = 'data:image/jpeg;base64,' + Buffer.from('fake jpeg').toString('base64');
const wav = Buffer.from(pcmZuWav(new Float32Array(1600).fill(0.1)));

// ── tests ───────────────────────────────────────────────────────────────────────────────────────────────────────────

test('nothing there: stand/modelle say so, frage and hoeren refuse, the island is not ready', async () => {
  const w = await welt();
  try {
    assert.deepEqual(await w.host.stand(), { vision: false, audio: false, entscheid: false, geraet: 'diesem PC' });
    const [m] = await w.host.modelle();
    assert.equal(m.vorhanden, false);
    assert.equal(m.geladen, false);
    assert.equal(m.laedt, null);
    assert.equal(w.host.bereit(), false);
    await assert.rejects(w.host.frage({ bild: dataUrl, text: 'Was ist das?' }), { message: 'Test-Omni ist auf diesem PC noch nicht geladen.' });
    await assert.rejects(w.host.frage({ bild: 'https://x/y.jpg', text: 'x' }), { message: MELDUNG.bild });
    await assert.rejects(w.host.hoerenWav(Buffer.from('kein wav')), { message: MELDUNG.ton });
    await assert.rejects(w.host.laden('gibtsnicht'), { message: MELDUNG.unbekannt });
  } finally { await w.ende(); }
});

test('laden: files + server zip with sha256, unpacked server, straight into memory; frage and hoeren answer', async () => {
  const w = await welt();
  try {
    await w.host.laden('omni');
    const modelleDir = path.join(w.tmp, 'lokal', 'modelle');
    assert.equal(fs.statSync(path.join(modelleDir, 'test-Q4_0.gguf')).size, 20_000);
    assert.equal(fs.statSync(path.join(modelleDir, 'mmproj-test-Q4_0.gguf')).size, 6_000);
    assert.ok(!fs.existsSync(path.join(modelleDir, 'test-Q4_0.gguf.teil')));
    const binDir = path.join(w.tmp, 'lokal', 'bin', 'b11960-vulkan');
    assert.deepEqual(fs.readdirSync(binDir).sort(), ['LICENSE', 'ggml.dll', 'llama-server.exe']);
    assert.ok(!fs.existsSync(path.join(w.tmp, 'lokal', 'bin', 'vulkan.zip')), 'zip removed after unpacking');
    // the sha256 came from the tree call, the files from resolve, the zip from GitHub
    assert.ok(w.protokoll.some((p) => p.url === '/api/models/LiquidAI/Test-GGUF/tree/main'));
    assert.ok(w.staende() >= 3);

    const [m] = await w.host.modelle();
    assert.equal(m.vorhanden, true);
    assert.equal(m.geladen, true);
    assert.equal(m.fehler, null);
    assert.equal(w.host.laeuft, true);
    assert.equal(w.host.bereit(), true);
    assert.deepEqual(await w.host.stand(), { vision: true, audio: true, entscheid: false, geraet: 'diesem PC' });

    const f = await w.host.frage({ bild: dataUrl, text: 'Was steht da?', sprache: 'de' });
    assert.equal(f.antwort, '"bild:1 ton:0 text:Was steht da? sys:Du bist die "');
    assert.ok(Number.isFinite(f.dauerMs) && f.dauerMs >= 0);
    const h = await w.host.hoerenWav(wav);
    assert.equal(h.text, 'bild:0 ton:1 text:Schreib auf, was gesagt wird. sys:Du bist ein');
    // the same port and key for the second question: one server, no restart
    assert.equal(w.kinder.length, 1);
    assert.equal(fs.existsSync(path.join(w.tmp, 'lokal', 'lokal.log')), true);
  } finally { await w.ende(); }
});

test('laden twice at once is refused; stand() while loading shows progress', async () => {
  const w = await welt();
  try {
    w.knopf.langsam = true;
    const lauf = w.host.laden('omni');
    await bis(async () => (await w.host.stand()).laedt > 0);
    await assert.rejects(w.host.laden('omni'), { message: MELDUNG.laedtSchon });
    const s = await w.host.stand();
    assert.ok(s.laedt > 0 && s.laedt < 1, String(s.laedt));
    const [m] = await w.host.modelle();
    assert.ok(m.laedt > 0 && m.laedt < 1);
    w.knopf.langsam = false;
    await lauf;
    assert.equal((await w.host.stand()).laedt, undefined);
  } finally { await w.ende(); }
});

test('abbrechen in the middle keeps the partial file; the next laden resumes with Range', async () => {
  const w = await welt();
  try {
    w.knopf.langsam = true;
    const lauf = w.host.laden('omni');
    const teil = path.join(w.tmp, 'lokal', 'modelle', 'test-Q4_0.gguf.teil');
    await bis(() => fs.existsSync(teil) && fs.statSync(teil).size >= 3000);
    await w.host.abbrechen('omni');
    await lauf; // resolves quietly
    const groesse = fs.statSync(teil).size;
    assert.ok(groesse >= 3000 && groesse < 20_000, String(groesse));
    const [m] = await w.host.modelle();
    assert.equal(m.laedt, null);
    assert.equal(m.fehler, null);
    assert.equal(m.vorhanden, false);

    w.knopf.langsam = false;
    w.protokoll.length = 0;
    await w.host.laden('omni');
    const weiter = w.protokoll.find((p) => p.url.endsWith('/test-Q4_0.gguf'));
    assert.equal(weiter.range, `bytes=${groesse}-`);
    assert.equal(fs.statSync(path.join(w.tmp, 'lokal', 'modelle', 'test-Q4_0.gguf')).size, 20_000);
    assert.equal((await w.host.modelle())[0].geladen, true);
  } finally { await w.ende(); }
});

test('a wrong checksum or a short file is thrown away with a German message', async () => {
  const w = await welt();
  try {
    w.knopf.falscheDatei = 'sha';
    await assert.rejects(w.host.laden('omni'), { message: MELDUNG.pruefsumme });
    const modelleDir = path.join(w.tmp, 'lokal', 'modelle');
    assert.ok(fs.existsSync(path.join(modelleDir, 'test-Q4_0.gguf')), 'the good file stays');
    assert.ok(!fs.existsSync(path.join(modelleDir, 'mmproj-test-Q4_0.gguf')));
    assert.ok(!fs.existsSync(path.join(modelleDir, 'mmproj-test-Q4_0.gguf.teil')));
    let [m] = await w.host.modelle();
    assert.equal(m.fehler, MELDUNG.pruefsumme);
    assert.equal((await w.host.stand()).vision, false);

    w.knopf.falscheDatei = 'kurz';
    await assert.rejects(w.host.laden('omni'), { message: MELDUNG.unvollstaendig });
    [m] = await w.host.modelle();
    assert.equal(m.fehler, MELDUNG.unvollstaendig);

    w.knopf.falscheDatei = null;
    await w.host.laden('omni');
    [m] = await w.host.modelle();
    assert.equal(m.fehler, null);
    assert.equal(m.geladen, true);
  } finally { await w.ende(); }
});

test('the Vulkan build dies → the CPU build takes over and is remembered', async () => {
  const w = await welt({ vulkanFail: true });
  try {
    await w.host.laden('omni');
    assert.equal(w.host.beschleunigung, 'cpu');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(w.tmp, 'lokal', 'lokal.json'), 'utf8')), { beschleunigung: 'cpu' });
    assert.ok(fs.existsSync(path.join(w.tmp, 'lokal', 'bin', 'b11960-cpu', 'llama-server.exe')));
    assert.equal(w.kinder.length, 2);
    const f = await w.host.frage({ bild: dataUrl, text: 'x' });
    assert.match(f.antwort, /bild:1/);
    const log = fs.readFileSync(path.join(w.tmp, 'lokal', 'lokal.log'), 'utf8');
    assert.match(log, /VK_ERROR_INCOMPATIBLE_DRIVER/);
    assert.match(log, /vulkan gescheitert .* → CPU-Build/);
  } finally { await w.ende(); }
});

test('after the idle time the server stops; the next question starts it again', async () => {
  const w = await welt({ leerlaufMs: 400 });
  try {
    await w.host.laden('omni');
    assert.equal(w.host.laeuft, true);
    assert.ok(await bis(() => !w.host.laeuft, 3000), 'server stopped after idle');
    assert.ok(await bis(() => w.kinder[0].exitCode !== null || w.kinder[0].signalCode !== null, 3000), 'process ended');
    assert.equal((await w.host.modelle())[0].geladen, false);
    assert.equal(w.host.bereit(), true, 'the model is still on disk');
    const f = await w.host.frage({ bild: dataUrl, text: 'nochmals' });
    assert.match(f.antwort, /text:nochmals/);
    assert.equal(w.kinder.length, 2);
  } finally { await w.ende(); }
});

test('an orphaned llama-server from a hard-killed app is ended at the next start — only if the PID is still that exe', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'space-lokal-waise-'));
  try {
    fs.mkdirSync(path.join(tmp, 'lokal'), { recursive: true });
    // a stand-in «llama-server»: a node process that would live for a minute
    const waise = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
    fs.writeFileSync(path.join(tmp, 'lokal', 'server.json'), JSON.stringify({ pid: waise.pid, port: 1 }));
    // PID reused by something else → untouched
    let h = createLokalHost({ userDataDir: tmp, platform: 'win32', prozessName: () => 'notepad.exe' });
    h.shutdown();
    await schlafen(100);
    assert.equal(waise.exitCode, null, 'a foreign process is never killed');
    assert.ok(!fs.existsSync(path.join(tmp, 'lokal', 'server.json')), 'the note is gone either way');
    fs.writeFileSync(path.join(tmp, 'lokal', 'server.json'), JSON.stringify({ pid: waise.pid, port: 1 }));
    h = createLokalHost({ userDataDir: tmp, platform: 'win32', prozessName: () => 'llama-server.exe' });
    h.shutdown();
    assert.ok(await bis(() => waise.exitCode !== null || waise.signalCode !== null, 3000), 'the orphan is ended');
    assert.match(fs.readFileSync(path.join(tmp, 'lokal', 'lokal.log'), 'utf8'), /verwaister llama-server/);
    // the running server writes its PID, a clean stop removes it
    const w = await welt();
    try {
      await w.host.laden('omni');
      const notiz = JSON.parse(fs.readFileSync(path.join(w.tmp, 'lokal', 'server.json'), 'utf8'));
      assert.equal(notiz.pid, w.kinder[0].pid);
      await w.host.entfernen('omni');
      assert.ok(await bis(() => !fs.existsSync(path.join(w.tmp, 'lokal', 'server.json')), 3000));
    } finally { await w.ende(); }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('stand() with a model on disk warms the server up; entfernen stops it and deletes the files', async () => {
  const w = await welt();
  try {
    await w.host.laden('omni');
    w.host.shutdown(); // simulate an app restart: files stay, nothing runs
    const w2host = createLokalHost({
      userDataDir: w.tmp, platform: 'win32', modelle: undefined, llama: undefined,
      herunterladen: () => { throw new Error('no network needed'); },
      spawnServer: (exe, args, o) => { const k = spawn(process.execPath, [path.join(w.tmp, 'fake-llama-server.js'), ...args], o); w.kinder.push(k); return k; },
    });
    // the real catalogue does not know the test files → stand() says: nothing there
    assert.equal((await w2host.stand()).vision, false);
    w2host.shutdown();

    const host3 = createLokalHost({
      userDataDir: w.tmp, platform: 'win32',
      modelle: { omni: { art: 'omni', name: 'Test-Omni', kann: { sehen: true, hoeren: true }, dateien: [
        { datei: 'test-Q4_0.gguf', url: 'x', bytes: 20_000, rolle: 'modell' }, { datei: 'mmproj-test-Q4_0.gguf', url: 'x', bytes: 6_000, rolle: 'projektor' }] } },
      llama: { tag: 'b11960', varianten: { vulkan: {}, cpu: {} } },
      herunterladen: () => { throw new Error('no network needed'); },
      spawnServer: (exe, args, o) => { const k = spawn(process.execPath, [path.join(w.tmp, 'fake-llama-server.js'), ...args], o); w.kinder.push(k); return k; },
    });
    try {
      const s = await host3.stand();
      assert.equal(s.vision, true, 'ready as soon as the files are there');
      assert.ok(await bis(() => host3.laeuft, 5000), 'warmed up without a question');
      await host3.entfernen('omni');
      assert.equal(host3.laeuft, false);
      assert.equal(host3.bereit(), false);
      assert.deepEqual(fs.readdirSync(path.join(w.tmp, 'lokal', 'modelle')), []);
      assert.equal((await host3.stand()).vision, false);
    } finally { host3.shutdown(); }
  } finally { await w.ende(); }
});
