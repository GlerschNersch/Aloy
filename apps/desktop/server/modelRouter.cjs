// Model Router: Intelligently routes incoming prompts to specialized models
// based on intent (Coding, Vision/Screen inspection, General dialogue, etc.)

// Reads from models.cjs (the single source of truth for model IDs) rather
// than hardcoding its own copy — this file used to keep an independent
// MODEL_REGISTRY with the same three model IDs, exactly the drift risk
// models.cjs's own header comment was written to prevent. Found and fixed
// 2026-08-23 while switching the CODER model to 7b: this registry still had
// its own separate hardcoded '14b' that models.cjs's env-override wouldn't
// have touched.
const { MODELS } = require('./models.cjs');
const MODEL_REGISTRY = {
  CODER: MODELS.CODER,
  VISION: MODELS.VISION,
  GENERAL: MODELS.GENERAL
};

const CODER_KEYWORDS = [
  'write a python', 'write python', 'write a javascript', 'write javascript',
  'write code', 'debug code', 'fix error', 'refactor', 'function', 'class',
  'parse json', 'regex', 'npm', 'git', 'endpoint', 'syntax', 'script'
];

const VISION_KEYWORDS = [
  'look at my screen', 'what is showing on my screen', 'screenshot',
  'what error is showing', 'look at this image', 'visual', 'ocr', 'inspect screen'
];

/**
 * Inspects conversation messages and selects the optimal model.
 * @param {Array<{role: string, content: string}>} messages
 * @returns {{ selectedModel: string, route: 'coder' | 'vision' | 'general', reason: string }}
 */
function routeModelRequest(messages = []) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { selectedModel: MODEL_REGISTRY.GENERAL, route: 'general', reason: 'empty_prompt_default' };
  }

  const latestUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';
  const lower = latestUserMsg.toLowerCase();

  // Check Vision triggers
  for (const kw of VISION_KEYWORDS) {
    if (lower.includes(kw)) {
      return {
        selectedModel: MODEL_REGISTRY.VISION,
        route: 'vision',
        reason: `Matched vision trigger: "${kw}"`
      };
    }
  }

  // Check Coder triggers
  for (const kw of CODER_KEYWORDS) {
    if (lower.includes(kw)) {
      return {
        selectedModel: MODEL_REGISTRY.CODER,
        route: 'coder',
        reason: `Matched coding trigger: "${kw}"`
      };
    }
  }

  return {
    selectedModel: MODEL_REGISTRY.GENERAL,
    route: 'general',
    reason: 'Default general conversation'
  };
}

module.exports = {
  MODEL_REGISTRY,
  routeModelRequest
};
