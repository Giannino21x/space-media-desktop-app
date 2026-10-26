// node --test fenster.test.js — what may load in the app window (fenster.js, no Electron needed)

const test = require('node:test');
const assert = require('node:assert/strict');
const { fensterWache } = require('./fenster');

const APP = ['https://app.space-media.ch', 'https://space-media-app.vercel.app'];

function wache(isDev) {
  const extern = [];
  return { extern, ...fensterWache({ allowed: APP, isDev, openExternal: (url) => extern.push(url) }) };
}

test('imFenster: only the exact app origins', () => {
  const { imFenster } = wache(false);
  assert.equal(imFenster('https://app.space-media.ch/chat'), true);
  assert.equal(imFenster('https://app.space-media.ch'), true);
  assert.equal(imFenster('https://app.space-media.ch:443/settings?tab=abo'), true);
  assert.equal(imFenster('https://APP.Space-Media.ch/login'), true);
  assert.equal(imFenster('https://space-media-app.vercel.app/login'), true);
  // Prefix tricks the old startsWith check let through
  assert.equal(imFenster('https://app.space-media.ch.evil.com/login'), false);
  assert.equal(imFenster('https://app.space-media.chX/'), false);
  assert.equal(imFenster('https://space-media-app.vercel.app.evil.com/'), false);
  assert.equal(imFenster('https://app.space-media.ch@evil.com/'), false);
  assert.equal(imFenster('https://app.space-media.ch:8443/'), false);
  assert.equal(imFenster('http://app.space-media.ch/'), false);
  assert.equal(imFenster('https://evil.com/?r=https://app.space-media.ch'), false);
  assert.equal(imFenster('about:blank'), false);
  assert.equal(imFenster('javascript:alert(1)'), false);
  assert.equal(imFenster('file:///C:/Windows/win.ini'), false);
  assert.equal(imFenster(''), false);
});

test('imFenster: localhost only with --dev', () => {
  assert.equal(wache(false).imFenster('http://localhost:3000/chat'), false);
  assert.equal(wache(false).imFenster('http://127.0.0.1:3000/'), false);
  const dev = wache(true);
  assert.equal(dev.imFenster('http://localhost:3000/chat'), true);
  assert.equal(dev.imFenster('http://localhost:3100/'), true);
  assert.equal(dev.imFenster('http://127.0.0.1:3000/'), true);
  assert.equal(dev.imFenster('https://app.space-media.ch/chat'), true);
  assert.equal(dev.imFenster('http://localhost.evil.com/'), false);
  assert.equal(dev.imFenster('http://localhost:3000@evil.com/'), false);
});

test('oeffnen (window.open): app pages get a window, the rest goes to the system browser', () => {
  const w = wache(false);
  assert.deepEqual(w.oeffnen({ url: 'https://app.space-media.ch/api/mcp/download?id=1' }), { action: 'allow' });
  assert.deepEqual(w.extern, []);
  assert.deepEqual(w.oeffnen({ url: 'https://app.space-media.ch.evil.com/' }), { action: 'deny' });
  assert.deepEqual(w.oeffnen({ url: 'http://localhost:3000/' }), { action: 'deny' });
  assert.deepEqual(w.oeffnen({ url: 'https://unsubscribe.example.com/u?x=1' }), { action: 'deny' });
  assert.deepEqual(w.extern, ['https://app.space-media.ch.evil.com/', 'http://localhost:3000/', 'https://unsubscribe.example.com/u?x=1']);
});

test('navigieren (will-navigate): sign-in, OAuth and payment hosts leave the window, the way back stays in it', () => {
  const w = wache(false);
  const nav = (url) => {
    let verhindert = false;
    w.navigieren({ preventDefault: () => { verhindert = true; } }, url);
    return verhindert;
  };
  // The app itself: login, mail confirmation, OAuth return (Composio/GitHub), Stripe return, legacy host
  assert.equal(nav('https://app.space-media.ch/login'), false);
  assert.equal(nav('https://app.space-media.ch/auth/confirm?token_hash=x&type=signup&next=/'), false);
  assert.equal(nav('https://app.space-media.ch/api/mcp/callback?app=gmail&status=success'), false);
  assert.equal(nav('https://app.space-media.ch/settings?tab=abo&kasse=ok'), false);
  assert.equal(nav('https://space-media-app.vercel.app/chat'), false);
  assert.deepEqual(w.extern, []);
  // Out to the system browser, as before: Stripe Checkout/portal, Composio and provider OAuth, GitHub
  const extern = [
    'https://checkout.stripe.com/c/pay/cs_test_x',
    'https://billing.stripe.com/p/session/x',
    'https://backend.composio.dev/api/v3/s/x',
    'https://accounts.google.com/o/oauth2/v2/auth?client_id=x',
    'https://github.com/login/oauth/authorize?client_id=x',
    'https://app.space-media.ch.evil.com/login',
    'http://localhost:3000/',
  ];
  for (const url of extern) assert.equal(nav(url), true, url);
  assert.deepEqual(w.extern, extern);
});
