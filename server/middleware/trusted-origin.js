const { URL } = require('node:url');

function parseOrigin(value, label = 'origin') {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`Invalid ${label}: ${value}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)
      || parsed.username
      || parsed.password
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash
      || parsed.origin === 'null') {
    throw new TypeError(`Invalid ${label}: ${value}`);
  }
  return parsed.origin;
}

function originList(values) {
  if (!values) return [];
  const list = Array.isArray(values) ? values : String(values).split(',');
  return list.map((value) => String(value).trim()).filter(Boolean).map((value) => parseOrigin(value));
}

function requestHost(value) {
  if (typeof value !== 'string' || !value || /[\s/@\\]/.test(value)) return null;
  try {
    const parsed = new URL(`http://${value}`);
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    return parsed.host.toLowerCase();
  } catch {
    return null;
  }
}

function createTrustedOriginGuard({ port = 3000, trustedOrigins = [], viteOrigin } = {}) {
  const configuredOrigins = new Set([
    ...originList(trustedOrigins),
    ...originList(viteOrigin ? [viteOrigin] : []),
  ]);
  const configuredHosts = new Set([...configuredOrigins].map((origin) => new URL(origin).host.toLowerCase()));
  const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

  const allowedHost = (requestHostValue) => {
    const normalized = requestHost(requestHostValue);
    if (!normalized) return false;
    if (configuredHosts.has(normalized)) return true;
    const parsed = new URL(`http://${normalized}`);
    const configuredPort = typeof port === 'function' ? port() : port;
    const sameListenerPort = !configuredPort || Number(parsed.port || 80) === Number(configuredPort);
    return localHosts.has(parsed.hostname.toLowerCase()) && sameListenerPort;
  };

  const isTrusted = (req) => {
    const hostHeader = req.headers?.host;
    if (!allowedHost(hostHeader)) return false;
    const originHeader = req.headers?.origin;
    if (originHeader === undefined) return true;

    let origin;
    try {
      origin = parseOrigin(originHeader);
    } catch {
      return false;
    }
    if (configuredOrigins.has(origin)) return true;

    const parsedOrigin = new URL(origin);
    const host = requestHost(hostHeader);
    const isSecureRequest = Boolean(req.socket?.encrypted);
    const expectedProtocol = isSecureRequest ? 'https:' : 'http:';
    return parsedOrigin.host.toLowerCase() === host && parsedOrigin.protocol === expectedProtocol;
  };

  const middleware = (req, res, next) => {
    if (isTrusted(req)) return next();
    res.status(403).json({ error: 'Untrusted request origin' });
  };

  return { middleware, isTrusted, allowedOrigins: [...configuredOrigins] };
}

module.exports = { createTrustedOriginGuard, parseOrigin };
