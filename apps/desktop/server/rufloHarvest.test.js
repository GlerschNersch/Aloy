import { describe, it, expect, beforeEach, vi } from 'vitest';
const { RufloFederationEngine, TRUST_LEVELS } = require('./rufloFederation.cjs');
const { SparcLifecycleEngine, SPARC_PHASES } = require('./sparcLifecycle.cjs');
const { AgentArenaEngine } = require('./agentArena.cjs');

// In-memory mock store
function createMockStore() {
  let state = {
    federationPeers: [],
    sparcWorkflows: [],
    arenaTournaments: [],
    arenaStrategies: []
  };

  return {
    load: () => JSON.parse(JSON.stringify(state)),
    save: (patch) => {
      state = { ...state, ...patch };
    },
    _getState: () => state
  };
}

describe('RUFLO HARVEST (ruvnet/ruflo) — Full Architecture Suite', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // 1. RUFLO-FEDERATION: Zero-Trust Peer Comms & Circuit Breakers
  // ──────────────────────────────────────────────────────────────────────────
  describe('1. Ruflo Federation Engine (Zero-Trust & Peer Mesh)', () => {
    let mockStore;
    let engine;

    beforeEach(() => {
      mockStore = createMockStore();
      engine = new RufloFederationEngine({
        store: mockStore,
        nodeId: 'test-host-node',
        nodeSecret: 'super-secret-test-key-2026'
      });
    });

    it('registers, updates, and lists federation peers with trust tiers', () => {
      const peer = engine.registerPeer({
        peerId: 'mobile-node-01',
        name: 'Aloy Mobile Device',
        endpoint: 'http://mobile.local:8080',
        trustLevel: TRUST_LEVELS.TRUSTED,
        tags: ['mobile', 'react-native']
      });

      expect(peer.peerId).toBe('mobile-node-01');
      expect(peer.trustLevel).toBe(TRUST_LEVELS.TRUSTED);

      const peers = engine.getPeers();
      expect(peers.length).toBe(1);
      expect(peers[0].name).toBe('Aloy Mobile Device');

      // Update peer
      engine.registerPeer({
        peerId: 'mobile-node-01',
        name: 'Aloy Mobile Device (Updated)',
        endpoint: 'http://mobile.local:8080',
        trustLevel: TRUST_LEVELS.PRIVILEGED
      });

      const updated = engine.getPeers();
      expect(updated.length).toBe(1);
      expect(updated[0].name).toBe('Aloy Mobile Device (Updated)');
      expect(updated[0].trustLevel).toBe(TRUST_LEVELS.PRIVILEGED);
    });

    it('creates and validates tamper-proof HMAC signed envelopes', () => {
      const payload = { task: 'fetch_weather', location: 'Living Room' };
      const envelope = engine.createSignedEnvelope('command', payload);

      expect(envelope.sourceNodeId).toBe('test-host-node');
      expect(envelope.signature).toBeDefined();

      const verification = engine.verifyEnvelope(envelope);
      expect(verification.valid).toBe(true);

      // Tampered payload fails verification
      const tampered = { ...envelope, payload: { ...payload, malicious: true } };
      const tamperedCheck = engine.verifyEnvelope(tampered);
      expect(tamperedCheck.valid).toBe(false);
      expect(tamperedCheck.reason).toBe('Invalid HMAC signature');
    });

    it('rejects expired envelopes to prevent replay attacks', () => {
      const payload = { task: 'open_garage' };
      const envelope = engine.createSignedEnvelope('command', payload);
      // Simulate expired timestamp (10 minutes ago)
      envelope.timestamp = Date.now() - 600000;
      envelope.signature = engine.signPayload(
        { sourceNodeId: envelope.sourceNodeId, messageType: envelope.messageType, payload: envelope.payload, hops: envelope.hops, timestamp: envelope.timestamp },
        'super-secret-test-key-2026'
      );

      const check = engine.verifyEnvelope(envelope, 'super-secret-test-key-2026', 300000);
      expect(check.valid).toBe(false);
      expect(check.reason).toContain('Envelope timestamp expired');
    });

    it('scrubs outbound personal paths and tokens before federation transit', () => {
      const sensitiveData = {
        path1: 'C:\\Users\\john\\Documents\\secret.txt',
        path2: '/home/alex/repo/data.json',
        auth: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
        token: 'ghp_abc123def456ghi789jkl012mno345pqr678'
      };

      const scrubbed = engine.scrubOutboundPayload(sensitiveData);
      expect(scrubbed.path1).toBe('%USERPROFILE%\\Documents\\secret.txt');
      expect(scrubbed.path2).toBe('~/repo/data.json');
      expect(scrubbed.auth).toBe('Bearer [REDACTED_TOKEN]');
      expect(scrubbed.token).toBe('ghp_[REDACTED]');
    });

    it('enforces circuit-breaker hop ceilings to prevent recursive delegation cascades', async () => {
      engine.registerPeer({
        peerId: 'peer-bazzite',
        endpoint: 'http://bazzite.local:7890',
        trustLevel: TRUST_LEVELS.TRUSTED
      });

      await expect(
        engine.dispatchTask('peer-bazzite', { run: 'test' }, { hops: 4, maxHops: 4 })
      ).rejects.toThrow('Circuit breaker triggered: HOP_LIMIT_EXCEEDED');
    });

    it('handles incoming federated messages and blocks untrusted peers', async () => {
      engine.registerPeer({
        peerId: 'untrusted-node',
        endpoint: 'http://untrusted.local',
        trustLevel: TRUST_LEVELS.UNTRUSTED
      });

      const envelope = engine.createSignedEnvelope('task', { query: 'test' });
      envelope.sourceNodeId = 'untrusted-node';
      envelope.signature = engine.signPayload(
        { sourceNodeId: 'untrusted-node', messageType: envelope.messageType, payload: envelope.payload, hops: envelope.hops, timestamp: envelope.timestamp },
        'super-secret-test-key-2026'
      );

      const res = await engine.handleIncomingMessage(envelope);
      expect(res.success).toBe(false);
      expect(res.status).toBe(403);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. RUFLO-SPARC: 5-Phase Methodology & Quality Gates
  // ──────────────────────────────────────────────────────────────────────────
  describe('2. Ruflo SPARC Engine (5-Phase Lifecycle & Quality Gates)', () => {
    let mockStore;
    let sparc;

    beforeEach(() => {
      mockStore = createMockStore();
      sparc = new SparcLifecycleEngine({ store: mockStore });
    });

    it('initializes a workflow in SPECIFICATION phase with default templates', () => {
      const wf = sparc.createWorkflow({
        featureName: 'Distributed Agent Bus',
        goalDescription: 'Connect mobile and desktop subagents seamlessly.'
      });

      expect(wf.id).toMatch(/^sparc-/);
      expect(wf.currentPhase).toBe(SPARC_PHASES.SPECIFICATION);
      expect(wf.phases[SPARC_PHASES.SPECIFICATION].status).toBe('in_progress');
      expect(wf.phases[SPARC_PHASES.PSEUDOCODE].status).toBe('pending');
    });

    it('blocks advancement through SPECIFICATION gate if criteria are missing', () => {
      const wf = sparc.createWorkflow({
        featureName: 'Fast Sync',
        goalDescription: 'Sync memories fast',
        initialSpec: { acceptanceCriteria: ['Must be fast'], constraints: [] }
      });

      const advanceResult = sparc.advancePhase(wf.id);
      expect(advanceResult.success).toBe(false);
      expect(advanceResult.advanced).toBe(false);
      expect(advanceResult.gateReport.blockers.length).toBeGreaterThan(0);
      expect(advanceResult.gateReport.blockers[0]).toContain('at least 3 distinct acceptance criteria');
    });

    it('advances cleanly across all 5 phases when quality gate criteria are satisfied', () => {
      const wf = sparc.createWorkflow({
        featureName: 'Audit Logging Engine',
        goalDescription: 'Log security actions',
        initialSpec: {
          acceptanceCriteria: [
            'Logs all auth attempts',
            'Enforces HMAC checks',
            'Rotates files daily'
          ],
          constraints: ['Zero external network calls']
        }
      });

      // 1. Advance SPECIFICATION -> PSEUDOCODE
      let res = sparc.advancePhase(wf.id);
      expect(res.success).toBe(true);
      expect(res.phase).toBe(SPARC_PHASES.PSEUDOCODE);

      // 2. Update and advance PSEUDOCODE -> ARCHITECTURE
      sparc.updatePhaseData(wf.id, SPARC_PHASES.PSEUDOCODE, {
        algorithmicFlow: 'Step 1: Check signature. Step 2: Validate token. Step 3: Record audit log.',
        errorHandlingPaths: ['On HMAC error, log security event and reject']
      });
      res = sparc.advancePhase(wf.id);
      expect(res.success).toBe(true);
      expect(res.phase).toBe(SPARC_PHASES.ARCHITECTURE);

      // 3. Update and advance ARCHITECTURE -> REFINEMENT
      sparc.updatePhaseData(wf.id, SPARC_PHASES.ARCHITECTURE, {
        modules: ['AuditLogger', 'HMACVerifier'],
        fileChanges: ['server/auditLogger.cjs']
      });
      res = sparc.advancePhase(wf.id);
      expect(res.success).toBe(true);
      expect(res.phase).toBe(SPARC_PHASES.REFINEMENT);

      // 4. Update and advance REFINEMENT -> COMPLETION
      sparc.updatePhaseData(wf.id, SPARC_PHASES.REFINEMENT, {
        implementationDiffs: ['+ function logAuditEvent() { ... }'],
        testsExecuted: 5,
        testsPassed: 5,
        testFailures: []
      });
      res = sparc.advancePhase(wf.id);
      expect(res.success).toBe(true);
      expect(res.phase).toBe(SPARC_PHASES.COMPLETION);

      // 5. Update and advance COMPLETION -> Finish
      sparc.updatePhaseData(wf.id, SPARC_PHASES.COMPLETION, {
        auditPassed: true,
        docsUpdated: true
      });
      res = sparc.advancePhase(wf.id);
      expect(res.success).toBe(true);
      expect(res.workflow.status).toBe('completed');
    });

    it('generates a full Markdown traceability report', () => {
      const wf = sparc.createWorkflow({
        featureName: 'Traceability Demo',
        goalDescription: 'Verify full report rendering',
        initialSpec: {
          acceptanceCriteria: ['AC1', 'AC2', 'AC3'],
          constraints: ['C1']
        }
      });

      const report = sparc.generateReport(wf.id);
      expect(report).toContain('# 🛡️ SPARC Methodology Report: Traceability Demo');
      expect(report).toContain('SPECIFICATION');
      expect(report).toContain('AC1');
      expect(report).toContain('C1');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. RUFLO-ARENA: Agent Tournament & Co-Evolution
  // ──────────────────────────────────────────────────────────────────────────
  describe('3. Ruflo Arena Engine (Tournaments & Strategy Co-Evolution)', () => {
    let mockStore;
    let arena;

    beforeEach(() => {
      mockStore = createMockStore();
      arena = new AgentArenaEngine({ store: mockStore });
    });

    it('initializes default prompt strategies with standard 1200 ELO', () => {
      const strategies = arena.getStrategies();
      expect(strategies.length).toBeGreaterThanOrEqual(4);
      expect(strategies.find(s => s.id === 'strat-minimalist')).toBeDefined();
      strategies.forEach(s => {
        expect(s.elo).toBe(1200);
      });
    });

    it('correctly calculates new ELO ratings using standard logistic curves', () => {
      // 1200 vs 1200, Player A wins
      const eloWin = arena.calculateElo(1200, 1200, 1.0, 32);
      expect(eloWin.newRatingA).toBe(1216);
      expect(eloWin.newRatingB).toBe(1184);

      // 1200 vs 1200, Draw
      const eloDraw = arena.calculateElo(1200, 1200, 0.5, 32);
      expect(eloDraw.newRatingA).toBe(1200);
      expect(eloDraw.newRatingB).toBe(1200);
    });

    it('runs a 1v1 match between two strategies and updates their records', async () => {
      const res = await arena.runMatch('strat-minimalist', 'strat-creative', 'Format JSON data without prose');
      expect(res.strategyA.id).toBe('strat-minimalist');
      expect(res.strategyB.id).toBe('strat-creative');
      expect(['Minimalist Executor', 'Deep-Thinking Explorer', 'Draw']).toContain(res.winner);

      const strategies = arena.getStrategies();
      const stratA = strategies.find(s => s.id === 'strat-minimalist');
      expect(stratA.matches).toBe(1);
    });

    it('executes a round-robin tournament and produces a competitive matrix', async () => {
      const tourn = await arena.runTournament(['Benchmark 1', 'Benchmark 2']);
      expect(tourn.id).toMatch(/^tourn-/);
      expect(tourn.matrix).toBeDefined();
      expect(tourn.matrix.length).toBe(arena.getStrategies().length);
      expect(tourn.rankedLeaderboard.length).toBe(arena.getStrategies().length);
      expect(tourn.rankedLeaderboard[0].elo).toBeGreaterThanOrEqual(tourn.rankedLeaderboard[1].elo);
    });

    it('co-evolves and hill-climbs prompt strategies across generations', async () => {
      const evolution = await arena.evolveStrategy('strat-minimalist', 3);
      expect(evolution.generations).toBe(3);
      expect(evolution.evolutionLog.length).toBe(3);
      expect(evolution.evolvedChampion).toBeDefined();
    });
  });
});
