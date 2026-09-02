// Append-only structured audit logger for Aloy OS.
// Records every mutation across Smart Home devices, MCP filesystem writes,
// financial transactions, reminders, and system automations.
// Output ledger: ~/.aloy-server/audit.log.jsonl

const fs = require('fs');
const os = require('os');
const path = require('path');

const AUDIT_DIR = path.join(os.homedir(), '.aloy-server');
const AUDIT_LOG_FILE = path.join(AUDIT_DIR, 'audit.log.jsonl');
const MAX_LOG_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB before rotation

function ensureAuditDir() {
  if (!fs.existsSync(AUDIT_DIR)) {
    fs.mkdirSync(AUDIT_DIR, { recursive: true });
  }
}

/**
 * Appends a structured audit event to the append-only ledger.
 * @param {Object} event
 * @param {string} event.category - 'smarthome' | 'filesystem' | 'finance' | 'reminder' | 'system' | 'auth'
 * @param {string} event.action - e.g. 'lock.unlock', 'write_file', 'add_transaction'
 * @param {string} event.target - e.g. 'lock.front_door', 'P:\\Movies\\new.mkv'
 * @param {string} event.actor - 'user' | 'aloy_agent' | 'planner' | 'cron'
 * @param {string} event.client - 'desktop_electron' | 'mobile_app' | 'api'
 * @param {string} event.status - 'success' | 'denied' | 'error' | 'pending_confirmation'
 * @param {Object} [event.payload] - sanitized parameters/arguments
 * @param {Object} [event.rollbackSnapshot] - previous state for rollback
 * @param {string} [event.details] - human-readable description or error message
 */
function logAuditEvent({
  category,
  action,
  target,
  actor = 'aloy_agent',
  client = 'desktop_electron',
  status = 'success',
  payload = {},
  rollbackSnapshot = null,
  details = ''
}) {
  try {
    ensureAuditDir();

    // Sanitize payload to remove any sensitive secrets/tokens
    const sanitizedPayload = { ...payload };
    if (sanitizedPayload.token) sanitizedPayload.token = '[REDACTED]';
    if (sanitizedPayload.password) sanitizedPayload.password = '[REDACTED]';

    const entry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      category,
      action,
      target,
      actor,
      client,
      status,
      payload: sanitizedPayload,
      rollbackSnapshot,
      details
    };

    // Check size for simple rotation
    if (fs.existsSync(AUDIT_LOG_FILE)) {
      try {
        const stats = fs.statSync(AUDIT_LOG_FILE);
        if (stats.size > MAX_LOG_SIZE_BYTES) {
          const archivePath = path.join(AUDIT_DIR, `audit.log.${Date.now()}.jsonl`);
          fs.renameSync(AUDIT_LOG_FILE, archivePath);
        }
      } catch {}
    }

    fs.appendFileSync(AUDIT_LOG_FILE, JSON.stringify(entry) + '\n', 'utf-8');
    return entry;
  } catch (err) {
    console.error('AuditLogger: failed to write audit entry:', err.message);
    return null;
  }
}

/**
 * Retrieves recent audit log entries with optional filtering.
 * @param {Object} options
 * @param {number} [options.limit=100]
 * @param {string} [options.category]
 * @param {string} [options.status]
 * @param {string} [options.target]
 * @returns {Array<Object>}
 */
function getRecentAuditLogs({ limit = 100, category = null, status = null, target = null } = {}) {
  try {
    if (!fs.existsSync(AUDIT_LOG_FILE)) return [];
    const content = fs.readFileSync(AUDIT_LOG_FILE, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    const records = [];

    // Parse in reverse for latest first
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (category && entry.category !== category) continue;
        if (status && entry.status !== status) continue;
        if (target && !entry.target?.includes(target)) continue;
        records.push(entry);
        if (records.length >= limit) break;
      } catch {}
    }

    return records;
  } catch (err) {
    console.error('AuditLogger: failed to read audit logs:', err.message);
    return [];
  }
}

module.exports = {
  AUDIT_LOG_FILE,
  logAuditEvent,
  getRecentAuditLogs
};
