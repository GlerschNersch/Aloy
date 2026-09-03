import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// store.cjs reads ALLOWED_STORE_DIR-equivalent (ALOY_STORE_DIR) at module
// load time from a module-level const, so each test gets a fresh require
// after pointing the env var at a throwaway directory — never touch the
// real ~/.aloy-server from this suite.
function freshStore(dir) {
  process.env.ALOY_STORE_DIR = dir;
  const resolved = require.resolve('./store.cjs');
  delete require.cache[resolved];
  return require('./store.cjs');
}

describe('store.cjs — save() merge safety (4 Tests)', () => {
  let tmpDir;
  let store;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aloy-store-test-'));
    store = freshStore(tmpDir);
  });

  afterEach(() => {
    delete process.env.ALOY_STORE_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // 1. The actual regression: a bare partial save must not wipe unrelated
  // fields. Root cause found 2026-09-02 — 19 call sites across 7 files
  // (agentArena.cjs, hermesGateway.cjs, sparcLifecycle.cjs, etc.) all call
  // `store.save({ oneField: ... })`, and the old save() did a raw
  // atomicSaveJson(STORE_PATH, store) — whatever was passed became the
  // ENTIRE file. Live store.json was found reduced to a single field
  // (arenaStrategies), with chats/memories/reminders/userProfile/everything
  // else gone, and both rolling backups already corrupted the same way.
  it('1. a partial save() does not wipe unrelated fields already on disk', () => {
    store.save({ chats: [{ id: 'c1', title: 'first chat' }] });
    store.save({ memories: ['likes dark mode'] });
    // The bug: this used to wipe `chats` entirely.
    store.save({ arenaStrategies: [{ id: 'strat-1' }] });

    const final = store.load();
    expect(final.chats).toEqual([{ id: 'c1', title: 'first chat' }]);
    expect(final.memories).toEqual(['likes dark mode']);
    expect(final.arenaStrategies).toEqual([{ id: 'strat-1' }]);
  });

  // 2. A save() call still correctly replaces the field it targets (merge,
  // not a no-op / union of arrays).
  it('2. save() replaces the targeted field rather than appending to it', () => {
    store.save({ reminders: [{ id: 'r1' }, { id: 'r2' }] });
    store.save({ reminders: [{ id: 'r3' }] });

    expect(store.load().reminders).toEqual([{ id: 'r3' }]);
  });

  // 3. userProfile specifically — the field whose silent loss this whole
  // investigation started from (a stale "Good afternoon, User" dashboard
  // greeting that turned out to be real data loss, not a display bug).
  it('3. a userProfile save survives an unrelated subsequent partial save', () => {
    store.save({ userProfile: { name: 'Matt Vincent', style: 'concise' } });
    store.save({ sparcWorkflows: [{ id: 'w1' }] });

    expect(store.load().userProfile).toEqual({ name: 'Matt Vincent', style: 'concise' });
  });

  // 4. load() still backfills any field absent from disk with its
  // DEFAULT_STORE value — merge-safety in save() shouldn't change read
  // behavior for a brand-new/partially-populated store.
  it('4. load() backfills unset fields from DEFAULT_STORE', () => {
    store.save({ chats: [{ id: 'only-chats' }] });

    const loaded = store.load();
    expect(loaded.chats).toEqual([{ id: 'only-chats' }]);
    expect(loaded.reminders).toEqual([]);
    expect(loaded.userProfile).toEqual({
      name: 'User',
      style: 'Concise, direct, highly technical, clean code, dark UI aesthetics.',
      instructions: 'Always address requests directly with production-ready code and optimal architecture.',
      checkInsEnabled: true
    });
  });
});
