import { describe, it, expect } from 'vitest';
import { getInboxFeed } from './inboxAggregator.cjs';

const NOW = Date.now();
const hoursAgo = (h) => new Date(NOW - h * 60 * 60 * 1000).toISOString();

function makeFakes({ escalations = [], tasks = [], securityRecent = [], hephTasks = [] } = {}) {
  return {
    loadStore: () => ({ claudeEscalations: escalations }),
    athenaEngine: { listTasks: () => tasks },
    globalMinerva: { getSecurityStats: () => ({ recent: securityRecent }) },
    globalHephaestus: { listTasks: () => hephTasks }
  };
}

describe('getInboxFeed', () => {
  it('includes escalations within the window as Apollo items', () => {
    const fakes = makeFakes({
      escalations: [{ timestamp: hoursAgo(2), question: 'What time is it in Tokyo?' }]
    });
    const { items } = getInboxFeed({ ...fakes, windowMs: 24 * 60 * 60 * 1000 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ agent: 'Apollo', type: 'escalation', text: 'What time is it in Tokyo?' });
  });

  it('excludes escalations outside the window', () => {
    const fakes = makeFakes({
      escalations: [{ timestamp: hoursAgo(48), question: 'stale question' }]
    });
    const { items } = getInboxFeed({ ...fakes, windowMs: 24 * 60 * 60 * 1000 });
    expect(items).toHaveLength(0);
  });

  it('includes only completed Athena tasks as Athena items', () => {
    const fakes = makeFakes({
      tasks: [
        { status: 'completed', completedAt: hoursAgo(1), query: 'best espresso machines' },
        { status: 'researching', completedAt: null, query: 'still running' },
        { status: 'completed', completedAt: hoursAgo(30), query: 'too old' }
      ]
    });
    const { items } = getInboxFeed({ ...fakes, windowMs: 24 * 60 * 60 * 1000 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ agent: 'Athena', type: 'research', text: 'best espresso machines' });
  });

  it('maps security events to Minerva items, distinguishing injection vs filesystem denials', () => {
    const fakes = makeFakes({
      securityRecent: [
        { timestamp: hoursAgo(1), category: 'security', target: 'fetched page' },
        { timestamp: hoursAgo(2), category: 'filesystem', action: 'write', target: 'C:\\Windows' }
      ]
    });
    const { items } = getInboxFeed({ ...fakes, windowMs: 24 * 60 * 60 * 1000 });
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.type === 'injection-attempt').text).toContain('injection');
    expect(items.find((i) => i.type === 'blocked-access').text).toContain('write');
  });

  it('surfaces queued Pantheon Council work orders as Hephaestus items, regardless of age', () => {
    const fakes = makeFakes({
      hephTasks: [
        { status: 'queued', requestedBy: 'pantheon_conclave', title: 'Continuous Code Optimization & Bundle Pruning (Week 34)', createdAt: hoursAgo(20) },
        { status: 'queued', requestedBy: 'desktop_user', title: 'A task user asked for himself', createdAt: hoursAgo(1) },
        { status: 'deployed', requestedBy: 'pantheon_conclave', title: 'Already shipped', createdAt: hoursAgo(100) }
      ]
    });
    const { items } = getInboxFeed({ ...fakes, windowMs: 24 * 60 * 60 * 1000 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ agent: 'Hephaestus', type: 'stuck-work-order' });
    expect(items[0].text).toContain('Continuous Code Optimization & Bundle Pruning (Week 34)');
  });

  it('surfaces queued Athena tasks as stuck-research-task items, regardless of age (unlike completed tasks, which are window-gated)', () => {
    const fakes = makeFakes({
      tasks: [
        { status: 'queued', query: 'Latest advancements in local SLM inference on Nvidia GPUs', createdAt: hoursAgo(120) },
        { status: 'researching', query: 'actively running, not stuck', createdAt: hoursAgo(1) },
        { status: 'completed', completedAt: hoursAgo(1), query: 'finished fine' }
      ]
    });
    const { items } = getInboxFeed({ ...fakes, windowMs: 24 * 60 * 60 * 1000 });
    const stuck = items.filter((i) => i.type === 'stuck-research-task');
    expect(stuck).toHaveLength(1);
    expect(stuck[0]).toMatchObject({ agent: 'Athena' });
    expect(stuck[0].text).toContain('Latest advancements in local SLM inference on Nvidia GPUs');
  });

  it('sorts all items across agents by recency, newest first', () => {
    const fakes = makeFakes({
      escalations: [{ timestamp: hoursAgo(5), question: 'older' }],
      tasks: [{ status: 'completed', completedAt: hoursAgo(1), query: 'newer' }],
      securityRecent: [{ timestamp: hoursAgo(3), category: 'security' }]
    });
    const { items } = getInboxFeed({ ...fakes, windowMs: 24 * 60 * 60 * 1000 });
    expect(items.map((i) => i.agent)).toEqual(['Athena', 'Minerva', 'Apollo']);
  });

  it('includes Minerva self-healing events in the feed', () => {
    const fakes = makeFakes();
    fakes.globalMinerva.getSelfHealEvents = () => [
      { timestamp: hoursAgo(1), details: 'Restarted Sonarr and Radarr after connection drops' }
    ];
    const { items } = getInboxFeed({ ...fakes, windowMs: 24 * 60 * 60 * 1000 });
    const healItems = items.filter(i => i.type === 'self-healing');
    expect(healItems).toHaveLength(1);
    expect(healItems[0].agent).toBe('Minerva');
    expect(healItems[0].text).toContain('Restarted Sonarr and Radarr');
  });
});
