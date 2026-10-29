// Sound for the on-device hearing model («KI auf dem Gerät»): the browser records WebM/Opus, llama.cpp (mtmd) wants
// WAV. Here: recording → PCM 16 kHz mono → WAV bytes. Port of lib/lokal/wav.ts in the web repo, so phone and PC feed
// the model the same thing. UMD on purpose: preload.js requires it (the bridge's `hoeren`), the dictation pill
// (insel/ui/pille.html) loads it as a plain script (window.spaceWav). The encoder is pure (tested in
// lokal-regeln.test.js); decoding needs an AudioContext, so it only runs in a renderer.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.spaceWav = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const WAV_RATE = 16_000;

  /** Float32 PCM (−1…1) → WAV bytes (PCM 16 bit, mono). */
  function pcmZuWav(samples, rate = WAV_RATE) {
    const n = samples.length;
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const text = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    text(0, 'RIFF');
    v.setUint32(4, 36 + n * 2, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); // PCM
    v.setUint16(22, 1, true); // mono
    v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    text(36, 'data');
    v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Uint8Array(buf);
  }

  /** Several channels → one (mean), any rate → target rate (linear). */
  function aufMonoUndRate(kanaele, rate, ziel = WAV_RATE) {
    if (kanaele.length === 0) return new Float32Array(0);
    const laenge = kanaele[0].length;
    const mono = new Float32Array(laenge);
    for (const k of kanaele) for (let i = 0; i < laenge; i++) mono[i] += k[i] / kanaele.length;
    if (rate === ziel) return mono;
    const f = rate / ziel;
    const out = new Float32Array(Math.floor(laenge / f));
    for (let i = 0; i < out.length; i++) {
      const p = i * f;
      const a = Math.floor(p);
      const b = Math.min(laenge - 1, a + 1);
      out[i] = mono[a] + (mono[b] - mono[a]) * (p - a);
    }
    return out;
  }

  /** Is this already a WAV file (RIFF/WAVE header)? */
  function istWav(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (b.length < 12) return false;
    const s = (o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
    return s(0) === 'RIFF' && s(8) === 'WAVE';
  }

  /** Recording (ArrayBuffer, any format the browser can decode) → WAV 16 kHz mono (Uint8Array). Renderer only. */
  async function aufnahmeZuWav(audio, Ctx) {
    if (istWav(audio)) return audio instanceof Uint8Array ? audio : new Uint8Array(audio);
    const Klasse = Ctx || (typeof AudioContext !== 'undefined' ? AudioContext : undefined);
    if (!Klasse) throw new Error('Die Aufnahme liess sich hier nicht umwandeln.');
    const ctx = new Klasse();
    try {
      const dekodiert = await ctx.decodeAudioData(audio.slice(0));
      const kanaele = [];
      for (let c = 0; c < dekodiert.numberOfChannels; c++) kanaele.push(dekodiert.getChannelData(c));
      return pcmZuWav(aufMonoUndRate(kanaele, dekodiert.sampleRate));
    } finally {
      ctx.close().catch(() => { /* still */ });
    }
  }

  return { WAV_RATE, pcmZuWav, aufMonoUndRate, istWav, aufnahmeZuWav };
});
