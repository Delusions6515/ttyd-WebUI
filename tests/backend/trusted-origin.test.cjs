const test = require('node:test');
const assert = require('node:assert/strict');
const { createTrustedOriginGuard } = require('../../server/middleware/trusted-origin');

function request(host, origin, extras = {}) {
  return {
    headers: { host, ...(origin === undefined ? {} : { origin }), ...extras },
    socket: { encrypted: false },
  };
}

test('trusted guard accepts local same-origin access and explicitly configured origins', () => {
  const guard = createTrustedOriginGuard({
    port: 3210,
    trustedOrigins: ['https://terminal.example.test'],
    viteOrigin: 'http://127.0.0.1:5173',
  });

  assert.equal(guard.isTrusted(request('127.0.0.1:3210', 'http://127.0.0.1:3210')), true);
  assert.equal(guard.isTrusted(request('127.0.0.1:3210', 'http://127.0.0.1:5173')), true);
  assert.equal(guard.isTrusted(request('terminal.example.test', 'https://terminal.example.test')), true);
  assert.equal(guard.isTrusted(request('localhost:3210')), true);
});

test('trusted guard rejects hostile Origin and Host and ignores forwarded host claims', () => {
  const guard = createTrustedOriginGuard({ port: 3211, trustedOrigins: ['https://terminal.example.test'] });

  assert.equal(guard.isTrusted(request('127.0.0.1:3211', 'https://evil.example.test')), false);
  assert.equal(guard.isTrusted(request('evil.example.test', undefined, {
    'x-forwarded-host': 'terminal.example.test',
    'x-forwarded-proto': 'https',
  })), false);
  assert.equal(guard.isTrusted(request('127.0.0.1:9999')), false);
  assert.equal(guard.isTrusted(request('127.0.0.1:3211', 'null')), false);
});

test('invalid configured origins fail fast instead of broadening trust', () => {
  assert.throws(() => createTrustedOriginGuard({ trustedOrigins: ['*'] }), /origin/i);
  assert.throws(() => createTrustedOriginGuard({ viteOrigin: 'https://site.test/path' }), /origin/i);
});

test('tailnet wildcard origins accept exactly one device label with the configured scheme and port', () => {
  const guard = createTrustedOriginGuard({
    port: 3000,
    trustedOrigins: 'https://*.tail1234.ts.net, http://*.tail5678.ts.net:3000',
  });
  for (const [host, origin] of [
    ['server.tail1234.ts.net', 'https://server.tail1234.ts.net'],
    ['SERVER.tail1234.ts.net:443', 'https://server.tail1234.ts.net:443'],
    ['another-device.tail1234.ts.net', undefined],
    ['server.tail5678.ts.net:3000', 'http://server.tail5678.ts.net:3000'],
    ['127.0.0.1:3000', 'https://server.tail1234.ts.net'],
  ]) assert.equal(guard.isTrusted(request(host, origin)), true, `${host} / ${origin}`);

  for (const [host, origin] of [
    ['tail1234.ts.net', 'https://tail1234.ts.net'],
    ['deep.server.tail1234.ts.net', 'https://deep.server.tail1234.ts.net'],
    ['server.tail1234.ts.net.evil.test', 'https://server.tail1234.ts.net.evil.test'],
    ['server.other-tailnet.ts.net', 'https://server.other-tailnet.ts.net'],
    ['server.tail1234.ts.net', 'http://server.tail1234.ts.net'],
    ['server.tail1234.ts.net:80', 'https://server.tail1234.ts.net'],
    ['server.tail1234.ts.net:8443', 'https://server.tail1234.ts.net'],
    ['server.tail1234.ts.net', 'https://server.tail1234.ts.net:8443'],
    ['server.tail5678.ts.net', 'http://server.tail5678.ts.net:3000'],
    ['server.tail5678.ts.net:3000', 'https://server.tail5678.ts.net:3000'],
    ['*.tail1234.ts.net', 'https://*.tail1234.ts.net'],
    ['server.tail1234.ts.net', 'https://*.tail1234.ts.net'],
    ['_server.tail1234.ts.net', undefined],
    ['-server.tail1234.ts.net', undefined],
    ['server.tail1234.ts.net', 'null'],
  ]) assert.equal(guard.isTrusted(request(host, origin)), false, `${host} / ${origin}`);

  assert.equal(guard.isTrusted(request('evil.test', 'https://server.tail1234.ts.net', {
    'x-forwarded-host': 'server.tail1234.ts.net',
    'x-forwarded-proto': 'https',
  })), false);
});

test('wildcard matching normalizes default ports but never grants an HTTP downgrade', () => {
  const guard = createTrustedOriginGuard({ trustedOrigins: ['http://*.tail1234.ts.net:80', 'https://terminal.example.test'] });
  assert.equal(guard.isTrusted(request('server.tail1234.ts.net:80', 'http://server.tail1234.ts.net')), true);
  assert.equal(guard.isTrusted(request('server.tail1234.ts.net', 'http://server.tail1234.ts.net:80')), true);
  assert.equal(guard.isTrusted(request('server.tail1234.ts.net:443', 'http://server.tail1234.ts.net')), false);
  assert.equal(guard.isTrusted(request('terminal.example.test', 'http://terminal.example.test')), false);
});

test('only an explicit leftmost DNS-label wildcard is permitted in trusted configuration', () => {
  for (const value of [
    '*', 'https://*', 'https://*tail1234.ts.net', 'https://device.*.ts.net',
    'https://**.tail1234.ts.net', 'https://*.tail1234.ts.net:*',
    'https://*.tail1234.ts.net/path', 'https://*.tail1234.ts.net?query=1',
    'https://user:password@*.tail1234.ts.net', 'https://*.localhost',
    'http://*.127.0.0.1', 'https://*.bad_label.ts.net',
    'https://%2A.tail1234.ts.net', 'https://*.tail1234.ts.net#fragment',
  ]) assert.throws(() => createTrustedOriginGuard({ trustedOrigins: [value] }), /origin/i, value);
  assert.throws(() => createTrustedOriginGuard({ viteOrigin: 'https://*.tail1234.ts.net' }), /origin/i);
});
