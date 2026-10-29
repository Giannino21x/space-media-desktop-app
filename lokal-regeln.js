// «KI auf dem Gerät» on the PC (29.10.2026) — the pure part of lokal.js, tested in lokal-regeln.test.js without
// Electron: the model catalogue (1:1 from lib/lokal/modelle.ts in the web repo, so phone and PC load the same files
// and answer the same), the pinned llama.cpp release, what to take out of its zip, the request to llama-server, the
// local-or-cloud decision for the island's dictation, and the port choice.

const zlib = require('zlib');

// ── Model catalogue (lib/lokal/modelle.ts, 29.10.2026) ────────────────────────────────────────────────────────────────
// ONE model in memory: LFM3-Omni-2B sees AND hears (image and audio projector in one mmproj file). Q4_0 like on the
// phone. Numbers from Hugging Face `LiquidAI/<modell>-GGUF`, 29.10.2026. Needs llama.cpp ≥ v0.8.0 (b11960).

const HF = 'https://huggingface.co/LiquidAI';

function datei(repo, name, bytes, rolle) {
  return { datei: name, url: `${HF}/${repo}/resolve/main/${name}`, bytes, rolle };
}

const MODELLE = {
  omni: {
    art: 'omni',
    name: 'LFM3-Omni-2B',
    kann: { sehen: true, hoeren: true },
    dateien: [
      datei('LFM3-Omni-2B-GGUF', 'LFM3-Omni-2B-Q4_0.gguf', 1_049_617_920, 'modell'),
      datei('LFM3-Omni-2B-GGUF', 'mmproj-LFM3-Omni-2B-Q4_0.gguf', 270_576_544, 'projektor'),
    ],
  },
  vision: {
    art: 'vision',
    name: 'LFM3-VL-2B',
    kann: { sehen: true, hoeren: false },
    dateien: [
      datei('LFM3-VL-2B-GGUF', 'LFM3-VL-2B-QAD-Q4_0.gguf', 1_050_000_000, 'modell'),
      datei('LFM3-VL-2B-GGUF', 'mmproj-LFM3-VL-2B-Q8_0.gguf', 200_000_000, 'projektor'),
    ],
  },
  audio: {
    art: 'audio',
    name: 'LFM3-Audio-2B',
    kann: { sehen: false, hoeren: true },
    dateien: [
      datei('LFM3-Audio-2B-GGUF', 'LFM3-Audio-2B-Q4_0.gguf', 1_050_000_000, 'modell'),
      datei('LFM3-Audio-2B-GGUF', 'mmproj-LFM3-Audio-2B-Q4_0.gguf', 160_000_000, 'projektor'),
    ],
  },
};

/** The model the app offers (Einstellungen → Bot → KI auf dem Gerät). */
const STANDARD_MODELL = 'omni';

const modellBytes = (m) => m.dateien.reduce((s, d) => s + d.bytes, 0);

/** «1,3 GB», «270 MB» — decimal, the way the stores count. */
function groesseText(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1).replace('.', ',')} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

/** Progress over all files of a model, 0–1, weighted by size. `geladen` = bytes per file name already there. */
function fortschritt(m, geladen) {
  const total = modellBytes(m);
  if (total <= 0) return 0;
  const da = m.dateien.reduce((s, d) => s + Math.min(d.bytes, Math.max(0, geladen[d.datei] || 0)), 0);
  return Math.min(1, da / total);
}

/** Are all files of the model on the PC? `vorhanden` = { name → bytes } of the finished files in the model folder. */
function vollstaendig(m, vorhanden) {
  return m.dateien.every((d) => Number.isFinite(vorhanden[d.datei]) && vorhanden[d.datei] === d.bytes);
}

/** «Sehen und Hören» for the line under the model name. */
function kannText(m) {
  return [m.kann.sehen ? 'Sehen' : '', m.kann.hoeren ? 'Hören' : ''].filter(Boolean).join(' und ');
}

/** Hugging Face: the API call that tells the file's sha256 (`lfs.oid`), or null for other hosts. */
function hfBaum(url) {
  const m = /^https:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/([^/]+)\/(.+)$/.exec(url);
  if (!m) return null;
  return { api: `https://huggingface.co/api/models/${m[1]}/tree/${m[2]}`, datei: decodeURIComponent(m[3]) };
}

/** The sha256 of one file from the tree answer of Hugging Face, or null. */
function hfSha256(baum, dateiName) {
  if (!Array.isArray(baum)) return null;
  const e = baum.find((x) => x && x.path === dateiName);
  const oid = e && e.lfs && e.lfs.oid;
  return typeof oid === 'string' && /^[0-9a-f]{64}$/.test(oid) ? oid : null;
}

// ── llama.cpp (ggml-org/llama.cpp, release b11960 = v0.8.0, 28.10.2026 — the first with LFM3) ────────────────────────
// The official Windows build. Vulkan runs on NVIDIA, AMD and Intel without a vendor runtime; CPU is the fallback when
// the Vulkan build cannot start (no driver). sha256 from the release's asset digests, pinned here.

const LLAMA = {
  tag: 'b11960',
  version: '0.8.0',
  varianten: {
    vulkan: {
      datei: 'llama-b11960-bin-win-vulkan-x64.zip',
      url: 'https://github.com/ggml-org/llama.cpp/releases/download/b11960/llama-b11960-bin-win-vulkan-x64.zip',
      bytes: 37_345_851,
      sha256: 'bac6914b5e83523eb008c6789eaa12669f93fbc196c3b9e8237b6672323b33e9',
    },
    cpu: {
      datei: 'llama-b11960-bin-win-cpu-x64.zip',
      url: 'https://github.com/ggml-org/llama.cpp/releases/download/b11960/llama-b11960-bin-win-cpu-x64.zip',
      bytes: 24_407_745,
      sha256: '73f962f82850d244db47eaacb9d913637027b82399124324298576d58c5f4287',
    },
  },
};
const STANDARD_VARIANTE = 'vulkan';
const SERVER_EXE = 'llama-server.exe';

/** Which files of the zip the server needs (the rest — CLI tools, benchmarks — stays out). */
function benoetigteDatei(name) {
  const n = String(name).split('/').pop();
  return /^(llama-server(-impl)?\.(exe|dll)|llama\.dll|llama-common\.dll|mtmd\.dll|ggml[\w-]*\.dll|libomp\.dll|LICENSE[\w.-]*)$/i.test(n);
}

/**
 * Entries of a zip file (Buffer) → [{ name, daten }]. Reads the central directory, inflates stored (0) and
 * deflated (8) entries. Enough for the llama.cpp release zips; anything else is refused.
 */
function zipEintraege(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('Kein Zip-Archiv.');
  // End of central directory: signature 0x06054b50, searched from the back (comment may follow)
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Kein Zip-Archiv.');
  const anzahl = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const eintraege = [];
  for (let i = 0; i < anzahl; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Zip-Archiv beschädigt.');
    const methode = buf.readUInt16LE(p + 10);
    const komprimiert = buf.readUInt32LE(p + 20);
    const gross = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const kommentarLen = buf.readUInt16LE(p + 32);
    const lokal = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + kommentarLen;
    if (name.endsWith('/')) continue; // folder
    if (buf.readUInt32LE(lokal) !== 0x04034b50) throw new Error('Zip-Archiv beschädigt.');
    const start = lokal + 30 + buf.readUInt16LE(lokal + 26) + buf.readUInt16LE(lokal + 28);
    const roh = buf.subarray(start, start + komprimiert);
    let daten;
    if (methode === 0) daten = Buffer.from(roh);
    else if (methode === 8) daten = zlib.inflateRawSync(roh);
    else throw new Error(`Zip-Methode ${methode} nicht unterstützt.`);
    if (daten.length !== gross) throw new Error('Zip-Archiv beschädigt.');
    eintraege.push({ name, daten });
  }
  return eintraege;
}

/** A loopback port for llama-server: 20000–59999 from a 0–1 random. */
function portVorschlag(zufall) {
  const z = Number.isFinite(zufall) ? Math.min(0.999_999, Math.max(0, zufall)) : 0;
  return 20_000 + Math.floor(z * 40_000);
}

/** Threads for the CPU part: half the logical cores, 2–12. */
function threadsFuer(logischeKerne) {
  return Math.max(2, Math.min(12, Math.floor((Number(logischeKerne) || 4) / 2)));
}

/** Context like on the phone (one picture in tiles plus question and answer). */
const N_CTX = 4096;
const N_PREDICT = 220;

/** Command line of llama-server — one slot, OpenAI API on the loopback only, protected by a random key. */
function serverArgs({ modell, projektor, port, schluessel, variante, threads }) {
  const args = [
    '--model', modell,
    '--mmproj', projektor,
    '--host', '127.0.0.1',
    '--port', String(port),
    '--api-key', schluessel,
    '--ctx-size', String(N_CTX),
    '--batch-size', '512',
    '--threads', String(threads),
    '--parallel', '1',
    '--no-webui',
    '--jinja',
    '--reasoning', 'off',
    '--alias', 'lokal',
  ];
  if (variante === 'cpu') args.push('--n-gpu-layers', '0', '--no-mmproj-offload');
  else args.push('--n-gpu-layers', '99');
  return args;
}

/** The server died while starting: did the GPU backend fail (→ try the CPU build), or something else? */
function vulkanGescheitert(ausgabe) {
  const t = String(ausgabe || '');
  return /VK_ERROR_[A-Z0-9_]+|ggml_vulkan.*(error|fail)|vulkan-1\.dll|ggml-vulkan\.dll|Vulkan.*(fail|error|not found)|0xC0000135|STATUS_DLL_NOT_FOUND/i.test(t);
}

/** The model files are the problem (corrupt, wrong format) — no other build will help. */
function modellGescheitert(ausgabe) {
  return /failed to load model|invalid magic|gguf_init_from|failed to load CLIP|model loading error|mmproj/i.test(String(ausgabe || ''));
}

/**
 * Why llama-server died before it listened: 'modell' (the files — say so, keep the build), 'gpu' (the Vulkan build
 * — try the CPU build once), 'unbekannt'. A Vulkan build that dies without a word (missing DLL: Windows prints
 * nothing) counts as 'gpu'.
 */
function startFehlerArt(ausgabe, variante) {
  const t = String(ausgabe || '');
  if (modellGescheitert(t)) return 'modell';
  if (vulkanGescheitert(t)) return 'gpu';
  if (variante !== 'cpu' && t.trim().length < 20) return 'gpu';
  return 'unbekannt';
}

// ── Prompts (lib/lokal/capacitor.ts, 1:1 so phone and PC answer the same) ────────────────────────────────────────────

const SYSTEM_FRAGE =
  'Du bist die KI auf dem Telefon der Person und siehst ein Foto von ihrer Kamera. ' +
  'Antworte auf Deutsch, kurz und konkret, höchstens drei Sätze. ' +
  'Wird nach Text im Bild gefragt, gib ihn wortgetreu wieder (Zahlen, Daten, Namen genau). ' +
  'Wenn du etwas nicht erkennst, sag das ehrlich.';

const SYSTEM_HOEREN =
  'Du bist ein Diktiergerät. Schreib wortgetreu auf Deutsch auf, was in der Aufnahme gesagt wird — ' +
  'nur den gesprochenen Text, keine Anführungszeichen, keine Kommentare, Satzzeichen wie gesprochen.';

const HOEREN_FRAGE = 'Schreib auf, was gesagt wird.';

/** A JPEG/PNG/WebP data URL from the page → { mime, base64 }, or null if it is anything else. */
function bildDataUrl(s) {
  if (typeof s !== 'string' || s.length > 40_000_000) return null;
  const m = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(s);
  return m ? { mime: m[1], base64: m[2].replace(/\s+/g, '') } : null;
}

/**
 * The OpenAI-style request body for llama-server: system prompt, the media (one picture as data URL or one WAV as
 * base64) and the question. Sampling like Liquid recommends for Omni: greedy, repeat penalty 1.1.
 */
function chatKoerper({ system, text, bild, wavBase64 }) {
  const inhalt = [];
  if (bild) inhalt.push({ type: 'image_url', image_url: { url: `data:${bild.mime};base64,${bild.base64}` } });
  if (wavBase64) inhalt.push({ type: 'input_audio', input_audio: { data: wavBase64, format: 'wav' } });
  inhalt.push({ type: 'text', text });
  return {
    model: 'lokal',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: inhalt },
    ],
    temperature: 0,
    top_k: 50,
    top_p: 1,
    min_p: 0,
    repeat_penalty: 1.1,
    max_tokens: N_PREDICT,
    stream: false,
  };
}

/** The answer text out of llama-server's reply. */
function antwortText(json) {
  const w = json && Array.isArray(json.choices) && json.choices[0] && json.choices[0].message;
  const c = w && w.content;
  if (typeof c === 'string') return c.trim();
  if (Array.isArray(c)) return c.map((t) => (t && typeof t.text === 'string' ? t.text : '')).join('').trim();
  return '';
}

/** The dictation text out of the model's answer: no surrounding quotes, one line of spaces. */
function diktatText(antwort) {
  let t = String(antwort || '').trim();
  if (t.length >= 2 && /^["«„“']/.test(t) && /["»“”']$/.test(t)) t = t.slice(1, -1).trim();
  return t.replace(/\s+/g, ' ');
}

// ── Decisions ────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The island's dictation: on the PC (model there, switch on, the pill sent WAV) or through the app's
 * /api/voice/transcribe (the person's KI-Option). WebM cannot go to the model — only the pill can decode it.
 */
function diktatWeg({ lokalDiktat, bereit, mime }) {
  if (!lokalDiktat || !bereit) return 'cloud';
  return /audio\/(wav|wave|x-wav)/i.test(String(mime || '')) ? 'lokal' : 'cloud';
}

/** «diesem PC» for the camera's title line (never an identifier). */
function geraetName(platform) {
  if (platform === 'darwin') return 'diesem Mac';
  if (platform === 'win32') return 'diesem PC';
  return 'diesem Computer';
}

/** stand() of the bridge from what the host knows. */
function standAus({ modell, vorhanden, fehler, laedt, platform }) {
  const bereit = vorhanden && !fehler;
  const s = { vision: bereit && modell.kann.sehen, audio: bereit && modell.kann.hoeren, entscheid: false, geraet: geraetName(platform) };
  if (Number.isFinite(laedt)) s.laedt = laedt;
  return s;
}

/** One line of modelle() for the settings card. */
function modellStand(m, { vorhanden, geladen, laedtBytes, fehler }) {
  return {
    art: m.art,
    name: m.name,
    kann: kannText(m),
    bytes: modellBytes(m),
    vorhanden: !!vorhanden,
    geladen: !!geladen,
    laedt: laedtBytes ? fortschritt(m, laedtBytes) : null,
    fehler: fehler || null,
  };
}

/** Download progress for stand().laedt: the model files count fully, the server zip is the last bit. */
function gesamtFortschritt(m, bytes, zipGeladen, zipBytes) {
  const modell = fortschritt(m, bytes);
  if (!zipBytes) return modell;
  const zip = Math.min(1, Math.max(0, (zipGeladen || 0) / zipBytes));
  // the zip is small next to the model: 5 % of the bar
  return Math.min(1, modell * 0.95 + zip * 0.05);
}

const MELDUNG = {
  nichtVerfuegbar: 'Die KI auf diesem PC ist hier nicht verfügbar.',
  nichtGeladen: 'Das Modell ist auf diesem PC noch nicht geladen.',
  laedtSchon: 'Es lädt schon ein Modell.',
  unbekannt: 'Dieses Modell kennt die App nicht.',
  bild: 'Das Bild konnte nicht gelesen werden.',
  ton: 'Die Aufnahme konnte nicht gelesen werden.',
  keinBild: 'Das Modell auf diesem PC kann keine Bilder sehen.',
  keinTon: 'Das Modell auf diesem PC kann nicht hören.',
  unvollstaendig: 'Die Datei kam unvollständig an. Bitte nochmals laden.',
  pruefsumme: 'Die Datei stimmt nicht mit dem Original überein. Bitte nochmals laden.',
  abgebrochen: 'Abgebrochen.',
  server: 'Die KI auf diesem PC liess sich nicht starten.',
  modellKaputt: 'Die Modelldatei ist beschädigt — bitte entfernen und nochmals laden.',
  antwort: 'Die KI auf diesem PC hat nicht geantwortet.',
  netz: 'Keine Verbindung — das Modell liess sich nicht herunterladen.',
};

module.exports = {
  MODELLE, STANDARD_MODELL, LLAMA, STANDARD_VARIANTE, SERVER_EXE, N_CTX, N_PREDICT, MELDUNG,
  SYSTEM_FRAGE, SYSTEM_HOEREN, HOEREN_FRAGE,
  modellBytes, groesseText, fortschritt, vollstaendig, kannText, hfBaum, hfSha256,
  benoetigteDatei, zipEintraege, portVorschlag, threadsFuer, serverArgs, vulkanGescheitert, modellGescheitert, startFehlerArt,
  bildDataUrl, chatKoerper, antwortText, diktatText, diktatWeg, geraetName, standAus, modellStand, gesamtFortschritt,
};
