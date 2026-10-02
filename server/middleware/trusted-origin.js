const { URL } = require('node:url');

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const defaultPort = (protocol) => protocol === 'https:' ? 443 : 80;

function parseOriginURL(value, label = 'origin', allowWildcard = false) {
  let parsed;
  try {
    if (typeof value !== 'string') throw new TypeError();
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
  if (parsed.hostname.includes('*')) {
    const suffix = parsed.hostname.slice(2);
    const labels = suffix.split('.');
    if (!allowWildcard
        || !/^https?:\/\/\*\.[^*\/?#\\\s%]+\/?$/i.test(value)
        || !parsed.hostname.startsWith('*.')
        || suffix.length > 251
        || labels.length < 2
        || !labels.every((part) => DNS_LABEL.test(part))
        || !/[a-z]/i.test(labels.at(-1))) {
      throw new TypeError(`Invalid ${label}: ${value}`);
    }
  }
  return parsed;
}

function parseOrigin(value, label = 'origin') {
  return parseOriginURL(value, label).origin;
}

function originList(values, allowWildcard = false) {
  if (!values) return [];
  const list = Array.isArray(values) ? values : String(values).split(',');
  return list.map((value) => String(value).trim()).filter(Boolean)
    .map((value) => parseOriginURL(value, 'origin', allowWildcard));
}

function requestHost(value) {
  if (typeof value !== 'string' || !value || /[\s/@\\%*]/.test(value) || value.endsWith(':')) return null;
  try {
    const parsed = new URL(`http://${value}`);
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    // Preserve explicit :80: URL's HTTP parser otherwise erases that default port.
    const explicitPort = /:([0-9]+)$/.exec(value);
    return { hostname: parsed.hostname.toLowerCase(), port: explicitPort ? Number(explicitPort[1]) : null };
  } catch {
    return null;
  }
}

function matchesHostname(hostname, pattern) {
  if (!pattern.startsWith('*.')) return hostname === pattern;
  const suffix = pattern.slice(1);
  if (hostname.length > 253 || !hostname.endsWith(suffix)) return false;
  return DNS_LABEL.test(hostname.slice(0, -suffix.length));
}

function matchesHost(host, rule) {
  const samePort = host.port === null
    ? rule.port === ''
    : host.port === Number(rule.port || defaultPort(rule.protocol));
  return samePort && matchesHostname(host.hostname, rule.hostname);
}

function createTrustedOriginGuard({ port = 3000, trustedOrigins = [], viteOrigin } = {}) {
  const rules = [...new Map([
    ...originList(trustedOrigins, true),
    ...originList(viteOrigin ? [viteOrigin] : []),
  ].map((rule) => [rule.origin, rule])).values()];
  const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

  const allowedLocalHost = (host) => {
    const configuredPort = typeof port === 'function' ? port() : port;
    return localHosts.has(host.hostname)
      && (!configuredPort || (host.port ?? 80) === Number(configuredPort));
  };

  const isTrusted = (req) => {
    const host = requestHost(req.headers?.host);
    if (!host || !(allowedLocalHost(host) || rules.some((rule) => matchesHost(host, rule)))) return false;
    const originHeader = req.headers?.origin;
    if (originHeader === undefined) return true;

    let origin;
    try {
      origin = parseOriginURL(originHeader);
    } catch {
      return false;
    }
    if (rules.some((rule) => origin.protocol === rule.protocol
        && origin.port === rule.port
        && matchesHostname(origin.hostname, rule.hostname))) return true;

    // Only loopback has an implicit same-origin allowance. Configured external
    // hosts must not gain an HTTP downgrade through the direct socket's scheme.
    const expectedProtocol = req.socket?.encrypted ? 'https:' : 'http:';
    return allowedLocalHost(host)
      && origin.hostname === host.hostname
      && Number(origin.port || defaultPort(origin.protocol)) === (host.port ?? defaultPort(expectedProtocol))
      && origin.protocol === expectedProtocol;
  };

  const middleware = (req, res, next) => {
    if (isTrusted(req)) return next();
    res.status(403).json({ error: 'Untrusted request origin' });
  };

  return { middleware, isTrusted, allowedOrigins: rules.map((rule) => rule.origin) };
}

module.exports = { createTrustedOriginGuard, parseOrigin };
