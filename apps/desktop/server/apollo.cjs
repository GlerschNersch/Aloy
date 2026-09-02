// APOLLO — Autonomous Document Intelligence, GraphRAG Curator & Vault Architect.
// Ingests documents (PDF/Markdown/Notes), gardens personal memories, maintains the
// semantic knowledge graph, and orchestrates Obsidian Vault synchronization.

const fs = require('fs');
const path = require('path');
const os = require('os');
const defaultStore = require('./store.cjs');
const { syncToVault } = require('./vaultSync.cjs');
const { logAuditEvent } = require('./auditLogger.cjs');
const { gardenAndReconcileFacts } = require('./apolloMemoryEngine.cjs');

const DEFAULT_STORAGE_DIR = path.join(os.homedir(), '.aloy-server');
const DEFAULT_TASKS_FILE = path.join(DEFAULT_STORAGE_DIR, 'apollo-tasks.json');

const APOLLO_STATUS = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  SYNTHESIZING: 'synthesizing',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

class ApolloEngine {
  constructor(customTasksFile = null, customStore = null) {
    this.tasksFile = customTasksFile || DEFAULT_TASKS_FILE;
    this.storageDir = path.dirname(this.tasksFile);
    this.store = customStore || defaultStore;
    this.ensureStorage();
  }

  ensureStorage() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
    if (!fs.existsSync(this.tasksFile)) {
      fs.writeFileSync(this.tasksFile, JSON.stringify([], null, 2), 'utf8');
    }
  }

  loadTasks() {
    this.ensureStorage();
    try {
      if (fs.existsSync(this.tasksFile)) {
        const raw = fs.readFileSync(this.tasksFile, 'utf8');
        if (raw && raw.trim()) return JSON.parse(raw);
      }
    } catch {
      // ignore parsing glitch
    }
    return [];
  }

  saveTasks(tasks) {
    this.ensureStorage();
    const serialized = JSON.stringify(tasks, null, 2);
    const tmpPath = path.join(this.storageDir, `.apollo_tasks_${Date.now()}.tmp`);
    try {
      fs.writeFileSync(tmpPath, serialized, 'utf8');
      fs.renameSync(tmpPath, this.tasksFile);
    } catch (err) {
      if (fs.existsSync(tmpPath)) try { fs.unlinkSync(tmpPath); } catch {}
      throw err;
    }
  }

  listTasks() {
    return this.loadTasks();
  }

  getTask(id) {
    return this.loadTasks().find(t => t.id === id) || null;
  }

  /**
   * Gardens and deduplicates user memories in store.json using Mem0-inspired reconciliation.
   * Resolves contradictions, detects supersessions, and preserves clean string formatting.
   */
  gardenMemories() {
    const d = this.store.load();
    const rawMemories = d.memories || [];
    
    const { activeFacts, archivedFacts, prunedCount, changesCount } = gardenAndReconcileFacts([], rawMemories);

    d.memories = activeFacts;
    this.store.save(d);

    logAuditEvent({
      action: 'apollo_memory_gardening',
      source: 'apollo',
      details: {
        initialCount: rawMemories.length,
        finalCount: activeFacts.length,
        prunedCount,
        archivedCount: archivedFacts.length
      }
    });

    return {
      success: true,
      initialCount: rawMemories.length,
      finalCount: activeFacts.length,
      prunedCount,
      archivedFacts,
      memories: activeFacts
    };
  }

  /**
   * Triggers automated Obsidian Vault export.
   */
  async triggerVaultSync() {
    const result = await syncToVault();
    logAuditEvent({
      action: 'apollo_vault_sync',
      source: 'apollo',
      details: { timestamp: new Date().toISOString() }
    });
    return result;
  }

  /**
   * Creates an autonomous document curation/synthesis task.
   */
  async createDocumentTask({ title, rawContent, category = 'Research Note', requestedBy = 'user' }) {
    if (!title || !rawContent) throw new Error('Title and content are required');

    const tasks = this.loadTasks();
    const taskId = `apollo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const task = {
      id: taskId,
      title: title.trim(),
      category,
      rawContentLength: rawContent.length,
      status: APOLLO_STATUS.QUEUED,
      progress: 0,
      summary: null,
      entities: [],
      requestedBy,
      createdAt: new Date().toISOString(),
      completedAt: null
    };

    tasks.unshift(task);
    this.saveTasks(tasks);

    logAuditEvent({
      action: 'apollo_task_created',
      source: 'apollo',
      details: { taskId, title: task.title, category }
    });

    setImmediate(() => this.processDocumentTask(taskId, rawContent));
    return task;
  }

  async processDocumentTask(taskId, rawContent) {
    const tasks = this.loadTasks();
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    try {
      task.status = APOLLO_STATUS.PROCESSING;
      task.progress = 40;
      this.saveTasks(tasks);

      // Extract high-level summary from paragraphs
      const paragraphs = rawContent.split(/\n\s*\n/).filter(p => p.trim().length > 20);
      const summary = paragraphs.slice(0, 3).join('\n\n').slice(0, 1000);

      // Extract capitalized multi-word terms or keywords
      const words = rawContent.match(/[A-Z][a-zA-Z0-9_]{2,}/g) || [];
      const entityCounts = {};
      words.forEach(w => { entityCounts[w] = (entityCounts[w] || 0) + 1; });
      const topEntities = Object.entries(entityCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([name, count]) => ({ name, occurrences: count }));

      task.status = APOLLO_STATUS.SYNTHESIZING;
      task.progress = 85;
      this.saveTasks(tasks);

      task.summary = summary;
      task.entities = topEntities;
      task.status = APOLLO_STATUS.COMPLETED;
      task.progress = 100;
      task.completedAt = new Date().toISOString();
      this.saveTasks(tasks);

      // Save to curatedDocuments tier (DO NOT contaminate learnedKnowledge which is reserved for verified research)
      const d = this.store.load();
      d.curatedDocuments = d.curatedDocuments || [];
      d.curatedDocuments.push({
        id: `apollo-doc-${Date.now()}`,
        title: task.title,
        category: task.category,
        summary: task.summary,
        keyEntities: topEntities,
        ingestedAt: task.completedAt
      });
      this.store.save(d);

      logAuditEvent({
        action: 'apollo_task_completed',
        source: 'apollo',
        details: { taskId, title: task.title, entityCount: topEntities.length }
      });
    } catch (err) {
      task.status = APOLLO_STATUS.FAILED;
      task.error = err.message;
      this.saveTasks(tasks);
    }
  }
}

const globalApollo = new ApolloEngine();

module.exports = {
  ApolloEngine,
  globalApollo,
  APOLLO_STATUS
};
