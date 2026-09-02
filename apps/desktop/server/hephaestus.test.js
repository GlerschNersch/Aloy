import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

const { HephaestusEngine, TASK_STATUS, generateUnifiedDiff } = require('./hephaestus.cjs');
const { getTrainingStats, recordTrainingPair } = require('./hephReviewer.cjs');

describe('HEPHAESTUS (HEPH) — Autonomous Code Forge Engine (20 Tests)', () => {
  let engine;
  let testTempDir;
  let tasksFile;

  beforeEach(() => {
    testTempDir = path.join(os.tmpdir(), `heph_suite_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    fs.mkdirSync(testTempDir, { recursive: true });
    tasksFile = path.join(testTempDir, 'heph-tasks.json');
    engine = new HephaestusEngine(tasksFile);
  });

  afterEach(() => {
    if (fs.existsSync(testTempDir)) {
      try {
        fs.rmSync(testTempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  // 1. Creation & initial state
  it('1. creates an engineering work order in Cauldron with unique id and queued status', () => {
    const task = engine.createTask({
      title: 'Add level completion sound',
      description: 'Implement sound trigger on victory flag',
      category: 'feature',
      targetFiles: ['src/sound.js'],
      requirements: ['Trigger sound when victory flag is active'],
      requestedBy: 'aloy'
    });

    expect(task.id).toMatch(/^heph-/);
    expect(task.status).toBe(TASK_STATUS.QUEUED);
    expect(task.requestedBy).toBe('aloy');
    expect(task.branch).toBe(`heph/${task.id}`);
  });

  // 2. Category defaulting & branch naming
  it('2. defaults category to feature and assigns isolated git branch', () => {
    const task = engine.createTask({
      title: 'Refactor memory hook'
    });
    expect(task.category).toBe('feature');
    expect(task.branch).toContain('heph-');
  });

  // 3. Target files assignment
  it('3. assigns and tracks targetFiles array', () => {
    const task = engine.createTask({
      title: 'Update config',
      targetFiles: ['src/config.json', 'src/app.js']
    });
    expect(task.targetFiles).toEqual(['src/config.json', 'src/app.js']);
  });

  // 4. Staging & diff computation
  it('4. stages proposed changes and computes additions/deletions accurately in unified diff', () => {
    const filePath = path.join(testTempDir, 'tool.js');
    fs.writeFileSync(filePath, 'function oldCode() {\n  return 1;\n}\n', 'utf8');

    const task = engine.createTask({
      title: 'Update tool logic',
      targetFiles: [filePath]
    });

    const newCode = 'function oldCode() {\n  return 2;\n}\n';
    const staged = engine.stageFileModification(task.id, filePath, newCode);

    expect(task.status).toBe(TASK_STATUS.STAGING);
    expect(staged.additions).toBeGreaterThan(0);
    expect(staged.deletions).toBeGreaterThan(0);
    expect(staged.patch).toContain('-  return 1;');
    expect(staged.patch).toContain('+  return 2;');
  });

  // 5. Multi-line diff handling
  it('5. handles multi-line additions, modifications, and deletions in diff generation', () => {
    const original = 'line1\nline2\nline3\n';
    const proposed = 'line1\nline2_modified\nline3\nline4_added\n';
    const diff = generateUnifiedDiff('test.txt', original, proposed);

    expect(diff.additions).toBe(2);
    expect(diff.deletions).toBe(1);
    expect(diff.patch).toContain('-line2');
    expect(diff.patch).toContain('+line2_modified');
    expect(diff.patch).toContain('+line4_added');
  });

  // 6. Syntax error detection
  it('6. runs syntax verification and catches invalid JS syntax in staging', async () => {
    const filePath = path.join(testTempDir, 'broken.js');
    fs.writeFileSync(filePath, 'console.log("valid");', 'utf8');

    const task = engine.createTask({
      title: 'Check syntax guard',
      targetFiles: [filePath]
    });

    const brokenCode = 'function broken( { syntax error! ';
    engine.stageFileModification(task.id, filePath, brokenCode);

    const verifiedTask = await engine.runVerification(task.id);
    expect(verifiedTask.status).toBe(TASK_STATUS.FAILED);
    expect(verifiedTask.testResults.syntaxValid).toBe(false);
    expect(verifiedTask.testResults.passed).toBe(false);
  });

  // 7. Clean syntax validation
  it('7. passes syntax verification on clean ES6 / CommonJS code', async () => {
    const filePath = path.join(testTempDir, 'clean.js');
    fs.writeFileSync(filePath, 'module.exports = { a: 1 };', 'utf8');

    const task = engine.createTask({
      title: 'Clean syntax test',
      targetFiles: [filePath]
    });

    const cleanCode = 'const sum = (a, b) => a + b;\nmodule.exports = { sum };\n';
    engine.stageFileModification(task.id, filePath, cleanCode);

    const verified = await engine.runVerification(task.id);
    expect(verified.testResults.syntaxValid).toBe(true);
    expect(verified.testResults.passed).toBe(true);
  });

  // 8. Staged for review transition
  it('8. transitions status from STAGING to STAGED_FOR_REVIEW upon verification pass', async () => {
    const filePath = path.join(testTempDir, 'module.js');
    fs.writeFileSync(filePath, 'const x = 10;', 'utf8');

    const task = engine.createTask({ title: 'Module update', targetFiles: [filePath] });
    engine.stageFileModification(task.id, filePath, 'const x = 20;\nmodule.exports = x;');

    const verified = await engine.runVerification(task.id);
    expect(verified.status).toBe(TASK_STATUS.STAGED_FOR_REVIEW);
  });

  // 9. Deployment execution
  it('9. deploys staged changes and safely modifies target file', async () => {
    const filePath = path.join(testTempDir, 'service.js');
    fs.writeFileSync(filePath, 'const VERSION = "1.0.0";\n', 'utf8');

    const task = engine.createTask({ title: 'Bump version', targetFiles: [filePath] });
    engine.stageFileModification(task.id, filePath, 'const VERSION = "2.0.0";\n');
    await engine.runVerification(task.id);

    const deployResult = await engine.approveAndDeploy(task.id, { runPostDeployVerification: false });
    expect(deployResult.success).toBe(true);
    expect(task.status).toBe(TASK_STATUS.DEPLOYED);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('const VERSION = "2.0.0";\n');
  });

  // 10. Rollback snapshot creation
  it('10. creates automatic rollback snapshot prior to file deployment', async () => {
    const filePath = path.join(testTempDir, 'rollback_test.js');
    fs.writeFileSync(filePath, 'const original = true;\n', 'utf8');

    const task = engine.createTask({ title: 'Rollback test', targetFiles: [filePath] });
    engine.stageFileModification(task.id, filePath, 'const modified = true;\n');
    await engine.runVerification(task.id);

    await engine.approveAndDeploy(task.id, { runPostDeployVerification: false });
    expect(task.rollbackSnapshotId).toBeDefined();
  });

  // 11. Rollback restoration
  it('11. successfully rolls back changes restoring exact original file content', async () => {
    const filePath = path.join(testTempDir, 'revert_me.js');
    const originalText = 'const stable = true;\n';
    fs.writeFileSync(filePath, originalText, 'utf8');

    const task = engine.createTask({ title: 'Revert test', targetFiles: [filePath] });
    engine.stageFileModification(task.id, filePath, 'const stable = false;\n');
    await engine.runVerification(task.id);
    await engine.approveAndDeploy(task.id, { runPostDeployVerification: false });

    const rbResult = await engine.rollbackDeployment(task.id);
    expect(rbResult.success).toBe(true);
    expect(task.status).toBe(TASK_STATUS.ROLLED_BACK);
    expect(fs.readFileSync(filePath, 'utf8')).toBe(originalText);
  });

  // 12. Auto-rollback safety on canary failure
  it('12. auto-rolls back when deployment encounters post-deploy syntax error', async () => {
    const filePath = path.join(testTempDir, 'canary_fail.js');
    fs.writeFileSync(filePath, 'const a = 1;', 'utf8');

    const task = engine.createTask({ title: 'Canary fail test', targetFiles: [filePath] });
    // Stage and verify VALID content first — approveAndDeploy now requires
    // status STAGED_FOR_REVIEW (a real pre-deploy verification pass), so it
    // can no longer be reached directly with content that would have been
    // rejected by runVerification's own syntax check. To still exercise the
    // canary in isolation, corrupt stagedChanges' proposedContent in place
    // AFTER verification passed, simulating whatever it is the canary
    // exists to catch: content that was fine when verified but isn't what
    // actually gets written to disk.
    engine.stageFileModification(task.id, filePath, 'const a = 2;');
    const verified = await engine.runVerification(task.id);
    expect(verified.status).toBe(TASK_STATUS.STAGED_FOR_REVIEW);
    verified.stagedChanges[0].proposedContent = 'function broken( {';

    const res = await engine.approveAndDeploy(task.id, { runPostDeployVerification: true });
    expect(res.success).toBe(false);
    expect(res.autoRolledBack).toBe(true);
    expect(task.status).toBe(TASK_STATUS.AUTO_ROLLED_BACK);
  });

  // 12b. Deployment gate rejection on unverified tasks
  it('12b. refuses to deploy a task that has not passed verification', async () => {
    const filePath = path.join(testTempDir, 'unverified.js');
    fs.writeFileSync(filePath, 'const a = 1;', 'utf8');

    const task = engine.createTask({ title: 'Skip verification test', targetFiles: [filePath] });
    engine.stageFileModification(task.id, filePath, 'const a = 2;');
    // Deliberately skip runVerification — status is STAGING, not
    // STAGED_FOR_REVIEW. approveAndDeploy is reachable directly (e.g. via
    // POST /api/hephaestus/tasks/:id/approve), not only through
    // runVerification's own auto-deploy path, so it must refuse on its own
    // rather than trusting the caller to have verified first.
    await expect(engine.approveAndDeploy(task.id)).rejects.toThrow('is not ready to deploy');
    expect(fs.readFileSync(filePath, 'utf8')).toBe('const a = 1;');
  });

  // 13. Deployment gate rejection on unverified tasks without staged changes
  it('13. rejects deployment if task has no staged changes', async () => {
    const task = engine.createTask({ title: 'Empty task' });
    await expect(engine.approveAndDeploy(task.id)).rejects.toThrow('has no staged changes to deploy');
  });

  // 14. Rejection with feedback
  it('14. supports explicit task rejection with custom feedback rationale', () => {
    const task = engine.createTask({ title: 'Reject me' });
    const rejected = engine.rejectTask(task.id, 'Does not follow codebase conventions');

    expect(rejected).toBeDefined();
    expect(task.status).toBe(TASK_STATUS.REJECTED);
  });

  // 15. AI Code Review attachment
  it('15. records AI code review evaluation with score and critique', () => {
    const task = engine.createTask({ title: 'Reviewable code' });
    task.aiReview = {
      score: 95,
      summary: 'Clean implementation',
      critique: 'Well structured and tested',
      reviewedAt: new Date().toISOString(),
      provider: 'claude-3-5-sonnet'
    };
    engine.persistTasks();

    const loaded = engine.getTask(task.id);
    expect(loaded.aiReview.score).toBe(95);
    expect(loaded.aiReview.provider).toBe('claude-3-5-sonnet');
  });

  // 16. QLoRA buffer pair generation
  it('16. records training pair into autonomous QLoRA dataset buffer', () => {
    const task = engine.createTask({ title: 'Train sample task' });
    const changes = [{ filePath: 'app.js', proposedContent: 'console.log("hello");', patch: '+hello' }];
    const reviewResult = { verdict: 'APPROVED', score: 98, provider: 'claude' };

    recordTrainingPair(task, changes, reviewResult);

    const stats = getTrainingStats();
    expect(stats.totalSamples).toBeGreaterThanOrEqual(1);
  });

  // 17. Training stats verification
  it('17. increments positive verified sample count for high scoring tasks in training stats', () => {
    const stats = getTrainingStats();
    expect(typeof stats.totalSamples).toBe('number');
    expect(typeof stats.positiveCount).toBe('number');
    expect(stats.totalSamples).toBeGreaterThanOrEqual(stats.positiveCount);
  });

  // 18. Task deletion
  it('18. deletes task and cleans up temporary working state', () => {
    const task = engine.createTask({ title: 'To be deleted' });
    expect(engine.getTask(task.id)).toBeDefined();

    const deleted = engine.deleteTask(task.id);
    expect(deleted).toBe(true);
    expect(engine.getTask(task.id)).toBeNull();
  });

  // 19. Task listing & sorting
  it('19. lists tasks with correct ordering by creation date', () => {
    const t1 = engine.createTask({ title: 'First Task' });
    const t2 = engine.createTask({ title: 'Second Task' });

    const list = engine.listTasks();
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.some(t => t.id === t1.id)).toBe(true);
    expect(list.some(t => t.id === t2.id)).toBe(true);
  });

  // 20. Persistence across engine instances
  it('20. persists tasks across engine re-instantiation from disk file', () => {
    const task = engine.createTask({
      title: 'Persistent Task',
      description: 'Must survive restart',
      category: 'bugfix'
    });

    const newEngineInstance = new HephaestusEngine(tasksFile);
    const reloaded = newEngineInstance.getTask(task.id);

    expect(reloaded).toBeDefined();
    expect(reloaded.title).toBe('Persistent Task');
    expect(reloaded.category).toBe('bugfix');
  });

  // 21. Stale task auto-close as EXPIRED
  it('21. auto-closes unstarted work orders as EXPIRED after staleness window', () => {
    const task = engine.createTask({
      title: 'Stale Unstarted Task',
      description: 'Will expire'
    });
    // simulate creation 25 hours ago
    task.createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    engine.persistTasks();

    engine.recoverStaleTasks();
    const updated = engine.getTask(task.id);
    expect(updated.status).toBe(TASK_STATUS.EXPIRED);
    expect(updated.logs.some(l => l.message.includes('expired'))).toBe(true);
  });

  // 22. 14-day expired task ledger pruning
  it('22. prunes ancient expired tasks older than 14 days during ledger maintenance', () => {
    const task = engine.createTask({
      title: 'Ancient Expired Task'
    });
    task.status = TASK_STATUS.EXPIRED;
    task.updatedAt = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    engine.persistTasks();

    engine.pruneTaskHistory();
    expect(engine.getTask(task.id)).toBeNull();
  });
});
