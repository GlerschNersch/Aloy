/**
 * HASS.Agent-inspired Windows PC Telemetry & Home Assistant Bridge for Aloy (Minerva).
 * 
 * Features:
 * - Real-time Windows hardware sensors (CPU, RAM, GPU, Storage on C: and P:, Uptime)
 * - Sensor publication payloads for Home Assistant
 * - Actionable Windows notification dispatcher with quick confirmation buttons
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { exec, execFile } = require('child_process');
const { logAuditEvent } = require('./auditLogger.cjs');

class HassTelemetryBridge {
  constructor(options = {}) {
    this.haUrl = options.haUrl || process.env.HOME_ASSISTANT_URL || 'http://localhost:8123';
    this.haToken = options.haToken || process.env.HOME_ASSISTANT_TOKEN;
    this.cachedTelemetry = null;
    this.lastSampleTime = 0;
  }

  /**
   * Samples current PC hardware metrics (CPU, RAM, GPU, Disks, Uptime).
   * @returns {Promise<Object>} Telemetry snapshot
   */
  async getSystemTelemetry() {
    const now = Date.now();
    // Cache for 2 seconds to avoid excessive WMI/SMI polling
    if (this.cachedTelemetry && now - this.lastSampleTime < 2000) {
      return this.cachedTelemetry;
    }

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const ramUtilPct = Math.round((usedMem / totalMem) * 100);

    // Drive status
    const drivePExists = fs.existsSync('P:\\');
    const driveCExists = fs.existsSync('C:\\');

    // GPU stats via nvidia-smi if available
    const gpuStats = await this.sampleGpuMetrics();

    const telemetry = {
      hostname: os.hostname(),
      platform: os.platform(),
      uptimeHours: parseFloat((process.uptime() / 3600).toFixed(1)),
      cpu: {
        cores: os.cpus().length,
        model: os.cpus()[0]?.model || 'Generic CPU',
        loadAvg: os.loadavg()
      },
      ram: {
        totalGb: parseFloat((totalMem / (1024 ** 3)).toFixed(2)),
        usedGb: parseFloat((usedMem / (1024 ** 3)).toFixed(2)),
        freeGb: parseFloat((freeMem / (1024 ** 3)).toFixed(2)),
        utilizationPct: ramUtilPct
      },
      storage: {
        driveC: { mounted: driveCExists },
        driveP: { mounted: drivePExists, label: 'Media Archive & AutoRip' }
      },
      gpu: gpuStats,
      timestamp: new Date().toISOString()
    };

    this.cachedTelemetry = telemetry;
    this.lastSampleTime = now;
    return telemetry;
  }

  /**
   * Helper to sample NVIDIA GPU metrics.
   */
  sampleGpuMetrics() {
    return new Promise((resolve) => {
      exec('nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits', { timeout: 2500 }, (err, stdout) => {
        if (err || !stdout || !stdout.trim()) {
          return resolve({ available: false, name: 'Integrated / System', utilPct: 0, vramUsedMb: 0, vramTotalMb: 0, tempC: null });
        }
        const parts = stdout.trim().split(',').map(s => s.trim());
        resolve({
          available: true,
          name: parts[0] || 'NVIDIA GPU',
          utilPct: parseInt(parts[1], 10) || 0,
          vramUsedMb: parseInt(parts[2], 10) || 0,
          vramTotalMb: parseInt(parts[3], 10) || 0,
          tempC: parseInt(parts[4], 10) || null
        });
      });
    });
  }

  /**
   * Formats telemetry data as Home Assistant Sensor States.
   * @param {Object} telemetry 
   * @returns {Array<{ entity_id: string, state: any, attributes: Object }>}
   */
  /**
   * Publishes one entity to Home Assistant.
   *
   * `haUrl` and `haToken` were assigned in the constructor and then read
   * NOWHERE in this file: formatHomeAssistantSensors built payloads that the
   * route handed straight back to the caller, and nothing ever POSTed them. So
   * sensor.aloy_desktop_gpu_utilization never existed in Home Assistant, and
   * any dashboard card or automation built against it showed "unavailable"
   * forever with no error anywhere.
   */
  async publishToHomeAssistant(entityId, state, attributes = {}) {
    if (!this.haToken) return false;
    // Never publish a value that was not measured — see zeppSyncEngine for the
    // same rule and why it matters (HA writes these into long-term statistics).
    if (state === null || state === undefined) return false;
    try {
      const { httpFetch, TIMEOUTS } = require('./http.cjs');
      const res = await httpFetch(`${this.haUrl}/api/states/${entityId}`, {
        timeoutMs: TIMEOUTS.API,
        method: 'POST',
        headers: { Authorization: `Bearer ${this.haToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: String(state), attributes })
      });
      return res.ok;
    } catch (err) {
      console.warn('[hassTelemetryBridge] publish failed for', entityId, err.message);
      return false;
    }
  }

  /** Publishes every formatted sensor, skipping any without a measured value. */
  async publishTelemetry(telemetry) {
    const published = [], skipped = [];
    for (const s of this.formatHomeAssistantSensors(telemetry)) {
      if (s.state === null || s.state === undefined) { skipped.push(s.entity_id); continue; }
      (await this.publishToHomeAssistant(s.entity_id, s.state, s.attributes)
        ? published : skipped).push(s.entity_id);
    }
    return { published, skipped, haConfigured: !!this.haToken };
  }

  formatHomeAssistantSensors(telemetry) {
    return [
      {
        entity_id: 'sensor.aloy_desktop_ram_utilization',
        state: telemetry.ram.utilizationPct,
        attributes: { unit_of_measurement: '%', friendly_name: 'Aloy PC RAM Utilization', total_gb: telemetry.ram.totalGb, used_gb: telemetry.ram.usedGb }
      },
      {
        entity_id: 'sensor.aloy_desktop_gpu_utilization',
        state: telemetry.gpu.utilPct,
        attributes: { unit_of_measurement: '%', friendly_name: 'Aloy PC GPU Utilization', temp_c: telemetry.gpu.tempC, name: telemetry.gpu.name }
      },
      {
        entity_id: 'sensor.aloy_desktop_gpu_vram',
        state: telemetry.gpu.vramUsedMb,
        attributes: { unit_of_measurement: 'MB', friendly_name: 'Aloy PC VRAM Used', total_mb: telemetry.gpu.vramTotalMb }
      },
      {
        entity_id: 'binary_sensor.aloy_desktop_drive_p',
        state: telemetry.storage.driveP.mounted ? 'on' : 'off',
        attributes: { friendly_name: 'Media Drive P: Mounted' }
      }
    ];
  }

  /**
   * Dispatches an actionable Windows toast notification via PowerShell.
   * @param {Object} params
   * @param {string} params.title
   * @param {string} params.message
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async sendWindowsNotification({ title, message }) {
    if (!title || !message) return { success: false, error: 'Title and message are required' };

    logAuditEvent({
      category: 'telemetry_bridge',
      action: 'windows_notification_sent',
      target: 'desktop_system',
      status: 'dispatched',
      details: `${title}: ${message}`
    });

    return new Promise((resolve) => {
      // The title and message arrive from POST /api/telemetry/notify, i.e. from
      // the network. They used to be interpolated into a PowerShell
      // double-quoted string with only `"` escaped — but $(...) subexpressions
      // are evaluated inside double quotes, so a title of `$(calc)` executed,
      // and a `"` also broke out of cmd.exe's own quoting one layer up.
      //
      // Now: the script text is a constant, the untrusted values are passed as
      // ARGUMENTS via execFile (no shell at all), and PowerShell receives them
      // as parameters it never parses as code.
      const psScript = `
param([string]$Title, [string]$Message)
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null
$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$textNodes = $template.GetElementsByTagName('text')
$textNodes.Item(0).AppendChild($template.CreateTextNode($Title)) > $null
$textNodes.Item(1).AppendChild($template.CreateTextNode($Message)) > $null
$toast = [Windows.UI.Notifications.ToastNotification]::new($template)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Aloy Assistant').Show($toast)
`.trim();

      execFile(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', psScript, '-Title', String(title), '-Message', String(message)],
        { timeout: 4000, windowsHide: true },
        (err) => {
          if (err) {
            return resolve({ success: false, error: err.message });
          }
          resolve({ success: true });
        }
      );
    });
  }
}

const globalHassTelemetryBridge = new HassTelemetryBridge();

module.exports = {
  HassTelemetryBridge,
  globalHassTelemetryBridge
};
