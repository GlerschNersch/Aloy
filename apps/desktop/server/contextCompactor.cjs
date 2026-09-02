/**
 * Rolling Chat Context Compactor for Aloy.
 * 
 * Prevents long conversation threads from exceeding model context limits
 * or degrading local Ollama generation speed by compacting older message turns
 * into a structured high-density summary while preserving recent turns intact.
 */

const MAX_PRESERVED_TURNS = 6;
const MAX_ESTIMATED_TOKENS = 3500;

/**
 * Estimates token count from a message list (~4 characters per token).
 * @param {Array<{role: string, content: string}>} messages
 * @returns {number}
 */
function estimateTokenCount(messages = []) {
  if (!Array.isArray(messages)) return 0;
  let chars = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') {
      chars += m.content.length;
    }
  }
  return Math.ceil(chars / 4);
}

/**
 * Extracts key topic bullets and conclusions from older message history.
 * @param {Array<{role: string, content: string}>} oldMessages 
 * @returns {string}
 */
function summarizeOlderMessages(oldMessages = []) {
  if (!Array.isArray(oldMessages) || oldMessages.length === 0) return '';

  const topics = [];
  for (const m of oldMessages) {
    if (!m.content || typeof m.content !== 'string') continue;
    const clean = m.content.replace(/\s+/g, ' ').trim();
    if (!clean) continue;

    if (m.role === 'user') {
      const promptSnippet = clean.length > 80 ? clean.slice(0, 77) + '...' : clean;
      topics.push(`User asked: "${promptSnippet}"`);
    } else if (m.role === 'assistant') {
      // Capture key outcome line (ignoring think tags if present)
      const nonThink = clean.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      if (nonThink) {
        const firstSentence = nonThink.split(/(?<=[.?!])\s+/)[0] || nonThink;
        const answerSnippet = firstSentence.length > 90 ? firstSentence.slice(0, 87) + '...' : firstSentence;
        topics.push(`Aloy established: ${answerSnippet}`);
      }
    }
  }

  return topics.slice(-8).map(t => `- ${t}`).join('\n');
}

/**
 * Compacts a conversation message history into bounded token payload.
 * @param {Array<{role: string, content: string}>} messages 
 * @param {Object} options 
 * @returns {{ compactedMessages: Array<{role: string, content: string}>, wasCompacted: boolean, originalCount: number, compactedCount: number, tokensEstimated: number }}
 */
function compactConversationHistory(messages = [], options = {}) {
  const preservedTurns = options.maxPreservedTurns || MAX_PRESERVED_TURNS;
  const maxTokens = options.maxTokens || MAX_ESTIMATED_TOKENS;

  if (!Array.isArray(messages) || messages.length <= preservedTurns) {
    return {
      compactedMessages: [...messages],
      wasCompacted: false,
      originalCount: messages ? messages.length : 0,
      compactedCount: messages ? messages.length : 0,
      tokensEstimated: estimateTokenCount(messages)
    };
  }

  const tokenEstimate = estimateTokenCount(messages);
  // If message count is high OR token count exceeds budget, perform compaction
  if (messages.length <= preservedTurns && tokenEstimate < maxTokens) {
    return {
      compactedMessages: [...messages],
      wasCompacted: false,
      originalCount: messages.length,
      compactedCount: messages.length,
      tokensEstimated: tokenEstimate
    };
  }

  const splitIndex = Math.max(0, messages.length - preservedTurns);
  const olderMessages = messages.slice(0, splitIndex);
  const recentMessages = messages.slice(splitIndex);

  const summaryBullets = summarizeOlderMessages(olderMessages);
  const summaryBlock = {
    role: 'system',
    content: `[PRIOR CONVERSATION SUMMARY & ESTABLISHED CONTEXT]\n${summaryBullets}\n(Above summary captures earlier discussion; continue seamlessly with latest turns below.)`,
    isCompactedSummary: true
  };

  const compactedMessages = [summaryBlock, ...recentMessages];

  return {
    compactedMessages,
    wasCompacted: true,
    originalCount: messages.length,
    compactedCount: compactedMessages.length,
    tokensEstimated: estimateTokenCount(compactedMessages)
  };
}

module.exports = {
  compactConversationHistory,
  estimateTokenCount,
  summarizeOlderMessages,
  MAX_PRESERVED_TURNS,
  MAX_ESTIMATED_TOKENS
};
