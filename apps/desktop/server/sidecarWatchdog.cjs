// SIDECAR WATCHDOG — Autonomous Resilience & Self-Healing Daemon
// Monitors, retries with progressive backoff, and provides failover circuit-breakers
// for sidecar drives (P:), local AI daemons, and cloud API keys.

const fs = require('fs');
const path = require('path');
const os = require('os');

class SidecarWatchdog {
  constructor(options = {}) {
    this.checkIntervalMs = options.checkIntervalMs || 30000;
    this.maxBackoffMs = options.maxBackoffMs || 300000; // 5 min
    this.baseBackoffMs = options.baseBackoffMs || 5000; // 5 sec
    this.state = {
      mindwalk: { consecutiveFailures: 0, status: 'unknown', lastRecoveredAt: null, nextCheckAt: 0 },
      kokoro: { consecutiveFailures: 0, status: 'unknown', lastRecoveredAt: null, nextCheckAt: 0 },
      whisper: { consecutiveFailures: 0, status: 'unknown', lastRecoveredAt: null, nextCheckAt: 0 },
      mediaDriveP: { consecutiveFailures: 0, status: 'unknown', lastRecoveredAt: null, nextCheckAt: 0 },
      anthropicApiKey: { consecutiveFailures: 0, status: 'unknown', lastRecoveredAt: null, nextCheckAt: 0 },
      geminiApiKey: { consecutiveFailures: 0, status: 'unknown', lastRecoveredAt: null, nextCheckAt: 0 },
      claudeModel: { consecutiveFailures: 0, status: 'unknown', lastRecoveredAt: null, nextCheckAt: 0 },
      geminiModel: { consecutiveFailures: 0, status: 'unknown', lastRecoveredAt: null, nextCheckAt: 0 }
    };
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.runWatchdogPass();
    this.timer = setInterval(() => this.runWatchdogPass(), this.checkIntervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  calculateBackoff(failures) {
    if (failures <= 0) return this.baseBackoffMs;
    const backoff = this.baseBackoffMs * Math.pow(2, failures - 1);
    return Math.min(backoff, this.maxBackoffMs);
  }

  async runWatchdogPass() {
    const now = Date.now();

    // 1. Mindwalk Sidecar Daemon Resilience (Port 8765)
    if (now >= this.state.mindwalk.nextCheckAt) {
      try {
        const mindwalkUrl = process.env.MINDWALK_URL || 'http://127.0.0.1:8765';
        const res = await fetch(mindwalkUrl, { signal: AbortSignal.timeout(2500) });
        if (res.ok || res.status === 304) {
          if (this.state.mindwalk.consecutiveFailures > 0) {
            console.log('[WATCHDOG] Mindwalk sidecar recovered.');
            this.state.mindwalk.lastRecoveredAt = new Date().toISOString();
          }
          this.state.mindwalk.consecutiveFailures = 0;
          this.state.mindwalk.status = 'online';
          this.state.mindwalk.nextCheckAt = now + this.checkIntervalMs;
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (err) {
        this.state.mindwalk.consecutiveFailures++;
        this.state.mindwalk.status = 'degraded';
        // Auto-revive Mindwalk if it is offline
        try {
          const { ensureMindwalkRunning } = require('./mindwalkAdapter.cjs');
          ensureMindwalkRunning().catch(() => {});
        } catch {}
        const delay = this.calculateBackoff(this.state.mindwalk.consecutiveFailures);
        this.state.mindwalk.nextCheckAt = now + delay;
      }
    }

const { spawn } = require('child_process');
const PYTHON_PATH = path.join(os.homedir(), 'openwebui_env', 'Scripts', 'python.exe');
const KOKORO_SCRIPT = path.join(os.homedir(), '.aloy-server', 'services', 'kokoro_server.py');

function ensureKokoroProcessRunning() {
  if (fs.existsSync(PYTHON_PATH) && fs.existsSync(KOKORO_SCRIPT)) {
    try {
      const p = spawn(PYTHON_PATH, [KOKORO_SCRIPT], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      p.unref();
    } catch (err) {
      console.warn('[WATCHDOG] Failed to auto-spawn kokoro_server.py:', err.message);
    }
  }
}

    // 2. Kokoro-82M Studio Neural Voice TTS (Port 8888 / voices)
    if (now >= this.state.kokoro.nextCheckAt) {
      try {
        const kokoroUrl = process.env.KOKORO_URL || 'http://127.0.0.1:8888/voices';
        const res = await fetch(kokoroUrl, { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          if (this.state.kokoro.consecutiveFailures > 0) {
            console.log('[WATCHDOG] Kokoro-TTS recovered.');
            this.state.kokoro.lastRecoveredAt = new Date().toISOString();
          }
          this.state.kokoro.consecutiveFailures = 0;
          this.state.kokoro.status = 'online';
          this.state.kokoro.nextCheckAt = now + this.checkIntervalMs;
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch {
        this.state.kokoro.consecutiveFailures++;
        this.state.kokoro.status = 'offline';
        ensureKokoroProcessRunning();
        const delay = this.calculateBackoff(this.state.kokoro.consecutiveFailures);
        this.state.kokoro.nextCheckAt = now + delay;
      }
    }

    // 3. Faster-Whisper Speech-to-Text (Port 8890 / health)
    if (now >= this.state.whisper.nextCheckAt) {
      try {
        const whisperUrl = process.env.WHISPER_URL || 'http://127.0.0.1:8890/health';
        const res = await fetch(whisperUrl, { signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          if (this.state.whisper.consecutiveFailures > 0) {
            console.log('[WATCHDOG] Faster-Whisper recovered.');
            this.state.whisper.lastRecoveredAt = new Date().toISOString();
          }
          this.state.whisper.consecutiveFailures = 0;
          this.state.whisper.status = 'online';
          this.state.whisper.nextCheckAt = now + this.checkIntervalMs;
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch {
        this.state.whisper.consecutiveFailures++;
        this.state.whisper.status = 'offline';
        const delay = this.calculateBackoff(this.state.whisper.consecutiveFailures);
        this.state.whisper.nextCheckAt = now + delay;
      }
    }

    // 2. Media Drive P: Resilience
    if (now >= this.state.mediaDriveP.nextCheckAt) {
      const isMounted = fs.existsSync('P:\\');
      if (isMounted) {
        if (this.state.mediaDriveP.consecutiveFailures > 0) {
          console.log('[WATCHDOG] Media Drive P: recovered.');
          this.state.mediaDriveP.lastRecoveredAt = new Date().toISOString();
        }
        this.state.mediaDriveP.consecutiveFailures = 0;
        this.state.mediaDriveP.status = 'mounted';
        this.state.mediaDriveP.nextCheckAt = now + this.checkIntervalMs;
      } else {
        this.state.mediaDriveP.consecutiveFailures++;
        this.state.mediaDriveP.status = 'unmounted';
        const delay = this.calculateBackoff(this.state.mediaDriveP.consecutiveFailures);
        this.state.mediaDriveP.nextCheckAt = now + delay;
        console.warn(`[WATCHDOG] Media Drive P: unmounted. Next retry in ${Math.round(delay / 1000)}s (Failures: ${this.state.mediaDriveP.consecutiveFailures})`);
      }
    }

    // 3. Anthropic Key & Claude Model Failover Circuit Breaker
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey && now >= this.state.anthropicApiKey.nextCheckAt) {
      try {
        const res = await fetch('https://api.anthropic.com/v1/models', {
          headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
          signal: AbortSignal.timeout(3000)
        });
        if (res.ok) {
          this.state.anthropicApiKey.consecutiveFailures = 0;
          this.state.anthropicApiKey.status = 'valid';
          this.state.anthropicApiKey.nextCheckAt = now + 120000;
          this.state.claudeModel.status = 'available';
          this.state.claudeModel.consecutiveFailures = 0;
        } else {
          this.state.anthropicApiKey.consecutiveFailures++;
          this.state.anthropicApiKey.status = res.status === 401 ? 'invalid_key' : 'degraded';
          this.state.claudeModel.status = 'degraded';
          const delay = this.calculateBackoff(this.state.anthropicApiKey.consecutiveFailures);
          this.state.anthropicApiKey.nextCheckAt = now + delay;
        }
      } catch (err) {
        this.state.anthropicApiKey.consecutiveFailures++;
        this.state.anthropicApiKey.status = 'unreachable';
        this.state.claudeModel.status = 'unreachable';
        const delay = this.calculateBackoff(this.state.anthropicApiKey.consecutiveFailures);
        this.state.anthropicApiKey.nextCheckAt = now + delay;
      }
    }

    // 4. Gemini Key & Model Health
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey && now >= this.state.geminiApiKey.nextCheckAt) {
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`, {
          signal: AbortSignal.timeout(3000)
        });
        if (res.ok) {
          this.state.geminiApiKey.consecutiveFailures = 0;
          this.state.geminiApiKey.status = 'valid';
          this.state.geminiApiKey.nextCheckAt = now + 120000;
          this.state.geminiModel.status = 'available';
          this.state.geminiModel.consecutiveFailures = 0;
        } else {
          this.state.geminiApiKey.consecutiveFailures++;
          this.state.geminiApiKey.status = 'invalid_key';
          this.state.geminiModel.status = 'degraded';
          const delay = this.calculateBackoff(this.state.geminiApiKey.consecutiveFailures);
          this.state.geminiApiKey.nextCheckAt = now + delay;
        }
      } catch (err) {
        this.state.geminiApiKey.consecutiveFailures++;
        this.state.geminiApiKey.status = 'unreachable';
        this.state.geminiModel.status = 'unreachable';
        const delay = this.calculateBackoff(this.state.geminiApiKey.consecutiveFailures);
        this.state.geminiApiKey.nextCheckAt = now + delay;
      }
    }
  }

  getStatus() {
    return {
      active: Boolean(this.timer),
      state: this.state,
      timestamp: new Date().toISOString()
    };
  }
}

const globalSidecarWatchdog = new SidecarWatchdog();

module.exports = {
  SidecarWatchdog,
  globalSidecarWatchdog
};
