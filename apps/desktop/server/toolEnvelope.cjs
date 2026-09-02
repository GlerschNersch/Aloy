// Standardized Tool Output Envelope & Recovery Hints — harvested from HKUDS/CLI-Anything.
// Provides uniform agent-friendly JSON structures for all tool results and errors.

/**
 * Standard success envelope
 */
function wrapToolSuccess(data, metadata = {}) {
  return {
    status: 'success',
    data,
    metadata: {
      timestamp: new Date().toISOString(),
      ...metadata
    }
  };
}

/**
 * Standard error envelope with actionable self-correction recovery hints
 */
function wrapToolError(message, { code = 'EXECUTION_ERROR', didYouMean = [], recoveryHint = null, raw = null } = {}) {
  const envelope = {
    status: 'error',
    code,
    message: String(message || 'An error occurred during tool execution'),
    metadata: {
      timestamp: new Date().toISOString()
    }
  };

  if (Array.isArray(didYouMean) && didYouMean.length > 0) {
    envelope.didYouMean = didYouMean;
  }

  if (recoveryHint) {
    envelope.recoveryHint = recoveryHint;
  }

  if (raw !== null && raw !== undefined) {
    envelope.raw = raw;
  }

  return envelope;
}

/**
 * Formats any tool return value into an unambiguous string for model consumption
 */
function formatAgentResult(rawResult, toolName = '') {
  if (typeof rawResult === 'string') {
    // If already valid JSON string, leave it or check for error
    try {
      const parsed = JSON.parse(rawResult);
      if (parsed && typeof parsed === 'object' && (parsed.status === 'error' || parsed.error)) {
        const hint = parsed.recoveryHint || `Review the error output above and adjust parameters for '${toolName}'.`;
        return `${rawResult}\n\n[SYSTEM HINT]: Tool '${toolName || 'action'}' reported an issue. ${hint}`;
      }
      return rawResult;
    } catch {
      // Plain text check
      const isError = /\b(error|failed|exception|not found|unrecognized)\b/i.test(rawResult);
      if (isError) {
        return `${rawResult}\n\n[SYSTEM HINT]: Tool '${toolName || 'action'}' encountered an issue. Review the output and attempt a self-correction with adjusted parameters or an alternative approach.`;
      }
      return rawResult;
    }
  }

  if (rawResult && typeof rawResult === 'object') {
    return JSON.stringify(rawResult, null, 2);
  }

  return String(rawResult ?? '');
}

module.exports = {
  wrapToolSuccess,
  wrapToolError,
  formatAgentResult
};
