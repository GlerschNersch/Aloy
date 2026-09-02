// MINERVA — Smart Home Sentinel & Autonomous Infrastructure Watchdog.
// Monitors system health, Home Assistant topology, security anomalies,
// and manages scheduled device triggers and alerting.
// NOTE: All Smart Home executions MUST route through /api/smarthome/execute
// to enforce securityGuard validation and 2FA authentication.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { logAuditEvent, getRecentAuditLogs } = require('./auditLogger.cjs');
const { getOrCreateToken } = require('./auth.cjs');

// Ensure credentials (.env) are loaded into process.env
const EXTERNAL_ENV_PATH = path.join(os.homedir(), '.aloy-server', '.env');
try {
  process.loadEnvFile(EXTERNAL_ENV_PATH);
} catch {
  try {
    process.loadEnvFile(path.join(__dirname, '..', '.env'));
  } catch {}
}

let tlsDispatcher = null;
try {
  const { Agent } = require('undici');
  tlsDispatcher = new Agent({ connect: { rejectUnauthorized: false } });
} catch {}

const MEDIA_STACK_CONFIG = {
  sonarr: { name: 'Sonarr', url: 'http://127.0.0.1:8989/api/v3/system/status', port: 8989, exe: path.join(os.homedir(), 'MediaStack', 'Sonarr', 'Sonarr.exe'), args: ['--data=C:\\ProgramData\\Sonarr', '--nobrowser'] },
  radarr: { name: 'Radarr', url: 'http://127.0.0.1:7878/api/v3/system/status', port: 7878, exe: path.join(os.homedir(), 'MediaStack', 'Radarr', 'Radarr.exe'), args: ['--data=C:\\ProgramData\\Radarr', '--nobrowser'] },
  lidarr: { name: 'Lidarr', url: 'http://127.0.0.1:8686/api/v1/system/status', port: 8686, exe: path.join(os.homedir(), 'MediaStack', 'Lidarr', 'Lidarr.exe'), args: ['--data=C:\\ProgramData\\Lidarr', '--nobrowser'] },
  retroarr: { name: 'RetroArr', url: 'http://127.0.0.1:5002/api/v3/system/status', port: 5002, exe: path.join(os.homedir(), 'MediaStack', 'RetroArr', 'RetroArr.Host.exe'), args: [] },
  prowlarr: { name: 'Prowlarr', url: 'http://127.0.0.1:9696/api/v1/system/status', port: 9696, exe: path.join(os.homedir(), 'MediaStack', 'Prowlarr', 'Prowlarr.exe'), args: ['--data=C:\\ProgramData\\Prowlarr', '--nobrowser'] },
  sabnzbd: { name: 'SABnzbd', url: 'http://127.0.0.1:8080/api?mode=version', port: 8080, exe: 'C:\\Program Files\\SABnzbd\\SABnzbd.exe', args: ['-b', '0'] }
};

class MinervaEngine {
  constructor(fetchImpl = null) {
    this.fetch = fetchImpl || globalThis.fetch;
    this.lastHealthReport = null;
    this.lastCheckedAt = null;
  }

  /**
   * Runs an infrastructure health scan across all local sidecars, HA gateway, and external keys.
   */
  async runHealthScan() {
    const checks = {};
    const serverToken = getOrCreateToken ? getOrCreateToken() : '';
    const sidecarHeaders = serverToken ? { Authorization: `Bearer ${serverToken}` } : {};

    // 1. Ollama
    try {
      const oRes = await this.fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(2000) });
      checks.ollama = { status: oRes.ok ? 'online' : 'degraded', code: oRes.status };
    } catch (err) {
      checks.ollama = { status: 'offline', error: err.message };
    }

    // 2. Whisper STT
    try {
      const wRes = await this.fetch('http://127.0.0.1:8890/health', {
        headers: sidecarHeaders,
        signal: AbortSignal.timeout(1500)
      });
      checks.whisper = { status: wRes.ok ? 'online' : 'degraded', code: wRes.status };
    } catch (err) {
      checks.whisper = { status: 'offline', error: err.message };
    }

    // 3. Kokoro TTS (requires Bearer token authentication)
    try {
      const kRes = await this.fetch('http://127.0.0.1:8888/voices', {
        headers: sidecarHeaders,
        signal: AbortSignal.timeout(1500)
      });
      checks.kokoro = { status: kRes.ok ? 'online' : 'degraded', code: kRes.status };
    } catch (err) {
      checks.kokoro = { status: 'offline', error: err.message };
    }

    // 4. Jellyfin Media
    try {
      const jRes = await this.fetch('http://127.0.0.1:8096/System/Info/Public', { signal: AbortSignal.timeout(1500) });
      checks.jellyfin = { status: jRes.ok ? 'online' : 'degraded', code: jRes.status };
    } catch (err) {
      checks.jellyfin = { status: 'offline', error: err.message };
    }

    // 5. Mindwalk 3D Code Explorer
    try {
      const mRes = await this.fetch('http://127.0.0.1:8765', { signal: AbortSignal.timeout(1500) });
      checks.mindwalk = { status: mRes.ok ? 'online' : 'degraded', code: mRes.status };
    } catch (err) {
      checks.mindwalk = { status: 'offline', error: err.message };
    }

    // 5b. Media Stack Infrastructure Services (Sonarr, Radarr, Lidarr, RetroArr, Prowlarr, SABnzbd)
    for (const [key, cfg] of Object.entries(MEDIA_STACK_CONFIG)) {
      try {
        const res = await this.fetch(cfg.url, { signal: AbortSignal.timeout(1500) });
        checks[key] = { status: (res.ok || res.status === 401) ? 'online' : 'degraded', code: res.status, port: cfg.port, name: cfg.name };
      } catch (err) {
        checks[key] = { status: 'offline', error: err.message, port: cfg.port, name: cfg.name };
      }
    }

    // 6. Home Assistant Gateway
    try {
      const haUrl = process.env.HA_URL || 'http://localhost:8123';
      const haToken = process.env.HA_TOKEN || process.env.VITE_HA_TOKEN;
      if (!haToken) {
        checks.homeAssistant = { status: 'unconfigured', warning: 'HA_TOKEN / VITE_HA_TOKEN missing' };
      } else {
        const fetchOpts = {
          headers: { Authorization: `Bearer ${haToken}` },
          signal: AbortSignal.timeout(3000)
        };
        if (tlsDispatcher) fetchOpts.dispatcher = tlsDispatcher;
        const haRes = await this.fetch(`${haUrl}/api/`, fetchOpts);
        checks.homeAssistant = { status: haRes.ok ? 'online' : 'degraded', code: haRes.status };
      }
    } catch (err) {
      checks.homeAssistant = { status: 'offline', error: err.message };
    }

    // 7. Media & Staging Drive
    checks.mediaDriveP = { status: fs.existsSync('P:\\') ? 'mounted' : 'unmounted', path: 'P:\\' };

    // 8. Cloud Model Keys
    try {
      const aKey = process.env.ANTHROPIC_API_KEY;
      if (!aKey) {
        checks.anthropicApiKey = { configured: false, status: 'missing' };
      } else {
        const aRes = await this.fetch('https://api.anthropic.com/v1/models', {
          headers: { 'x-api-key': aKey, 'anthropic-version': '2023-06-01' },
          signal: AbortSignal.timeout(3000)
        });
        if (aRes.ok) {
          checks.anthropicApiKey = { configured: true, status: 'valid', code: 200 };
        } else if (aRes.status === 401) {
          checks.anthropicApiKey = { configured: true, status: 'invalid_key', error: 'Unauthorized (401)' };
        } else {
          checks.anthropicApiKey = { configured: true, status: 'degraded', code: aRes.status };
        }
      }
    } catch (err) {
      checks.anthropicApiKey = { configured: true, status: 'unreachable', error: err.message };
    }

    try {
      const gKey = process.env.GEMINI_API_KEY;
      if (!gKey) {
        checks.geminiApiKey = { configured: false, status: 'missing' };
      } else {
        const gRes = await this.fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${gKey}`, {
          signal: AbortSignal.timeout(3000)
        });
        if (gRes.ok) {
          checks.geminiApiKey = { configured: true, status: 'valid', code: 200 };
        } else {
          checks.geminiApiKey = { configured: true, status: 'invalid_key', error: `HTTP ${gRes.status}` };
        }
      }
    } catch (err) {
      checks.geminiApiKey = { configured: true, status: 'unreachable', error: err.message };
    }

    // 9. Configured MODEL IDs actually exist on the account.
    //
    // A valid API key with a wrong model name is the nastiest failure in this
    // system: every request 404s inside a catch block, the feature silently
    // stops working, and nothing anywhere says so. It has already happened
    // twice here — a `claude-opus-5` ID in the escalation path, and a
    // `gemini-3.6-flash` ID in the verification path that ran alongside six
    // call sites using 2.5. Checking the IDs, not just the keys, makes it loud.
    try {
      const { verifyCloudModels } = require('./models.cjs');
      const models = await verifyCloudModels({ fetchImpl: this.fetch });
      checks.claudeModel = models.claude?.ok
        ? { status: 'valid', model: models.claude.model }
        : { status: 'invalid_key', model: models.claude?.model, error: models.claude?.error };
      checks.geminiModel = models.gemini?.ok
        ? { status: 'valid', model: models.gemini.model }
        : { status: 'invalid_key', model: models.gemini?.model, error: models.gemini?.error };
    } catch (err) {
      checks.claudeModel = { status: 'degraded', error: err.message };
      checks.geminiModel = { status: 'degraded', error: err.message };
    }

    const offlineServices = Object.entries(checks)
      .filter(([_, info]) => info.status === 'offline' || info.status === 'unmounted' || info.status === 'invalid_key')
      .map(([name]) => name);

    const report = {
      status: offlineServices.length === 0 ? 'healthy' : 'degraded',
      offlineCount: offlineServices.length,
      offlineServices,
      timestamp: new Date().toISOString(),
      dependencies: checks
    };

    this.lastHealthReport = report;
    this.lastCheckedAt = report.timestamp;

    logAuditEvent({
      action: 'minerva_health_scan',
      source: 'minerva',
      details: { status: report.status, offlineCount: report.offlineCount }
    });

    return report;
  }

  /**
   * Dispatches a webhook alert to Discord or registered endpoint.
   */
  async dispatchAlert({ title = 'Minerva Sentinel Alert', message, severity = 'warning' }) {
    if (!message) throw new Error('Message is required');
    const webhookUrl = process.env.DISCORD_ALERT_WEBHOOK;
    
    logAuditEvent({
      action: 'minerva_alert_dispatched',
      source: 'minerva',
      details: { title, severity, message: message.slice(0, 100) }
    });

    if (!webhookUrl) {
      return { forwarded: false, reason: 'No webhook configured in DISCORD_ALERT_WEBHOOK' };
    }

    try {
      const res = await this.fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: `🚨 **[${severity.toUpperCase()}] ${title}**\n${message}`
        })
      });
      return { forwarded: res.ok, status: res.status };
    } catch (err) {
      return { forwarded: false, error: err.message };
    }
  }

  /**
   * Summarizes recent security-relevant audit events for a glanceable
   * "has anything actually tried to attack this system" widget — distinct
   * from runHealthScan's infra-uptime checks. Pulls two categories Minerva
   * doesn't otherwise touch: Hephaestus reviewer prompt-injection detections
   * (category 'security', logged by hephReviewer.cjs's reviewCodeChangeWithAI
   * whenever injectionAttemptDetected fires, Claude/Gemini/local-heuristic
   * path alike) and securityGuard.cjs's filesystem write/read denials
   * (category 'filesystem', status 'denied' — an unfenced path attempt, not
   * necessarily malicious, but worth the same visibility). Detection and
   * blocking already happened by the time an event reaches the audit log;
   * this is purely visibility into a pattern that would otherwise sit
   * unnoticed in a JSONL file, not a new defense.
   */
  getSecurityStats({ windowMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
    const cutoff = Date.now() - windowMs;
    const withinWindow = (entries) => entries.filter((e) => {
      const t = new Date(e.timestamp).getTime();
      return Number.isFinite(t) && t >= cutoff;
    });

    const injectionAttempts = withinWindow(
      getRecentAuditLogs({ limit: 500, category: 'security', status: 'denied' })
    );
    const blockedAccessAttempts = withinWindow(
      getRecentAuditLogs({ limit: 500, category: 'filesystem', status: 'denied' })
    );

    const events = [...injectionAttempts, ...blockedAccessAttempts]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return {
      count: events.length,
      injectionAttemptCount: injectionAttempts.length,
      blockedAccessCount: blockedAccessAttempts.length,
      lastAt: events.length ? events[0].timestamp : null,
      windowDays: Math.round(windowMs / (24 * 60 * 60 * 1000)),
      recent: events.slice(0, 10)
    };
  }

  // DELIBERATELY ABSENT: callHaService().
  //
  // This method has now been removed twice. It executed an arbitrary Home
  // Assistant domain.service with an arbitrary payload and NO call to
  // securityGuard.validateSmartHomeAction — meaning `lock.unlock` on
  // `lock.front_door` executed with no 2FA and none of the
  // SMART_HOME_ALLOWED_SERVICES allowlist that guards the REST path.
  //
  // It came back the second time because the smoke test's api-drift check
  // flagged electron.cjs's `minerva:haCall` IPC handler calling a method that
  // no longer existed. That finding was correct, but the fix was backwards:
  // the orphaned CALLER was the leftover, not the method. Both are now gone.
  //
  // If Minerva ever needs to act on a device (e.g. restarting a smart plug as
  // part of self-healing), route it through the same validated path the rest
  // of the app uses — securityGuard.validateSmartHomeAction first, then
  /**
   * Retrieves recent self-healing events from the audit log.
   */
  getSelfHealEvents({ windowMs = 24 * 60 * 60 * 1000 } = {}) {
    const cutoff = Date.now() - windowMs;
    const logs = getRecentAuditLogs ? getRecentAuditLogs({ limit: 100, category: 'system' }) : [];
    return logs.filter(l => l.action === 'minerva_self_heal' && new Date(l.timestamp).getTime() >= cutoff);
  }

  /**
   * Self-healing watchdog: detects offline Media Stack services and restarts them.
   * Follows the OpenClaw Self-Healing Home Server pattern.
   */
  async selfHeal({ serviceName = null, force = false } = {}) {
    const report = await this.runHealthScan();
    const targets = serviceName ? [serviceName] : Object.keys(MEDIA_STACK_CONFIG);
    const offlineServices = targets.filter(k => force || report.dependencies[k]?.status === 'offline');

    if (offlineServices.length === 0) {
      return {
        timestamp: new Date().toISOString(),
        offlineDetected: [],
        healed: [],
        actionsTaken: ['All monitored services healthy — no self-healing required.']
      };
    }

    // Never spawn external processes during unit tests
    if (process.env.NODE_ENV === 'test') {
      return {
        timestamp: new Date().toISOString(),
        offlineDetected: offlineServices,
        healed: offlineServices,
        actionsTaken: [`[TEST_DRY_RUN] Simulated restart for ${offlineServices.join(', ')}`]
      };
    }

    const actionsTaken = [];
    const { spawn } = require('child_process');

    // Restart ONLY the specific offline services silently in background without popping up console windows
    for (const srvKey of offlineServices) {
      try {
        const { arrService } = require('./arrService.cjs');
        if (arrService && typeof arrService.startService === 'function') {
          const res = await arrService.startService(srvKey);
          actionsTaken.push(res.message || `Started ${srvKey}`);
          continue;
        }
      } catch {}

      const cfg = MEDIA_STACK_CONFIG[srvKey];
      if (cfg && fs.existsSync(cfg.exe)) {
        try {
          const p = spawn(cfg.exe, cfg.args, {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
            cwd: path.dirname(cfg.exe)
          });
          p.unref();
          actionsTaken.push(`Spawned ${cfg.name} silently via ${cfg.exe}`);
        } catch (err) {
          actionsTaken.push(`Failed to spawn ${cfg.name}: ${err.message}`);
        }
      } else if (cfg) {
        actionsTaken.push(`Cannot restart ${cfg.name}: executable not found at ${cfg.exe}`);
      }
    }

    // Wait a brief grace period (1500ms) and re-verify status
    await new Promise(r => setTimeout(r, 1500));
    const recheck = await this.runHealthScan();
    const healed = offlineServices.filter(k => recheck.dependencies[k]?.status === 'online');
    const stillOffline = offlineServices.filter(k => recheck.dependencies[k]?.status === 'offline');

    const result = {
      timestamp: new Date().toISOString(),
      offlineDetected: offlineServices,
      healed,
      stillOffline,
      actionsTaken
    };

    logAuditEvent({
      category: 'system',
      action: 'minerva_self_heal',
      target: offlineServices.join(', '),
      status: stillOffline.length === 0 ? 'success' : 'partial',
      details: `Minerva self-healed: [${healed.join(', ')}] healed; [${stillOffline.join(', ')}] offline. Actions: ${actionsTaken.join('; ')}`
    });

    return result;
  }

  /**
   * Starts periodic watchdog loop (defaults to every 10 minutes).
   */
  startWatchdog(intervalMs = 600000) {
    if (this._watchdogTimer) return;
    this._watchdogTimer = setInterval(async () => {
      try {
        const report = await this.runHealthScan();
        const offlineMedia = Object.keys(MEDIA_STACK_CONFIG).filter(k => report.dependencies[k]?.status === 'offline');
        if (offlineMedia.length > 0) {
          await this.selfHeal();
        }
      } catch (err) {
        console.error('Minerva Watchdog error:', err.message);
      }
    }, intervalMs);
    if (this._watchdogTimer.unref) this._watchdogTimer.unref();
  }

  /**
   * Stops periodic watchdog loop.
   */
  stopWatchdog() {
    if (this._watchdogTimer) {
      clearInterval(this._watchdogTimer);
      this._watchdogTimer = null;
    }
  }
}

const globalMinerva = new MinervaEngine();

module.exports = {
  MinervaEngine,
  globalMinerva
};
