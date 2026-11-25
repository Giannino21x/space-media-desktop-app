// Static checks of insel.js that the pure tests cannot see (the cursor poll needs Electron).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const quelle = fs.readFileSync(path.join(__dirname, 'insel.js'), 'utf8');

test('pollTakt declares no inner `ziehen` (it would shadow the drag state: every tick threw, 25.11.2026)', () => {
  const a = quelle.indexOf('function pollTakt()');
  const b = quelle.indexOf('function pollStarten(', a);
  assert.ok(a > 0 && b > a);
  assert.doesNotMatch(quelle.slice(a, b), /\b(const|let|var)\s+ziehen\b/);
});
