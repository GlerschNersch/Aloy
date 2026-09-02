import { describe, it, expect, beforeEach, afterEach } from 'vitest';
const { SidecarWatchdog } = require('./sidecarWatchdog.cjs');

describe('SidecarWatchdog — Autonomous Resilience & Self-Healing Daemon', () => {
  let watchdog;

  beforeEach(() => {
    watchdog = new SidecarWatchdog({
      checkIntervalMs: 1000,
      baseBackoffMs: 100,
      maxBackoffMs: 2000
    });
  });

  afterEach(() => {
    watchdog.stop();
  });

  it('initializes tracking state for all required sidecars and models', () => {
    const status = watchdog.getStatus();
    expect(status.state.mindwalk).toBeDefined();
    expect(status.state.mediaDriveP).toBeDefined();
    expect(status.state.anthropicApiKey).toBeDefined();
    expect(status.state.geminiApiKey).toBeDefined();
    expect(status.state.claudeModel).toBeDefined();
    expect(status.state.geminiModel).toBeDefined();
  });

  it('calculates progressive exponential backoff correctly', () => {
    expect(watchdog.calculateBackoff(0)).toBe(100);
    expect(watchdog.calculateBackoff(1)).toBe(100);
    expect(watchdog.calculateBackoff(2)).toBe(200);
    expect(watchdog.calculateBackoff(3)).toBe(400);
    expect(watchdog.calculateBackoff(4)).toBe(800);
    expect(watchdog.calculateBackoff(10)).toBe(2000);
  });

  it('detects media drive state and recovers cleanly on pass', async () => {
    await watchdog.runWatchdogPass();
    const status = watchdog.getStatus();
    expect(['mounted', 'unmounted']).toContain(status.state.mediaDriveP.status);
  });
});
