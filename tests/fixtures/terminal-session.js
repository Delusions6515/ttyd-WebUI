const { StringDecoder } = require('node:string_decoder');
const { WebSocket } = require('../../server/node_modules/ws');

// ttyd 1.7.7 src/server.h defines INPUT and RESIZE as the characters '0' and '1'.
const INPUT_PREFIX = 0x30;
const RESIZE_PREFIX = 0x31;

function frame(prefix, payload) {
  return payload === undefined
    ? Buffer.from([prefix])
    : Buffer.concat([Buffer.from([prefix]), Buffer.from(payload)]);
}

async function connectTerminal(origin, sessionName, size = { columns: 80, rows: 24 }) {
  const tokenResponse = await fetch(`${origin}/terminal/${encodeURIComponent(sessionName)}/token`);
  if (!tokenResponse.ok) throw new Error(`ttyd token request failed (${tokenResponse.status})`);
  const token = await tokenResponse.json();
  if (typeof token.token !== 'string') throw new Error('ttyd token response omitted its token');

  const url = new URL(`/terminal/${encodeURIComponent(sessionName)}/ws`, origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url, 'tty');
  const decoder = new StringDecoder('utf8');
  let output = '';
  let closeError;
  const waiters = new Set();

  const onMessage = (data, isBinary) => {
    if (!isBinary) return;
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (bytes.length === 0 || bytes[0] !== INPUT_PREFIX) return;
    output += decoder.write(bytes.subarray(1));
    for (const waiter of waiters) {
      if (waiter.matches(output)) {
        waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.resolve(output);
      }
    }
  };
  socket.on('message', onMessage);
  socket.once('error', (error) => { closeError = error; });
  socket.once('close', (code, reason) => {
    closeError ||= new Error(`ttyd WebSocket closed (${code}): ${reason.toString()}`);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(closeError);
    }
    waiters.clear();
  });
  await new Promise((resolve, reject) => {
    socket.once('open', () => {
      socket.send(JSON.stringify({ AuthToken: token.token, columns: size.columns, rows: size.rows }));
      resolve();
    });
    socket.once('unexpected-response', (_request, response) => {
      response.resume();
      reject(new Error(`ttyd WebSocket upgrade failed (${response.statusCode})`));
    });
    socket.once('error', reject);
  });

  const connection = {
    get output() { return output; },
    sendInput(text) {
      if (socket.readyState !== WebSocket.OPEN) throw new Error('ttyd WebSocket is not open');
      socket.send(frame(INPUT_PREFIX, text));
    },
    resize(columns, rows) {
      if (socket.readyState !== WebSocket.OPEN) throw new Error('ttyd WebSocket is not open');
      socket.send(frame(RESIZE_PREFIX, JSON.stringify({ columns, rows })));
    },
    waitForOutput(matcher, timeout = 5000) {
      const matches = typeof matcher === 'function'
        ? matcher
        : (text) => text.includes(String(matcher));
      if (matches(output)) return Promise.resolve(output);
      if (closeError) return Promise.reject(closeError);
      return new Promise((resolve, reject) => {
        const waiter = { matches, resolve, reject, timer: undefined };
        waiter.timer = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error(`Timed out waiting for ttyd output; received: ${output.slice(-800)}`));
        }, timeout);
        waiters.add(waiter);
      });
    },
    close() {
      if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
      return new Promise((resolve) => {
        socket.once('close', resolve);
        if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
        else socket.close(1000, 'integration test complete');
        const timer = setTimeout(() => {
          socket.terminate();
          resolve();
        }, 1000);
        timer.unref?.();
      });
    },
  };

  await connection.waitForOutput((text) => text.length > 0);
  return connection;
}

module.exports = { connectTerminal, INPUT_PREFIX, RESIZE_PREFIX };
