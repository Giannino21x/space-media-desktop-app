const test = require('node:test');
const assert = require('node:assert/strict');
const { updateText, istNeuer } = require('./update-text');

test('one sentence per result, with the version', () => {
  assert.deepEqual(updateText({ art: 'aktuell', version: '1.0.17' }), { titel: 'SME ist aktuell', text: 'Version 1.0.17 ist die neueste.' });
  assert.match(updateText({ art: 'laedt', version: '1.0.17', neu: '1.0.18' }).titel, /1\.0\.18 wird geladen/);
  assert.match(updateText({ art: 'bereit', version: '1.0.17', neu: '1.0.18' }).text, /neu zu starten/);
  assert.match(updateText({ art: 'fehler', version: '1.0.17' }).text, /1\.0\.17 läuft weiter/);
  assert.doesNotMatch(updateText({ art: 'fehler', version: '1.0.17' }).text, /Fehler/);
  assert.equal(updateText({ art: 'entwicklung' }).titel, 'Entwicklungsversion');
});

test('newer or not', () => {
  assert.equal(istNeuer({ isUpdateAvailable: true, updateInfo: { version: '1.0.18' } }, '1.0.17'), true);
  assert.equal(istNeuer({ isUpdateAvailable: false, updateInfo: { version: '1.0.17' } }, '1.0.17'), false);
  assert.equal(istNeuer({ updateInfo: { version: '1.0.18' } }, '1.0.17'), true);
  assert.equal(istNeuer({ updateInfo: { version: '1.0.9' } }, '1.0.17'), false);
  assert.equal(istNeuer({ updateInfo: { version: '1.0.17' } }, '1.0.17'), false);
  assert.equal(istNeuer(null, '1.0.17'), false);
});
