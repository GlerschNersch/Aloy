// Tracks which devices are actively talking to the Aloy backend server, for
// the "how many clients are connected" status widget. There's no real
// concept of a persistent "connection" here — every request is a stateless
// authenticated HTTP call (desktop's own renderer and any mobile device
// share the SAME bearer token, so the server can't tell them apart by
// identity) — so "connected" is defined as "made an authenticated request
// within the last ACTIVE_WINDOW_MS", keyed by source IP.
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;

// ip -> { lastSeenAt: number, userAgent: string }
const lastSeenByIp = new Map();

function normalizeIp(rawIp) {
  // Node reports IPv4 connections as IPv4-mapped IPv6 (::ffff:100.x.x.x).
  return (rawIp || '').replace(/^::ffff:/, '');
}

function isLocalIp(ip) {
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

function trackClientMiddleware(req, _res, next) {
  const ip = normalizeIp(req.socket.remoteAddress);
  lastSeenByIp.set(ip, { lastSeenAt: Date.now(), userAgent: req.headers['user-agent'] || 'unknown' });
  next();
}

function getConnectedClients() {
  const now = Date.now();
  const clients = [...lastSeenByIp.entries()]
    .map(([ip, info]) => ({
      ip,
      isLocal: isLocalIp(ip),
      userAgent: info.userAgent,
      lastSeenAt: new Date(info.lastSeenAt).toISOString(),
      secondsAgo: Math.round((now - info.lastSeenAt) / 1000)
    }))
    .sort((a, b) => a.secondsAgo - b.secondsAgo);

  const active = clients.filter((c) => c.secondsAgo * 1000 <= ACTIVE_WINDOW_MS);
  return { activeCount: active.length, activeWindowMinutes: ACTIVE_WINDOW_MS / 60000, clients };
}

module.exports = { trackClientMiddleware, getConnectedClients };
