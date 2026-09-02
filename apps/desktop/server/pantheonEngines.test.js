import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { ApolloEngine, APOLLO_STATUS } from './apollo.cjs';
import { MinervaEngine } from './minerva.cjs';
import { HermesEngine } from './hermes.cjs';

// Helper mock store for complete test isolation
function createMockStore(initialData = {}) {
  let data = {
    memories: ['User prefers concise code', 'User lives in Los Angeles', 'User prefers concise code'],
    reminders: [{ id: '1', text: 'Review QLoRA weights', completed: false }],
    transactions: [{ id: 'tx-1', type: 'expense', amount: 45.50, category: 'Food & Dining', date: new Date().toISOString() }],
    budgets: [{ category: 'Food & Dining', limit: 100 }],
    trackedProjects: [{ name: 'Aloy Refactor', status: 'in progress' }],
    ...initialData
  };

  return {
    load: () => JSON.parse(JSON.stringify(data)),
    save: (next) => { data = JSON.parse(JSON.stringify(next)); return true; },
    getRaw: () => data
  };
}

describe('Aloy Sub-Agent Pantheon Engines (Isolated Temp Tests)', () => {
  let tempFiles = [];

  const getTempFile = (prefix) => {
    const p = path.join(os.tmpdir(), `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.json`);
    tempFiles.push(p);
    return p;
  };

  afterEach(() => {
    for (const f of tempFiles) {
      if (fs.existsSync(f)) {
        try { fs.unlinkSync(f); } catch {}
      }
    }
    tempFiles = [];
  });

  describe('Apollo Engine (Document Intelligence & Memory Gardening)', () => {
    it('gardens and deduplicates user memories preserving clean string format', () => {
      const mockStore = createMockStore({
        memories: [
          'User loves espresso',
          '  user loves espresso  ',
          'User codes in TypeScript',
          ''
        ]
      });
      const tempTaskFile = getTempFile('apollo_tasks');
      const apollo = new ApolloEngine(tempTaskFile, mockStore);

      const result = apollo.gardenMemories();
      expect(result.success).toBe(true);
      expect(result.finalCount).toBe(2);
      expect(result.prunedCount).toBe(2);

      // Verify memories are clean strings, not mangled JSON objects
      expect(result.memories).toEqual(['User loves espresso', 'User codes in TypeScript']);
      expect(typeof result.memories[0]).toBe('string');
      expect(typeof mockStore.getRaw().memories[0]).toBe('string');
    });

    it('creates and processes document tasks without polluting learnedKnowledge', async () => {
      const mockStore = createMockStore();
      const tempTaskFile = getTempFile('apollo_tasks');
      const apollo = new ApolloEngine(tempTaskFile, mockStore);

      const docContent = `Quantum Superposition Notes\n\nQuantum bits exist simultaneously in 0 and 1 states. Entanglement coordinates distant pairs.\n\nKey platforms include Trapped Ions and Silicon Photonics.`;

      const task = await apollo.createDocumentTask({
        title: 'Quantum Computing Brief',
        rawContent: docContent,
        category: 'Physics'
      });

      expect(task.id).toMatch(/^apollo-/);
      expect(task.status).toBe(APOLLO_STATUS.QUEUED);

      // Wait for immediate async processor
      await new Promise(r => setTimeout(r, 200));

      const updated = apollo.getTask(task.id);
      expect(updated.status).toBe(APOLLO_STATUS.COMPLETED);
      expect(updated.summary).toContain('Quantum bits exist simultaneously');
      expect(updated.entities.length).toBeGreaterThan(0);

      // Verify learnedKnowledge was NOT polluted (it should land in curatedDocuments instead)
      expect(mockStore.getRaw().learnedKnowledge).toBeUndefined();
      expect(mockStore.getRaw().curatedDocuments).toBeDefined();
      expect(mockStore.getRaw().curatedDocuments[0].title).toBe('Quantum Computing Brief');
    });
  });

  describe('Minerva Engine (Smart Home Sentinel & Health Watchdog)', () => {
    it('runs an infrastructure health scan using mock fetcher', async () => {
      const mockFetch = async (url) => {
        if (url.includes('11434')) return { ok: true, status: 200 };
        if (url.includes('8096')) return { ok: true, status: 200 };
        return { ok: false, status: 503 };
      };

      const minerva = new MinervaEngine(mockFetch);
      const report = await minerva.runHealthScan();

      expect(report.timestamp).toBeDefined();
      expect(report.dependencies).toBeDefined();
      expect(report.dependencies.ollama.status).toBe('online');
      expect(report.dependencies.jellyfin.status).toBe('online');
      expect(report.dependencies.mediaDriveP).toBeDefined();
    });

    it('handles alert dispatching cleanly without external webhook', async () => {
      const minerva = new MinervaEngine();
      const res = await minerva.dispatchAlert({ title: 'Test Alert', message: 'All systems green' });
      expect(res.forwarded).toBe(false);
      expect(res.reason).toBeDefined();
    });
  });

  describe('Hermes Engine (Logistics & Daily Briefing)', () => {
    it('generates a structured daily operations briefing from isolated store', async () => {
      const mockStore = createMockStore();
      const hermes = new HermesEngine(mockStore);

      const brief = await hermes.generateDailyBriefing({ userName: 'User' });
      expect(brief.markdown).toContain('Daily Operations Briefing');
      expect(brief.sections.reminders.totalPending).toBe(1);
      expect(brief.sections.finances.recentSpendTotal).toBe(45.5);
      expect(brief.sections.projects.activeCount).toBe(1);
    });

    it('evaluates budget health without false $1 limit fallbacks', () => {
      const mockStore = createMockStore({
        transactions: [
          { type: 'expense', amount: 90, category: 'Food & Dining' },
          { type: 'expense', amount: 500, category: 'Uncapped Category' }
        ],
        budgets: [
          { category: 'Food & Dining', limit: 100 },
          { category: 'Uncapped Category' } // Missing limit should NOT default to $1
        ]
      });

      const hermes = new HermesEngine(mockStore);
      const health = hermes.evaluateBudgetHealth();

      expect(health.categorySpend['Food & Dining']).toBe(90);
      expect(health.categorySpend['Uncapped Category']).toBe(500);

      // Only Food & Dining (90%) should trigger alert (>=85%)
      expect(health.budgetAlerts.length).toBe(1);
      expect(health.budgetAlerts[0].category).toBe('Food & Dining');
      expect(health.budgetAlerts[0].percent).toBe(90);
    });
  });
});
