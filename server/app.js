const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const http = require('node:http');
const { createProxyMiddleware } = require('http-proxy-middleware');
const SessionManager = require('./services/session-manager');
const sessionsRoute = require('./routes/sessions');
const setupWebSocket = require('./ws');
const { createTrustedOriginGuard } = require('./middleware/trusted-origin');

function envInteger(name, fallback) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isInteger(value) ? value : fallback;
}

function createApp(options = {}) {
  const configuredPort = options.port ?? envInteger('PORT', 3000);
  const host = options.host || process.env.HOST || '127.0.0.1';
  const sessionManager = options.sessionManager || new SessionManager({
    portRangeStart: envInteger('TTYD_PORT_RANGE_START', 7681),
    portRangeEnd: envInteger('TTYD_PORT_RANGE_END', 7780),
    tmuxSocket: process.env.TTYD_TMUX_SOCKET,
  });
  const app = express();
  const server = http.createServer(app);
  const originGuard = createTrustedOriginGuard({
    port: () => server.address()?.port || configuredPort,
    trustedOrigins: options.trustedOrigins ?? process.env.TRUSTED_ORIGINS ?? [],
    viteOrigin: options.viteOrigin ?? process.env.VITE_ORIGIN,
  });
  const publicDir = options.publicDir || path.resolve(__dirname, '../frontend/dist');

  app.use(originGuard.middleware);
  app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    next();
  });
  app.use(express.json());

  function resolveRunningSession(name) {
    if (!name || !/^[A-Za-z0-9_-]+$/.test(name)) return null;
    try {
      const session = sessionManager.getSession(name);
      return session && session.status === 'running' && Number.isInteger(session.port) ? session : null;
    } catch {
      return null;
    }
  }

  const terminalProxySockets = new Set();

  function closeTerminalProxySockets() {
    for (const socket of terminalProxySockets) socket.destroy();
    terminalProxySockets.clear();
  }

  function proxyError(error, req, response) {
    if (response && !response.destroyed && typeof response.writeHead === 'function' && typeof response.end === 'function') {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      response.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'Terminal proxy error' }));
      return;
    }
    response?.destroy?.(error);
  }

  const terminalProxy = createProxyMiddleware({
    target: 'http://127.0.0.1',
    changeOrigin: true,
    router: (req) => {
      const session = req.ttydSession || resolveRunningSession(req.params?.name);
      if (!session) throw new Error('Terminal session is unavailable');
      return `http://127.0.0.1:${session.port}`;
    },
    pathRewrite: (_path, req) => req.originalUrl || req.url,
    on: {
      error: proxyError,
      proxyReq: (proxyRequest, req) => {
        if (req.ttydSession?.upstreamAuthorization) {
          proxyRequest.setHeader('Authorization', req.ttydSession.upstreamAuthorization);
        }
      },
      proxyReqWs: (proxyRequest, req) => {
        if (req.ttydSession?.upstreamAuthorization) {
          proxyRequest.setHeader('Authorization', req.ttydSession.upstreamAuthorization);
        }
        proxyRequest.once('upgrade', (_response, socket) => {
          terminalProxySockets.add(socket);
          socket.once('close', () => terminalProxySockets.delete(socket));
        });
      },
      proxyRes: (proxyResponse) => {
        if (/text\/html/i.test(proxyResponse.headers['content-type'] || '')) {
          const upstreamPolicy = proxyResponse.headers['content-security-policy'];
          const enforcedPolicy = "frame-ancestors 'none'";
          proxyResponse.headers['content-security-policy'] = upstreamPolicy
            ? [...(Array.isArray(upstreamPolicy) ? upstreamPolicy : [upstreamPolicy]), enforcedPolicy]
            : enforcedPolicy;
        }
      },
    },
  });

  app.use('/api/sessions', sessionsRoute(sessionManager));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found' }));

  app.use('/terminal/:name', (req, res, next) => {
    const rawName = /^\/terminal\/([^/?#]+)/.exec(req.originalUrl || req.url)?.[1];
    if (rawName !== req.params.name) return res.status(404).json({ error: 'Session not found or not running' });
    const session = resolveRunningSession(rawName);
    if (!session) return res.status(404).json({ error: 'Session not found or not running' });
    req.ttydSession = session;
    next();
  }, terminalProxy);
  app.use('/terminal', (_req, res) => res.status(404).json({ error: 'Session not found or not running' }));

  app.use(express.static(publicDir));
  app.get(/^\/(?!(?:api|terminal|ws)(?:\/|$)).*/, (req, res, next) => {
    res.sendFile(path.join(publicDir, 'index.html'), (error) => {
      if (error) next(error);
    });
  });
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((error, req, res, _next) => {
    if (res.headersSent) return res.end();
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (req.path.startsWith('/api/') || req.path === '/api' || req.path.startsWith('/terminal/')) {
      return res.status(status).json({ error: status < 500 ? error.message : 'Request failed' });
    }
    return res.status(status).send(status < 500 ? error.message : 'Request failed');
  });

  const { wss, closeTerminalConnections } = setupWebSocket(server, sessionManager, {
    terminalProxy,
    resolveRunningSession,
    isTrusted: originGuard.isTrusted,
  });
  let closePromise;

  function close() {
    if (closePromise) return closePromise;
    closePromise = (async () => {
      for (const client of wss.clients) client.terminate();
      closeTerminalConnections();
      closeTerminalProxySockets();
      await new Promise((resolve) => wss.close(resolve));
      if (server.listening) await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    })();
    return closePromise;
  }

  return { app, server, sessionManager, wss, originGuard, close, host, port: configuredPort };
}

module.exports = createApp;
