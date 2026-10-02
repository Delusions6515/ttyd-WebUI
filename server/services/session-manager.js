const { spawn: defaultSpawn, execFile: defaultExecFile } = require('node:child_process');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const net = require('node:net');
const EventEmitter = require('node:events');
const PortManager = require('./port-manager');

const SESSION_NAME_RE = /^[a-zA-Z0-9_-]+$/;
const MAX_STDERR_BYTES = 8192;
const DEFAULT_TMUX_SOCKET = 'ttyd-webui';
const KNOWN_SHELLS = [
  { id: 'bash', name: 'Bash', paths: ['/bin/bash', '/usr/bin/bash', '/usr/local/bin/bash', '/opt/homebrew/bin/bash'] },
  { id: 'zsh', name: 'Zsh', paths: ['/bin/zsh', '/usr/bin/zsh', '/usr/local/bin/zsh', '/opt/homebrew/bin/zsh'] },
  { id: 'fish', name: 'Fish', paths: ['/usr/local/bin/fish', '/opt/homebrew/bin/fish', '/usr/bin/fish'] },
  { id: 'sh', name: 'Sh', paths: ['/bin/sh', '/usr/bin/sh'] },
];

function detectShells() {
  return KNOWN_SHELLS.flatMap((shell) => {
    const path = shell.paths.find((candidate) => fs.existsSync(candidate));
    return path ? [{ id: shell.id, name: shell.name, path }] : [];
  });
}

function waitForPort(port, host = '127.0.0.1', timeout = 5000, signal) {
  return new Promise((resolve, reject) => {
    let timer;
    let retryTimer;
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(retryTimer);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => finish(signal.reason instanceof Error ? signal.reason : new Error('ttyd exited before becoming ready'));
    const tryConnect = () => {
      if (settled) return;
      const socket = net.createConnection({ port, host });
      socket.once('connect', () => {
        socket.destroy();
        finish();
      });
      socket.once('error', () => {
        socket.destroy();
        if (!settled) retryTimer = setTimeout(tryConnect, 100);
      });
    };

    timer = setTimeout(() => finish(new Error(`ttyd did not start within ${timeout}ms`)), timeout);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    tryConnect();
  });
}

function setErrorStatus(error, statusCode) {
  error.statusCode = statusCode;
  return error;
}

class SessionManager extends EventEmitter {
  constructor(options = {}) {
    super();
    const portRangeStart = options.portRangeStart ?? 7681;
    const portRangeEnd = options.portRangeEnd ?? 7780;
    this.sessions = new Map();
    this.pendingNames = new Set();
    this.operationTails = new Map();
    this.generationByName = new Map();
    this.nameCounter = 0;
    this.portManager = options.portManager || new PortManager({ rangeStart: portRangeStart, rangeEnd: portRangeEnd });
    this.shells = options.shells || detectShells();
    this.spawn = options.spawn || defaultSpawn;
    this.execFile = options.execFile || defaultExecFile;
    this.waitForPort = options.waitForPort || waitForPort;
    this.startupTimeout = options.startupTimeout ?? 5000;
    this.tmuxSocket = options.tmuxSocket || process.env.TTYD_TMUX_SOCKET || DEFAULT_TMUX_SOCKET;
    this.spawnEnv = options.env || {
      ...process.env,
      PATH: `/usr/local/bin:/opt/homebrew/bin:${process.env.PATH || ''}`,
    };
  }

  generateName(shell) {
    const prefix = shell || 'session';
    let candidate;
    do {
      this.nameCounter = (this.nameCounter || 0) + 1;
      candidate = `${prefix}-${this.nameCounter}`;
    } while (this.sessions.has(candidate) || this.pendingNames.has(candidate));
    return candidate;
  }

  getShells() {
    return this.shells.map(({ id, name, path }) => ({ id, name, path }));
  }

  resolveShell(shellId) {
    if (!shellId) return null;
    const shell = this.shells.find((candidate) => candidate.id === shellId);
    if (!shell) throw setErrorStatus(new Error(`Shell "${shellId}" is not available`), 400);
    return shell.path;
  }

  validateName(name) {
    if (typeof name !== 'string' || !SESSION_NAME_RE.test(name)) {
      throw setErrorStatus(new Error('Session name must contain only letters, numbers, hyphens and underscores'), 400);
    }
    if (this.sessions.has(name) || this.pendingNames.has(name)) {
      throw setErrorStatus(new Error(`Session "${name}" already exists`), 409);
    }
  }

  serializeOperation(name, operation) {
    const previous = this.operationTails.get(name) || Promise.resolve();
    const result = previous.then(operation, operation);
    const tail = result.then(() => undefined, () => undefined);
    this.operationTails.set(name, tail);
    tail.then(() => {
      if (this.operationTails.get(name) === tail) this.operationTails.delete(name);
    });
    return result;
  }

  create(name, shell) {
    const sessionName = name || this.generateName(shell);
    try {
      this.validateName(sessionName);
    } catch (error) {
      return Promise.reject(error);
    }

    this.pendingNames.add(sessionName);
    return this.serializeOperation(sessionName, async () => {
      try {
        const shellPath = this.resolveShell(shell);
        if (await this.tmuxSessionExists(sessionName)) {
          if (!name) return this.create(undefined, shell);
          throw setErrorStatus(new Error(`Session "${sessionName}" already exists in tmux`), 409);
        }
        const session = {
          name: sessionName,
          port: null,
          pid: null,
          shell: shell || null,
          status: 'starting',
          createdAt: new Date().toISOString(),
          process: null,
          generation: 0,
        };
        this.sessions.set(sessionName, session);
        try {
          await this.startProcess(session, shellPath);
        } catch (error) {
          if (this.sessions.get(sessionName) === session && !session.process) this.sessions.delete(sessionName);
          throw error;
        }
        this.emit('session:created', this.serialize(session));
        return this.serialize(session);
      } finally {
        this.pendingNames.delete(sessionName);
      }
    });
  }

  async startProcess(session, shellPath) {
    const port = await this.portManager.allocate();
    const generation = (this.generationByName.get(session.name) || 0) + 1;
    this.generationByName.set(session.name, generation);
    session.generation = generation;
    session.status = 'starting';
    session.port = port;

    const credential = `ttyd:${randomBytes(32).toString('hex')}`;
    const encodedCredential = Buffer.from(credential).toString('base64');
    session.upstreamAuthorization = `Basic ${encodedCredential}`;
    const tmuxArgs = ['tmux', '-L', this.tmuxSocket, 'new', '-A', '-s', session.name];
    if (shellPath) tmuxArgs.push(shellPath);

    let child;
    try {
      child = this.spawn('ttyd', [
        '-i', '127.0.0.1',
        '-W', '-p', String(port),
        '-c', credential,
        '-b', `/terminal/${session.name}`,
        '-s', '9',
        '-t', 'theme={"background":"#000000"}',
        ...tmuxArgs,
      ], {
        stdio: ['ignore', 'ignore', 'pipe'],
        detached: false,
        shell: false,
        env: this.spawnEnv,
      });
    } catch (error) {
      this.portManager.release(port);
      session.port = null;
      session.status = 'stopped';
      throw error;
    }

    session.process = child;
    session.pid = child.pid ?? null;
    let stderr = Buffer.alloc(0);
    child.stdout?.on('data', () => {});
    child.stderr?.on('data', (chunk) => {
      const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      stderr = Buffer.concat([stderr, next]);
      if (stderr.length > MAX_STDERR_BYTES) stderr = stderr.subarray(stderr.length - MAX_STDERR_BYTES);
    });

    const redactDiagnostic = (text) => text.replaceAll(credential, '[redacted]')
      .replaceAll(encodedCredential, '[redacted]');

    let closed = false;
    let exitCode = null;
    let exitSignal = null;
    let spawnError = null;
    let resolveClose;
    const closePromise = new Promise((resolve) => { resolveClose = resolve; });
    const abortController = new AbortController();
    let released = false;

    const ownsGeneration = () => this.sessions.get(session.name) === session
      && session.generation === generation
      && session.process === child;
    const onExit = (code, signal) => {
      exitCode = code;
      exitSignal = signal;
      if (!ownsGeneration()) return;
      const wasRunning = session.status === 'running';
      session.status = 'stopped';
      session.pid = null;
      session.process = null;
      session.port = null;
      if (wasRunning && !session.stopRequested) {
        this.emit('session:exited', this.serialize(session));
      }
    };
    child.once('error', (error) => { spawnError = error; });
    child.once('exit', onExit);
    child.once('close', (code, signal) => {
      closed = true;
      if (exitCode === null) exitCode = code;
      if (exitSignal === null) exitSignal = signal;
      abortController.abort(new Error('ttyd exited before becoming ready'));
      if (!released) {
        released = true;
        this.portManager.release(port);
      }
      if (ownsGeneration()) {
        if (session.status !== 'stopped') onExit(exitCode, exitSignal);
        session.pid = null;
        session.process = null;
        session.port = null;
      }
      resolveClose({ code: exitCode, signal: exitSignal });
    });

    const exitedBeforeReady = closePromise.then(({ code, signal }) => {
      const detail = redactDiagnostic(spawnError?.message || stderr.toString('utf8').trim());
      throw new Error(`ttyd exited before becoming ready${detail ? `: ${detail}` : ` (code ${code ?? 'unknown'}${signal ? `, signal ${signal}` : ''})`}`);
    });

    try {
      await Promise.race([
        Promise.resolve(this.waitForPort(port, '127.0.0.1', this.startupTimeout, abortController.signal)),
        exitedBeforeReady,
      ]);
      if (closed || !ownsGeneration() || session.status !== 'starting') {
        throw new Error('ttyd exited before becoming ready');
      }
      session.status = 'running';
      return;
    } catch (error) {
      if (!closed && child && typeof child.kill === 'function') {
        if (ownsGeneration()) session.status = 'stopping';
        try {
          child.kill('SIGTERM');
        } catch (killError) {
          if (!closed) {
            session.status = 'stopping';
            throw new AggregateError([error, killError], 'ttyd startup failed and process termination failed');
          }
        }
      }
      if (!closed) await closePromise;
      session.status = 'stopped';
      session.pid = null;
      session.process = null;
      session.port = null;
      const reason = redactDiagnostic(error.message || String(error));
      const diagnostic = redactDiagnostic(stderr.toString('utf8').trim());
      const detail = diagnostic && !reason.includes(diagnostic) ? `${reason}: ${diagnostic}` : reason;
      throw new Error(`ttyd failed to start: ${detail}`);
    }
  }

  stop(name) {
    return this.serializeOperation(name, async () => {
      const session = this.getSession(name);
      if (session.status !== 'running') {
        throw setErrorStatus(new Error(`Session "${name}" is not running`), 409);
      }
      await this.stopProcess(session);
      this.emit('session:stopped', this.serialize(session));
      return this.serialize(session);
    });
  }

  async stopProcess(session) {
    const child = session.process;
    if (!child) {
      if (session.status === 'stopped') return;
      throw new Error(`Session "${session.name}" has no owned ttyd process`);
    }
    session.stopRequested = true;
    try {
      const exited = new Promise((resolve) => {
        if (child.exitCode !== null && child.exitCode !== undefined) {
          resolve();
        } else {
          child.once('close', resolve);
        }
      });
      if (child.exitCode === null || child.exitCode === undefined) {
        try {
          const signalled = child.kill('SIGTERM');
          if (!signalled && (child.exitCode === null || child.exitCode === undefined)) {
            throw new Error(`Could not stop ttyd process for session "${session.name}"`);
          }
        } catch (error) {
          if (child.exitCode === null || child.exitCode === undefined) throw error;
        }
      }
      await exited;
    } finally {
      session.stopRequested = false;
    }
  }

  remove(name) {
    return this.serializeOperation(name, async () => {
      const session = this.getSession(name);
      if (session.process) {
        await this.stopProcess(session);
        this.emit('session:stopped', this.serialize(session));
      }

      await this.killTmuxSession(name);
      if (this.sessions.get(name) === session) this.sessions.delete(name);
      this.emit('session:deleted', { name });
      return { name };
    });
  }

  tmuxSessionExists(name) {
    return new Promise((resolve, reject) => {
      this.execFile('tmux', ['-L', this.tmuxSocket, 'has-session', '-t', `=${name}`], {
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 64 * 1024,
        env: this.spawnEnv,
      }, (error, _stdout, stderr) => {
        if (!error) return resolve(true);
        const message = `${error.message || ''}\n${stderr || ''}`;
        if (/no server running|can't find session|no such session/i.test(message)
            || /error connecting to .+ \(No such file or directory\)/i.test(message)) {
          return resolve(false);
        }
        reject(error);
      });
    });
  }

  killTmuxSession(name) {
    return new Promise((resolve, reject) => {
      this.execFile('tmux', ['-L', this.tmuxSocket, 'kill-session', '-t', `=${name}`], {
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 64 * 1024,
        env: this.spawnEnv,
      }, (error, _stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }
        const message = `${error.message || ''}\n${stderr || ''}`;
        if (/no server running|can't find session|no such session/i.test(message)
            || /error connecting to .+ \(No such file or directory\)/i.test(message)) {
          resolve();
          return;
        }
        reject(error);
      });
    });
  }

  restart(name) {
    return this.serializeOperation(name, async () => {
      const session = this.getSession(name);
      if (session.status !== 'stopped' || session.process) {
        throw setErrorStatus(new Error(`Session "${name}" is already running`), 409);
      }
      const shellPath = this.resolveShell(session.shell);
      await this.startProcess(session, shellPath);
      this.emit('session:created', this.serialize(session));
      return this.serialize(session);
    });
  }

  getSession(name) {
    const session = this.sessions.get(name);
    if (!session) throw setErrorStatus(new Error(`Session "${name}" not found`), 404);
    return session;
  }

  list() {
    return Array.from(this.sessions.values(), (session) => this.serialize(session));
  }

  serialize(session) {
    return {
      name: session.name,
      port: session.port,
      pid: session.pid,
      shell: session.shell,
      status: session.status,
      createdAt: session.createdAt,
    };
  }

  async cleanup() {
    const sessions = Array.from(this.sessions.values());
    const failures = [];
    await Promise.all(sessions.map(async (session) => {
      if (!session.process) return;
      try {
        await this.stopProcess(session);
      } catch (error) {
        failures.push(error);
      }
      return undefined;
    }));
    if (failures.length) throw new AggregateError(failures, 'One or more ttyd processes could not be stopped');
  }
}

module.exports = SessionManager;
module.exports.detectShells = detectShells;
module.exports.waitForPort = waitForPort;
