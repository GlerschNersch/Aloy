import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

const { logAuditEvent, getRecentAuditLogs, AUDIT_LOG_FILE } = require('./auditLogger.cjs');
const { validatePathAccess, validateSmartHomeAction } = require('./securityGuard.cjs');
const { RollbackManager } = require('./rollbackManager.cjs');
const { BM25Index, UnifiedKnowledgeGraph } = require('./graphRAG.cjs');
const { AgenticPlanner, RISK_TIERS } = require('./planner.cjs');
const { routeModelRequest, MODEL_REGISTRY } = require('./modelRouter.cjs');
const { EvaluationHarness } = require('./evalHarness.cjs');
const { buildDistillationDataset } = require('./trainer/datasetBuilder.cjs');

describe('Security Guard & Subtree Scoping', () => {
  it('allows access to whitelisted P:\\ subtrees', () => {
    expect(validatePathAccess('P:\\Movies\\Inception (2010)').allowed).toBe(true);
    expect(validatePathAccess('P:\\TV Shows\\Avatar\\Season 01').allowed).toBe(true);
    expect(validatePathAccess('P:\\Music\\311').allowed).toBe(true);
  });

  it('blocks access to system root directories and metadata files', () => {
    expect(validatePathAccess('P:\\$RECYCLE.BIN').allowed).toBe(false);
    expect(validatePathAccess('P:\\System Volume Information').allowed).toBe(false);
    expect(validatePathAccess('C:\\Windows\\System32').allowed).toBe(false);
    expect(validatePathAccess('C:\\Program Files\\app').allowed).toBe(false);
  });

  it('requires 2FA/stepped-up auth for unlocking exterior doors', () => {
    const unauthCheck = validateSmartHomeAction({
      domain: 'lock',
      service: 'unlock',
      entityId: 'lock.front_door',
      authContext: { isInteractiveUser: false }
    });
    expect(unauthCheck.allowed).toBe(false);
    expect(unauthCheck.requires2FA).toBe(true);

    const authCheck = validateSmartHomeAction({
      domain: 'lock',
      service: 'unlock',
      entityId: 'lock.front_door',
      authContext: { pinVerified: true }
    });
    expect(authCheck.allowed).toBe(true);
  });
});

describe('Audit Logger', () => {
  it('logs events and sanitizes credentials', () => {
    const entry = logAuditEvent({
      category: 'smarthome',
      action: 'light.turn_on',
      target: 'light.office',
      payload: { brightness: 100, token: 'secret-token-123' }
    });

    expect(entry).toBeDefined();
    expect(entry.payload.token).toBe('[REDACTED]');
    expect(entry.status).toBe('success');

    const recent = getRecentAuditLogs({ target: 'light.office', limit: 20 });
    expect(recent.length).toBeGreaterThan(0);
    const logged = recent.find(r => r.id === entry.id);
    expect(logged).toBeDefined();
    expect(logged.target).toBe('light.office');
  });
});

describe('Rollback Manager', () => {
  it('pushes actions and executes rollback handlers', async () => {
    const rm = new RollbackManager();
    const mockUndo = vi.fn().mockResolvedValue(true);

    const actionId = rm.pushAction({
      type: 'smarthome_state',
      description: 'Set living room light to 50%',
      undoContext: { previousBrightness: 100 },
      undoHandler: mockUndo
    });

    expect(actionId).toBeDefined();
    const result = await rm.rollback(actionId);
    expect(result.success).toBe(true);
    expect(mockUndo).toHaveBeenCalledWith({ previousBrightness: 100 });
  });
});

describe('GraphRAG & Hybrid Search', () => {
  it('indexes documents with BM25 and retrieves matches', () => {
    const bm25 = new BM25Index();
    bm25.addDocuments([
      { id: '1', content: 'Captain America Civil War 2016 movie file on drive P' },
      { id: '2', content: 'Dragon Ball Z TV series episodes in Season 01' },
      { id: '3', content: 'Obsidian notes about smart home architecture' }
    ]);

    const results = bm25.search('Civil War');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].document.id).toBe('1');
  });

  it('builds unified knowledge graph connecting nodes and edges', () => {
    const graph = new UnifiedKnowledgeGraph();
    graph.ingestHomeAssistant({
      lights: [{ entity_id: 'light.office', name: 'Office Main Light', state: 'on', domain: 'light' }]
    });
    graph.ingestMediaLibrary({
      movies: ['Back to the Future (1985)'],
      tvShows: ['Avatar The Last Airbender (2005)']
    });

    graph.rebuildSearchIndex();
    const searchResults = graph.searchUnified('Avatar');
    expect(searchResults.length).toBeGreaterThan(0);
    expect(searchResults[0].node.label).toContain('Avatar');
  });
});

describe('Agentic Planner', () => {
  it('creates a multi-step plan, classifies risks, and dry runs safely', async () => {
    const planner = new AgenticPlanner();
    const plan = planner.createPlan('Organize media and adjust lighting', [
      { tool: 'mcp__filesystem__list_directory', args: { path: 'P:\\Movies' }, title: 'List movies' },
      { tool: 'control_smart_home_device', args: { domain: 'light', service: 'turn_on', entity_id: 'light.office' }, title: 'Turn on light' }
    ]);

    expect(plan.steps.length).toBe(2);
    expect(plan.steps[0].riskTier).toBe(RISK_TIERS.AUTONOMOUS);
    expect(plan.steps[1].riskTier).toBe(RISK_TIERS.CONFIRM_REQUIRED);

    const dryRunResult = await planner.dryRunPlan(plan.id);
    expect(dryRunResult.passed).toBe(true);
    expect(dryRunResult.plan.status).toBe('dry_run');
  });
});

describe('Model Router', () => {
  it('routes coding queries to Qwen2.5-Coder', () => {
    const res = routeModelRequest([{ role: 'user', content: 'Write a python function to parse json logs' }]);
    expect(res.selectedModel).toBe(MODEL_REGISTRY.CODER);
    expect(res.route).toBe('coder');
  });

  it('routes screenshot and screen vision queries to Qwen2.5-VL', () => {
    const res = routeModelRequest([{ role: 'user', content: 'Look at my screen and tell me what error is showing' }]);
    expect(res.selectedModel).toBe(MODEL_REGISTRY.VISION);
    expect(res.route).toBe('vision');
  });

  it('defaults general queries to aloy-assistant', () => {
    const res = routeModelRequest([{ role: 'user', content: 'What is on my calendar tomorrow morning?' }]);
    expect(res.selectedModel).toBe(MODEL_REGISTRY.GENERAL);
    expect(res.route).toBe('general');
  });
});

describe('LoRA Distillation Dataset Builder', () => {
  it('extracts training samples into Alpaca formatted JSONL with holdout split', () => {
    const result = buildDistillationDataset();
    expect(result).toBeDefined();
    expect(result.trainFilePath).toContain('aloy_ai_train.jsonl');
    expect(result.holdoutFilePath).toContain('aloy_ai_eval_holdout.jsonl');
    expect(fs.existsSync(result.trainFilePath)).toBe(true);
    expect(fs.existsSync(result.holdoutFilePath)).toBe(true);
  });
});
