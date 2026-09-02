import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import fs from 'fs';

const { BrowserAgent } = require('./browserAgent.cjs');
const { HassTelemetryBridge } = require('./hassTelemetryBridge.cjs');
const { LightGraphRAG } = require('./lightGraphRAG.cjs');

describe('Browser-Use Vision-Guided Agent', () => {
  it('validates URLs and blocks unauthorized internal network probing', () => {
    const agent = new BrowserAgent();
    expect(agent.validateUrl('https://news.ycombinator.com').allowed).toBe(true);
    expect(agent.validateUrl('http://127.0.0.1/admin').allowed).toBe(false);
    expect(agent.validateUrl('file:///C:/Windows/System32').allowed).toBe(false);
  });

  it('extracts interactive elements from markdown text', () => {
    const agent = new BrowserAgent();
    const markdown = 'Check [Job Details](https://linkedin.com/jobs/123) and [Company Page](https://company.org)';
    const elements = agent.extractInteractiveElements(markdown);
    expect(elements.length).toBe(2);
    expect(elements[0].label).toBe('Job Details');
    expect(elements[0].actionTarget).toBe('https://linkedin.com/jobs/123');
  });
});

describe('HASS.Agent PC Hardware Telemetry & Smart Home Bridge', () => {
  it('samples system telemetry with CPU, RAM, and storage stats', async () => {
    const bridge = new HassTelemetryBridge();
    const telemetry = await bridge.getSystemTelemetry();
    expect(telemetry.hostname).toBeDefined();
    expect(telemetry.ram.totalGb).toBeGreaterThan(0);
    expect(telemetry.ram.utilizationPct).toBeGreaterThanOrEqual(0);
    expect(telemetry.storage.driveC).toBeDefined();
  });

  it('formats telemetry into Home Assistant sensor entities', async () => {
    const bridge = new HassTelemetryBridge();
    const telemetry = await bridge.getSystemTelemetry();
    const sensors = bridge.formatHomeAssistantSensors(telemetry);
    expect(sensors.some(s => s.entity_id.includes('ram_utilization'))).toBe(true);
    expect(sensors.some(s => s.entity_id.includes('drive_p'))).toBe(true);
  });
});

describe('LightRAG Dual-Level Knowledge Graph (Apollo & Vault)', () => {
  it('indexes high-level thematic clusters and low-level entities', async () => {
    const graphRag = new LightGraphRAG();
    const sampleFacts = [
      'User runs Home Assistant at homeassistant.local (1,681 entities).',
      'AutoRipManager runs NVENC H.264 quality 20 encoding.',
      'Aloy has subagents Athena, Hephaestus, Apollo, Minerva, and Hermes.'
    ];

    const stats = await graphRag.buildKnowledgeGraph(sampleFacts);
    expect(stats.nodeCount).toBeGreaterThan(0);
    expect(stats.themeCount).toBe(4);

    const queryResult = graphRag.queryGraph('AutoRip');
    expect(queryResult.themes.some(t => t.id === 'theme-media')).toBe(true);
    expect(queryResult.contextMarkdown).toContain('Dual-Level Knowledge Graph');
  });

  it('performs multi-hop relational retrieval across smart home topics', async () => {
    const graphRag = new LightGraphRAG();
    await graphRag.buildKnowledgeGraph(['Home Assistant manages Aqara Smart Lock U400 on front door.']);
    const queryResult = graphRag.queryGraph('Smart Lock');
    expect(queryResult.contextMarkdown).toContain('Smart Home & Automation');
  });
});
