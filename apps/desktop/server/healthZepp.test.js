import { describe, it, expect } from 'vitest';
const { HealthBridge } = require('./healthBridge.cjs');
const { ZeppSyncEngine } = require('./zeppSyncEngine.cjs');

describe('HealthBridge & Wearable Ingestion', () => {
  it('ingests daily steps, heart rate, and sleep duration', () => {
    const bridge = new HealthBridge();
    const updated = bridge.ingestHealthData({
      steps: 8420,
      restingHeartRate: 64,
      sleepScore: 91,
      sleepDurationHours: 7.8,
      stressScore: 24,
      batteryLevel: 88,
      source: 'Zepp App'
    });

    expect(updated.steps).toBe(8420);
    expect(updated.restingHeartRate).toBe(64);
    expect(updated.sleepScore).toBe(91);
    expect(updated.sleepDurationHours).toBe(7.8);
    expect(updated.history.length).toBeGreaterThan(0);
  });

  it('calculates readiness score and recovery state accurately', () => {
    const bridge = new HealthBridge();
    bridge.ingestHealthData({
      steps: 10500,
      restingHeartRate: 60,
      sleepScore: 92,
      sleepDurationHours: 8.0,
      stressScore: 20
    });

    const summary = bridge.getHealthSummary();
    expect(summary.readinessScore).toBeGreaterThanOrEqual(80);
    expect(summary.recoveryState).toBe('Optimal');
  });

  it('formats LLM context with live wearable telemetry', () => {
    const bridge = new HealthBridge();
    bridge.ingestHealthData({
      steps: 9200,
      restingHeartRate: 65,
      sleepScore: 89,
      sleepDurationHours: 7.5,
      batteryLevel: 90
    });

    const context = bridge.formatHealthContext();
    expect(context).toContain('LIVE WEARABLE & HEALTH TELEMETRY');
    expect(context).toContain('9,200 steps');
    expect(context).toContain('65 bpm');
    expect(context).toContain('Watch Battery: 90%');
  });
});

describe('ZeppSyncEngine Home Assistant Publisher', () => {
  it('handles missing token gracefully without throwing', async () => {
    const engine = new ZeppSyncEngine({ haToken: null });
    const result = await engine.publishToHomeAssistant('sensor.amazfit_watch_steps', 5000);
    expect(result).toBe(false);
  });

  it('generates entity sync payload and records audit event', async () => {
    const engine = new ZeppSyncEngine({ haToken: null });
    // Mock publishToHomeAssistant to simulate successful HA state sync
    engine.publishToHomeAssistant = async () => true;

    const syncRes = await engine.syncAndPublish({
      steps: 7500,
      restingHeartRate: 68,
      sleepScore: 85,
      batteryLevel: 82
    });

    expect(syncRes.success).toBe(true);
    expect(syncRes.updatedEntities.length).toBeGreaterThan(0);
    expect(syncRes.healthSummary.steps).toBe(7500);
  });
});
