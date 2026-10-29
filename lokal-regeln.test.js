// node --test lokal-regeln.test.js — the pure rules of «KI auf dem Gerät» on the PC (lokal-regeln.js) and the WAV
// encoder (lokal-wav.js), without Electron, llama.cpp or a model.

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const {
  MODELLE, STANDARD_MODELL, LLAMA, N_CTX, N_PREDICT, SYSTEM_FRAGE, SYSTEM_HOEREN, HOEREN_FRAGE,
  modellBytes, groesseText, fortschritt, vollstaendig, kannText, hfBaum, hfSha256,
  benoetigteDatei, zipEintraege, portVorschlag, threadsFuer, serverArgs, vulkanGescheitert, modellGescheitert, startFehlerArt,
  bildDataUrl, chatKoerper, antwortText, diktatText, diktatWeg, geraetName, standAus, modellStand, gesamtFortschritt,
} = require('./lokal-regeln');
const { pcmZuWav, aufMonoUndRate, istWav, WAV_RATE } = require('./lokal-wav');

// ── Catalogue (1:1 with lib/lokal/modelle.ts) ───────────────────────────────────────────────────────────────────────

test('the standard model is LFM3-Omni-2B, Q4_0 model + Q4_0 projector from Hugging Face', () => {
  const m = MODELLE[STANDARD_MODELL];
  assert.equal(m.name, 'LFM3-Omni-2B');
  assert.deepEqual(m.kann, { sehen: true, hoeren: true });
  assert.deepEqual(m.dateien.map((d) => d.datei), ['LFM3-Omni-2B-Q4_0.gguf', 'mmproj-LFM3-Omni-2B-Q4_0.gguf']);
  assert.equal(m.dateien[0].url, 'https://huggingface.co/LiquidAI/LFM3-Omni-2B-GGUF/resolve/main/LFM3-Omni-2B-Q4_0.gguf');
  assert.equal(m.dateien[1].rolle, 'projektor');
  assert.equal(modellBytes(m), 1_049_617_920 + 270_576_544);
  assert.equal(groesseText(modellBytes(m)), '1,3 GB');
  assert.equal(groesseText(270_576_544), '271 MB');
  assert.equal(kannText(m), 'Sehen und Hören');
  assert.equal(kannText(MODELLE.vision), 'Sehen');
});

test('fortschritt weighs the files by size and never exceeds 1', () => {
  const m = MODELLE.omni;
  assert.equal(fortschritt(m, {}), 0);
  assert.equal(fortschritt(m, { 'LFM3-Omni-2B-Q4_0.gguf': 1_049_617_920, 'mmproj-LFM3-Omni-2B-Q4_0.gguf': 270_576_544 }), 1);
  const halb = fortschritt(m, { 'LFM3-Omni-2B-Q4_0.gguf': 1_049_617_920 / 2 });
  assert.ok(halb > 0.39 && halb < 0.41, String(halb));
  assert.equal(fortschritt(m, { 'LFM3-Omni-2B-Q4_0.gguf': 9e12 }), 1_049_617_920 / modellBytes(m));
  assert.equal(fortschritt(m, { 'LFM3-Omni-2B-Q4_0.gguf': -5 }), 0);
});

test('vollstaendig: both files there with the exact size — a half file does not count', () => {
  const m = MODELLE.omni;
  assert.equal(vollstaendig(m, { 'LFM3-Omni-2B-Q4_0.gguf': 1_049_617_920, 'mmproj-LFM3-Omni-2B-Q4_0.gguf': 270_576_544 }), true);
  assert.equal(vollstaendig(m, { 'LFM3-Omni-2B-Q4_0.gguf': 1_049_617_920 }), false);
  assert.equal(vollstaendig(m, { 'LFM3-Omni-2B-Q4_0.gguf': 1_049_617_919, 'mmproj-LFM3-Omni-2B-Q4_0.gguf': 270_576_544 }), false);
  assert.equal(vollstaendig(m, {}), false);
});

test('gesamtFortschritt: the server zip is the last 5 %', () => {
  const m = MODELLE.omni;
  const voll = { 'LFM3-Omni-2B-Q4_0.gguf': 1_049_617_920, 'mmproj-LFM3-Omni-2B-Q4_0.gguf': 270_576_544 };
  assert.equal(gesamtFortschritt(m, voll, 0, 0), 1);
  assert.equal(gesamtFortschritt(m, voll, 0, 100), 0.95);
  assert.equal(gesamtFortschritt(m, voll, 100, 100), 1);
  assert.equal(gesamtFortschritt(m, {}, 50, 100), 0.025);
});

test('hfBaum/hfSha256: the tree call of Hugging Face and the sha256 out of it', () => {
  const b = hfBaum('https://huggingface.co/LiquidAI/LFM3-Omni-2B-GGUF/resolve/main/mmproj-LFM3-Omni-2B-Q4_0.gguf');
  assert.deepEqual(b, { api: 'https://huggingface.co/api/models/LiquidAI/LFM3-Omni-2B-GGUF/tree/main', datei: 'mmproj-LFM3-Omni-2B-Q4_0.gguf' });
  assert.equal(hfBaum('https://github.com/x/y/releases/download/a.zip'), null);
  const sha = 'c7341273f1757b33ccd9e6f8b17007eb81307d26c90d8c36c22efb45fd3d82eb';
  const baum = [{ path: 'README.md' }, { path: 'mmproj-LFM3-Omni-2B-Q4_0.gguf', lfs: { oid: sha, size: 1 } }];
  assert.equal(hfSha256(baum, 'mmproj-LFM3-Omni-2B-Q4_0.gguf'), sha);
  assert.equal(hfSha256(baum, 'README.md'), null);
  assert.equal(hfSha256(baum, 'fehlt.gguf'), null);
  assert.equal(hfSha256([{ path: 'x', lfs: { oid: 'kein-hash' } }], 'x'), null);
  assert.equal(hfSha256({ error: 'x' }, 'x'), null);
});

// ── llama.cpp release ───────────────────────────────────────────────────────────────────────────────────────────────

test('llama.cpp is pinned to b11960 (v0.8.0, the first with LFM3), both variants with sha256', () => {
  assert.equal(LLAMA.tag, 'b11960');
  for (const v of ['vulkan', 'cpu']) {
    assert.match(LLAMA.varianten[v].url, new RegExp(`/releases/download/b11960/llama-b11960-bin-win-${v}-x64\\.zip$`));
    assert.match(LLAMA.varianten[v].sha256, /^[0-9a-f]{64}$/);
    assert.ok(LLAMA.varianten[v].bytes > 10_000_000);
  }
});

test('benoetigteDatei: the server and its DLLs, not the CLI tools', () => {
  for (const n of ['llama-server.exe', 'llama-server-impl.dll', 'llama.dll', 'llama-common.dll', 'mtmd.dll', 'ggml.dll', 'ggml-base.dll', 'ggml-vulkan.dll', 'ggml-cpu-zen4.dll', 'libomp.dll', 'LICENSE-LLVM-OpenMP']) {
    assert.equal(benoetigteDatei(n), true, n);
  }
  for (const n of ['llama-cli.exe', 'llama-bench.exe', 'llama-connect.exe', 'llama-quantize-impl.dll', 'ggml-rpc-server.exe', 'README.md', '../evil.dll']) {
    assert.equal(benoetigteDatei(n), false, n);
  }
});

/** A small zip (stored or deflated) with the structures zipEintraege reads. */
function zipBauen(dateien, deflate) {
  const lokal = [];
  const zentral = [];
  let offset = 0;
  for (const [name, inhalt] of dateien) {
    const roh = Buffer.from(inhalt);
    const daten = deflate ? zlib.deflateRawSync(roh) : roh;
    const n = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(deflate ? 8 : 0, 8); lh.writeUInt32LE(daten.length, 18); lh.writeUInt32LE(roh.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(deflate ? 8 : 0, 10); ch.writeUInt32LE(daten.length, 20); ch.writeUInt32LE(roh.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    lokal.push(lh, n, daten);
    zentral.push(ch, n);
    offset += lh.length + n.length + daten.length;
  }
  const zd = Buffer.concat(zentral);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(dateien.length, 8); eocd.writeUInt16LE(dateien.length, 10); eocd.writeUInt32LE(zd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...lokal, zd, eocd]);
}

test('zipEintraege reads stored and deflated entries, skips folders, refuses junk', () => {
  const dateien = [['llama-server.exe', 'MZ fake server'], ['bin/', ''], ['ggml.dll', 'x'.repeat(5000)]];
  for (const deflate of [false, true]) {
    const e = zipEintraege(zipBauen(dateien, deflate));
    assert.deepEqual(e.map((x) => x.name), ['llama-server.exe', 'ggml.dll']);
    assert.equal(e[0].daten.toString(), 'MZ fake server');
    assert.equal(e[1].daten.length, 5000);
  }
  assert.throws(() => zipEintraege(Buffer.from('nicht ein zip, nur text, lang genug für 22 bytes')), /Kein Zip/);
  assert.throws(() => zipEintraege(Buffer.alloc(3)), /Kein Zip/);
  const kaputt = zipBauen([['a.txt', 'hallo']], true);
  kaputt.writeUInt32LE(99, kaputt.length - 22 + 16); // central directory offset points into nowhere
  assert.throws(() => zipEintraege(kaputt), /beschädigt/);
});

test('portVorschlag stays in 20000–59999, threadsFuer in 2–12', () => {
  assert.equal(portVorschlag(0), 20_000);
  assert.equal(portVorschlag(0.5), 40_000);
  assert.equal(portVorschlag(1), 59_999);
  assert.equal(portVorschlag(NaN), 20_000);
  assert.equal(threadsFuer(32), 12);
  assert.equal(threadsFuer(8), 4);
  assert.equal(threadsFuer(2), 2);
  assert.equal(threadsFuer(undefined), 2);
});

test('serverArgs: loopback only, random key, one slot, no web UI, no thinking; CPU build without offload', () => {
  const basis = { modell: 'C:\\m\\a.gguf', projektor: 'C:\\m\\mm.gguf', port: 23456, schluessel: 'k1', threads: 6 };
  const vk = serverArgs({ ...basis, variante: 'vulkan' });
  const s = vk.join(' ');
  assert.match(s, /--model C:\\m\\a\.gguf --mmproj C:\\m\\mm\.gguf --host 127\.0\.0\.1 --port 23456 --api-key k1/);
  assert.match(s, new RegExp(`--ctx-size ${N_CTX} --batch-size 512 --threads 6 --parallel 1 --no-webui --jinja --reasoning off`));
  assert.match(s, /--n-gpu-layers 99$/);
  assert.ok(!s.includes('--no-mmproj-offload'));
  const cpu = serverArgs({ ...basis, variante: 'cpu' }).join(' ');
  assert.match(cpu, /--n-gpu-layers 0 --no-mmproj-offload$/);
});

test('vulkanGescheitert recognises a missing driver or DLL', () => {
  assert.equal(vulkanGescheitert('ggml_vulkan: Failed to initialize Vulkan: VK_ERROR_INCOMPATIBLE_DRIVER'), true);
  assert.equal(vulkanGescheitert('The code execution cannot proceed because vulkan-1.dll was not found'), true);
  assert.equal(vulkanGescheitert('exit status 0xC0000135'), true);
  assert.equal(vulkanGescheitert('srv load_model: model loaded'), false);
  assert.equal(vulkanGescheitert(''), false);
});

test('startFehlerArt: corrupt files keep the build, a silent or Vulkan death tries the CPU build', () => {
  const kaputt = "E gguf_init_from_reader: invalid magic characters: '????', expected 'GGUF'\nE srv load_model: failed to load model";
  assert.equal(modellGescheitert(kaputt), true);
  assert.equal(startFehlerArt(kaputt, 'vulkan'), 'modell');
  assert.equal(startFehlerArt('ggml_vulkan: Failed to initialize Vulkan: VK_ERROR_INCOMPATIBLE_DRIVER', 'vulkan'), 'gpu');
  assert.equal(startFehlerArt('', 'vulkan'), 'gpu');
  assert.equal(startFehlerArt('', 'cpu'), 'unbekannt');
  assert.equal(startFehlerArt('E something else went wrong in a long line of text', 'vulkan'), 'unbekannt');
});

// ── Request and answer ──────────────────────────────────────────────────────────────────────────────────────────────

test('the prompts are the phone\'s (lib/lokal/capacitor.ts)', () => {
  assert.match(SYSTEM_FRAGE, /^Du bist die KI auf dem Telefon der Person und siehst ein Foto von ihrer Kamera\. /);
  assert.match(SYSTEM_FRAGE, /höchstens drei Sätze/);
  assert.match(SYSTEM_HOEREN, /^Du bist ein Diktiergerät\. Schreib wortgetreu auf Deutsch auf/);
  assert.equal(HOEREN_FRAGE, 'Schreib auf, was gesagt wird.');
});

test('bildDataUrl takes JPEG/PNG/WebP data URLs only', () => {
  assert.deepEqual(bildDataUrl('data:image/jpeg;base64,/9j/4AAQ'), { mime: 'image/jpeg', base64: '/9j/4AAQ' });
  assert.deepEqual(bildDataUrl('data:image/png;base64,iVBOR\nw0KG'), { mime: 'image/png', base64: 'iVBORw0KG' });
  assert.equal(bildDataUrl('data:text/html;base64,PGh0bWw+'), null);
  assert.equal(bildDataUrl('https://example.com/a.jpg'), null);
  assert.equal(bildDataUrl('data:image/svg+xml;base64,PHN2Zz4='), null);
  assert.equal(bildDataUrl(''), null);
  assert.equal(bildDataUrl(null), null);
});

test('chatKoerper: system + picture/sound + question, greedy like on the phone', () => {
  const k = chatKoerper({ system: 'S', text: 'Was steht da?', bild: { mime: 'image/jpeg', base64: 'QUJD' } });
  assert.equal(k.messages[0].role, 'system');
  assert.equal(k.messages[0].content, 'S');
  assert.deepEqual(k.messages[1].content, [
    { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } },
    { type: 'text', text: 'Was steht da?' },
  ]);
  assert.equal(k.temperature, 0);
  assert.equal(k.repeat_penalty, 1.1);
  assert.equal(k.max_tokens, N_PREDICT);
  assert.equal(k.stream, false);
  const h = chatKoerper({ system: 'H', text: 'Schreib auf', wavBase64: 'UklGRg==' });
  assert.deepEqual(h.messages[1].content[0], { type: 'input_audio', input_audio: { data: 'UklGRg==', format: 'wav' } });
  assert.equal(h.messages[1].content.length, 2);
});

test('antwortText reads string and part-list content, empty otherwise', () => {
  assert.equal(antwortText({ choices: [{ message: { content: '  Eine Rechnung.  ' } }] }), 'Eine Rechnung.');
  assert.equal(antwortText({ choices: [{ message: { content: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] } }] }), 'AB');
  assert.equal(antwortText({ choices: [] }), '');
  assert.equal(antwortText(null), '');
  assert.equal(antwortText({ error: { message: 'x' } }), '');
});

test('diktatText drops surrounding quotes and folds whitespace', () => {
  assert.equal(diktatText('"Bitte schick mir die Offerte."'), 'Bitte schick mir die Offerte.');
  assert.equal(diktatText('«Hallo  Welt»'), 'Hallo Welt');
  assert.equal(diktatText('  Zeile eins\nZeile zwei  '), 'Zeile eins Zeile zwei');
  assert.equal(diktatText('"nur vorne'), '"nur vorne');
  assert.equal(diktatText(''), '');
  assert.equal(diktatText(null), '');
});

// ── Decisions ───────────────────────────────────────────────────────────────────────────────────────────────────────

test('diktatWeg: on the PC only with switch, model and WAV — everything else goes to the app', () => {
  assert.equal(diktatWeg({ lokalDiktat: true, bereit: true, mime: 'audio/wav' }), 'lokal');
  assert.equal(diktatWeg({ lokalDiktat: true, bereit: true, mime: 'audio/x-wav' }), 'lokal');
  assert.equal(diktatWeg({ lokalDiktat: true, bereit: true, mime: 'audio/webm;codecs=opus' }), 'cloud');
  assert.equal(diktatWeg({ lokalDiktat: false, bereit: true, mime: 'audio/wav' }), 'cloud');
  assert.equal(diktatWeg({ lokalDiktat: true, bereit: false, mime: 'audio/wav' }), 'cloud');
  assert.equal(diktatWeg({ lokalDiktat: true, bereit: true, mime: '' }), 'cloud');
});

test('geraetName in words, standAus and modellStand for the page', () => {
  assert.equal(geraetName('win32'), 'diesem PC');
  assert.equal(geraetName('darwin'), 'diesem Mac');
  assert.equal(geraetName('linux'), 'diesem Computer');
  const m = MODELLE.omni;
  assert.deepEqual(standAus({ modell: m, vorhanden: true, fehler: null, laedt: undefined, platform: 'win32' }), { vision: true, audio: true, entscheid: false, geraet: 'diesem PC' });
  assert.deepEqual(standAus({ modell: m, vorhanden: true, fehler: 'kaputt', laedt: 0.5, platform: 'win32' }), { vision: false, audio: false, entscheid: false, geraet: 'diesem PC', laedt: 0.5 });
  assert.deepEqual(standAus({ modell: MODELLE.vision, vorhanden: true, fehler: null, platform: 'win32' }), { vision: true, audio: false, entscheid: false, geraet: 'diesem PC' });
  assert.deepEqual(modellStand(m, { vorhanden: true, geladen: false, laedtBytes: null, fehler: undefined }), {
    art: 'omni', name: 'LFM3-Omni-2B', kann: 'Sehen und Hören', bytes: modellBytes(m), vorhanden: true, geladen: false, laedt: null, fehler: null,
  });
  assert.equal(modellStand(m, { vorhanden: false, geladen: false, laedtBytes: { 'LFM3-Omni-2B-Q4_0.gguf': 1_049_617_920, 'mmproj-LFM3-Omni-2B-Q4_0.gguf': 270_576_544 }, fehler: 'x' }).laedt, 1);
});

// ── WAV (lib/lokal/wav.ts) ──────────────────────────────────────────────────────────────────────────────────────────

test('pcmZuWav writes a 16-bit mono RIFF header and clamps the samples', () => {
  const wav = pcmZuWav(new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2]));
  assert.equal(wav.length, 44 + 7 * 2);
  assert.equal(istWav(wav), true);
  const v = new DataView(wav.buffer);
  assert.equal(v.getUint16(20, true), 1);
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getUint32(24, true), WAV_RATE);
  assert.equal(v.getUint32(28, true), WAV_RATE * 2);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), 14);
  assert.equal(v.getInt16(44, true), 0);
  assert.equal(v.getInt16(46, true), Math.floor(0.5 * 0x7fff));
  assert.equal(v.getInt16(50, true), 0x7fff);
  assert.equal(v.getInt16(52, true), -0x8000);
  assert.equal(v.getInt16(54, true), 0x7fff);
  assert.equal(v.getInt16(56, true), -0x8000);
  assert.equal(istWav(new Uint8Array([1, 2, 3])), false);
  assert.equal(istWav(Buffer.from('RIFFxxxxWAVEfmt ')), true);
});

test('aufMonoUndRate averages channels and resamples to 16 kHz', () => {
  const l = new Float32Array([1, 1, 1, 1]);
  const r = new Float32Array([0, 0, 0, 0]);
  assert.deepEqual(Array.from(aufMonoUndRate([l, r], WAV_RATE)), [0.5, 0.5, 0.5, 0.5]);
  const bei48 = new Float32Array(48_000).fill(0.25);
  const aus = aufMonoUndRate([bei48], 48_000);
  assert.equal(aus.length, 16_000);
  assert.equal(aus[100], 0.25);
  assert.equal(aufMonoUndRate([], 48_000).length, 0);
});
