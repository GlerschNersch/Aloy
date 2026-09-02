/**
 * Health Connect & Wearable Biometrics Bridge for Aloy (Apollo & Hermes).
 * 
 * Features:
 * - Local ingestion of daily steps, heart rate, sleep metrics, and recovery scores
 * - Ingestion into store.cjs with rolling historical trend analysis
 * - Formats health context for Hermes daily briefing and Apollo memory gardening
 */

const store = require('./store.cjs');
const { logAuditEvent } = require('./auditLogger.cjs');

class HealthBridge {
  constructor() {
    this.cachedMetrics = null;
  }

  /**
   * Ingests health metrics synced from Android Health Connect / Zepp App.
   * @param {Object} metrics
   * @param {number} [metrics.steps]
   * @param {number} [metrics.restingHeartRate]
   * @param {number} [metrics.sleepScore]
   * @param {number} [metrics.sleepDurationHours]
   * @param {number} [metrics.activeCalories]
   * @param {number} [metrics.stressScore]
   * @param {number} [metrics.batteryLevel]
   * @param {string} [metrics.source]
   * @returns {Object} Updated health record
   */
  ingestHealthData(metrics = {}) {
    const d = store.load();
    const now = new Date().toISOString();
    const today = now.slice(0, 10);

    const currentHealth = d.healthMetrics || {
      steps: 0,
      restingHeartRate: null,
      sleepScore: null,
      sleepDurationHours: null,
      activeCalories: 0,
      stressScore: null,
      batteryLevel: null,
      source: metrics.source || 'Zepp / Health Connect',
      lastSyncedAt: now,
      history: []
    };

    // Update current snapshot
    if (metrics.steps != null) currentHealth.steps = Number(metrics.steps);
    if (metrics.restingHeartRate != null) currentHealth.restingHeartRate = Number(metrics.restingHeartRate);
    if (metrics.sleepScore != null) currentHealth.sleepScore = Number(metrics.sleepScore);
    if (metrics.sleepDurationHours != null) currentHealth.sleepDurationHours = Number(metrics.sleepDurationHours);
    if (metrics.activeCalories != null) currentHealth.activeCalories = Number(metrics.activeCalories);
    if (metrics.stressScore != null) currentHealth.stressScore = Number(metrics.stressScore);
    if (metrics.batteryLevel != null) currentHealth.batteryLevel = Number(metrics.batteryLevel);
    currentHealth.lastSyncedAt = now;
    if (metrics.source) currentHealth.source = metrics.source;

    // Maintain daily history (last 30 days)
    const history = currentHealth.history || [];
    const dayIndex = history.findIndex(h => h.date === today);
    const daySnapshot = {
      date: today,
      steps: currentHealth.steps,
      restingHeartRate: currentHealth.restingHeartRate,
      sleepScore: currentHealth.sleepScore,
      sleepDurationHours: currentHealth.sleepDurationHours,
      activeCalories: currentHealth.activeCalories,
      stressScore: currentHealth.stressScore,
      updatedAt: now
    };

    if (dayIndex >= 0) {
      history[dayIndex] = daySnapshot;
    } else {
      history.unshift(daySnapshot);
      if (history.length > 30) history.pop();
    }
    currentHealth.history = history;

    d.healthMetrics = currentHealth;
    store.save(d);
    this.cachedMetrics = currentHealth;

    logAuditEvent({
      category: 'health_bridge',
      action: 'health_metrics_ingested',
      target: currentHealth.source,
      status: 'recorded',
      details: `Steps: ${currentHealth.steps}, Sleep: ${currentHealth.sleepDurationHours}h, HR: ${currentHealth.restingHeartRate}bpm`
    });

    return currentHealth;
  }

  /**
   * Returns current health metrics and calculated readiness score.
   */
  getHealthSummary() {
    const d = store.load();
    const health = d.healthMetrics || {
      steps: 0,
      restingHeartRate: null,
      sleepScore: null,
      sleepDurationHours: null,
      activeCalories: 0,
      stressScore: null,
      batteryLevel: null,
      lastSyncedAt: null,
      history: []
    };

    // Readiness is only meaningful if something was actually measured.
    //
    // This used to start at a literal 85 / 'Optimal' with every adjustment
    // guarded on `!= null`, so an empty store returned "85/100 Optimal" as a
    // computed metric — and formatHealthContext then fed that to the model
    // under an [LIVE WEARABLE & HEALTH TELEMETRY] header with a directive to
    // report it accurately. Aloy confidently told the user their recovery was
    // Optimal when no watch had ever synced.
    const hasAnySignal = health.sleepDurationHours != null
      || health.stressScore != null
      || health.restingHeartRate != null;

    if (!hasAnySignal) {
      return { ...health, readinessScore: null, recoveryState: null };
    }

    let recoveryState = 'Optimal';
    let readinessScore = 85;

    if (health.sleepDurationHours != null && health.sleepDurationHours < 6.0) {
      readinessScore -= 20;
      recoveryState = 'Needs Rest';
    }
    if (health.stressScore != null && health.stressScore > 70) {
      readinessScore -= 15;
      recoveryState = 'High Stress';
    }
    if (health.restingHeartRate != null && health.restingHeartRate > 80) {
      readinessScore -= 10;
    }

    readinessScore = Math.max(10, Math.min(100, readinessScore));

    return {
      ...health,
      readinessScore,
      recoveryState
    };
  }

  /**
   * Formats a clean context block for LLM prompts and daily briefs.
   */
  formatHealthContext() {
    const summary = this.getHealthSummary();
    if (!summary.lastSyncedAt && summary.steps === 0) {
      return '';
    }

    const lines = [
      `[LIVE WEARABLE & HEALTH TELEMETRY (Zepp / Amazfit / Health Connect)]`,
      `- Steps Today: ${summary.steps.toLocaleString()} steps`,
      summary.restingHeartRate ? `- Resting Heart Rate: ${summary.restingHeartRate} bpm` : null,
      summary.sleepDurationHours ? `- Sleep Duration: ${summary.sleepDurationHours} hrs (Score: ${summary.sleepScore || 'N/A'}/100)` : null,
      summary.stressScore != null ? `- Stress Level: ${summary.stressScore}/100 (${summary.recoveryState})` : null,
      summary.activeCalories ? `- Active Calorie Burn: ${summary.activeCalories} kcal` : null,
      summary.batteryLevel != null ? `- Watch Battery: ${summary.batteryLevel}%` : null,
      summary.readinessScore != null
        ? `- Calculated Physical Readiness: ${summary.readinessScore}/100 (${summary.recoveryState})`
        : null,
      // Was `|| 'Just now'`, which stamped never-synced data as current.
      summary.lastSyncedAt
        ? `- Last Synchronized: ${summary.lastSyncedAt}`
        : `- NOTE: no wearable sync has been recorded. Do not state or imply that this data is current.`
    ].filter(Boolean);

    return lines.join('\n') + '\n';
  }
}

const globalHealthBridge = new HealthBridge();

module.exports = {
  HealthBridge,
  globalHealthBridge
};
