const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createRuntime, runTmux } = require('../fixtures/runtime.cjs');
const { connectTerminal } = require('../fixtures/terminal-session');
const SessionManager = require('../../server/services/session-manager');
const createApp = require('../../server/app');
const { WebSocket } = require('../../server/node_modules/ws');

function hasTmuxSession(name, socket) {
  const args = socket ? ['-L', socket, 'has-session', '-t', `=${name}`] : ['has-session', '-t', `=${name}`];
  try {
    execFileSync('tmux', args, { stdio: 'ignore', env: process.env });
    return true;
  } catch {
    return false;
  }
}

test('real ttyd token-first WebSocket retains a tmux shell, resizes, and deletes only its own namespace', async (t) => {
  assert.match(execFileSync('ttyd', ['--version'], { encoding: 'utf8' }), /1\.7\.7/);
  assert.match(execFileSync('tmux', ['-V'], { encoding: 'utf8' }), /^tmux /);

  const runtime = await createRuntime();
  const name = `protocol-${process.pid}`;
  const marker = `owned-${process.pid}`;
  let connection;
  let defaultSocketPrepared = false;
  t.after(async () => {
    await connection?.close();
    if (defaultSocketPrepared) {
      await runTmux(['kill-session', '-t', `=${name}`], { ignoreFailure: true });
      await runTmux(['kill-server'], { ignoreFailure: true });
    }
    await runtime.close();
  });

  await runTmux(['new-session', '-d', '-s', name]);
  defaultSocketPrepared = true;
  assert.equal(hasTmuxSession(name), true, 'fixture created the collision target on its private default socket');

  const created = await runtime.sessionManager.create(name, 'bash');
  assert.equal(created.status, 'running');
  const directOrigin = `http://127.0.0.1:${created.port}`;
  for (const headers of [{}, { Origin: 'https://hostile.example' }, { Authorization: 'Basic forged' }]) {
    assert.equal((await fetch(`${directOrigin}/terminal/${name}/token`, { headers })).status, 401);
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(`${directOrigin.replace('http:', 'ws:')}/terminal/${name}/ws`, 'tty', { headers, handshakeTimeout: 3000 });
      socket.once('open', () => { socket.terminate(); reject(new Error('direct unauthenticated WebSocket opened')); });
      socket.once('unexpected-response', (_request, response) => { response.resume(); socket.terminate(); resolve(); });
      socket.once('error', () => resolve());
    });
  }
  connection = await connectTerminal(runtime.origin, name);
  connection.sendInput(`export U8_MARKER=${marker}; printf 'STATE:%s\\n' "$U8_MARKER"\n`);
  await connection.waitForOutput(`STATE:${marker}`);
  assert.equal(hasTmuxSession(name, runtime.tmuxSocket), true, 'the application created the task only on its named socket');

  connection.resize(53, 17);
  await new Promise((resolve) => setTimeout(resolve, 150));
  connection.sendInput("stty size; printf '\\nRESIZE_DONE\\n'\n");
  const resizedOutput = await connection.waitForOutput((output) => output.includes('\nRESIZE_DONE'));
  const size = /\n(\d+) 53/.exec(resizedOutput);
  assert.ok(size, 'stty reports the requested 53 columns');
  const tmuxStatus = execFileSync('tmux', ['-L', runtime.tmuxSocket, 'show-option', '-gv', 'status'], { encoding: 'utf8' }).trim();
  assert.equal(Number(size[1]), 17 - (tmuxStatus === 'on' ? 1 : 0));

  await connection.close();
  connection = undefined;
  await runtime.sessionManager.stop(name);
  assert.equal(hasTmuxSession(name, runtime.tmuxSocket), true, 'stopping web access preserves the managed tmux task');
  await runtime.sessionManager.restart(name);
  connection = await connectTerminal(runtime.origin, name);
  connection.sendInput(`printf 'RESUMED:%s\\n' "$U8_MARKER"\n`);
  await connection.waitForOutput(`RESUMED:${marker}`);

  await connection.close();
  connection = undefined;
  await runtime.sessionManager.remove(name);
  assert.equal(hasTmuxSession(name, runtime.tmuxSocket), false, 'delete removes the exact managed tmux target');
  assert.equal(hasTmuxSession(name), true, 'same-named task on the host default socket is untouched');
  await runTmux(['kill-session', '-t', `=${name}`]);
  defaultSocketPrepared = false;
  await runTmux(['kill-server'], { ignoreFailure: true });
});

test('scroll drives tmux copy mode through the real managed session and leaves the task running', async (t) => {
  const runtime = await createRuntime();
  const name = `scroll-${process.pid}`;
  let connection;
  t.after(async () => {
    await connection?.close();
    await runtime.close();
  });

  await runtime.sessionManager.create(name, 'bash');
  connection = await connectTerminal(runtime.origin, name);
  connection.resize(80, 24);
  connection.sendInput('seq 1 600\n');
  await connection.waitForOutput('600');
  await new Promise((resolve) => setTimeout(resolve, 300));

  const paneInMode = () => execFileSync(
    'tmux',
    ['-L', runtime.tmuxSocket, 'display-message', '-p', '-t', `=${name}:`, '#{pane_in_mode}'],
    { encoding: 'utf8', env: process.env },
  ).trim();

  assert.equal(paneInMode(), '0', 'a healthy pane starts outside copy mode');
  await runtime.sessionManager.scroll(name, { direction: 'up', lines: 5 });
  assert.equal(paneInMode(), '1', 'scrolling up enters tmux copy mode');
  await runtime.sessionManager.scroll(name, { direction: 'down', lines: 2 });
  assert.equal(paneInMode(), '1', 'scrolling down stays in tmux copy mode');
  await runtime.sessionManager.scroll(name, { direction: 'bottom' });
  assert.equal(paneInMode(), '0', 'returning to the bottom leaves tmux copy mode');
  assert.equal(runtime.sessionManager.list()[0].status, 'running', 'scrolling never stops or deletes the managed session');
  assert.equal(hasTmuxSession(name, runtime.tmuxSocket), true, 'the managed tmux task survives tmux scrolling');

  await connection.close();
  connection = undefined;
});

test('service restart stops only managed ttyd and starts with an empty registry while tmux survives', async (t) => {
  const runtime = await createRuntime();
  const name = `restart-${process.pid}`;
  let connection;
  let restartedService;
  const shellValue = `preserved-${process.pid}`;
  t.after(async () => {
    await connection?.close();
    await restartedService?.close();
    await runtime.close();
  });

  await runtime.sessionManager.create(name, 'bash');
  connection = await connectTerminal(runtime.origin, name);
  connection.sendInput(`export U8_RESTART_VALUE=${shellValue}; printf 'RESTART_STATE:%s\\n' "$U8_RESTART_VALUE"\n`);
  await connection.waitForOutput(`RESTART_STATE:${shellValue}`);

  await runtime.service.close();
  await runtime.sessionManager.cleanup();
  await connection.close();
  connection = undefined;
  assert.equal(runtime.sessionManager.list()[0].status, 'stopped');
  assert.equal(runtime.sessionManager.list()[0].pid, null);
  assert.equal(hasTmuxSession(name, runtime.tmuxSocket), true, 'normal shutdown preserves the existing tmux task');

  const restartedManager = new SessionManager({ tmuxSocket: runtime.tmuxSocket });
  restartedService = createApp({ sessionManager: restartedManager, host: '127.0.0.1', port: 0 });
  const restartedPort = await new Promise((resolve, reject) => {
    restartedService.server.once('error', reject);
    restartedService.server.listen(0, '127.0.0.1', () => resolve(restartedService.server.address().port));
  });
  const response = await fetch(`http://127.0.0.1:${restartedPort}/api/sessions`);
  assert.deepEqual(await response.json(), { sessions: [] });
  await assert.rejects(restartedManager.create(name, 'bash'), /already exists in tmux/);
  assert.deepEqual(restartedManager.list(), []);
  assert.equal(hasTmuxSession(name, runtime.tmuxSocket), true, 'rejected creation never adopts or deletes the preserved task');
  await runTmux(['-L', runtime.tmuxSocket, 'new-session', '-d', '-s', 'bash-1']);
  const automatic = await restartedManager.create(undefined, 'bash');
  assert.equal(automatic.name, 'bash-2');
  await restartedManager.remove(automatic.name);
  assert.equal(hasTmuxSession('bash-1', runtime.tmuxSocket), true, 'automatic creation/deletion does not touch the preserved name');
  await restartedService.close();
  restartedService = undefined;
  await restartedManager.cleanup();
  assert.equal(hasTmuxSession(name, runtime.tmuxSocket), true, 'an empty restarted registry does not invent records or end the task');
});
