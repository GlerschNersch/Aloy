import { describe, it, expect, beforeEach } from 'vitest';
import { HermesScriptPipeline } from './hermesScriptPipeline.cjs';
import { HermesEvolutionEngine } from './hermesEvolutionEngine.cjs';
import { HermesDialecticMemory } from './hermesDialecticMemory.cjs';
import { HermesGateway } from './hermesGateway.cjs';

class FakeStore {
  constructor(initial = {}) {
    this.data = {
      transactions: [
        { id: 't1', type: 'expense', amount: -45, category: 'Groceries', date: new Date().toISOString() },
        { id: 't2', type: 'expense', amount: -15, category: 'Coffee', date: new Date().toISOString() }
      ],
      reminders: [
        { id: 'r1', text: 'Deploy Aloy update', completed: false }
      ],
      chats: [
        {
          id: 'chat_1',
          title: 'Aloy Architecture Review',
          messages: [
            { role: 'user', content: 'Can we build the right edge slideout sidebar HUD?' },
            { role: 'assistant', content: 'Yes, using full vertical height and glass styling.' }
          ]
        }
      ],
      memories: [
        { id: 'm1', text: 'Prefers Cyberpunk neon obsidian theme and fast global shortcuts.', category: 'preference' }
      ],
      ...initial
    };
  }
  load() { return JSON.parse(JSON.stringify(this.data)); }
  save(patch) { this.data = { ...this.data, ...patch }; }
}

describe('NousResearch Hermes Agent Harvest Suite', () => {
  let fakeStore;

  beforeEach(() => {
    fakeStore = new FakeStore();
  });

  describe('1. Zero-Context RPC Script Pipeline (HermesScriptPipeline)', () => {
    it('enforces security disablement for unisolated vm.createContext script execution', async () => {
      const pipeline = new HermesScriptPipeline({ store: fakeStore });
      const script = `const txs = await aloy.callTool('get_transactions');`;
      await expect(pipeline.executePipeline(script, { user: 'User' })).rejects.toThrow(
        /Hermes script pipeline is disabled/
      );
    });

    it('gracefully catches invocation on disabled sandbox', async () => {
      const pipeline = new HermesScriptPipeline({ store: fakeStore });
      const script = `throw new Error('Database connection failed');`;
      await expect(pipeline.executePipeline(script)).rejects.toThrow(
        /Hermes script pipeline is disabled/
      );
    });
  });

  describe('2. Self-Improving Skill Synthesis & GEPA Evolution (HermesEvolutionEngine)', () => {
    it('synthesizes an agentskills.io compatible markdown skill', () => {
      const evolution = new HermesEvolutionEngine({ store: fakeStore, skillsDir: './test_skills' });
      const skill = evolution.synthesizeSkill({
        name: 'battery_guard',
        description: 'Monitors smart home batteries and alerts on low levels',
        instructions: 'Query battery entities and flag below 20%.',
        code: 'return states.filter(e => e.attributes.battery < 20);',
        tags: ['smarthome', 'telemetry']
      });

      expect(skill.name).toBe('battery_guard');
      expect(skill.version).toBe('1.0.0');
      expect(skill.metrics.evolutionGen).toBe(1);
    });

    it('records execution traces and evolves skills based on error feedback', () => {
      const evolution = new HermesEvolutionEngine({ store: fakeStore, skillsDir: './test_skills' });
      evolution.synthesizeSkill({
        name: 'stock_delta_analyzer',
        description: 'Computes stock changes',
        instructions: 'Calculate current change percentage.'
      });

      evolution.recordExecution('stock_delta_analyzer', { success: false, latencyMs: 120, error: 'Quote returned NaN for OTC symbol' });
      const evolved = evolution.evolveSkill('stock_delta_analyzer', { reason: 'NaN guard', feedback: 'Handle missing OTC price gracefully' });

      expect(evolved.metrics.evolutionGen).toBe(2);
      expect(evolved.version).toBe('1.2.0');
      expect(evolved.instructions).toContain('Handle missing OTC price gracefully');
    });
  });

  describe('3. FTS5 Cross-Session Memory & Honcho Dialectic Modeling (HermesDialecticMemory)', () => {
    it('retrieves and evolves the Honcho dialectic user model', () => {
      const memory = new HermesDialecticMemory({ store: fakeStore });
      const model = memory.getUserModel();
      expect(model.userName).toBe('User');
      expect(model.communication_style).toContain('Concise');
      expect(model.active_priorities.length).toBeGreaterThan(0);

      const updated = memory.updateUserModel({ communication_style: 'Hyper-concise bullet points only.' });
      expect(updated.communication_style).toBe('Hyper-concise bullet points only.');
    });

    it('performs cross-session keyword matching with BM25 scoring', () => {
      const memory = new HermesDialecticMemory({ store: fakeStore });
      const hits = memory.searchCrossSession('slideout sidebar HUD');
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].content).toContain('sidebar');
    });

    it('generates a compact dialectic context nudge', () => {
      const memory = new HermesDialecticMemory({ store: fakeStore });
      const nudge = memory.generateDialecticNudge('sidebar');
      expect(nudge).toContain('[HERMES DIALECTIC USER PROFILE]');
      expect(nudge).toContain('[CROSS-SESSION RECALL]');
    });
  });

  describe('4. Universal Gateway & Scheduled Automations (HermesGateway)', () => {
    it('returns gateway status and scheduled tasks', () => {
      const gateway = new HermesGateway({ store: fakeStore });
      const status = gateway.getGatewayStatus();
      expect(status.status).toBe('idle');
      expect(status.schedulerImplemented).toBe(true);
      expect(status.gatewayVersion).toContain('Nous Hermes');
    });

    it('schedules a new natural language automation', () => {
      const gateway = new HermesGateway({ store: fakeStore });
      const task = gateway.scheduleTask({
        name: 'Weekly Vault Backup',
        cron: '0 0 * * 0',
        prompt: 'Sync all memories to Obsidian vault'
      });
      expect(task.name).toBe('Weekly Vault Backup');
      expect(task.cron).toBe('0 0 * * 0');
    });

    it('accurately parses and matches standard cron patterns', () => {
      const { matchesCron } = require('./hermesGateway.cjs');
      const testDate = new Date('2026-08-28T09:30:00'); // Friday, Aug 28, 9:30 AM
      expect(matchesCron('30 9 * * *', testDate)).toBe(true);
      expect(matchesCron('*/15 9 * * *', testDate)).toBe(true);
      expect(matchesCron('0 9 * * *', testDate)).toBe(false);
      expect(matchesCron('@hourly', new Date('2026-08-28T10:00:00'))).toBe(true);
    });

    it('executes tasks and updates execution telemetry', async () => {
      const gateway = new HermesGateway({ store: fakeStore });
      const task = gateway.scheduleTask({
        id: 'auto_test_1',
        name: 'Test Pulse',
        cron: '* * * * *',
        prompt: 'Run test diagnostic'
      });

      const execRes = await gateway.executeTaskNow('auto_test_1', async (t) => {
        return `Diagnostic passed for ${t.name}`;
      });

      expect(execRes.success).toBe(true);
      expect(execRes.result).toContain('Diagnostic passed');
      expect(execRes.task.lastRunStatus).toBe('success');
      expect(execRes.task.lastRunAt).toBeDefined();

      gateway.startScheduler(60000);
      expect(gateway.getGatewayStatus().status).toBe('active');
      gateway.stopScheduler();
      expect(gateway.getGatewayStatus().status).toBe('idle');
    });
  });
});
