// Persistent file logging for the Electron main process — wraps
// console.log/warn/error so every existing call site (MCP client status,
// the uncaughtException/unhandledRejection handlers in aloyServer.cjs,
// confidence-escalation errors, etc.) gets captured to disk with zero
// changes needed elsewhere. Must be require()'d before anything else in
// electron.cjs so nothing logs before the patch is installed.
const fs = require('fs');
const path = require('path');
const os = require('os');

const LOG_DIR = path.join(os.homedir(), '.aloy-server', 'logs');
const RETENTION_DAYS = 14;

function localDateString(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function currentLogPath() {
  return path.join(LOG_DIR, `aloy-${localDateString()}.log`);
}

function pruneOldLogs() {
  let files;
  try {
    files = fs.readdirSync(LOG_DIR);
  } catch {
    return;
  }
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const file of files) {
    const match = /^aloy-(\d{4}-\d{2}-\d{2})\.log$/.exec(file);
    if (!match) continue;
    const fileDate = new Date(`${match[1]}T00:00:00`);
    if (fileDate.getTime() < cutoff) {
      try {
        fs.unlinkSync(path.join(LOG_DIR, file));
      } catch {
        // Non-fatal — leave it for next prune pass.
      }
    }
  }
}

function formatArgs(args) {
  return args
    .map((a) => (a instanceof Error ? (a.stack || a.message) : typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ');
}

function writeLine(level, args) {
  try {
    const line = `${new Date().toISOString()} [${level}] ${formatArgs(args)}\n`;
    fs.appendFileSync(currentLogPath(), line, 'utf-8');
  } catch {
    // Logging must never crash the app it's trying to log.
  }
}

let installed = false;

function installConsoleLogging() {
  if (installed) return;
  installed = true;

  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // If we can't create the log dir, fall through — writeLine's own
    // try/catch will just silently no-op on every call.
  }
  pruneOldLogs();

  const original = { log: console.log, warn: console.warn, error: console.error };

  console.log = (...args) => { original.log(...args); writeLine('INFO', args); };
  console.warn = (...args) => { original.warn(...args); writeLine('WARN', args); };
  console.error = (...args) => { original.error(...args); writeLine('ERROR', args); };
}

module.exports = { installConsoleLogging };
