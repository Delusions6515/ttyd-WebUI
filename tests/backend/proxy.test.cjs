const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { EventEmitter } = require('node:events');
const { WebSocket, WebSocketServer } = require('../../server/node_modules/ws');
const createApp = require('../../server/app');

async function listen(server, port = 0) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function close(server) {
  if (server.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
}

function responseServer(handler) {
  const server = http.createServer(handler);
  return server;
}

function fakeManager(sessions) {
  const manager = new EventEmitter();
  manager.list = () => sessions.map(({ name, status, port }) => ({ name, status, port }));
  manager.getShells = () => [];
  manager.getSession = (name) => sessions.find((session) => session.name === name) || null;
  return manager;
}

test('tailnet wildcard validation is shared by HTTP, metadata WebSocket and terminal WebSocket', async (t) => {
  const upstream = responseServer((req, res) => {
    assert.equal(req.headers.authorization, 'Basic private-upstream');
    res.end('terminal');
  });
  const upstreamWss = new WebSocketServer({ noServer: true });
  upstream.on('upgrade', (req, socket, head) => {
    assert.equal(req.headers.authorization, 'Basic private-upstream');
    upstreamWss.handleUpgrade(req, socket, head, (ws) => ws.on('message', (data) => ws.send(data)));
  });
  const upstreamPort = await listen(upstream);
  const app = createApp({
    sessionManager: fakeManager([{ name: 'term', status: 'running', port: upstreamPort, upstreamAuthorization: 'Basic private-upstream' }]),
    trustedOrigins: ['https://*.tail1234.ts.net'],
    host: '127.0.0.1',
  });
  const port = await listen(app.server);
  t.after(async () => {
    await app.close();
    upstreamWss.close();
    await close(upstream);
  });

  async function requestHttp(path, headers) {
    return new Promise((resolve, reject) => {
      const request = http.request({ hostname: '127.0.0.1', port, path, headers }, (response) => {
        let body = '';
        response.on('data', (chunk) => { body += chunk.toString(); });
        response.once('end', () => resolve({ status: response.statusCode, body }));
        response.once('error', reject);
      });
      request.once('error', reject);
      request.end();
    });
  }

  async function upgrade(path, headers, expectedStatus) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers, handshakeTimeout: 3000 });
      socket.once('open', () => {
        if (expectedStatus === 101) resolve(socket);
        else { socket.terminate(); reject(new Error('untrusted upgrade opened')); }
      });
      socket.once('unexpected-response', (_request, response) => {
        response.resume();
        socket.terminate();
        if (response.statusCode === expectedStatus) resolve(null);
        else reject(new Error(`unexpected upgrade status: ${response.statusCode}`));
      });
      socket.once('error', reject);
    });
  }

  const allowed = { Host: 'server.tail1234.ts.net', Origin: 'https://server.tail1234.ts.net' };
  assert.equal((await requestHttp('/api/sessions', allowed)).status, 200);
  assert.equal((await requestHttp('/terminal/term/token', allowed)).body, 'terminal');
  const metadata = await upgrade('/ws', allowed, 101);
  metadata.close();
  const terminal = await upgrade('/terminal/term/ws', allowed, 101);
  const echoed = new Promise((resolve, reject) => {
    terminal.once('message', (data) => resolve(data.toString()));
    terminal.once('error', reject);
  });
  terminal.send('wildcard-input');
  assert.equal(await echoed, 'wildcard-input');
  terminal.close();

  for (const headers of [
    { ...allowed, Origin: 'http://server.tail1234.ts.net' },
    { ...allowed, Origin: 'https://server.tail1234.ts.net:8443' },
    { Host: 'nested.server.tail1234.ts.net', Origin: 'https://nested.server.tail1234.ts.net' },
    { Host: 'server.tail1234.ts.net.evil.test', Origin: 'https://server.tail1234.ts.net.evil.test' },
    { ...allowed, Host: 'evil.test', 'X-Forwarded-Host': allowed.Host },
  ]) {
    for (const path of ['/api/sessions', '/terminal/term/token']) {
      assert.equal((await requestHttp(path, headers)).status, 403, `${path}: ${JSON.stringify(headers)}`);
    }
    await upgrade('/ws', headers, 403);
    await upgrade('/terminal/term/ws', headers, 403);
  }
});

test('HTTP proxy preserves ttyd base paths and routes each session to its own port', async (t) => {
  const seen = [];
  const upstreams = [
    responseServer((req, res) => {
      seen.push(['alpha', req.url]);
      assert.equal(req.headers.authorization, 'Basic alpha-secret');
      if (req.url === '/terminal/alpha/page') {
        res.setHeader('content-type', 'text/html');
        res.setHeader('content-security-policy', 'default-src \'self\'');
        res.end('<main>terminal</main>');
      } else {
        res.setHeader('content-type', 'text/plain');
        res.end('alpha');
      }
    }),
    responseServer((req, res) => {
      seen.push(['beta', req.url]);
      assert.equal(req.headers.authorization, 'Basic beta-secret');
      res.end('beta');
    }),
  ];
  const ports = await Promise.all(upstreams.map((server) => listen(server)));
  const sessions = [
    { name: 'alpha', status: 'running', port: ports[0], upstreamAuthorization: 'Basic alpha-secret' },
    { name: 'beta', status: 'running', port: ports[1], upstreamAuthorization: 'Basic beta-secret' },
    { name: 'stopped', status: 'stopped', port: ports[0] },
  ];
  const app = createApp({ sessionManager: fakeManager(sessions), port: 3000, host: '127.0.0.1' });
  const serverPort = await listen(app.server);
  t.after(async () => {
    await app.close();
    await Promise.all(upstreams.map(close));
  });

  const origin = `http://127.0.0.1:${serverPort}`;
  assert.equal(await (await fetch(`${origin}/terminal/alpha/token?query=1`, { headers: { Authorization: 'Basic forged' } })).text(), 'alpha');
  assert.equal(await (await fetch(`${origin}/terminal/beta/ws`)).text(), 'beta');
  const terminalPage = await fetch(`${origin}/terminal/alpha/page`);
  assert.equal(await terminalPage.text(), '<main>terminal</main>');
  assert.match(terminalPage.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(terminalPage.headers.get('content-security-policy'), /default-src/);
  assert.deepEqual(seen, [
    ['alpha', '/terminal/alpha/token?query=1'],
    ['beta', '/terminal/beta/ws'],
    ['alpha', '/terminal/alpha/page'],
  ]);
  assert.equal((await fetch(`${origin}/terminal/stopped/token`)).status, 404);
  assert.equal((await fetch(`${origin}/terminal/unknown/token`)).status, 404);
  assert.equal((await fetch(`${origin}/terminal/%2F/token`)).status, 404);
  assert.equal((await fetch(`${origin}/terminal/%61lpha/token`)).status, 404);
});

test('API errors and unknown upgrade paths never fall through to the SPA', async (t) => {
  const staticDir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'ttyd-webui-proxy-'));
  require('node:fs').writeFileSync(require('node:path').join(staticDir, 'index.html'), '<main>app</main>');
  const app = createApp({ sessionManager: fakeManager([]), publicDir: staticDir, port: 3000, host: '127.0.0.1' });
  const serverPort = await listen(app.server);
  t.after(async () => {
    await app.close();
    require('node:fs').rmSync(staticDir, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${serverPort}`;

  const missingApi = await fetch(`${origin}/api/not-a-route`);
  assert.equal(missingApi.status, 404);
  assert.match(missingApi.headers.get('content-type'), /application\/json/);
  assert.equal(missingApi.headers.get('content-security-policy'), "frame-ancestors 'none'");
  assert.equal(await (await fetch(`${origin}/unmatched/path`)).text(), '<main>app</main>');
  const notFound = await fetch(`${origin}/ws`);
  assert.equal(notFound.status, 404);
  assert.match(notFound.headers.get('content-type'), /application\/json/);

  const wsOutcome = await new Promise((resolve) => {
    const socket = net.connect(serverPort, '127.0.0.1');
    let data = '';
    socket.on('connect', () => socket.write(`GET /unknown HTTP/1.1\r\nHost: 127.0.0.1:${serverPort}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`));
    socket.on('data', (chunk) => { data += chunk.toString(); });
    socket.on('close', () => resolve(data));
    socket.on('error', () => resolve(data));
  });
  assert.match(wsOutcome, /^HTTP\/1\.1 404/);
});

test('terminal WebSocket upgrades work before any HTTP request and reject stopped targets', async (t) => {
  const echoes = [];
  const upstream = http.createServer();
  const upstreamWss = new WebSocketServer({ noServer: true });
  upstream.on('upgrade', (req, socket, head) => {
    assert.equal(req.headers.authorization, 'Basic term-secret');
    upstreamWss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('message', (message) => {
        echoes.push(message.toString());
        ws.send(`echo:${message}`);
      });
    });
  });
  const upstreamPort = await listen(upstream);
  const sessions = [{ name: 'term', status: 'running', port: upstreamPort, upstreamAuthorization: 'Basic term-secret' }, { name: 'off', status: 'stopped', port: upstreamPort }];
  const app = createApp({ sessionManager: fakeManager(sessions), port: 3000, host: '127.0.0.1' });
  const serverPort = await listen(app.server);
  t.after(async () => {
    await app.close();
    upstreamWss.close();
    await close(upstream);
  });

  const socket = new WebSocket(`ws://127.0.0.1:${serverPort}/terminal/term/ws`, 'tty', { headers: { Authorization: 'Basic forged' } });
  const response = await new Promise((resolve, reject) => {
    socket.once('open', () => socket.send('probe'));
    socket.once('message', (message) => resolve(message.toString()));
    socket.once('error', reject);
  });
  assert.equal(response, 'echo:probe');
  assert.deepEqual(echoes, ['probe']);
  socket.close();

  const rejected = new WebSocket(`ws://127.0.0.1:${serverPort}/terminal/off/ws`, 'tty');
  await new Promise((resolve) => rejected.once('unexpected-response', (_request, response) => {
    assert.equal(response.statusCode, 404);
    response.resume();
    resolve();
  }));
});

test('management WebSocket broadcasts the existing event envelope', async (t) => {
  const manager = fakeManager([]);
  const app = createApp({ sessionManager: manager, host: '127.0.0.1' });
  const port = await listen(app.server);
  t.after(() => app.close());

  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const message = new Promise((resolve, reject) => {
    socket.once('open', () => manager.emit('session:created', { name: 'dev', status: 'running' }));
    socket.once('message', (value) => resolve(JSON.parse(value.toString())));
    socket.once('error', reject);
  });
  assert.deepEqual(await message, { event: 'session:created', data: { name: 'dev', status: 'running' } });
  socket.close();
});

test('malicious Origin and Host are rejected without trusting forwarding headers', async (t) => {
  const app = createApp({ sessionManager: fakeManager([]), port: 3000, host: '127.0.0.1', trustedOrigins: ['https://terminal.example.test'] });
  const serverPort = await listen(app.server);
  t.after(() => app.close());
  const response = await fetch(`http://127.0.0.1:${serverPort}/api/sessions`, {
    headers: {
      origin: 'https://evil.example.test',
      host: `127.0.0.1:${serverPort}`,
      'x-forwarded-host': 'terminal.example.test',
      'x-forwarded-proto': 'https',
    },
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'Untrusted request origin' });
});

test('session API paths preserve their response shapes and surface failures as JSON', async (t) => {
  const calls = [];
  const manager = new EventEmitter();
  manager.list = () => [{ name: 'dev', status: 'stopped' }];
  manager.getShells = () => [{ id: 'sh', name: 'Sh' }];
  manager.create = async (name, shell) => {
    calls.push(['create', name, shell]);
    if (name === 'broken') throw Object.assign(new Error('ttyd startup failed'), { statusCode: 502 });
    return { name, shell, status: 'running' };
  };
  manager.stop = async (name) => { calls.push(['stop', name]); return { name, status: 'stopped' }; };
  manager.restart = async (name) => { calls.push(['restart', name]); return { name, status: 'running' }; };
  manager.remove = async (name) => { calls.push(['remove', name]); return { name }; };
  manager.getSession = () => null;

  const app = createApp({ sessionManager: manager, host: '127.0.0.1' });
  const port = await listen(app.server);
  t.after(() => app.close());
  const base = `http://127.0.0.1:${port}/api/sessions`;

  assert.deepEqual(await (await fetch(base)).json(), { sessions: [{ name: 'dev', status: 'stopped' }] });
  assert.deepEqual(await (await fetch(`${base}/shells`)).json(), { shells: [{ id: 'sh', name: 'Sh' }] });
  const created = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'new', shell: 'sh' }),
  });
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { name: 'new', shell: 'sh', status: 'running' });
  const failed = await fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'broken', shell: 'sh' }),
  });
  assert.equal(failed.status, 502);
  assert.deepEqual(await failed.json(), { error: 'ttyd startup failed' });

  await fetch(`${base}/new/stop`, { method: 'POST' });
  await fetch(`${base}/new/restart`, { method: 'POST' });
  await fetch(`${base}/new`, { method: 'DELETE' });
  assert.deepEqual(calls, [
    ['create', 'new', 'sh'],
    ['create', 'broken', 'sh'],
    ['stop', 'new'],
    ['restart', 'new'],
    ['remove', 'new'],
  ]);
});

test('shutdown closes metadata and proxied terminal sockets and removes listeners', async () => {
  const upstream = http.createServer();
  const upstreamWss = new WebSocketServer({ noServer: true });
  upstream.on('upgrade', (req, socket, head) => upstreamWss.handleUpgrade(req, socket, head, (client) => {
    client.on('message', () => client.send('ready'));
  }));
  const upstreamPort = await listen(upstream);
  const manager = fakeManager([{ name: 'probe', status: 'running', port: upstreamPort }]);
  const service = createApp({ sessionManager: manager, host: '127.0.0.1' });
  const appPort = await listen(service.server);
  let terminal;
  let metadata;
  let closePromise;

  async function cleanup() {
    terminal?.terminate();
    metadata?.terminate();
    for (const client of upstreamWss.clients) client.terminate();
    closePromise ||= service.close();
    let timer;
    await Promise.race([closePromise, new Promise((resolve) => { timer = setTimeout(resolve, 1000); })]);
    clearTimeout(timer);
    await new Promise((resolve) => upstreamWss.close(resolve));
    await close(upstream);
  }

  try {
    terminal = new WebSocket(`ws://127.0.0.1:${appPort}/terminal/probe/ws`);
    metadata = new WebSocket(`ws://127.0.0.1:${appPort}/ws`);
    await Promise.all([terminal, metadata].map((socket) => new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    })));
    assert.equal(upstreamWss.clients.size, 1);
    assert.equal(manager.listenerCount('session:created'), 1);
    assert.equal(service.server.listenerCount('upgrade'), 1);
    const terminalClosed = new Promise((resolve) => terminal.once('close', resolve));
    const metadataClosed = new Promise((resolve) => metadata.once('close', resolve));
    const upstreamClientClosed = new Promise((resolve) => [...upstreamWss.clients][0].once('close', resolve));

    closePromise = service.close();
    const duplicateClose = service.close();
    let timer;
    const completed = await Promise.race([
      Promise.all([closePromise, duplicateClose, terminalClosed, metadataClosed, upstreamClientClosed]).then(() => true),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), 150); }),
    ]);
    clearTimeout(timer);
    assert.equal(completed, true, 'shutdown should settle while both websocket clients are active');
    assert.equal(terminal.readyState, WebSocket.CLOSED);
    assert.equal(metadata.readyState, WebSocket.CLOSED);
    assert.equal(service.server.listening, false);
    assert.equal(service.server.listenerCount('upgrade'), 0);
    assert.equal(manager.listenerCount('session:created'), 0);
    assert.equal(manager.list().length, 1, 'closing web access must not remove or kill the tmux-backed session');
    assert.equal(upstreamWss.clients.size, 0);
  } finally {
    await cleanup();
  }
});

test('an upstream connection refusal returns a bounded 502 response', async (t) => {
  const unopened = responseServer((_req, res) => res.end('unreachable'));
  const port = await listen(unopened);
  await close(unopened);
  const app = createApp({
    sessionManager: fakeManager([{ name: 'offline', status: 'running', port }]),
    host: '127.0.0.1',
  });
  const appPort = await listen(app.server);
  t.after(() => app.close());

  const response = await fetch(`http://127.0.0.1:${appPort}/terminal/offline/token`);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'Terminal proxy error' });
});
