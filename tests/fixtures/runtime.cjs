const { execFile } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { randomBytes } = require('node:crypto');
const SessionManager = require('../../server/services/session-manager');
const createApp = require('../../server/app');

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(__dirname, '../..');

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function freePort() {
  const server = net.createServer();
  return listen(server).then((port) => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve(port));
  }));
}

async function runTmux(args, options = {}) {
  const env = { ...process.env, TMUX_TMPDIR: process.env.TMUX_TMPDIR };
  try {
    return await execFileAsync('tmux', args, { env, timeout: 5000, encoding: 'utf8' });
  } catch (error) {
    if (options.ignoreFailure) return null;
    throw error;
  }
}

async function createRuntime(options = {}) {
  const oldTmuxTmpDir = process.env.TMUX_TMPDIR;
  const tmuxTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ttyd-webui-runtime-'));
  process.env.TMUX_TMPDIR = tmuxTmpDir;
  const tmuxSocket = options.tmuxSocket || `ttyd-webui-test-${process.pid}-${randomBytes(4).toString('hex')}`;
  const portRangeStart = options.terminalPort || await freePort();
  const portRangeEnd = options.portRangeEnd ?? Math.min(portRangeStart + 20, 65535);
  const sessionManager = options.sessionManager || new SessionManager({
    portRangeStart,
    portRangeEnd,
    tmuxSocket,
    env: { ...process.env, TMUX_TMPDIR: tmuxTmpDir },
  });
  const service = createApp({
    sessionManager,
    host: '127.0.0.1',
    port: options.port ?? 0,
    publicDir: options.publicDir || path.join(repositoryRoot, 'frontend/dist'),
    trustedOrigins: options.trustedOrigins || [],
    viteOrigin: options.viteOrigin,
  });
  const port = await listen(service.server, options.port ?? 0);
  let closed = false;

  async function close() {
    if (closed) return;
    closed = true;
    const errors = [];
    try {
      await service.close();
    } catch (error) {
      errors.push(error);
    }
    try {
      await sessionManager.cleanup();
    } catch (error) {
      errors.push(error);
    }
    for (const session of sessionManager.list()) {
      try {
        await runTmux(['-L', tmuxSocket, 'kill-session', '-t', `=${session.name}`], { ignoreFailure: true });
      } catch (error) {
        errors.push(error);
      }
    }
    await runTmux(['-L', tmuxSocket, 'kill-server'], { ignoreFailure: true });
    await new Promise((resolve) => setTimeout(resolve, 100));
    fs.rmSync(tmuxTmpDir, { recursive: true, force: true });
    if (oldTmuxTmpDir === undefined) delete process.env.TMUX_TMPDIR;
    else process.env.TMUX_TMPDIR = oldTmuxTmpDir;
    if (errors.length) throw new AggregateError(errors, 'Runtime fixture cleanup failed');
  }

  return {
    origin: `http://127.0.0.1:${port}`,
    port,
    publicDir: path.join(repositoryRoot, 'frontend/dist'),
    sessionManager,
    service,
    tmuxSocket,
    tmuxTmpDir,
    close,
  };
}

module.exports = { createRuntime, freePort, runTmux };
