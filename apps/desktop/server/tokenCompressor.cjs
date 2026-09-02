/**
 * Token Compressor & Quota-Aware Auto-Fallback Engine for Aloy.
 * Inspired by diegosouzapw / Gateway RTK & Caveman token reduction.
 * 
 * Capabilities:
 * 1. Lossless & High-Density Context Compression (trims JSON payloads, tool traces, code comments)
 * 2. Caveman Token Pruner for high-volume context feeds (RAG & Web Search snippets)
 * 3. Quota-Aware Provider State Manager & Fallback Cascade
 */

class TokenCompressor {
  /**
   * Compresses raw text by stripping repetitive syntax noise, excessive whitespace,
   * markdown header trails, and blank lines while preserving semantics.
   * @param {string} text 
   * @param {object} [options]
   * @returns {{ compressed: string, originalTokens: number, savedTokens: number, ratio: number }}
   */
  static compressText(text, options = {}) {
    if (!text || typeof text !== 'string') {
      return { compressed: '', originalTokens: 0, savedTokens: 0, ratio: 0 };
    }

    const originalLength = text.length;
    let out = text;

    // 1. Normalize excessive newlines and whitespace
    out = out.replace(/[ \t]+/g, ' ');
    out = out.replace(/\n\s*\n\s*\n+/g, '\n\n');

    // 2. Strip large repetitive code divider lines (e.g. // ========= or # --------)
    out = out.replace(/[#\/\-\*\=]{10,}/g, '');

    // 3. Compress JSON code blocks if requested or detected
    if (options.compressJson !== false) {
      out = out.replace(/```json([\s\S]*?)```/g, (match, jsonStr) => {
        try {
          const parsed = JSON.parse(jsonStr.trim());
          return '```json\n' + JSON.stringify(parsed) + '\n```';
        } catch {
          return match;
        }
      });
    }

    // 4. Caveman mode: prune non-essential conversational filler words for RAG contexts
    if (options.caveman) {
      out = this.applyCavemanPruning(out);
    }

    const compressedLength = out.length;
    const originalTokens = Math.ceil(originalLength / 4);
    const compressedTokens = Math.ceil(compressedLength / 4);
    const savedTokens = Math.max(0, originalTokens - compressedTokens);
    const ratio = originalTokens > 0 ? Number(((savedTokens / originalTokens) * 100).toFixed(1)) : 0;

    return {
      compressed: out.trim(),
      originalTokens,
      compressedTokens,
      savedTokens,
      ratio
    };
  }

  /**
   * Fast semantic pruner for RAG documents and tool results.
   * Keeps verbs, nouns, technical identifiers, code, and removes conversational padding.
   */
  static applyCavemanPruning(text) {
    const fillerPatterns = [
      /\b(please note that|it is worth mentioning that|as previously stated|in order to|as well as|due to the fact that)\b/gi,
      /\b(furthermore|moreover|additionally|essentially|basically|substantially)\b/gi
    ];
    let res = text;
    for (const pat of fillerPatterns) {
      res = res.replace(pat, '');
    }
    return res.replace(/\s+/g, ' ').trim();
  }

  /**
   * Compresses an entire array of chat messages.
   * @param {Array<{role: string, content: string}>} messages 
   * @param {object} [options]
   */
  static compressMessages(messages = [], options = {}) {
    if (!Array.isArray(messages)) return { messages: [], stats: { totalSaved: 0 } };

    let totalOriginal = 0;
    let totalCompressed = 0;

    const compressedMessages = messages.map((msg, index) => {
      // Keep the most recent user and assistant messages fully lossless
      const isRecent = index >= messages.length - 2;
      const opt = isRecent ? { ...options, caveman: false } : options;
      
      const res = this.compressText(msg.content, opt);
      totalOriginal += res.originalTokens;
      totalCompressed += res.compressedTokens;

      return {
        ...msg,
        content: res.compressed
      };
    });

    return {
      messages: compressedMessages,
      stats: {
        originalTokens: totalOriginal,
        compressedTokens: totalCompressed,
        savedTokens: totalOriginal - totalCompressed,
        compressionRatio: totalOriginal > 0 ? Number((((totalOriginal - totalCompressed) / totalOriginal) * 100).toFixed(1)) : 0
      }
    };
  }
}

/**
 * Quota & Fallback Router Tracker
 */
class QuotaFallbackRouter {
  constructor() {
    this.providers = new Map([
      ['claude', { status: 'healthy', failureCount: 0, lastFailure: 0, quotaRemaining: 100 }],
      ['ollama_gpu', { status: 'healthy', failureCount: 0, lastFailure: 0, quotaRemaining: 100 }],
      ['ollama_local', { status: 'healthy', failureCount: 0, lastFailure: 0, quotaRemaining: 100 }]
    ]);
    this.cooldownMs = 60000; // 1 minute cooldown on 429 / quota errors
  }

  recordFailure(providerName, error) {
    const p = this.providers.get(providerName) || { status: 'healthy', failureCount: 0, lastFailure: 0, quotaRemaining: 100 };
    p.failureCount += 1;
    p.lastFailure = Date.now();
    
    // If rate-limited or quota exceeded
    if (error && (error.status === 429 || String(error).includes('quota') || String(error).includes('rate limit'))) {
      p.status = 'rate_limited';
      p.quotaRemaining = 0;
    } else {
      p.status = 'degraded';
    }
    this.providers.set(providerName, p);
  }

  recordSuccess(providerName) {
    const p = this.providers.get(providerName);
    if (p) {
      p.failureCount = 0;
      p.status = 'healthy';
      p.quotaRemaining = 100;
    }
  }

  getOptimalProvider(preferred = 'ollama_gpu') {
    const now = Date.now();
    const candidateOrder = [preferred, 'ollama_gpu', 'ollama_local', 'claude'].filter((v, i, a) => a.indexOf(v) === i);

    for (const name of candidateOrder) {
      const p = this.providers.get(name);
      if (!p) continue;
      
      if (p.status === 'healthy') return name;
      if (p.status === 'rate_limited' && (now - p.lastFailure) > this.cooldownMs) {
        p.status = 'healthy';
        return name;
      }
      if (p.status === 'degraded' && (now - p.lastFailure) > 15000) {
        return name;
      }
    }
    return 'ollama_local'; // Safe universal fallback
  }

  getStatus() {
    return Object.fromEntries(this.providers.entries());
  }
}

const quotaRouter = new QuotaFallbackRouter();

module.exports = {
  TokenCompressor,
  QuotaFallbackRouter,
  quotaRouter
};
