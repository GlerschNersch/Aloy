import { describe, it, expect } from 'vitest';
const {
  SessionStateStore,
  AgentAsTool,
  SequentialPipeline,
  ParallelDispatch,
  AgentHandoffManager
} = require('./adkOrchestrator.cjs');

describe('Google ADK Architecture Harvest — Multi-Agent Orchestrator', () => {
  describe('1. SessionStateStore & Template Interpolation', () => {
    it('manages shared key-value dictionary and tracks update history', () => {
      const store = new SessionStateStore({ initial_var: 'hello' });
      expect(store.get('initial_var')).toBe('hello');
      
      store.set('user_role', 'engineer');
      expect(store.get('user_role')).toBe('engineer');
      expect(store.history.length).toBe(1);
    });

    it('interpolates {key_name} placeholders accurately from session state', () => {
      const store = new SessionStateStore({
        target_domain: 'Reliability',
        active_service: 'Jellyfin',
        error_count: 3
      });

      const interpolated = store.interpolate(
        'Investigating {target_domain} for {active_service}. Found {error_count} errors in {unmatched_var}.'
      );

      expect(interpolated).toBe('Investigating Reliability for Jellyfin. Found 3 errors in {unmatched_var}.');
    });
  });

  describe('2. AgentAsTool Wrapper (Agent-as-a-Tool Pattern)', () => {
    it('encapsulates a subagent into a standard tool schema and executes cleanly', async () => {
      const mockAthena = {
        executeTask: async (query) => ({ summary: 'Researched: ' + query, sources: 3 })
      };

      const athenaTool = new AgentAsTool({
        name: 'athena_scout',
        description: 'Deep research scout',
        agentInstance: mockAthena,
        runMethod: 'executeTask',
        outputKey: 'last_research'
      });

      const def = athenaTool.getToolDefinition();
      expect(def.type).toBe('function');
      expect(def.function.name).toBe('athena_scout');

      const session = new SessionStateStore();
      const output = await athenaTool.execute({ task: 'Investigate Google ADK' }, session);

      expect(output.status).toBe('success');
      expect(output.result.summary).toContain('Investigate Google ADK');
      expect(session.get('last_research')).toEqual(output.result);
    });
  });

  describe('3. SequentialPipeline (Deterministic Chaining)', () => {
    it('executes multi-agent workflow sequentially passing state forward', async () => {
      const step1 = async (input, state) => {
        state.set('scout_finding', 'Found missing retry parameter');
        return 'Analysis: Found missing retry parameter';
      };

      const step2 = async (input, state) => {
        const finding = state.get('scout_finding');
        return 'Generated Patch based on: ' + finding;
      };

      const pipeline = new SequentialPipeline({
        name: 'research_to_code_pipeline'
      });
      pipeline.addStep({ agent: step1, outputKey: 'step1_out' });
      pipeline.addStep({ agent: step2, outputKey: 'final_patch' });

      const result = await pipeline.execute('Initial prompt');

      expect(result.status).toBe('completed');
      expect(result.steps.length).toBe(2);
      expect(result.finalOutput).toContain('Generated Patch based on: Found missing retry parameter');
      expect(result.sessionState.final_patch).toContain('Generated Patch');
    });
  });

  describe('4. ParallelDispatch (Concurrent Orchestration)', () => {
    it('dispatches tasks concurrently to multiple agents and aggregates outputs', async () => {
      const mockMinerva = new AgentAsTool({
        name: 'minerva_health',
        agentInstance: { executeTask: async () => ({ score: 100, health: 'nominal' }) }
      });
      const mockApollo = new AgentAsTool({
        name: 'apollo_memory',
        agentInstance: { executeTask: async () => ({ facts: 42, proficiency: 96 }) }
      });

      const dispatch = new ParallelDispatch({
        name: 'system_pulse_check',
        agents: [
          { agent: mockMinerva, outputKey: 'minerva_report' },
          { agent: mockApollo, outputKey: 'apollo_report' }
        ]
      });

      const result = await dispatch.execute();

      expect(result.totalAgents).toBe(2);
      expect(result.successful).toBe(2);
      expect(result.sessionState.minerva_report.health).toBe('nominal');
      expect(result.sessionState.apollo_report.facts).toBe(42);
    });
  });

  describe('5. AgentHandoffManager (transfer_to_agent)', () => {
    it('manages conversation delegation stack and returns control properly', () => {
      const handoff = new AgentHandoffManager();
      expect(handoff.getActiveAgent()).toBe('aloy_primary');

      handoff.transferToAgent('athena_scout', 'Deep research session requested');
      expect(handoff.getActiveAgent()).toBe('athena_scout');

      const returned = handoff.returnControl('Research finished');
      expect(returned.activeAgent).toBe('aloy_primary');
      expect(handoff.delegationLogs.length).toBe(2);
    });
  });
});
