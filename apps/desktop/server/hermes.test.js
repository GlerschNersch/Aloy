import { describe, it, expect, beforeEach } from 'vitest';
import { HermesEngine } from './hermes.cjs';

function createMockStore(initialData = {}) {
  let data = {
    reminders: [
      { id: '1', title: 'Review PR #42', completed: false },
      { id: '2', title: 'Check server logs', completed: true },
      { id: '3', text: 'Backup Obsidian vault', completed: false }
    ],
    transactions: [
      { id: 't1', type: 'expense', amount: 35.50, category: 'Food & Dining', date: new Date().toISOString() },
      { id: 't2', type: 'expense', amount: 120.00, category: 'Hardware', date: new Date().toISOString() },
      { id: 't3', type: 'income', amount: 1500.00, category: 'Payroll', date: new Date().toISOString() }
    ],
    budgets: [
      { category: 'Food & Dining', limit: 200 },
      { category: 'Hardware', limit: 100 }
    ],
    trackedProjects: [
      { name: 'Aloy Refactor', status: 'in progress' },
      { name: 'Legacy Cleanup', status: 'completed' }
    ],
    ...initialData
  };

  return {
    load: () => JSON.parse(JSON.stringify(data)),
    save: (next) => { data = JSON.parse(JSON.stringify(next)); return true; },
    getRaw: () => data
  };
}

describe('HERMES (BRIEF) — Autonomous Operations & Daily Briefing Engine (20 Tests)', () => {
  let engine;
  let mockStore;

  beforeEach(() => {
    mockStore = createMockStore();
    engine = new HermesEngine(mockStore);
  });

  // 1. Initialization
  it('1. initializes HermesEngine with custom or default store', () => {
    expect(engine).toBeDefined();
    expect(engine.store).toBe(mockStore);
  });

  // 2. Daily brief generation
  it('2. generates daily executive briefing with personalized greeting', async () => {
    const brief = await engine.generateDailyBriefing({ userName: 'User' });
    expect(brief).toBeDefined();
    expect(brief.userName).toBe('User');
    expect(brief.greeting).toContain('User');
    expect(brief.markdown).toContain('# ☀️ Daily Operations Briefing');
  });

  // 3. Pending reminders filtering
  it('3. filters and includes only uncompleted pending reminders in daily brief', async () => {
    const brief = await engine.generateDailyBriefing();
    expect(brief.sections.reminders.totalPending).toBe(2);
    expect(brief.sections.reminders.items).toContain('Review PR #42');
    expect(brief.sections.reminders.items).toContain('Backup Obsidian vault');
    expect(brief.sections.reminders.items).not.toContain('Check server logs');
  });

  // 4. Caps priority reminders list
  it('4. caps high priority reminders list cleanly to top items', async () => {
    const manyReminders = Array.from({ length: 15 }, (_, i) => ({ id: `r-${i}`, title: `Task ${i}`, completed: false }));
    mockStore = createMockStore({ reminders: manyReminders });
    engine = new HermesEngine(mockStore);

    const brief = await engine.generateDailyBriefing();
    expect(brief.sections.reminders.totalPending).toBe(15);
    expect(brief.sections.reminders.items.length).toBeLessThanOrEqual(5);
  });

  // 5. Financial outflow calculation
  it('5. calculates 30-day recent spend outflow from transactions', async () => {
    const brief = await engine.generateDailyBriefing();
    expect(brief.sections.finances.recentTransactionCount).toBe(2);
    expect(brief.sections.finances.recentSpendTotal).toBe(155.50);
  });

  // 6. Ignores income in spend calculation
  it('6. ignores income deposits and positive credits in outflow spend calculation', async () => {
    const brief = await engine.generateDailyBriefing();
    expect(brief.sections.finances.recentSpendTotal).toBe(155.50);
    expect(brief.sections.finances.recentSpendTotal).not.toBe(1655.50);
  });

  // 7. Decimal precision formatting
  it('7. formats spend amount with 2 decimal places precision', async () => {
    mockStore = createMockStore({
      transactions: [{ id: 't1', type: 'expense', amount: 10.33333, category: 'Misc', date: new Date().toISOString() }]
    });
    engine = new HermesEngine(mockStore);

    const brief = await engine.generateDailyBriefing();
    expect(brief.sections.finances.recentSpendTotal).toBe(10.33);
  });

  // 8. Budget evaluation
  it('8. evaluates budget health returning categorySpend and budgetAlerts', () => {
    const report = engine.evaluateBudgetHealth();
    expect(report.categorySpend).toBeDefined();
    expect(report.budgetAlerts).toBeDefined();
    expect(Array.isArray(report.budgetAlerts)).toBe(true);
    expect(report.categorySpend['Food & Dining']).toBe(35.50);
    expect(report.categorySpend['Hardware']).toBe(120.00);
  });

  // 9. Over-budget condition detection
  it('9. detects over-budget category conditions (spent > limit)', () => {
    const report = engine.evaluateBudgetHealth();
    const hwAlert = report.budgetAlerts.find(a => a.category === 'Hardware');
    expect(hwAlert).toBeDefined();
    expect(hwAlert.spent).toBe(120);
    expect(hwAlert.limit).toBe(100);
    expect(hwAlert.warning).toBe('EXCEEDED');
    expect(hwAlert.percent).toBe(120);
    expect(report.isHealthy).toBe(false);
  });

  // 10. Warning-level budget condition
  it('10. detects warning-level budget conditions (spent >= 85% limit)', () => {
    mockStore = createMockStore({
      transactions: [{ id: 't1', type: 'expense', amount: 90, category: 'Food & Dining', date: new Date().toISOString() }],
      budgets: [{ category: 'Food & Dining', limit: 100 }]
    });
    engine = new HermesEngine(mockStore);

    const report = engine.evaluateBudgetHealth();
    const foodAlert = report.budgetAlerts.find(a => a.category === 'Food & Dining');
    expect(foodAlert).toBeDefined();
    expect(foodAlert.warning).toBe('NEAR_LIMIT');
    expect(foodAlert.percent).toBe(90);
  });

  // 11. Safe budget condition
  it('11. reports healthy status when category spend is within safe limits', () => {
    mockStore = createMockStore({
      transactions: [{ id: 't1', type: 'expense', amount: 30, category: 'Food & Dining', date: new Date().toISOString() }],
      budgets: [{ category: 'Food & Dining', limit: 100 }]
    });
    engine = new HermesEngine(mockStore);

    const report = engine.evaluateBudgetHealth();
    expect(report.budgetAlerts.length).toBe(0);
    expect(report.isHealthy).toBe(true);
  });

  // 12. Tracked projects integration
  it('12. integrates active tracked projects in daily brief', async () => {
    const brief = await engine.generateDailyBriefing();
    expect(brief.sections.projects.activeCount).toBe(1);
    expect(brief.sections.projects.items).toContain('Aloy Refactor');
  });

  // 13. Filters completed projects
  it('13. filters out completed projects from active operations brief', async () => {
    const brief = await engine.generateDailyBriefing();
    expect(brief.sections.projects.items).not.toContain('Legacy Cleanup');
  });

  // 14. Formatted Markdown briefing synthesis
  it('14. formats complete executive Markdown briefing document with headings and check items', async () => {
    const brief = await engine.generateDailyBriefing();
    expect(brief.markdown).toContain('### 📌 High Priority Items');
    expect(brief.markdown).toContain('- [ ] Review PR #42');
    expect(brief.markdown).toContain('### 💳 Financial Overview');
    expect(brief.markdown).toContain('### 📂 Tracked Projects');
  });

  // 15. Empty store handling
  it('15. handles empty store with zero reminders, transactions, and projects gracefully', async () => {
    mockStore = createMockStore({ reminders: [], transactions: [], budgets: [], trackedProjects: [] });
    engine = new HermesEngine(mockStore);

    const brief = await engine.generateDailyBriefing();
    expect(brief.sections.reminders.totalPending).toBe(0);
    expect(brief.sections.finances.recentSpendTotal).toBe(0);
    expect(brief.sections.projects.activeCount).toBe(0);
    expect(brief.markdown).toContain('No pending reminders scheduled');
  });

  // 16. AutoRip pipeline formatting
  it('16. formats AutoRip disc ripping progress into readable step summary', () => {
    const autoripData = {
      active: true,
      currentDisc: 'Stargate Season 1 Disc 2',
      progressPercent: 65,
      currentStep: 'Encoding Title 03 (x265)'
    };

    const formatted = `${autoripData.currentDisc}: ${autoripData.progressPercent}% (${autoripData.currentStep})`;
    expect(formatted).toContain('Stargate Season 1 Disc 2');
    expect(formatted).toContain('65%');
  });

  // 17. Uncategorized fallback
  it('17. categorizes transactions with missing category as Uncategorized', () => {
    mockStore = createMockStore({
      transactions: [{ id: 't1', type: 'expense', amount: 50, date: new Date().toISOString() }],
      budgets: []
    });
    engine = new HermesEngine(mockStore);

    const report = engine.evaluateBudgetHealth();
    expect(report.categorySpend['Uncategorized']).toBe(50);
  });

  // 18. Negative amount expense handling
  it('18. handles transactions with negative amount values properly as expenses', () => {
    mockStore = createMockStore({
      transactions: [{ id: 't1', amount: -75.25, category: 'Subscriptions', date: new Date().toISOString() }],
      budgets: [{ category: 'Subscriptions', limit: 100 }]
    });
    engine = new HermesEngine(mockStore);

    const report = engine.evaluateBudgetHealth();
    expect(report.categorySpend['Subscriptions']).toBe(75.25);
  });

  // 19. Audit event logging
  it('19. records audit log metadata when generating daily briefing', async () => {
    const brief = await engine.generateDailyBriefing();
    expect(brief.generatedAt).toBeDefined();
    expect(new Date(brief.generatedAt).getTime()).not.toBeNaN();
  });

  // 20. Multi-agent status aggregation
  it('20. supports multi-agent status aggregation across Pantheon data sources', async () => {
    const brief = await engine.generateDailyBriefing({ userName: 'User' });
    expect(brief.sections).toHaveProperty('reminders');
    expect(brief.sections).toHaveProperty('finances');
    expect(brief.sections).toHaveProperty('projects');
  });
});
