import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { ConclaveEngine, getIsoWeek, getIsoWeekYear, getIsoWeekData } from './conclave.cjs';

// Helper mock store for unit testing
function createMockStore(initialData = {}) {
  let data = {
    memories: ['User prefers concise answers', 'Home Assistant host is configured'],
    reminders: [{ id: '1', title: 'Review QLoRA weights', completed: false }],
    trackedProjects: [{ id: 'p1', name: 'Aloy Refactor', status: 'in progress' }],
    hephaestusTasks: [],
    trainingSamples: [],
    athenaTasks: [],
    claudeEscalations: [],
    learnedKnowledge: [],
    ...initialData
  };

  return {
    load: () => JSON.parse(JSON.stringify(data)),
    save: (next) => { data = JSON.parse(JSON.stringify(next)); return true; },
    getRaw: () => data
  };
}

describe('Aloy Sub-Agent Pantheon — Weekly Strategic Conclave Engine', () => {
  let tempDirs = [];

  const getTempDir = () => {
    const dir = path.join(os.tmpdir(), `conclave_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    fs.mkdirSync(dir, { recursive: true });
    tempDirs.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
    tempDirs = [];
  });

  it('calculates ISO week and week-year correctly across boundary edge cases', () => {
    // Normal date
    const d1 = new Date('2026-08-18T10:00:00Z');
    const res1 = getIsoWeekData(d1);
    expect(res1.week).toBe(34);
    expect(res1.year).toBe(2026);
    expect(getIsoWeek(d1)).toBe(34);
    expect(getIsoWeekYear(d1)).toBe(2026);

    // Dec 31, 2024 is a Tuesday that belongs to ISO Week 1 of 2025
    const d2 = new Date('2024-12-31T10:00:00Z');
    const res2 = getIsoWeekData(d2);
    expect(res2.week).toBe(1);
    expect(res2.year).toBe(2025);

    // Jan 2, 2021 is a Saturday that belongs to ISO Week 53 of 2020
    const d3 = new Date('2021-01-02T10:00:00Z');
    const res3 = getIsoWeekData(d3);
    expect(res3.week).toBe(53);
    expect(res3.year).toBe(2020);
  });

  it('convenes weekly conclave with real injected engines and dispatches actual tasks', async () => {
    const mockStore = createMockStore();
    const tempVault = getTempDir();

    const createdHephTasks = [];
    const createdAthenaTasks = [];

    const mockMinerva = {
      runHealthScan: async () => ({
        timestamp: new Date().toISOString(),
        dependencies: {
          ollama: { status: 'online' },
          whisper: { status: 'online' },
          kokoro: { status: 'degraded', error: 'Port conflict' },
          homeAssistant: { status: 'online' }
        }
      })
    };

    const mockHephaestus = {
      listTasks: async () => [
        { id: 'heph-existing-1', title: 'TTS retry handler', status: 'staged_for_review' }
      ],
      getTrainingStats: () => ({ totalSamples: 14, positiveCount: 12, correctionCount: 2 }),
      createTask: async (taskData) => {
        const t = { id: `heph-${Date.now()}`, ...taskData, status: 'queued' };
        createdHephTasks.push(t);
        return t;
      }
    };

    const mockAthena = {
      listTasks: async () => [
        { id: 'ath-1', query: 'Rust Wasm performance', status: 'completed' },
        { id: 'ath-2', query: 'Local embeddings', status: 'researching' }
      ],
      createTask: async (taskData) => {
        const t = { id: `ath-${Date.now()}`, ...taskData, status: 'queued' };
        createdAthenaTasks.push(t);
        return t;
      }
    };

    const mockHermes = {
      evaluateBudgetHealth: async () => ({
        budgetAlerts: [{ category: 'Dining Out', spent: 150, limit: 100, percent: 150 }]
      })
    };

    const conclave = new ConclaveEngine({
      store: mockStore,
      minervaEngine: mockMinerva,
      hephaestusEngine: mockHephaestus,
      athenaEngine: mockAthena,
      hermesEngine: mockHermes,
      vaultDir: tempVault
    });

    const session = await conclave.conveneConclave({ manualTrigger: true, overrideTime: '2026-08-18T10:00:00Z' });

    expect(session).toBeDefined();
    expect(session.id).toContain('conclave-2026-w34-');
    expect(session.isoWeek).toBe(34);
    expect(session.year).toBe(2026);
    expect(session.manualTrigger).toBe(true);

    // 1. Verify Minerva Telemetry
    expect(session.reports.minerva).toBeDefined();
    expect(session.reports.minerva.healthScore).toBe(75);
    expect(session.reports.minerva.degraded.length).toBe(1);
    expect(session.reports.minerva.degraded[0].service).toBe('kokoro');

    // 2. Verify Hephaestus Telemetry
    expect(session.reports.hephaestus).toBeDefined();
    expect(session.reports.hephaestus.activeWorkOrders).toBe(1);
    expect(session.reports.hephaestus.qloraSamples).toBe(14);

    // 3. Verify Athena Telemetry
    expect(session.reports.athena).toBeDefined();
    expect(session.reports.athena.completedDossiers).toBe(1);
    expect(session.reports.athena.activeMissions).toBe(1);

    // 4. Verify Hermes Telemetry
    expect(session.reports.hermes).toBeDefined();
    expect(session.reports.hermes.status).toBe('BUDGET_ATTENTION');
    expect(session.reports.hermes.budgetAlertsCount).toBe(1);

    // 6. Verify Auto-Dispatched Task
    expect(createdHephTasks.length).toBe(1);
    const recoveryDirective = session.directives.find(d => d.assignedTo === 'Hephaestus' && d.domain === 'Reliability');
    expect(recoveryDirective).toBeDefined();
    expect(recoveryDirective.status).toBe('DISPATCHED');
    expect(recoveryDirective.taskId).toBe(createdHephTasks[0].id);

    // 7. Verify Deliberation Threads, Timestamps & inReplyTo Hierarchy
    expect(session.threads).toBeDefined();
    expect(session.threads.length).toBeGreaterThanOrEqual(4);
    const reliabilityThread = session.threads.find(t => t.domain === 'Reliability');
    expect(reliabilityThread).toBeDefined();
    expect(reliabilityThread.messages.length).toBe(2);
    expect(reliabilityThread.messages[0].speaker).toBe('Minerva');
    expect(reliabilityThread.messages[0].timeStr).toBeDefined();
    expect(reliabilityThread.messages[0].timestamp).toBeDefined();
    expect(reliabilityThread.messages[1].speaker).toBe('Hephaestus');
    expect(reliabilityThread.messages[1].inReplyTo).toBe(reliabilityThread.messages[0].id);
    expect(reliabilityThread.messages[1].directiveRef).toBe(recoveryDirective.id);

    // Verify Honest Deliberation Minutes (no fake 100% uptime claims)
    const minervaStatement = session.minutes.find(m => m.speaker === 'Minerva');
    expect(minervaStatement.statement).toContain('detected service degradation on [kokoro]');
    expect(minervaStatement.statement).not.toContain('100% uptime');

    // 8. Verify Vault Sync & Threaded Markdown
    expect(fs.existsSync(session.vaultFilePath)).toBe(true);
    const vaultContent = fs.readFileSync(session.vaultFilePath, 'utf8');
    expect(vaultContent).toContain('## 🗣️ Deliberation Transcripts & Consensus Threads');
    expect(vaultContent).toContain('### 🧵 Thread 1:');
    expect(vaultContent).toContain('## 🎯 Strategic Directives Dispatched');
    expect(vaultContent).toContain(recoveryDirective.taskId);
  }, 15000);

  it('correctly marks directives as PROPOSED when subagent engines are not configured to auto-create tasks', async () => {
    const mockStore = createMockStore();
    const tempVault = getTempDir();

    const mockMinerva = {
      runHealthScan: async () => ({
        timestamp: new Date().toISOString(),
        dependencies: {
          ollama: { status: 'online' },
          whisper: { status: 'degraded', error: 'Process hung' }
        }
      })
    };

    // Hephaestus without createTask capability
    const mockHephaestus = {
      listTasks: async () => []
    };

    const conclave = new ConclaveEngine({
      store: mockStore,
      minervaEngine: mockMinerva,
      hephaestusEngine: mockHephaestus,
      vaultDir: tempVault
    });

    const session = await conclave.conveneConclave({ manualTrigger: true });
    const recoveryDirective = session.directives.find(d => d.assignedTo === 'Hephaestus' && d.domain === 'Reliability');
    expect(recoveryDirective).toBeDefined();
    expect(recoveryDirective.status).toBe('PROPOSED');
    expect(recoveryDirective.taskId).toBeNull();
  });

  it('respects 7-day cooldown and avoids re-dispatching recently expired Hephaestus directives', async () => {
    const mockStore = createMockStore();
    const tempVault = getTempDir();
    let tasksCreated = 0;

    const mockHephaestus = {
      listTasks: async () => [
        {
          id: 'heph-expired-1',
          title: 'Implement Resilient Sidecar Auto-Recovery (kokoro)',
          status: 'expired',
          updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() // expired 2 days ago
        }
      ],
      createTask: async () => {
        tasksCreated++;
        return { id: 'heph-new-1' };
      }
    };

    const conclave = new ConclaveEngine({
      store: mockStore,
      hephaestusEngine: mockHephaestus,
      vaultDir: tempVault
    });

    const result = await conclave._dispatchHephTaskOnce(
      { title: 'Implement Resilient Sidecar Auto-Recovery (kokoro)' },
      'Implement Resilient Sidecar Auto-Recovery'
    );

    expect(result.deduped).toBe(true);
    expect(result.inCooldown).toBe(true);
    expect(tasksCreated).toBe(0);
  });
});
