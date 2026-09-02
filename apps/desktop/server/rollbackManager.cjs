// Reversible action stack & Rollback Manager for Aloy Planner & Agentic execution.
// Tracks inverse operations and previous state snapshots to enable safe recovery.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { logAuditEvent } = require('./auditLogger.cjs');

const ROLLBACK_BACKUP_DIR = path.join(os.homedir(), '.aloy-server', 'rollback-snapshots');

function ensureBackupDir() {
  if (!fs.existsSync(ROLLBACK_BACKUP_DIR)) {
    fs.mkdirSync(ROLLBACK_BACKUP_DIR, { recursive: true });
  }
}

class RollbackManager {
  constructor() {
    this.stack = [];
    this.maxStackSize = 50;
  }

  /**
   * Pushes an undoable action to the rollback stack.
   * @param {Object} entry
   * @param {string} entry.type - 'file_edit' | 'smarthome_state' | 'reminder' | 'budget'
   * @param {string} entry.description - Human-readable description
   * @param {Object} entry.undoContext - Data needed to perform inverse action
   * @param {Function} [entry.undoHandler] - Optional custom undo function
   */
  pushAction({ type, description, undoContext = {}, undoHandler = null }) {
    const record = {
      id: `rb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      type,
      description,
      undoContext,
      undoHandler
    };

    this.stack.push(record);
    if (this.stack.length > this.maxStackSize) {
      this.stack.shift();
    }
    return record.id;
  }

  /**
   * Captures a backup copy of a file before overwriting.
   * @param {string} filePath
   * @returns {string|null} Snapshot file path
   */
  captureFileSnapshot(filePath) {
    try {
      if (!fs.existsSync(filePath)) return null;
      ensureBackupDir();
      const snapshotFilename = `${path.basename(filePath)}.${Date.now()}.bak`;
      const snapshotPath = path.join(ROLLBACK_BACKUP_DIR, snapshotFilename);
      fs.copyFileSync(filePath, snapshotPath);
      return snapshotPath;
    } catch (err) {
      console.warn('RollbackManager: failed to capture file snapshot:', err.message);
      return null;
    }
  }

  /**
   * Executes rollback of the most recent action or specified action ID.
   * @param {string} [actionId]
   * @returns {Promise<{ success: boolean, message: string }>}
   */
  async rollback(actionId = null) {
    let index = -1;
    if (actionId) {
      index = this.stack.findIndex(a => a.id === actionId);
    } else {
      index = this.stack.length - 1;
    }

    if (index === -1 || this.stack.length === 0) {
      return { success: false, message: 'No rollback actions available.' };
    }

    const [action] = this.stack.splice(index, 1);

    try {
      if (action.type === 'file_edit' && action.undoContext?.snapshotPath && action.undoContext?.originalPath) {
        if (fs.existsSync(action.undoContext.snapshotPath)) {
          fs.copyFileSync(action.undoContext.snapshotPath, action.undoContext.originalPath);
          logAuditEvent({
            category: 'filesystem',
            action: 'rollback_file',
            target: action.undoContext.originalPath,
            status: 'success',
            details: `Rolled back file to snapshot: ${action.undoContext.snapshotPath}`
          });
          return { success: true, message: `Restored file ${action.undoContext.originalPath} from rollback snapshot.` };
        }
      }

      if (typeof action.undoHandler === 'function') {
        await action.undoHandler(action.undoContext);
        logAuditEvent({
          category: 'system',
          action: 'rollback_custom',
          target: action.description,
          status: 'success',
          details: `Executed rollback handler for: ${action.description}`
        });
        return { success: true, message: `Successfully reverted: ${action.description}` };
      }

      return { success: true, message: `Reverted action record: ${action.description}` };
    } catch (err) {
      console.error('RollbackManager: rollback execution failed:', err);
      logAuditEvent({
        category: 'system',
        action: 'rollback_failed',
        target: action.description,
        status: 'error',
        details: err.message
      });
      return { success: false, message: `Rollback failed: ${err.message}` };
    }
  }

  getRecentActions() {
    return this.stack.slice(-10).reverse().map(a => ({
      id: a.id,
      timestamp: a.timestamp,
      type: a.type,
      description: a.description
    }));
  }
}

const globalRollbackManager = new RollbackManager();

module.exports = {
  RollbackManager,
  globalRollbackManager
};
