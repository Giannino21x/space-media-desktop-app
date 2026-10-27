const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HALTEN_MIN_MS, DOPPEL_MS, MAX_AUFNAHME_MS,
  diktatTaste, inselRahmen, pillenRahmen, imRechteck, inselLage, multipart, diktatFehler,
} = require('./regeln');

const ab = (taste, folge) => folge.map(([art, zeit]) => taste.ereignis({ art, zeit }));

test('hold right Ctrl, speak, let go → paste', () => {
  const t = diktatTaste();
  assert.deepEqual(ab(t, [['diktatRunter', 0], ['diktatRunter', 30], ['diktatHoch', HALTEN_MIN_MS + 500]]), [['aufnahmeStart'], [], ['senden']]);
  assert.equal(t.zustand, 'ruhe');
});

test('a short tap alone is thrown away after the double-tap window', () => {
  const t = diktatTaste();
  assert.deepEqual(ab(t, [['diktatRunter', 0], ['diktatHoch', 90], ['takt', 90 + DOPPEL_MS - 1], ['takt', 90 + DOPPEL_MS]]), [['aufnahmeStart'], [], [], ['verwerfen']]);
});

test('two quick taps → hands-free, one more tap sends', () => {
  const t = diktatTaste();
  const r = ab(t, [['diktatRunter', 0], ['diktatHoch', 80], ['diktatRunter', 200], ['diktatHoch', 260], ['andere', 900], ['diktatRunter', 5000], ['diktatHoch', 5080]]);
  assert.deepEqual(r, [['aufnahmeStart'], [], ['freihand'], [], [], ['senden'], []]);
  assert.equal(t.zustand, 'ruhe');
});

test('right Ctrl as part of a shortcut is dropped silently', () => {
  const t = diktatTaste();
  assert.deepEqual(ab(t, [['diktatRunter', 0], ['andere', 40], ['diktatHoch', 900]]), [['aufnahmeStart'], ['verwerfen'], []]);
});

test('Esc cancels while holding and hands-free', () => {
  const t = diktatTaste();
  assert.deepEqual(ab(t, [['diktatRunter', 0], ['esc', 1500]]), [['aufnahmeStart'], ['abbrechen']]);
  assert.deepEqual(ab(t, [['diktatRunter', 0], ['diktatHoch', 50], ['diktatRunter', 150], ['esc', 3000]]), [['aufnahmeStart'], [], ['freihand'], ['abbrechen']]);
  assert.deepEqual(ab(t, [['esc', 10]]), [[]]);
});

test('a recording never runs forever', () => {
  const t = diktatTaste();
  assert.deepEqual(ab(t, [['diktatRunter', 0], ['takt', MAX_AUFNAHME_MS]]), [['aufnahmeStart'], ['senden']]);
  // still holding the key: its release must not start anything
  assert.deepEqual(ab(t, [['diktatHoch', MAX_AUFNAHME_MS + 10]]), [[]]);
  assert.equal(t.zustand, 'ruhe');
});

test('windows sit top centre and above the taskbar', () => {
  assert.deepEqual(inselRahmen({ x: 0, y: 0, width: 1920, height: 1080 }, 680, 300), { x: 620, y: 0, width: 680, height: 300 });
  assert.deepEqual(inselRahmen({ x: -1920, y: 0, width: 1920, height: 1080 }, 680, 300), { x: -1300, y: 0, width: 680, height: 300 });
  assert.deepEqual(pillenRahmen({ x: 0, y: 0, width: 1920, height: 1040 }, 320, 120, 8), { x: 800, y: 912, width: 320, height: 120 });
});

test('point in rectangle with margin', () => {
  const r = { x: 100, y: 0, width: 200, height: 40 };
  assert.equal(imRechteck({ x: 100, y: 0 }, r), true);
  assert.equal(imRechteck({ x: 300, y: 10 }, r), false);
  assert.equal(imRechteck({ x: 305, y: 10 }, r, 6), true);
  assert.equal(imRechteck({ x: 5, y: 5 }, null), false);
});

test('island state from the app answers', () => {
  const lage = inselLage({
    laufend: { laufend: [{ id: 'r1', titel: 'Offerte prüfen', bot: 'Offerten-Bot', start: '2026-10-27T10:00:00Z' }], fertig: [], freigaben: 2 },
    freigaben: { approvals: [{ id: 'a1', title: 'Mail an Huber', summary: 'Antwort auf die Offerte', kind: 'email_send', bot_id: 'b1' }] },
    team: { bots: [{ id: 'b1', name: 'SPACE Bot', color: 'sky', isDefault: true }, { id: 'b2', name: 'Alt', color: 'red', archivedAt: '2026-01-01' }] },
    profil: { access: { plan: 'standard' }, nickname: 'Giannino' },
  });
  assert.equal(lage.angemeldet, true);
  assert.equal(lage.steno, false);
  assert.equal(lage.name, 'Giannino');
  assert.equal(lage.laufend.length, 1);
  assert.equal(lage.freigabenZahl, 2);
  assert.equal(lage.freigaben[0].titel, 'Mail an Huber');
  assert.deepEqual(lage.team.map((b) => b.id), ['b1']);
  const leer = inselLage();
  assert.equal(leer.angemeldet, false);
  assert.deepEqual(leer.laufend, []);
  assert.equal(inselLage({ profil: { access: { plan: 'spacebot' } } }).steno, true);
});

test('multipart body carries the file', () => {
  const { typ, koerper } = multipart('audio', 'diktat.webm', 'audio/webm', Buffer.from('abc'));
  const grenze = typ.split('boundary=')[1];
  const text = koerper.toString();
  assert.ok(text.startsWith(`--${grenze}\r\n`));
  assert.ok(text.includes('name="audio"; filename="diktat.webm"'));
  assert.ok(text.includes('Content-Type: audio/webm\r\n\r\nabc\r\n'));
  assert.ok(text.endsWith(`--${grenze}--\r\n`));
});

test('dictation errors in German', () => {
  assert.equal(diktatFehler(401, null), 'Bitte zuerst in SPACE anmelden.');
  assert.equal(diktatFehler(403, { error: 'Sprache ist mit «Nur Schweiz» gesperrt.' }), 'Sprache ist mit «Nur Schweiz» gesperrt.');
  assert.equal(diktatFehler(500, {}), 'Das Diktat liess sich nicht lesen.');
});

test('the pill buttons: dictate hands-free, finish', () => {
  const t = diktatTaste();
  assert.deepEqual(t.freihand(0), ['aufnahmeStart', 'freihand']);
  assert.deepEqual(t.freihand(10), []);
  assert.deepEqual(t.ereignis({ art: 'andere', zeit: 500 }), []);
  assert.deepEqual(t.fertig(), ['senden']);
  assert.equal(t.zustand, 'ruhe');
  assert.deepEqual(t.fertig(), []);
});
