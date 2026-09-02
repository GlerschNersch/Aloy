/**
 * Zepp / Amazfit Cloud Sync & Home Assistant Entity Publisher for Aloy.
 * 
 * Features:
 * - Bridges Amazfit/Zepp biometrics directly to Home Assistant states
 * - Publishes live sensor.amazfit_* and binary_sensor.amazfit_* entities
 * - Syncs bidirectionally with Aloy's HealthBridge
 */

const { globalHealthBridge } = require('./healthBridge.cjs');
const { httpFetch, TIMEOUTS } = require('./http.cjs');
const { logAuditEvent } = require('./auditLogger.cjs');

class ZeppSyncEngine {
  constructor(options = {}) {
    this.haUrl = options.haUrl || process.env.HOME_ASSISTANT_URL || process.env.VITE_HA_URL || 'http://localhost:8123';
    this.haToken = options.haToken || process.env.HOME_ASSISTANT_TOKEN || process.env.VITE_HA_TOKEN;
    this.lastPublishedAt = null;
  }

  /**
   * Publishes an entity state to Home Assistant via REST API (/api/states/<entity_id>).
   * @param {string} entityId 
   * @param {any} state 
   * @param {Object} attributes 
   * @returns {Promise<boolean>}
   */
  async publishToHomeAssistant(entityId, state, attributes = {}) {
    if (!this.haToken) {
      console.warn('[ZeppSync] Cannot publish to Home Assistant: Missing HA Token');
      return false;
    }

    const cleanBase = this.haUrl.replace(/\/+$/, '');
    const url = `${cleanBase}/api/states/${entityId}`;

    try {
      const res = await httpFetch(url, {
        method: 'POST',
        timeoutMs: TIMEOUTS.HA_API || 4000,
        headers: {
          Authorization: `Bearer ${this.haToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          state: String(state),
          attributes: {
            ...attributes,
            last_updated_by: 'Aloy Zepp Sync Engine',
            source: 'Zepp / Amazfit'
          }
        })
      });

      return res.ok;
    } catch (err) {
      console.warn(`[ZeppSync] Failed to publish ${entityId} to HA:`, err.message);
      return false;
    }
  }

  /**
   * Synchronizes health metrics to both Aloy store and Home Assistant entities.
   * @param {Object} metrics 
   * @returns {Promise<{ success: boolean, updatedEntities: string[], healthSummary: Object }>}
   */
  async syncAndPublish(metrics = {}) {
    // 1. Ingest locally into Aloy
    const ingested = globalHealthBridge.ingestHealthData({
      ...metrics,
      source: 'Zepp / Amazfit'
    });

    const summary = globalHealthBridge.getHealthSummary();
    const updatedEntities = [];
    const failedEntities = [];

    // 2. Define Home Assistant entities to update (both zepp_device and amazfit_watch)
    const entityPayloads = [
      // Standard Dashboard Entities (Dad's Watch view)
      {
        entity_id: 'sensor.zepp_device_steps',
        state: summary.steps,
        attributes: { unit_of_measurement: 'steps', state_class: 'total_increasing', icon: 'mdi:walk', friendly_name: "Dad's Watch Steps" }
      },
      {
        entity_id: 'sensor.zepp_device_battery',
        state: summary.batteryLevel,
        attributes: { unit_of_measurement: '%', device_class: 'battery', icon: 'mdi:battery-bluetooth', friendly_name: "Dad's Watch Battery" }
      },
      {
        entity_id: 'sensor.zepp_device_heart_rate',
        state: summary.restingHeartRate,
        attributes: { unit_of_measurement: 'bpm', state_class: 'measurement', icon: 'mdi:heart-pulse', friendly_name: "Dad's Watch Heart Rate" }
      },
      {
        entity_id: 'sensor.zepp_device_sleep_score',
        state: summary.sleepScore,
        attributes: { unit_of_measurement: 'score', state_class: 'measurement', icon: 'mdi:sleep', friendly_name: "Dad's Watch Sleep Score" }
      },
      {
        entity_id: 'sensor.zepp_device_sleep_total',
        state: summary.sleepDurationHours != null ? Math.round(summary.sleepDurationHours * 60) : null,
        attributes: { unit_of_measurement: 'min', device_class: 'duration', icon: 'mdi:bed', friendly_name: "Dad's Watch Total Sleep" }
      },
      {
        entity_id: 'sensor.zepp_device_stress',
        state: summary.stressScore,
        attributes: { unit_of_measurement: '%', state_class: 'measurement', icon: 'mdi:brain', friendly_name: "Dad's Watch Stress" }
      },
      {
        entity_id: 'binary_sensor.zepp_device_is_sleeping',
        state: summary.sleepScore != null && (new Date().getHours() < 7 || new Date().getHours() >= 23) ? 'on' : 'off',
        attributes: { device_class: 'running', icon: 'mdi:sleep', friendly_name: "Dad's Watch Sleeping" }
      },
      {
        // Was a hardcoded 'on'. Nothing in this codebase can observe whether
        // the watch is being worn, so this published a permanent "yes" that
        // any automation would read as ground truth. Only report it if a sync
        // ever actually supplies it.
        entity_id: 'binary_sensor.zepp_device_is_wearing',
        state: summary.isWearing == null ? null : (summary.isWearing ? 'on' : 'off'),
        attributes: { friendly_name: "Dad's Watch Is Wearing" }
      },
      // Amazfit Watch Sensor Aliases
      {
        entity_id: 'sensor.amazfit_watch_steps',
        state: summary.steps,
        attributes: { unit_of_measurement: 'steps', state_class: 'total_increasing', icon: 'mdi:walk', friendly_name: 'Amazfit Daily Steps' }
      },
      {
        entity_id: 'sensor.amazfit_watch_battery_level',
        state: summary.batteryLevel,
        attributes: { unit_of_measurement: '%', device_class: 'battery', icon: 'mdi:battery-bluetooth', friendly_name: 'Amazfit Watch Battery' }
      },
      {
        entity_id: 'sensor.amazfit_watch_resting_heart_rate',
        state: summary.restingHeartRate,
        attributes: { unit_of_measurement: 'bpm', state_class: 'measurement', icon: 'mdi:heart-pulse', friendly_name: 'Amazfit Resting Heart Rate' }
      },
      {
        entity_id: 'sensor.amazfit_watch_sleep_score',
        state: summary.sleepScore,
        attributes: { unit_of_measurement: 'score', state_class: 'measurement', icon: 'mdi:sleep', friendly_name: 'Amazfit Sleep Score' }
      },
      {
        entity_id: 'sensor.amazfit_watch_sleep_duration',
        state: summary.sleepDurationHours,
        attributes: { unit_of_measurement: 'h', device_class: 'duration', icon: 'mdi:bed', friendly_name: 'Amazfit Sleep Duration' }
      },
      {
        entity_id: 'sensor.amazfit_watch_stress_level',
        state: summary.stressScore,
        attributes: { unit_of_measurement: '%', state_class: 'measurement', icon: 'mdi:brain', friendly_name: 'Amazfit Stress Level' }
      },
      {
        entity_id: 'sensor.amazfit_watch_readiness_score',
        state: summary.readinessScore,
        attributes: { unit_of_measurement: 'score', state_class: 'measurement', icon: 'mdi:lightning-bolt', friendly_name: 'Amazfit Readiness Score' }
      },
      {
        entity_id: 'binary_sensor.amazfit_watch_is_sleeping',
        state: summary.sleepScore != null && (new Date().getHours() < 7 || new Date().getHours() >= 23) ? 'on' : 'off',
        attributes: { device_class: 'running', icon: 'mdi:sleep', friendly_name: 'Amazfit Sleep Mode Active' }
      }
    ];

    // 3. Publish to Home Assistant.
    //
    // A null state means "we never measured this", and it is SKIPPED rather
    // than published. Every one of these used to carry an invented fallback
    // (battery 85, HR 68, sleep score 88, readiness 85, is_wearing 'on'), and
    // because they carry state_class/device_class, Home Assistant wrote them
    // into long-term statistics. That produced a recorder database where real
    // and synthetic vitals are permanently indistinguishable. Never publish a
    // measurement you did not take.
    const skippedEntities = [];
    for (const item of entityPayloads) {
      if (item.state === null || item.state === undefined) {
        skippedEntities.push(item.entity_id);
        continue;
      }
      const published = await this.publishToHomeAssistant(item.entity_id, item.state, item.attributes);
      if (published) updatedEntities.push(item.entity_id);
      else failedEntities.push(item.entity_id);
    }

    this.lastPublishedAt = new Date().toISOString();

    // `success` used to be an unconditional true, so a sync where every
    // publish failed (no HA token, HA down) still reported success and the
    // audit line still said 'completed'. Both now reflect what happened.
    const anyPublished = updatedEntities.length > 0;
    logAuditEvent({
      category: 'zepp_sync',
      action: 'ha_entities_published',
      target: process.env.HA_URL || 'home_assistant',
      status: failedEntities.length ? 'error' : (anyPublished ? 'success' : 'denied'),
      payload: { updated: updatedEntities.length, failed: failedEntities.length, skipped: skippedEntities.length },
      details: `Published ${updatedEntities.length}; ${failedEntities.length} failed; ${skippedEntities.length} skipped for having no measured value.`
    });

    return {
      success: anyPublished && failedEntities.length === 0,
      updatedEntities,
      failedEntities,
      skippedEntities,
      healthSummary: summary,
      timestamp: this.lastPublishedAt
    };
  }
}

const globalZeppSyncEngine = new ZeppSyncEngine();

module.exports = {
  ZeppSyncEngine,
  globalZeppSyncEngine
};
