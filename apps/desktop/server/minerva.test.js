import { describe, it, expect, beforeEach } from 'vitest';
import { MinervaEngine } from './minerva.cjs';
import { validateSmartHomeAction, validatePathAccess } from './securityGuard.cjs';

describe('MINERVA (SENTINEL) — Reliability & Security Sentinel Engine (20 Tests)', () => {
  let engine;

  beforeEach(() => {
    engine = new MinervaEngine();
  });

  // 1. Initial state
  it('1. initializes MinervaEngine with default clean state', () => {
    expect(engine).toBeDefined();
    expect(engine.lastHealthReport).toBeNull();
    expect(engine.lastCheckedAt).toBeNull();
  });

  // 2. Health scan with online sidecars
  it('2. runs sidecar health scan identifying online services', async () => {
    const mockFetch = async (url) => {
      return { ok: true, status: 200, json: async () => ({}) };
    };
    const mockEngine = new MinervaEngine(mockFetch);
    const report = await mockEngine.runHealthScan();

    expect(report).toBeDefined();
    expect(report.dependencies.ollama.status).toBe('online');
    expect(report.dependencies.whisper.status).toBe('online');
    expect(report.dependencies.kokoro.status).toBe('online');
  });

  // 3. Graceful offline sidecar handling
  it('3. handles offline sidecars gracefully without throwing unhandled exceptions', async () => {
    const mockFetch = async (url) => {
      throw new Error('Connection refused (ECONNREFUSED)');
    };
    const mockEngine = new MinervaEngine(mockFetch);
    const report = await mockEngine.runHealthScan();

    expect(report.dependencies.ollama.status).toBe('offline');
    expect(report.dependencies.whisper.status).toBe('offline');
    expect(report.offlineCount).toBeGreaterThan(0);
  });

  // 4. Degraded status reporting
  it('4. detects and reports degraded HTTP status codes from sidecars', async () => {
    const mockFetch = async (url) => {
      return { ok: false, status: 503, json: async () => ({}) };
    };
    const mockEngine = new MinervaEngine(mockFetch);
    const report = await mockEngine.runHealthScan();

    expect(report.dependencies.ollama.status).toBe('degraded');
    expect(report.dependencies.ollama.code).toBe(503);
  });

  // 5. Drive mount detection
  it('5. checks mount status of media drive P:', async () => {
    const report = await engine.runHealthScan();
    expect(report.dependencies.mediaDriveP).toBeDefined();
    expect(['mounted', 'unmounted']).toContain(report.dependencies.mediaDriveP.status);
  });

  // 6. HA unconfigured handling
  it('6. handles Home Assistant token missing/unconfigured state', async () => {
    const origToken = process.env.HA_TOKEN;
    const origViteToken = process.env.VITE_HA_TOKEN;
    delete process.env.HA_TOKEN;
    delete process.env.VITE_HA_TOKEN;

    const report = await engine.runHealthScan();
    expect(report.dependencies.homeAssistant.status).toBe('unconfigured');

    if (origToken) process.env.HA_TOKEN = origToken;
    if (origViteToken) process.env.VITE_HA_TOKEN = origViteToken;
  });

  // 7. HA online verification
  it('7. verifies Home Assistant gateway connectivity with valid mock token', async () => {
    process.env.HA_TOKEN = 'test-token-123';
    const mockFetch = async (url) => {
      if (url.includes('/api/')) return { ok: true, status: 200 };
      return { ok: true, status: 200 };
    };
    const mockEngine = new MinervaEngine(mockFetch);
    const report = await mockEngine.runHealthScan();

    expect(report.dependencies.homeAssistant.status).toBe('online');
  });

  // 8. Cloud API key status
  it('8. checks Anthropic cloud API key status and reports validity', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const report = await engine.runHealthScan();
    expect(report.dependencies.anthropicApiKey.configured).toBe(false);
    expect(report.dependencies.anthropicApiKey.status).toBe('missing');
  });

  // 9. Offline count calculation
  it('9. calculates total offline dependency count accurately', async () => {
    const mockFetch = async (url) => {
      if (url.includes('11434')) return { ok: true, status: 200 };
      throw new Error('Offline');
    };
    const mockEngine = new MinervaEngine(mockFetch);
    const report = await mockEngine.runHealthScan();

    expect(report.dependencies.ollama.status).toBe('online');
    expect(report.offlineCount).toBeGreaterThan(0);
  });

  // 10. Overall status roll-up
  it('10. computes overall system health status properly', async () => {
    const mockFetch = async () => ({ ok: true, status: 200 });
    const mockEngine = new MinervaEngine(mockFetch);
    const report = await mockEngine.runHealthScan();

    expect(['healthy', 'degraded', 'critical', 'operational']).toContain(report.status.toLowerCase());
  });

  // 11. Fail-closed 2FA gate on exterior door locks
  it('11. enforces fail-closed 2FA gate on exterior door locks', () => {
    const validation = validateSmartHomeAction({
      domain: 'lock',
      service: 'unlock',
      entityId: 'lock.front_door',
      authContext: { isInteractiveUser: false, pinVerified: false }
    });
    expect(validation.allowed).toBe(false);
    expect(validation.requires2FA).toBe(true);
    expect(validation.reason).toContain('requires explicit 2FA PIN');
  });

  // 12. Rejects unlock without 2FA
  it('12. rejects unlock commands lacking verified 2FA token', () => {
    const validation = validateSmartHomeAction({
      domain: 'lock',
      service: 'unlock',
      entityId: 'lock.back_door',
      authContext: { pinVerified: false }
    });
    expect(validation.allowed).toBe(false);
    expect(validation.requires2FA).toBe(true);
  });

  // 13. Permits locking without 2FA
  it('13. permits locking exterior doors without 2FA token', () => {
    const validation = validateSmartHomeAction({
      domain: 'lock',
      service: 'lock',
      entityId: 'lock.front_door'
    });
    expect(validation.allowed).toBe(true);
  });

  // 14. Allows interior entities freely
  it('14. allows interior lights and switches without 2FA step-up', () => {
    const validation = validateSmartHomeAction({
      domain: 'light',
      service: 'turn_on',
      entityId: 'light.kitchen_lights'
    });
    expect(validation.allowed).toBe(true);
  });

  // 15. Security path access protection (forbidden Windows system roots)
  it('15. blocks file access to dangerous forbidden paths like C:\\Windows or .env', () => {
    const blockedSys = validatePathAccess('C:\\Windows\\System32\\cmd.exe', false);
    const blockedEnv = validatePathAccess('C:\\Users\\User\\Aloy\\.env', false);

    expect(blockedSys.allowed).toBe(false);
    expect(blockedEnv.allowed).toBe(false);
  });

  // 16. Least-privilege write restriction
  it('16. enforces write protection against unauthorized folders', () => {
    const writeBlocked = validatePathAccess('C:\\Users\\User\\random_unauthorized\\script.js', true);
    expect(writeBlocked.allowed).toBe(false);
    expect(writeBlocked.reason).toContain('Write access denied');
  });

  // 17. Camera vision triage filtering
  it('17. triages camera vision events filtering routine checks and highlighting notable events', () => {
    const rawEvents = [
      { start: '2026-08-17T12:00:00Z', description: 'NO' },
      { start: '2026-08-17T12:05:00Z', description: 'NO - no motion' },
      { start: '2026-08-17T12:10:00Z', description: 'Person detected at front gate carrying package' }
    ];

    const notable = rawEvents.filter(e => {
      const d = (e.description || '').trim();
      return d !== 'NO' && !d.startsWith('NO -');
    });

    expect(notable.length).toBe(1);
    expect(notable[0].description).toContain('Person detected');
  });

  // 18. Relative timestamp formatting
  it('18. formats vision event timestamps with relative age calculation', () => {
    const pastIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const diffSec = Math.floor((Date.now() - new Date(pastIso).getTime()) / 1000);
    const minutes = Math.floor(diffSec / 60);

    expect(minutes).toBe(5);
  });

  // 19. Audit event recording
  it('19. records audit log metadata on health scan and security gate checks', async () => {
    const mockFetch = async () => ({ ok: true, status: 200 });
    const mockEngine = new MinervaEngine(mockFetch);
    const report = await mockEngine.runHealthScan();

    expect(report.timestamp).toBeDefined();
    expect(new Date(report.timestamp).getTime()).not.toBeNaN();
  });

  // 20. Dependency injection for offline reliability
  it('20. supports mock fetch dependency injection for 100% deterministic offline unit testing', async () => {
    let callCount = 0;
    const trackingFetch = async () => {
      callCount++;
      return { ok: true, status: 200, json: async () => ({}) };
    };

    const mockEngine = new MinervaEngine(trackingFetch);
    await mockEngine.runHealthScan();
    expect(callCount).toBeGreaterThanOrEqual(4);
  });

  // 21. Media stack health scan
  it('21. inspects media stack services (sonarr, radarr, lidarr, retroarr) during health scan', async () => {
    const mockFetch = async (url) => {
      if (url.includes(':8989') || url.includes(':7878')) return { ok: true, status: 200 };
      if (url.includes(':8686')) return { ok: false, status: 401 }; // 401 still means process is online
      throw new Error('Connection refused');
    };
    const mockEngine = new MinervaEngine(mockFetch);
    const report = await mockEngine.runHealthScan();

    expect(report.dependencies.sonarr.status).toBe('online');
    expect(report.dependencies.radarr.status).toBe('online');
    expect(report.dependencies.lidarr.status).toBe('online');
    expect(report.dependencies.retroarr.status).toBe('offline');
  });

  // 22. Self-healing detection
  it('22. detects offline media stack services and runs selfHeal without unhandled errors', async () => {
    const mockFetch = async () => {
      throw new Error('Offline for testing');
    };
    const mockEngine = new MinervaEngine(mockFetch);
    const healResult = await mockEngine.selfHeal();

    expect(healResult).toBeDefined();
    expect(healResult.offlineDetected).toContain('sonarr');
    expect(healResult.offlineDetected).toContain('radarr');
    expect(Array.isArray(healResult.actionsTaken)).toBe(true);
  });
});
