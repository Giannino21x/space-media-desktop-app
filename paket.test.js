// node --test paket.test.js — what the packaged app needs must be in it. The tests run from source, so a file missing
// from build.files stays invisible here and stops the app at the first start after the update, before the updater runs:
// no window, no repair, every customer reinstalls by hand (nearly shipped with befehle-regeln.js in 1.0.13).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');
const pkg = require('./package.json');

const einschluesse = pkg.build.files.filter((m) => !m.startsWith('!'));
const imPaket = (datei) => einschluesse.some((m) => m === datei || (m.endsWith('/**/*') && datei.startsWith(m.slice(0, -4))));

/** Every require() reachable from the entry files; relative ones as files, the others as package names. */
function erreichbar(start) {
  const dateien = new Set();
  const pakete = new Set();
  const offen = [...start];
  while (offen.length) {
    const datei = offen.pop();
    if (dateien.has(datei)) continue;
    dateien.add(datei);
    const text = fs.readFileSync(path.join(__dirname, datei), 'utf8');
    for (const [, ziel] of text.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (!ziel.startsWith('.')) { pakete.add(ziel); continue; }
      let rel = path.posix.normalize(path.posix.join(path.posix.dirname(datei), ziel));
      if (!path.posix.extname(rel)) rel += '.js';
      if (rel.endsWith('.js')) offen.push(rel);
    }
  }
  return { dateien, pakete };
}

const { dateien, pakete } = erreichbar([pkg.main, 'preload.js']);

test('every local file the app requires is in build.files', () => {
  assert.ok(dateien.size > 5);
  const fehlt = [...dateien].filter((d) => !imPaket(d));
  assert.deepEqual(fehlt, []);
});

test('every package the app requires ships with it', () => {
  const eingebaut = new Set([...builtinModules, 'electron']);
  const fehlt = [...pakete]
    .map((n) => n.replace(/^node:/, ''))
    .filter((n) => !eingebaut.has(n) && !eingebaut.has(n.split('/')[0]))
    .map((n) => (n.startsWith('@') ? n.split('/').slice(0, 2).join('/') : n.split('/')[0]))
    .filter((n) => !(pkg.dependencies && pkg.dependencies[n]));
  assert.deepEqual(fehlt, []);
});

test('the bridge has no way to run commands', () => {
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8'), /dateien:ausfuehren|ausfuehren\s*:\s*\(/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8'), /dateien:ausfuehren/);
});
