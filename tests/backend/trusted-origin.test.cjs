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
