// HERMES SCRIPT PIPELINE (Harvested from NousResearch/hermes-agent)
// Enables Zero-Context-Cost Multi-Tool Turns by executing dynamic script pipelines
// locally with an injected RPC client, collapsing multi-step tool interactions into a single turn.

const vm = require('vm');
const defaultStore = require('./store.cjs');
const { logAuditEvent } = require('./auditLogger.cjs');
const { callMcpTool } = require('./mcpClient.cjs');

class HermesScriptPipeline {
  constructor(options = {}) {
    this.store = options.store || defaultStore;
    this.timeoutMs = options.timeoutMs || 15000;
  }

  /**
   * Executes a multi-tool pipeline script in a safe VM context.
   * @param {string} scriptCode - JavaScript async function body or script
   * @param {object} initialContext - Input parameters or state passed to the script
   * @param {object} toolHandlers - Map of accessible native tool executors
   */
  async executePipeline(scriptCode, initialContext = {}, toolHandlers = {}) {
    const startTime = Date.now();
    const logs = [];
    const toolsCalled = [];

    const logger = {
      log: (...args) => logs.push({ level: 'info', time: Date.now() - startTime, message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') }),
      warn: (...args) => logs.push({ level: 'warn', time: Date.now() - startTime, message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') }),
      error: (...args) => logs.push({ level: 'error', time: Date.now() - startTime, message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') })
    };

    // RPC Client exposed to the pipeline script
    const aloy = {
      context: Object.freeze({ ...initialContext }),
      log: logger.log,
      warn: logger.warn,
      error: logger.error,

      /**
       * Call any native or MCP tool via RPC
       */
      callTool: async (toolName, toolArgs = {}) => {
        toolsCalled.push({ name: toolName, args: toolArgs, timestamp: new Date().toISOString() });
        logger.log(`[RPC] Calling tool: ${toolName}`);

        // 1. MCP tool check
        if (toolName.startsWith('mcp__')) {
          const mcpRes = await callMcpTool(toolName, toolArgs);
          return mcpRes;
        }

        // 2. Injected handler check
        if (toolHandlers[toolName]) {
          return await toolHandlers[toolName](toolArgs);
        }

        // 3. Fallback to store query for common domains
        if (toolName === 'get_transactions') {
          const d = this.store.load();
          return d.transactions || [];
        }
        if (toolName === 'get_reminders') {
          const d = this.store.load();
          return d.reminders || [];
        }
        if (toolName === 'get_projects') {
          const d = this.store.load();
          return d.trackedProjects || [];
        }

        throw new Error(`Tool "${toolName}" is not registered or accessible in Hermes Pipeline.`);
      },

      /**
       * Fast store access
       */
      getStoreData: (domain = null) => {
        const d = this.store.load();
        return domain ? (d[domain] || null) : d;
      },

      /**
       * Array and math helpers
       */
      stats: {
        sum: (arr, key = null) => (arr || []).reduce((acc, x) => acc + (key ? (x[key] || 0) : (x || 0)), 0),
        avg: (arr, key = null) => {
          if (!arr || arr.length === 0) return 0;
          return aloy.stats.sum(arr, key) / arr.length;
        },
        groupBy: (arr, key) => (arr || []).reduce((acc, x) => {
          const k = typeof key === 'function' ? key(x) : x[key];
          (acc[k] = acc[k] || []).push(x);
          return acc;
        }, {})
      }
    };

    // Sandbox execution context
    const sandbox = {
      aloy,
      console: logger,
      setTimeout,
      clearTimeout,
      Promise,
      JSON,
      Math,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      result: null
    };

    // DISABLED 2026-08-29 — this is not a sandbox and never was.
    //
    // Node's `vm` is not a security boundary. The sandbox below hands the
    // guest host-realm intrinsics (Object, Promise, JSON, Array, ...), and any
    // one of them returns the host Function constructor:
    //
    //   Object.constructor('return process')()
    //     .mainModule.require('child_process').execSync('id')   -> uid=0(root)
    //
    // That was reproduced against this exact sandbox shape, not theorised.
    // Removing the intrinsics does not fix it either — aloy.callTool is also a
    // host function, so `aloy.callTool.constructor` gets there too.
    //
    // The `timeout` option does not contain it, and does not even bound
    // runtime: it applies to SYNCHRONOUS execution only, and line ~123 wraps
    // every script in `(async () => {...})()`. Measured: runInContext returned
    // in 1ms under a 500ms timeout while the body ran a full 3000ms.
    //
    // Reachable from POST /api/hermes/pipeline/run with no confirmation, and
    // from the hermes_run_pipeline model tool whose confirm label is only
    // script.slice(0, 40) — so a model can put 40 harmless characters up front
    // and have the user approve a payload they cannot see.
    //
    // TO RE-ENABLE SAFELY this needs one of:
    //   (a) a declarative step list instead of free-form script text, or
    //   (b) a real isolate (isolated-vm) or a separate child process with no
    //       host objects reachable from the guest.
    // Filtering the script text is not an option; do not try.
    throw new Error(
      'Hermes script pipeline is disabled: vm.createContext is not a sandbox ' +
      '(verified RCE). Re-enable only with an out-of-process runner or a real isolate.'
    );

    // eslint-disable-next-line no-unreachable
    const vmContext = vm.createContext(sandbox);

    // Wrap script in an async self-executing function if not already wrapped
    let executableCode = scriptCode.trim();
    if (!executableCode.includes('async function') && !executableCode.startsWith('(async')) {
      executableCode = `(async () => {\n${executableCode}\n})()`;
    }

    try {
      const script = new vm.Script(`result = ${executableCode};`, {
        filename: 'hermes_pipeline.vm.js'
      });

      // Execute within timeout
      const executionPromise = script.runInContext(vmContext, { timeout: this.timeoutMs });
      const finalResult = await executionPromise;

      const durationMs = Date.now() - startTime;
      const tokensSavedEstimate = Math.max(0, (toolsCalled.length - 1) * 850);

      logAuditEvent({
        category: 'hermes', action: 'pipeline_executed', target: 'hermes_script_pipeline',
        // `tokensSavedEstimate` is (toolsCalled.length - 1) * 850 — an invented
        // number, not a measurement, so it is not recorded as one.
        payload: { toolsCount: toolsCalled.length, durationMs }
      });

      return {
        success: true,
        result: finalResult !== undefined ? finalResult : sandbox.result,
        toolsCalled,
        logs,
        durationMs,
        tokensSavedEstimate
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      logger.error('Pipeline execution error:', err.message);
      return {
        success: false,
        error: err.message,
        toolsCalled,
        logs,
        durationMs,
        tokensSavedEstimate: 0
      };
    }
  }
}

const globalHermesPipeline = new HermesScriptPipeline();

module.exports = {
  HermesScriptPipeline,
  globalHermesPipeline
};
