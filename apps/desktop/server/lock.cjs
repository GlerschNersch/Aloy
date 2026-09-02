// Desktop app-lock PIN storage — a SEPARATE file from store.json on purpose,
// so the recovery path for "I forgot my PIN" is "delete this one file" and
// can never touch chats/finances/memories/etc. Never stores the PIN itself,
// only a salted scrypt hash.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOCK_PATH = path.join(require('os').homedir(), '.aloy-server', 'lock.json');

function readLock() {
  try {
    return JSON.parse(fs.readFileSync(LOCK_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function isConfigured() {
  return readLock() !== null;
}

function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 64).toString('hex');
}

function setPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPin(pin, salt);
  fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
  fs.writeFileSync(LOCK_PATH, JSON.stringify({ salt, hash }), 'utf-8');
}

// No PIN configured means nothing to check against — treated as "verified"
// so the app never ends up in a locked state with no way to unlock it.
function verifyPin(pin) {
  const stored = readLock();
  if (!stored) return true;
  const hash = hashPin(pin, stored.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(stored.hash, 'hex'));
}

function clearPin() {
  try {
    fs.unlinkSync(LOCK_PATH);
  } catch {}
}

module.exports = { isConfigured, setPin, verifyPin, clearPin, LOCK_PATH };
