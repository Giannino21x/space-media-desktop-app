// The island only sounds as the answer to a click or key of the person on it (insel/ui/klang.js). It runs while the
// app window sits in the tray, so a sound from a finished run, a new approval, the wake strip, a hover or the island
// folding by itself came «auch wenn die App nicht offen war» (Giannino, 25.11.2026). Reads the source: insel-ui.js is a
// classic browser script without exports.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const quelle = fs.readFileSync(path.join(__dirname, 'ui', 'insel-ui.js'), 'utf8');

/** The body of `function name(` up to the next function at the same indentation. */
function rumpf(name) {
  const start = quelle.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found`);
  const ende = quelle.indexOf('\n  function ', start + 10);
  return quelle.slice(start, ende < 0 ? undefined : ende);
}

test('no sound for what happens without the person: runs, approvals, wake strip, folding', () => {
  for (const name of ['lageNeu', 'wecken', 'modusSetzen', 'meldung', 'alarm']) {
    assert.doesNotMatch(rumpf(name), /K\.spielen\(/, `${name} plays a sound`);
  }
});

test('hearts on hover stay silent', () => {
  assert.doesNotMatch(quelle, /beiHerzen:\s*\(\)\s*=>\s*K\.spielen/);
});

test('a click on the island still answers with a sound', () => {
  assert.match(rumpf('aufklappen'), /K\.spielen\('hallo'\)/);
  // closing it by its button or Escape is the person's action too
  assert.match(quelle, /\$\('f-zu'\)\.addEventListener\('click', \(\) => \{[^}]*K\.spielen\('stups'\)/);
});
