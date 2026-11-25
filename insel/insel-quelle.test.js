// Static checks of insel.js that the pure tests cannot see (the cursor poll needs Electron).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const quelle = fs.readFileSync(path.join(__dirname, 'insel.js'), 'utf8');

test('island and pill ask for their settings once they listen (insel:hallo), after registering the listener', () => {
  for (const datei of ['ui/insel-ui.js', 'ui/pille-ui.js']) {
    const s = fs.readFileSync(path.join(__dirname, datei), 'utf8');
    const an = s.indexOf('api.onEinstellungen(einstellungenNeu)');
    const hallo = s.indexOf('api.hallo()');
    assert.ok(an > 0 && hallo > an, datei);
  }
});

test('pollTakt declares no inner `ziehen` (it would shadow the drag state: every tick threw, 25.11.2026)', () => {
  const a = quelle.indexOf('function pollTakt()');
  const b = quelle.indexOf('function pollStarten(', a);
  assert.ok(a > 0 && b > a);
  assert.doesNotMatch(quelle.slice(a, b), /\b(const|let|var)\s+ziehen\b/);
});

test('the app bridge passes taste as text, not as a switch (1.0.16 sent «Aus» as true)', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  assert.match(preload, /schluessel === 'taste' \? String\(/);
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /schluessel === 'taste' \? String\(/);
});

test('Notiz an mich: der Ton wird abgelegt, nie eingefügt; startet auch ohne Diktat-Taste', () => {
  const quelle = fs.readFileSync(path.join(__dirname, 'insel.js'), 'utf8');
  const audio = quelle.slice(quelle.indexOf("kanal('pille:audio'"), quelle.indexOf("kanal('pille:leer'"));
  const notiz = audio.indexOf("if (zweck === 'notiz') return notizAblegenMelden(");
  assert.ok(notiz > 0, 'Notiz-Zweig fehlt');
  assert.ok(notiz < audio.indexOf('einfuegen('), 'die Notiz muss vor dem Einfügen abbiegen');
  const taste = quelle.slice(quelle.indexOf('function pillenTaste('));
  assert.ok(taste.indexOf("if (was === 'notiz')") < taste.indexOf('if (!tasteAn()) return;'));
});

test('Notiz an mich bei Taste «Aus»: ✓, ✕, Esc und die 6-Minuten-Grenze beenden sie (Prüfer F, Blocker)', () => {
  const quelle = fs.readFileSync(path.join(__dirname, 'insel.js'), 'utf8');
  assert.match(quelle, /const tasteAn = \(\) => einstellungen\.diktat \|\| notizLaeuft\(\);/);
  const ereignis = quelle.slice(quelle.indexOf('function tasteEreignis('), quelle.indexOf('function taktStarten('));
  assert.ok(ereignis.includes('if (!tasteAn()) return;'), 'tasteEreignis muss eine laufende Notiz durchlassen');
  assert.ok(!ereignis.includes('if (!einstellungen.diktat) return;'));
});

test('Notiz an mich: der Zweck bleibt nie für das nächste Diktat liegen (Prüfer F)', () => {
  const quelle = fs.readFileSync(path.join(__dirname, 'insel.js'), 'utf8');
  const start = quelle.slice(quelle.indexOf('function notizStarten('), quelle.indexOf('function pilleZeigen('));
  assert.match(start, /finally \{\s*naechsterZweck = null;/);
});

test('Notiz an mich: nach dem Hochladen wird nie mehr gelöscht (Prüfer F)', () => {
  const quelle = fs.readFileSync(path.join(__dirname, 'insel.js'), 'utf8');
  const ablegen = quelle.slice(quelle.indexOf('async function notizAblegen('), quelle.indexOf('async function notizAblegenMelden('));
  const loeschen = ablegen.indexOf("method: 'DELETE'");
  assert.ok(loeschen > 0 && loeschen < ablegen.indexOf('/audio/finalize'), 'DELETE nur vor dem Abschliessen');
  assert.equal(ablegen.split("method: 'DELETE'").length, 2);
});
