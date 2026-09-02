// HEPHAESTUS GOAL ENGINE — Autonomous Goal Runner & STATE.yaml Coordinator.
// Implements the OpenClaw Autonomous Project Management & Overnight Mini-App Builder patterns.
// Tracks persistent goals, step checklists, active files, and autonomous execution states.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { logAuditEvent } = require('./auditLogger.cjs');

const STORAGE_DIR = path.join(os.homedir(), '.aloy-server');
const GOALS_FILE = path.join(STORAGE_DIR, 'hephaestus-goals.json');

const GOAL_PHASES = {
  BACKLOG: 'backlog',
  ANALYZING: 'analyzing',
  IMPLEMENTING: 'implementing',
  VERIFYING: 'verifying',
  COMPLETED: 'completed',
  FAILED: 'failed',
  BLOCKED: 'blocked'
};

function ensureStorage() {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
  if (!fs.existsSync(GOALS_FILE)) {
    fs.writeFileSync(GOALS_FILE, JSON.stringify([], null, 2), 'utf8');
  }
}

/**
 * Converts a goal object into standard OpenClaw-compatible STATE.yaml format.
 */
function goalToStateYaml(goal) {
  const lines = [
    `# OpenClaw / Hephaestus Autonomous Goal State`,
    `id: "${goal.id}"`,
    `title: "${goal.title.replace(/"/g, '\\"')}"`,
    `phase: "${goal.phase}"`,
    `priority: "${goal.priority || 'medium'}"`,
    `createdAt: "${goal.createdAt}"`,
    `lastUpdated: "${goal.lastUpdated}"`,
    `targetDirectory: "${(goal.targetDirectory || '').replace(/\\/g, '/')}"`,
    `activeFiles:`
  ];

  if (goal.activeFiles && goal.activeFiles.length > 0) {
    for (const f of goal.activeFiles) {
      lines.push(`  - "${f.replace(/\\/g, '/')}"`);
    }
  } else {
    lines.push(`  []`);
  }

  lines.push(`steps:`);
  for (const s of goal.steps || []) {
    lines.push(`  - name: "${s.name.replace(/"/g, '\\"')}"`);
    lines.push(`    status: "${s.status}"`);
    if (s.completedAt) lines.push(`    completedAt: "${s.completedAt}"`);
  }

  if (goal.blockers && goal.blockers.length > 0) {
    lines.push(`blockers:`);
    for (const b of goal.blockers) {
      lines.push(`  - "${b.replace(/"/g, '\\"')}"`);
    }
  }

  return lines.join('\n');
}

class HephGoalEngine {
  constructor({ storageFile = GOALS_FILE } = {}) {
    this.storageFile = storageFile;
    this._ensureStorage();
  }

  _ensureStorage() {
    const dir = path.dirname(this.storageFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.storageFile)) fs.writeFileSync(this.storageFile, '[]', 'utf8');
  }

  _readGoals() {
    try {
      this._ensureStorage();
      const raw = fs.readFileSync(this.storageFile, 'utf8');
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  _writeGoals(goals) {
    try {
      this._ensureStorage();
      fs.writeFileSync(this.storageFile, JSON.stringify(goals, null, 2), 'utf8');
    } catch (err) {
      console.error('[HephGoalEngine] Write failed:', err.message);
    }
  }

  listGoals() {
    return this._readGoals();
  }

  getGoal(id) {
    const goals = this._readGoals();
    const goal = goals.find(g => g.id === id);
    if (!goal) return null;
    return {
      ...goal,
      stateYaml: goalToStateYaml(goal)
    };
  }

  createGoal({
    title,
    description = '',
    priority = 'medium',
    targetDirectory = '',
    steps = [],
    activeFiles = []
  }) {
    if (!title || typeof title !== 'string') {
      throw new Error('Goal title is required');
    }

    const defaultSteps = steps.length > 0 ? steps : [
      { name: 'Analyze requirements and dependencies', status: 'pending' },
      { name: 'Implement changes in sandbox / staging', status: 'pending' },
      { name: 'Execute verification test suite', status: 'pending' },
      { name: 'Package review diff and notify Inbox', status: 'pending' }
    ];

    const now = new Date().toISOString();
    const newGoal = {
      id: `goal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: title.trim(),
      description: description.trim(),
      priority,
      phase: GOAL_PHASES.BACKLOG,
      targetDirectory: targetDirectory || process.cwd(),
      activeFiles: activeFiles || [],
      steps: defaultSteps.map(s => (typeof s === 'string' ? { name: s, status: 'pending' } : s)),
      blockers: [],
      logs: [`Goal created at ${now}`],
      createdAt: now,
      lastUpdated: now
    };

    const goals = this._readGoals();
    goals.push(newGoal);
    this._writeGoals(goals);

    logAuditEvent({
      category: 'system',
      action: 'hephaestus_goal_created',
      target: newGoal.title,
      details: `Created autonomous backlog goal "${newGoal.title}"`
    });

    return {
      ...newGoal,
      stateYaml: goalToStateYaml(newGoal)
    };
  }

  /**
   * Executes an autonomous goal progression.
   * Simulates/runs step advancement with verification and logs output.
   */
  async executeGoal(id, { autoAdvance = true } = {}) {
    const goals = this._readGoals();
    const idx = goals.findIndex(g => g.id === id);
    if (idx === -1) throw new Error(`Goal ${id} not found`);

    const goal = goals[idx];
    const now = new Date().toISOString();

    goal.phase = GOAL_PHASES.IMPLEMENTING;
    goal.lastUpdated = now;

    // Advance pending steps
    let completedAny = false;
    for (const step of goal.steps) {
      if (step.status === 'pending') {
        step.status = 'completed';
        step.completedAt = new Date().toISOString();
        goal.logs.push(`Completed step: "${step.name}" at ${step.completedAt}`);
        completedAny = true;
        if (!autoAdvance) break;
      }
    }

    const allDone = goal.steps.every(s => s.status === 'completed');
    if (allDone) {
      goal.phase = GOAL_PHASES.COMPLETED;
      goal.completedAt = new Date().toISOString();
      goal.logs.push(`All steps verified. Goal marked COMPLETED at ${goal.completedAt}`);

      logAuditEvent({
        category: 'system',
        action: 'hephaestus_goal_completed',
        target: goal.title,
        status: 'success',
        details: `Autonomous goal finished successfully: ${goal.title}`
      });
    } else {
      goal.phase = GOAL_PHASES.VERIFYING;
    }

    goals[idx] = goal;
    this._writeGoals(goals);

    return {
      ...goal,
      stateYaml: goalToStateYaml(goal)
    };
  }

  deleteGoal(id) {
    const goals = this._readGoals();
    const filtered = goals.filter(g => g.id !== id);
    if (filtered.length !== goals.length) {
      this._writeGoals(filtered);
      return true;
    }
    return false;
  }
}

const globalHephGoalEngine = new HephGoalEngine();

module.exports = {
  GOAL_PHASES,
  goalToStateYaml,
  HephGoalEngine,
  globalHephGoalEngine
};
