import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { HephGoalEngine, goalToStateYaml, GOAL_PHASES } from './hephGoalEngine.cjs';

describe('HEPHAESTUS GOAL ENGINE — Autonomous Goal Runner & STATE.yaml (OpenClaw Parity)', () => {
  const tempTestFile = path.join(os.tmpdir(), `heph-test-goals-${Date.now()}.json`);
  let engine;

  beforeEach(() => {
    engine = new HephGoalEngine({ storageFile: tempTestFile });
  });

  afterEach(() => {
    if (fs.existsSync(tempTestFile)) {
      try { fs.unlinkSync(tempTestFile); } catch {}
    }
  });

  it('1. formats goals into valid OpenClaw-compatible STATE.yaml format', () => {
    const goal = {
      id: 'goal-12345',
      title: 'Build Autonomous Video Transcoder',
      phase: GOAL_PHASES.BACKLOG,
      priority: 'high',
      createdAt: '2026-09-02T10:00:00Z',
      lastUpdated: '2026-09-02T10:00:00Z',
      targetDirectory: 'C:/workspace/MediaStack',
      activeFiles: ['server/transcoder.cjs'],
      steps: [
        { name: 'Scan target directory', status: 'completed' },
        { name: 'Execute ffmpeg pipeline', status: 'pending' }
      ]
    };

    const yaml = goalToStateYaml(goal);
    expect(yaml).toContain('id: "goal-12345"');
    expect(yaml).toContain('title: "Build Autonomous Video Transcoder"');
    expect(yaml).toContain('phase: "backlog"');
    expect(yaml).toContain('- "server/transcoder.cjs"');
    expect(yaml).toContain('name: "Scan target directory"');
  });

  it('2. creates, persists, and lists backlog goals', () => {
    const newGoal = engine.createGoal({
      title: 'Automate weekly backup of Aloy memory vault',
      description: 'Snapshot ~/.aloy-server to secondary drive',
      priority: 'high'
    });

    expect(newGoal.id).toBeDefined();
    expect(newGoal.title).toBe('Automate weekly backup of Aloy memory vault');
    expect(newGoal.phase).toBe(GOAL_PHASES.BACKLOG);
    expect(newGoal.stateYaml).toBeDefined();

    const list = engine.listGoals();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(newGoal.id);
  });

  it('3. executes autonomous goal, completes steps, and transitions phase to COMPLETED', async () => {
    const goal = engine.createGoal({
      title: 'Auto-verify test suites overnight',
      steps: [
        { name: 'Run vitest suite', status: 'pending' },
        { name: 'Inspect log output', status: 'pending' }
      ]
    });

    const executed = await engine.executeGoal(goal.id);

    expect(executed.phase).toBe(GOAL_PHASES.COMPLETED);
    expect(executed.steps.every(s => s.status === 'completed')).toBe(true);
    expect(executed.logs.length).toBeGreaterThan(1);
  });
});
