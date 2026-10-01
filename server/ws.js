const { WebSocketServer } = require('ws');

function rejectUpgrade(socket, status, message) {
  if (socket.destroyed) return;
  const body = `${message}\n`;
  socket.end(`HTTP/1.1 ${status} ${status === 403 ? 'Forbidden' : status === 404 ? 'Not Found' : 'Bad Request'}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function setupWebSocket(server, sessionManager, { terminalProxy, resolveRunningSession, isTrusted = () => true } = {}) {
  const wss = new WebSocketServer({ noServer: true });
  const eventNames = ['session:created', 'session:stopped', 'session:deleted', 'session:exited'];
  const listeners = new Map();
  const terminalSockets = new Set();

  function broadcast(event, data) {
    const message = JSON.stringify({ event, data });
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(message);
    }
  }

  for (const event of eventNames) {
    const listener = (data) => broadcast(event, data);
    listeners.set(event, listener);
    sessionManager.on(event, listener);
  }

  const onUpgrade = (req, socket, head) => {
    if (!isTrusted(req)) {
      rejectUpgrade(socket, 403, 'Untrusted request origin');
      return;
    }

    let pathname;
    try {
      pathname = new URL(req.url || '/', 'http://localhost').pathname;
    } catch {
      rejectUpgrade(socket, 400, 'Invalid upgrade path');
      return;
    }

    if (pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (client) => {
        wss.emit('connection', client, req);
      });
      return;
    }

    const terminalMatch = /^\/terminal\/([A-Za-z0-9_-]+)\/ws$/.exec(pathname);
    if (terminalMatch) {
      const session = resolveRunningSession(terminalMatch[1]);
      if (!session) {
        rejectUpgrade(socket, 404, 'Session not found or not running');
        return;
      }
      if (!terminalProxy || typeof terminalProxy.upgrade !== 'function') {
        rejectUpgrade(socket, 502, 'Terminal proxy unavailable');
        return;
      }
      req.ttydSession = session;
      terminalSockets.add(socket);
      socket.once('close', () => terminalSockets.delete(socket));
      try {
        terminalProxy.upgrade(req, socket, head);
      } catch {
        terminalSockets.delete(socket);
        rejectUpgrade(socket, 502, 'Terminal proxy unavailable');
      }
      return;
    }

    rejectUpgrade(socket, 404, 'Unknown WebSocket path');
  };
  server.on('upgrade', onUpgrade);

  function closeTerminalConnections() {
    for (const socket of terminalSockets) socket.destroy();
    terminalSockets.clear();
  }

  wss.once('close', () => {
    server.off('upgrade', onUpgrade);
    for (const [event, listener] of listeners) sessionManager.off(event, listener);
  });
  return { wss, closeTerminalConnections };
}

module.exports = setupWebSocket;
module.exports.rejectUpgrade = rejectUpgrade;
