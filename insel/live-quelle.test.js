// Live text: what the source must keep (Plan live-text, Abnahme 2, 3, 4, 6). Reads insel.js / live.js / the pill as text.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const insel = fs.readFileSync(path.join(__dirname, 'insel.js'), 'utf8');
const liveQuelle = fs.readFileSync(path.join(__dirname, 'live.js'), 'utf8');
const pille = fs.readFileSync(path.join(__dirname, 'ui', 'pille-ui.js'), 'utf8');
const zweig = (von, bis) => insel.slice(insel.indexOf(von), insel.indexOf(bis, insel.indexOf(von) + von.length));

test('der Token kommt nur im Zweig «gehalten» (ein Kürzel kostet nie etwas)', () => {
  const aufrufe = insel.split('.verbinden()').length - 1;
  assert.equal(aufrufe, 1, 'verbinden() genau einmal');
  const gehalten = zweig("case 'gehalten':", 'break;');
  assert.ok(gehalten.includes('aufnahme.live.verbinden()'));
  assert.ok(!zweig("case 'aufnahmeStart':", 'break;').includes('verbinden'), 'nicht schon beim Drücken');
  assert.ok(liveQuelle.includes("'/api/voice/realtime/token'"));
  assert.equal(insel.split('/api/voice/realtime/token').length - 1, 0, 'insel.js holt den Token nur über live.js');
});

test('Verwerfen, Abbrechen und eine leere Aufnahme beenden die Live-Sitzung (Socket zu, finish)', () => {
  assert.ok(zweig("case 'abbrechen':", 'break;').includes('liveEnde(aufnahme.id)'));
  assert.ok(zweig("kanal('pille:leer'", '});').includes('liveEnde(aufnahme.id)'));
  const audio = zweig("kanal('pille:audio'", "kanal('pille:leer'");
  assert.ok(audio.includes('liveEnde(input.id)'));
  assert.ok(audio.indexOf('warteAufEnde(') < audio.indexOf('festhalten()'), 'erst der letzte Ton, dann der Commit');
  assert.ok(audio.includes("input.peak === null || input.peak === undefined ? NaN"), 'kein Pegel ist nicht still');
});

test('Rückfall: ohne Schlusstext geht die Aufnahme wie heute an transkribieren, nie zweimal eingefügt', () => {
  const audio = zweig("kanal('pille:audio'", "kanal('pille:leer'");
  const live = audio.indexOf('liveSitzung.schluss(LIVE_SCHLUSS_MS)');
  const rueck = audio.indexOf('if (roh === null) roh = await transkribieren(');
  assert.ok(live > 0 && rueck > live, 'erst Live, dann der heutige Weg');
  assert.equal(audio.split('einfuegen(').length - 1, 1, 'genau ein Einfügen');
  assert.ok(audio.indexOf('aufraeumen(roh)') > rueck, 'Füllwörter für beide Wege');
});

test('eine Notiz geht nie live, «Diktat auf diesem PC» an nie live', () => {
  const fuer = zweig('const liveFuer = ', '}) ===');
  assert.ok(fuer.includes('lokalDiktat: einstellungen.lokalDiktat !== false'));
  assert.ok(fuer.includes('zweck'));
  assert.ok(insel.indexOf("if (zweck === 'notiz') return notizAblegenMelden(") < insel.indexOf('liveSitzung.schluss('));
});

test('der Test-Ersatz für Token und Adresse gilt nur ungepackt und nur für ws://127.0.0.1', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /liveTest: !app\.isPackaged && \/\^ws:\\\/\\\/127\\\.0\\\.0\\\.1:\\d\+\\\/\/\.test\(/);
  assert.match(liveQuelle, /testErlaubt && url\.protocol === 'ws:' && url\.hostname === '127\.0\.0\.1'/);
});

test('die Socket-Adresse (Token in der Query) kommt nie in ein Log', () => {
  for (const zeile of liveQuelle.split('\n').filter((z) => /\blog\(/.test(z))) {
    assert.ok(!/adresse|url|token|zugang/i.test(zeile.replace(/log\(`live \$\{id\}: aufgegeben \(\$\{grund\}\)`\)/, '')), zeile);
  }
  assert.ok(!/log\([^)]*(liveTest|adresse)/.test(insel));
});

test('die Pille schickt Ton nur bei einer Live-Aufnahme, und die Aufnahme läuft immer mit', () => {
  assert.ok(pille.includes('if (a.live) pcmStarten(a, stream);'));
  assert.ok(pille.indexOf('if (a.live) pcmStarten(a, stream);') < pille.indexOf('a.recorder.start(250);'));
});
