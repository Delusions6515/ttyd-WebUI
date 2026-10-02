const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const os = require('node:os');
const { PassThrough } = require('node:stream');
const SessionManager = require('../../server/services/session-manager');

class FakeChild extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.exitCode = null;
    this.signalCode = null;
    this.kills = [];
  }

  kill(signal) {
    this.kills.push(signal);
    queueMicrotask(() => {
      this.exitCode = 0;
      this.emit('exit', 0, null);
      this.emit('close', 0, null);
    });
    return true;
  }
}

function createHarness(options = {}) {
  let nextPort = 7681;
  const released = [];
  const children = [];
  const spawned = [];
  const tmuxCalls = [];
  const portManager = {
    async allocate() {
      return nextPort++;
    },
    release(port) {
      released.push(port);
    },
  };
  const manager = new SessionManager({
    portManager,
    shells: [{ id: 'sh', name: 'Sh', path: '/bin/sh' }],
    spawn(command, args, spawnOptions) {
      const child = new FakeChild(children.length + 1);
      children.push(child);
      spawned.push({ command, args, spawnOptions });
      return child;
    },
    waitForPort: options.waitForPort || (async () => {}),
    execFile(command, args, execOptions, callback) {
      if (args.includes('has-session')) {
        const occupied = options.occupiedNames?.includes(args.at(-1).slice(1));
        setImmediate(() => callback(occupied ? null : new Error("can't find session")));
        return;
      }
      tmuxCalls.push({ command, args, execOptions });
      setImmediate(() => callback(options.tmuxError || null));
    },
    tmuxSocket: 'ttyd-webui-test',
    ...options.managerOptions,
  });

  return { manager, children, spawned, released, tmuxCalls };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('create binds ttyd to loopback, isolates tmux, and stop preserves the task', async () => {
  const harness = createHarness();
  const { manager, spawned, children, released } = harness;

  assert.deepEqual(manager.getShells(), [{ id: 'sh', name: 'Sh', path: '/bin/sh' }]);
  const created = await manager.create('dev', 'sh');
  const command = spawned[0];
  assert.equal(created.name, 'dev');
  assert.equal(created.status, 'running');
  assert.equal(command.command, 'ttyd');
  assert.ok(command.args.includes('-i'));
  assert.ok(command.args.includes('127.0.0.1'));
  assert.deepEqual(command.args.slice(-10), ['tmux', '-L', 'ttyd-webui-test', 'new', '-A', '-s', 'dev', '-c', os.homedir(), '/bin/sh']);
  assert.equal(command.spawnOptions.shell, false);

  const stopped = await manager.stop('dev');
  assert.equal(stopped.status, 'stopped');
  assert.deepEqual(children[0].kills, ['SIGTERM']);
  assert.deepEqual(released, [created.port]);
  assert.deepEqual(harness.tmuxCalls, []);
});

test('the tmux task starts in the resolved home directory, falling back to HOME', async () => {
  const cases = [
    [{ home: '/home/tester', env: { PATH: '', HOME: '/ignored' } }, '/home/tester'],
    [{ home: '', env: { PATH: '', HOME: '/from-env' } }, '/from-env'],
    [{ home: '/explicit', env: { PATH: '', HOME: '/from-env' } }, '/explicit'],
    [{ home: '', env: { PATH: '' } }, null],
  ];
  for (const [managerOptions, expected] of cases) {
    const harness = createHarness({ managerOptions });
    await harness.manager.create('dev', 'sh');
    const args = harness.spawned[0].args;
    const tmuxArgs = args.slice(args.indexOf('tmux'));
    const startIndex = tmuxArgs.indexOf('-c');
    assert.equal(startIndex === -1 ? null : tmuxArgs[startIndex + 1], expected, JSON.stringify(managerOptions));
  }
});

test('scroll drives tmux copy mode on the exact owned pane target for each direction', async () => {
  const harness = createHarness();
  await harness.manager.create('dev', 'sh');
  harness.tmuxCalls.length = 0;

  await harness.manager.scroll('dev', { direction: 'up', lines: 5 });
  assert.deepEqual(harness.tmuxCalls.map(({ command, args }) => [command, ...args]), [
    ['tmux', '-L', 'ttyd-webui-test', 'copy-mode', '-e', '-t', '=dev:'],
    ['tmux', '-L', 'ttyd-webui-test', 'send-keys', '-t', '=dev:', '-N', '5', '-X', 'scroll-up'],
  ]);

  harness.tmuxCalls.length = 0;
  await harness.manager.scroll('dev', { direction: 'down', lines: 1 });
  assert.deepEqual(harness.tmuxCalls.map(({ args }) => args), [
    ['-L', 'ttyd-webui-test', 'copy-mode', '-e', '-t', '=dev:'],
    ['-L', 'ttyd-webui-test', 'send-keys', '-t', '=dev:', '-N', '1', '-X', 'scroll-down'],
  ]);

  harness.tmuxCalls.length = 0;
  await harness.manager.scroll('dev', { direction: 'down' });
  assert.deepEqual(harness.tmuxCalls.map(({ args }) => args), [
    ['-L', 'ttyd-webui-test', 'copy-mode', '-e', '-t', '=dev:'],
    ['-L', 'ttyd-webui-test', 'send-keys', '-t', '=dev:', '-N', '5', '-X', 'scroll-down'],
  ]);

  harness.tmuxCalls.length = 0;
  await harness.manager.scroll('dev', { direction: 'bottom' });
  assert.deepEqual(harness.tmuxCalls.map(({ args }) => args), [
    ['-L', 'ttyd-webui-test', 'send-keys', '-t', '=dev:', '-X', 'cancel'],
  ]);

  assert.deepEqual(harness.manager.list().map(({ name, status }) => [name, status]), [['dev', 'running']]);
  assert.deepEqual(harness.spawned.length, 1);
});

test('scroll accepts an already live pane and rejects unknown sessions, directions and line counts', async () => {
  const harness = createHarness();
  await harness.manager.create('dev', 'sh');
  harness.tmuxCalls.length = 0;

  const alreadyLive = Object.assign(new Error('Command failed: tmux'), { stderr: 'not in a mode' });
  harness.manager.execFile = (command, args, execOptions, callback) => {
    harness.tmuxCalls.push({ command, args, execOptions });
    setImmediate(() => callback(args.includes('cancel') ? alreadyLive : null, '', args.includes('cancel') ? 'not in a mode' : ''));
  };
  assert.deepEqual(await harness.manager.scroll('dev', { direction: 'bottom' }), harness.manager.list()[0]);

  for (const lines of [0, -1, 101, 1.5, '5', null]) {
    await assert.rejects(harness.manager.scroll('dev', { direction: 'up', lines }), /between 1 and 100/);
  }
  for (const direction of ['left', 'UP', '', undefined]) {
    await assert.rejects(harness.manager.scroll('dev', { direction }), /direction/);
  }
  await assert.rejects(harness.manager.scroll('missing', { direction: 'up' }), (error) => {
    assert.equal(error.statusCode, 404);
    return true;
  });
});

test('scroll surfaces tmux failures other than an already live pane', async () => {
  const harness = createHarness();
  await harness.manager.create('dev', 'sh');
  harness.manager.execFile = (command, args, execOptions, callback) => {
    harness.tmuxCalls.push({ command, args, execOptions });
    setImmediate(() => callback(Object.assign(new Error('tmux failed'), { stderr: "can't find pane: =dev:" })));
  };
  await assert.rejects(harness.manager.scroll('dev', { direction: 'up' }), /tmux failed/);
});

test('new records cannot adopt preserved tmux names and automatic names skip them', async () => {
  const harness = createHarness({ occupiedNames: ['dev', 'sh-1', 'sh-2'] });
  await assert.rejects(harness.manager.create('dev', 'sh'), /already exists in tmux/);
  assert.equal(harness.spawned.length, 0);
  const created = await harness.manager.create(undefined, 'sh');
  assert.equal(created.name, 'sh-3');
  assert.deepEqual(harness.manager.list().map(({ name }) => name), ['sh-3']);
});

test('ttyd credentials rotate per process and never appear in DTOs', async () => {
  const harness = createHarness();
  const created = await harness.manager.create('private', 'sh');
  const firstArgs = harness.spawned[0].args;
  const first = firstArgs[firstArgs.indexOf('-c') + 1];
  assert.match(first, /^ttyd:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(created).includes(first), false);
  assert.equal(harness.manager.getSession('private').upstreamAuthorization, `Basic ${Buffer.from(first).toString('base64')}`);
  await harness.manager.stop('private');
  await harness.manager.restart('private');
  const nextArgs = harness.spawned[1].args;
  assert.notEqual(nextArgs[nextArgs.indexOf('-c') + 1], first);
});

test('concurrent same-name creates reserve the name before awaiting readiness', async () => {
  const ready = deferred();
  const harness = createHarness({ waitForPort: () => ready.promise });
  const first = harness.manager.create('same', 'sh');
  await assert.rejects(harness.manager.create('same', 'sh'), /already exists/i);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.spawned.length, 1);
  ready.resolve();
  assert.equal((await first).name, 'same');
  assert.equal(harness.manager.list().length, 1);
});

test('concurrent restarts settle once and a late old-generation exit cannot stop the new process', async () => {
  const ready = deferred();
  let call = 0;
  const harness = createHarness({ waitForPort: () => (++call === 2 ? ready.promise : Promise.resolve()) });
  const original = await harness.manager.create('dev', 'sh');
  const oldChild = harness.children[0];
  oldChild.kill = function kill(signal) {
    this.kills.push(signal);
    queueMicrotask(() => {
      this.exitCode = 0;
      this.emit('close', 0, null);
    });
    return true;
  };
  await harness.manager.stop('dev');

  const firstRestart = harness.manager.restart('dev');
  const secondRestart = harness.manager.restart('dev');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.spawned.length, 2);
  ready.resolve();
  const resumed = await firstRestart;
  await assert.rejects(secondRestart, /already running/i);

  oldChild.exitCode = 0;
  oldChild.emit('exit', 0, null);
  const current = harness.manager.list()[0];
  assert.equal(current.status, 'running');
  assert.equal(current.port, resumed.port);
  assert.notEqual(current.port, original.port);
});

test('a late exit after deletion and same-name recreation cannot mutate the new entry', async () => {
  const harness = createHarness();
  const original = await harness.manager.create('dev', 'sh');
  const oldChild = harness.children[0];
  oldChild.kill = function kill(signal) {
    this.kills.push(signal);
    queueMicrotask(() => {
      this.exitCode = 0;
      this.emit('close', 0, null);
    });
    return true;
  };
  await harness.manager.remove('dev');

  const recreated = await harness.manager.create('dev', 'sh');
  oldChild.emit('exit', 0, null);
  const current = harness.manager.list()[0];
  assert.equal(current.status, 'running');
  assert.equal(current.port, recreated.port);
  assert.notEqual(current.port, original.port);
});

test('restart queued against deletion completes in order without leaving a live registry entry', async () => {
  const ready = deferred();
  let readinessChecks = 0;
  const harness = createHarness({ waitForPort: () => (++readinessChecks === 2 ? ready.promise : Promise.resolve()) });
  await harness.manager.create('dev', 'sh');
  await harness.manager.stop('dev');

  const restart = harness.manager.restart('dev');
  await new Promise((resolve) => setImmediate(resolve));
  const removal = harness.manager.remove('dev');
  ready.resolve();
  assert.equal((await restart).status, 'running');
  assert.deepEqual(await removal, { name: 'dev' });
  assert.deepEqual(harness.manager.list(), []);
  assert.equal(harness.children.length, 2);
});

test('remove waits for ttyd exit and targets only the exact tmux session', async () => {
  const harness = createHarness();
  const created = await harness.manager.create('dev', 'sh');
  const other = await harness.manager.create('dev-extra', 'sh');

  assert.deepEqual(await harness.manager.remove('dev'), { name: 'dev' });
  assert.deepEqual(harness.tmuxCalls[0].args, ['-L', 'ttyd-webui-test', 'kill-session', '-t', '=dev']);
  assert.deepEqual(harness.released, [created.port]);
  assert.deepEqual(harness.manager.list().map(({ name }) => name), ['dev-extra']);
  assert.equal(other.status, 'running');
});

test('tmux permission failures do not report successful deletion', async () => {
  const harness = createHarness({ tmuxError: Object.assign(new Error('permission denied'), { code: 1 }) });
  await harness.manager.create('dev', 'sh');
  const stopped = [];
  harness.manager.on('session:stopped', (value) => stopped.push(value));

  await assert.rejects(harness.manager.remove('dev'), /permission denied/i);
  assert.equal(harness.manager.list().length, 1);
  assert.equal(harness.manager.list()[0].status, 'stopped');
  assert.equal(stopped.length, 1);
  assert.equal(stopped[0].status, 'stopped');
});

test('an early ttyd exit fails creation and releases only its own port', async () => {
  const child = new FakeChild(1);
  const harness = createHarness({ waitForPort: () => {
    queueMicrotask(() => {
      child.exitCode = 1;
      child.emit('exit', 1, null);
      child.emit('close', 1, null);
    });
    return new Promise(() => {});
  } });
  harness.manager.spawn = () => child;

  await assert.rejects(harness.manager.create('early', 'sh'), /exited before becoming ready/i);
  assert.deepEqual(harness.released, [7681]);
  assert.deepEqual(harness.manager.list(), []);
});

test('a spawn ENOENT is reported and does not retain a failed session', async () => {
  const child = new FakeChild(1);
  const harness = createHarness({ waitForPort: () => new Promise(() => {}) });
  harness.manager.spawn = () => {
    queueMicrotask(() => {
      child.emit('error', Object.assign(new Error('spawn ttyd ENOENT'), { code: 'ENOENT' }));
      child.exitCode = -2;
      child.emit('close', -2, null);
    });
    return child;
  };

  await assert.rejects(harness.manager.create('missing', 'sh'), /ENOENT/i);
  assert.deepEqual(harness.released, [7681]);
  assert.deepEqual(harness.manager.list(), []);
});

test('a timed-out process retains its port reservation until close confirms exit', async () => {
  const child = new FakeChild(1);
  const killCalled = deferred();
  const harness = createHarness({ waitForPort: async () => { throw new Error('startup timed out'); } });
  harness.manager.spawn = () => {
    child.kill = (signal) => {
      child.kills.push(signal);
      killCalled.resolve();
      return true;
    };
    return child;
  };

  const creation = harness.manager.create('hung', 'sh');
  await killCalled.promise;
  assert.deepEqual(harness.released, []);
  assert.equal(harness.manager.list()[0].status, 'stopping');
  child.exitCode = 0;
  child.emit('exit', 0, null);
  child.emit('close', 0, null);
  await assert.rejects(creation, /startup timed out/i);
  assert.deepEqual(harness.released, [7681]);
  assert.deepEqual(harness.manager.list(), []);
});

test('missing tmux sessions are already ended and can be removed', async () => {
  const missingSession = Object.assign(new Error('tmux: no server running on /tmp/tmux-test/default'), { code: 1 });
  const harness = createHarness({ tmuxError: missingSession });
  await harness.manager.create('dev', 'sh');

  assert.deepEqual(await harness.manager.remove('dev'), { name: 'dev' });
  assert.deepEqual(harness.manager.list(), []);
});

test('a missing tmux socket directory is treated as an already absent target', async () => {
  const missingSocket = Object.assign(
    new Error('error connecting to /tmp/tmux-test/tmux-1006/ttyd-webui-test (No such file or directory)'),
    { code: 1 },
  );
  const harness = createHarness({ tmuxError: missingSocket });
  await harness.manager.create('never-attached', 'sh');

  assert.deepEqual(await harness.manager.remove('never-attached'), { name: 'never-attached' });
  assert.deepEqual(harness.manager.list(), []);
});

test('startup diagnostics never expose raw or base64 ttyd credentials', async () => {
  let credential;
  const harness = createHarness({ waitForPort: async () => {
    const args = harness.spawned[0].args;
    credential = args[args.indexOf('-c') + 1];
    harness.children[0].stderr.write(`${credential} ${Buffer.from(credential).toString('base64')}`);
    throw new Error(`startup failed: ${credential}`);
  } });
  await assert.rejects(harness.manager.create('private', 'sh'), (error) => {
    assert.equal(error.message.includes(credential), false);
    assert.equal(error.message.includes(Buffer.from(credential).toString('base64')), false);
    assert.match(error.message, /redacted/);
    return true;
  });
});

test('startup failures retain bounded diagnostics and release a port only after child exit', async () => {
  const ready = deferred();
  const child = new FakeChild(1);
  const harness = createHarness({ waitForPort: () => {
    child.stderr.write('x'.repeat(100_000));
    ready.reject(new Error('startup timed out'));
    return ready.promise;
  } });
  harness.manager.spawn = () => child;
  const originalRelease = harness.manager.portManager.release.bind(harness.manager.portManager);
  let releasedBeforeExit = false;
  harness.manager.portManager.release = (port) => {
    releasedBeforeExit = child.exitCode === null;
    originalRelease(port);
  };

  await assert.rejects(harness.manager.create('broken', 'sh'), (error) => {
    assert.match(error.message, /startup timed out/i);
    assert.ok(error.message.length < 20_000);
    return true;
  });
  assert.equal(releasedBeforeExit, false);
  assert.equal(harness.manager.list().length, 0);
});
