// Google ADK (Agent Development Kit) Multi-Agent Orchestrator for Aloy
// Harvested from google/adk-python architecture:
// 1. SessionStateStore: Shared persistent session dictionary with {key} template interpolation
// 2. AgentAsTool: Encapsulates specialized subagents as standard callable tools
// 3. SequentialPipeline: Deterministic multi-agent chaining (A -> B -> C)
// 4. ParallelDispatch: Concurrent multi-agent orchestration
// 5. AgentHandoffManager: Dynamic context-preserving conversational transfers (transfer_to_agent)

class SessionStateStore {
  constructor(initialState = {}) {
    this.state = { ...initialState };
    this.history = [];
  }

  get(key, defaultValue = undefined) {
    return key in this.state ? this.state[key] : defaultValue;
  }

  set(key, value) {
    this.state[key] = value;
    this.history.push({
      timestamp: new Date().toISOString(),
      action: 'set',
      key,
      value
    });
    return value;
  }

  getAll() {
    return { ...this.state };
  }

  clear() {
    this.state = {};
    this.history.push({ timestamp: new Date().toISOString(), action: 'clear' });
  }

  /**
   * Interpolates {key_name} placeholders in template strings with current session state values.
   */
  interpolate(template) {
    if (typeof template !== 'string') return template;
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
      if (key in this.state) {
        const val = this.state[key];
        return typeof val === 'object' ? JSON.stringify(val) : String(val);
      }
      return match;
    });
  }
}

class AgentAsTool {
  constructor({ name, description, agentInstance, runMethod = 'executeTask', outputKey = null }) {
    this.name = name;
    this.description = description;
    this.agentInstance = agentInstance;
    this.runMethod = runMethod;
    this.outputKey = outputKey;
  }

  getToolDefinition() {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'The task or query to delegate to this specialized subagent' },
            context: { type: 'object', description: 'Optional supplemental parameters or metadata' }
          },
          required: ['task']
        }
      }
    };
  }

  async execute({ task, context = {} }, sessionState = null) {
    if (!this.agentInstance) {
      throw new Error(`Subagent instance for tool '${this.name}' is not configured.`);
    }

    const runner = this.agentInstance[this.runMethod] || this.agentInstance.run || this.agentInstance.execute;
    if (typeof runner !== 'function') {
      throw new Error(`Method '${this.runMethod}' not found on subagent instance '${this.name}'.`);
    }

    const interpolatedTask = sessionState ? sessionState.interpolate(task) : task;
    const startTime = Date.now();
    
    try {
      const result = await runner.call(this.agentInstance, interpolatedTask, context);
      const durationMs = Date.now() - startTime;

      if (this.outputKey && sessionState) {
        sessionState.set(this.outputKey, result);
      }

      return {
        status: 'success',
        agent: this.name,
        result,
        durationMs
      };
    } catch (err) {
      return {
        status: 'error',
        agent: this.name,
        error: err.message,
        durationMs: Date.now() - startTime
      };
    }
  }
}

class SequentialPipeline {
  constructor({ name, steps = [], sessionState = null }) {
    this.name = name || 'sequential_pipeline';
    this.steps = steps; // Array of { agent: AgentAsTool | function, inputTemplate: string, outputKey: string }
    this.sessionState = sessionState || new SessionStateStore();
  }

  addStep(step) {
    this.steps.push(step);
    return this;
  }

  async execute(initialInput = '') {
    const startTime = Date.now();
    let currentInput = initialInput;
    const stepResults = [];

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      const stepStart = Date.now();
      
      const prompt = step.inputTemplate
        ? this.sessionState.interpolate(step.inputTemplate.replace('{input}', currentInput))
        : currentInput;

      let result;
      if (typeof step.agent === 'function') {
        result = await step.agent(prompt, this.sessionState);
      } else if (step.agent instanceof AgentAsTool) {
        const out = await step.agent.execute({ task: prompt }, this.sessionState);
        result = out.result || out.error;
      } else if (step.agent && typeof step.agent.execute === 'function') {
        result = await step.agent.execute(prompt, this.sessionState);
      } else {
        throw new Error(`Step ${i + 1} has invalid agent runner.`);
      }

      if (step.outputKey) {
        this.sessionState.set(step.outputKey, result);
      }

      stepResults.push({
        stepIndex: i + 1,
        outputKey: step.outputKey || null,
        result,
        durationMs: Date.now() - stepStart
      });

      // Pass result forward to next step
      currentInput = typeof result === 'object' ? JSON.stringify(result) : String(result);
    }

    return {
      pipeline: this.name,
      status: 'completed',
      finalOutput: currentInput,
      steps: stepResults,
      totalDurationMs: Date.now() - startTime,
      sessionState: this.sessionState.getAll()
    };
  }
}

class ParallelDispatch {
  constructor({ name, agents = [], sessionState = null }) {
    this.name = name || 'parallel_dispatch';
    this.agents = agents; // Array of { agent: AgentAsTool, task: string, outputKey: string }
    this.sessionState = sessionState || new SessionStateStore();
  }

  async execute(tasksMap = {}) {
    const startTime = Date.now();
    const executions = this.agents.map(async (item) => {
      const task = tasksMap[item.agent.name] || item.task || '';
      const interpolated = this.sessionState.interpolate(task);
      const res = await item.agent.execute({ task: interpolated }, this.sessionState);
      if (item.outputKey && res.status === 'success') {
        this.sessionState.set(item.outputKey, res.result);
      }
      return {
        agent: item.agent.name,
        outputKey: item.outputKey || null,
        ...res
      };
    });

    const results = await Promise.allSettled(executions);
    const summary = results.map(r => r.status === 'fulfilled' ? r.value : { status: 'rejected', error: r.reason?.message });

    return {
      dispatch: this.name,
      totalAgents: this.agents.length,
      successful: summary.filter(s => s.status === 'success').length,
      results: summary,
      totalDurationMs: Date.now() - startTime,
      sessionState: this.sessionState.getAll()
    };
  }
}

class AgentHandoffManager {
  constructor() {
    this.activeAgent = 'aloy_primary';
    this.handoffStack = [];
    this.delegationLogs = [];
  }

  transferToAgent(targetAgentName, reason = '', context = {}) {
    this.handoffStack.push(this.activeAgent);
    const previousAgent = this.activeAgent;
    this.activeAgent = targetAgentName;

    const logEntry = {
      timestamp: new Date().toISOString(),
      action: 'transfer_to_agent',
      from: previousAgent,
      to: targetAgentName,
      reason,
      context
    };
    this.delegationLogs.push(logEntry);
    return logEntry;
  }

  returnControl(summary = '') {
    if (this.handoffStack.length === 0) {
      this.activeAgent = 'aloy_primary';
      return { activeAgent: this.activeAgent, returned: false };
    }
    const previousAgent = this.activeAgent;
    this.activeAgent = this.handoffStack.pop();

    const logEntry = {
      timestamp: new Date().toISOString(),
      action: 'return_control',
      from: previousAgent,
      to: this.activeAgent,
      summary
    };
    this.delegationLogs.push(logEntry);
    return { activeAgent: this.activeAgent, returned: true, logEntry };
  }

  getActiveAgent() {
    return this.activeAgent;
  }
}

// A single process-wide manager.
//
// aloyServer's onTransferToAgent used to do `new AgentHandoffManager()` on every
// call, so handoffStack, activeAgent and delegationLogs were rebuilt empty each
// time: activeAgent was always 'aloy_primary' before the transfer, returnControl
// always found an empty stack, and the "context-preserving conversational
// transfer" this class exists to provide preserved nothing at all. State has to
// outlive the call for a stack to mean anything.
const globalHandoffManager = new AgentHandoffManager();

module.exports = {
  SessionStateStore,
  AgentAsTool,
  SequentialPipeline,
  ParallelDispatch,
  AgentHandoffManager,
  globalHandoffManager
};
