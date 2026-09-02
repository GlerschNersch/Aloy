// HERMES DIALECTIC MEMORY & FTS5 RETRIEVAL (Harvested from NousResearch/hermes-agent & Honcho)
// Implements cross-session full-text keyword retrieval (BM25) and Plastic Labs' Honcho dialectic user modeling.

const path = require('path');
const os = require('os');
const defaultStore = require('./store.cjs');
const { logAuditEvent } = require('./auditLogger.cjs');

class HermesDialecticMemory {
  constructor(options = {}) {
    this.store = options.store || defaultStore;
  }

  /**
   * Retrieves or initializes the structured Honcho dialectic user model.
   */
  getUserModel() {
    const d = this.store.load();
    const existing = d.dialecticUserModel;
    if (existing) return existing;

    const defaultModel = {
      userName: 'User',
      communication_style: 'Concise, direct, highly technical, prefers structured Markdown, tables, and exact code diffs without redundant boilerplate.',
      active_priorities: [
        'Aloy Desktop & Mobile System Development',
        'Home Assistant smart home telemetry and automation',
        'Obsidian Vault (Aloy Brain) bi-directional knowledge synchronization',
        'Health & fitness monitoring (Amazfit T-Rex 3, sleep & readiness tracking)',
        'Personal finances & budget monitoring'
      ],
      domain_expertise: [
        'Advanced Software Engineering & Agentic Architecture',
        'TypeScript / React / Node.js / Electron',
        'Local LLM inference & Ollama / MCP protocols'
      ],
      friction_points: [
        'Dislikes intrusive popups, cmd console flashes, or unclipped UI elements',
        'Dislikes wasting token context on multi-turn roundtrip tool calls',
        'Prefers seamless global hotkeys (Ctrl+Shift+Space) and edge-hover drawer triggers'
      ],
      working_habits: {
        environment: 'Windows 11 desktop environment, PowerShell, fast hotkeys',
        primaryVault: path.join(os.homedir(), 'Documents', 'Vault Notes', 'Aloy Brain'),
        theme: 'Cyberpunk glass neon dark obsidian aesthetic'
      },
      lastUpdated: new Date().toISOString(),
      interactionCount: 1
    };

    this.store.save({ dialecticUserModel: defaultModel });
    return defaultModel;
  }

  /**
   * Updates the dialectic user model based on recent conversational signals.
   */
  updateUserModel(updates = {}) {
    const current = this.getUserModel();
    const updated = {
      ...current,
      ...updates,
      lastUpdated: new Date().toISOString(),
      interactionCount: (current.interactionCount || 0) + 1
    };

    this.store.save({ dialecticUserModel: updated });
    // Was logAuditEvent('...', {...}) — two args to a function that takes one
    // options object, so this wrote an anonymous row with no payload.
    logAuditEvent({
      category: 'hermes', action: 'user_model_updated', target: 'hermes_user_model',
      payload: { keys: Object.keys(updates) }
    });
    return updated;
  }

  /**
   * Full-Text Search (FTS) with BM25-style keyword relevance scoring across all past chat sessions and memories.
   */
  searchCrossSession(query, { maxResults = 8 } = {}) {
    if (!query || typeof query !== 'string') return [];
    const queryTokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    if (queryTokens.length === 0) return [];

    const d = this.store.load();
    const chats = d.chats || [];
    const memories = d.memories || [];
    const lessons = d.lessons || [];

    const scoredHits = [];

    // 1. Search memories & lessons
    for (const m of [...memories, ...lessons]) {
      const text = `${m.text || m.lesson || ''} ${m.category || ''} ${m.tags ? m.tags.join(' ') : ''}`.toLowerCase();
      let matchCount = 0;
      for (const token of queryTokens) {
        if (text.includes(token)) matchCount += 1;
      }
      if (matchCount > 0) {
        const score = (matchCount / queryTokens.length) * 1.5;
        scoredHits.push({
          source: 'memory',
          category: m.category || 'general',
          content: m.text || m.lesson,
          timestamp: m.timestamp || m.created_at || new Date().toISOString(),
          score
        });
      }
    }

    // 2. Search chat session transcripts
    for (const chat of chats) {
      const messages = chat.messages || [];
      for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const content = (msg.content || '').toLowerCase();
        let matchCount = 0;
        for (const token of queryTokens) {
          if (content.includes(token)) matchCount += 1;
        }

        if (matchCount > 0) {
          const score = (matchCount / queryTokens.length);
          scoredHits.push({
            source: 'session',
            chatId: chat.id,
            chatTitle: chat.title || 'Chat',
            role: msg.role,
            content: msg.content.length > 300 ? msg.content.slice(0, 300) + '...' : msg.content,
            timestamp: msg.timestamp || chat.timestamp || new Date().toISOString(),
            score
          });
        }
      }
    }

    // Sort by BM25 relevance score descending
    scoredHits.sort((a, b) => b.score - a.score);
    return scoredHits.slice(0, maxResults);
  }

  /**
   * Generates a compact Dialectic Context Nudge for LLM prompt injection.
   */
  generateDialecticNudge(currentPrompt = '') {
    const model = this.getUserModel();
    const relevantMemories = this.searchCrossSession(currentPrompt, { maxResults: 3 });

    let nudge = `[HERMES DIALECTIC USER PROFILE]\n`;
    nudge += `• Style: ${model.communication_style}\n`;
    nudge += `• Top Priorities: ${model.active_priorities.slice(0, 3).join('; ')}\n`;
    nudge += `• Environment: ${model.working_habits.environment}\n`;

    if (relevantMemories.length > 0) {
      nudge += `[CROSS-SESSION RECALL]\n`;
      relevantMemories.forEach((hit, idx) => {
        nudge += `  ${idx + 1}. [${hit.source}] ${hit.content.replace(/\n+/g, ' ')}\n`;
      });
    }

    return nudge;
  }
}

const globalHermesMemory = new HermesDialecticMemory();

module.exports = {
  HermesDialecticMemory,
  globalHermesMemory
};
