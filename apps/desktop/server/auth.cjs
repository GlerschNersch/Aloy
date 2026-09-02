// Bearer-token auth for the Aloy backend server. Tailscale already
// restricts who can reach this server at all (only devices on your
// tailnet), but this adds a second layer — if the tailnet is ever
// misconfigured/shared, or another device joins it, this token is still
// required to actually use the API (read finances, control smart home
// devices, etc.).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function getTokenPath() {
  const home = process.env.USERPROFILE || process.env.HOME || require('os').homedir();
  return path.join(home, '.aloy-server', 'auth-token.txt');
}

function getOrCreateToken() {
  const tokenPath = getTokenPath();
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  if (fs.existsSync(tokenPath)) {
    return fs.readFileSync(tokenPath, 'utf-8').trim();
  }
  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(tokenPath, token, 'utf-8');
  return token;
}

function tokensMatch(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(String(provided).trim());
  const b = Buffer.from(String(expected).trim());
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function requireAuth(tokenOrFn) {
  return (req, res, next) => {
    const expected = typeof tokenOrFn === 'function' ? tokenOrFn() : (tokenOrFn || getOrCreateToken());
    const header = req.headers.authorization || '';
    let provided = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!provided && req.query && req.query.token) {
      provided = req.query.token;
    }
    if (!provided || !tokensMatch(provided, expected)) {
      return res.status(401).json({ error: 'Invalid or missing auth token' });
    }
    next();
  };
}

module.exports = {
  getOrCreateToken,
  getTokenPath,
  requireAuth,
  get TOKEN_PATH() {
    return getTokenPath();
  }
};
