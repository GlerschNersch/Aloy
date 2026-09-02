/**
 * LightRAG-inspired Dual-Level Knowledge Graph & Multi-Hop Retrieval Engine for Apollo.
 * 
 * Features:
 * - Dual-Level Knowledge Graph indexing:
 *   1. Low-Level Entity Nodes (functions, devices, paths, configs, parameters)
 *   2. High-Level Thematic Clusters (Architecture, Home Automation, Transcoding, Memory)
 * - Multi-Hop Graph Traversal across Obsidian Vault notes and live system state
 * - Strict schema indexing and token-efficient subgraph extraction
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { logAuditEvent } = require('./auditLogger.cjs');

// The notes live one level down, in 'Vault Notes/Aloy Brain' (see conclave.cjs
// and hermesDialecticMemory.cjs, which both use that path). Pointing at the
// parent and reading it non-recursively meant the graph indexed zero notes, and
// /api/graphrag/query returned an empty result under a header that reads to the
// model as "retrieval ran and found nothing" rather than "retrieval never ran".
const DEFAULT_VAULT_DIR = path.join(os.homedir(), 'Documents', 'Vault Notes', 'Aloy Brain');

// An Obsidian vault is nested by definition, so walk it.
function walkMarkdown(dir, depth = 0, acc = []) {
  if (depth > 6) return acc;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (err) { console.warn('[lightGraphRAG] cannot read', dir, err.message); return acc; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkMarkdown(full, depth + 1, acc);
    else if (e.name.endsWith('.md')) acc.push(full);
  }
  return acc;
}

class LightGraphRAG {
  constructor(options = {}) {
    this.vaultDir = options.vaultDir || DEFAULT_VAULT_DIR;
    this.graph = {
      entities: new Map(), // id -> { id, label, type, metadata, notes: [] }
      themes: new Map(),   // id -> { id, label, description, entityIds: Set }
      edges: []            // Array<{ source, target, relation, weight }>
    };
    this.lastIndexedAt = null;
  }

  /**
   * Builds the dual-level knowledge graph from Obsidian Vault Notes and system facts.
   * @param {Array<string>} [additionalFacts]
   * @returns {Promise<{ nodeCount: number, edgeCount: number, themeCount: number }>}
   */
  async buildKnowledgeGraph(additionalFacts = []) {
    this.graph.entities.clear();
    this.graph.themes.clear();
    this.graph.edges = [];

    // 1. Initialize High-Level Thematic Clusters
    const coreThemes = [
      { id: 'theme-smarthome', label: 'Smart Home & Automation', description: 'Home Assistant entities, lighting, locks, thermostats, and 2FA gates.' },
      { id: 'theme-media', label: 'Media Ripping & Jellyfin', description: 'AutoRipManager disc encoding, NVENC quality flags, Jellyfin library structure.' },
      { id: 'theme-environment', label: 'System Infrastructure', description: 'Windows environment, VS Code, Python 3.11, Docker, and subagents.' },
      { id: 'theme-agentic', label: 'Pantheon Autonomous Agents', description: 'Athena scout, Hephaestus forge, Apollo vault, Minerva sentinel, Hermes briefs.' }
    ];

    for (const theme of coreThemes) {
      this.graph.themes.set(theme.id, { ...theme, entityIds: new Set() });
    }

    // 2. Index Markdown Notes in Vault Notes
    if (fs.existsSync(this.vaultDir)) {
      for (const filePath of walkMarkdown(this.vaultDir)) {
        try {
          this.indexNoteContent(path.relative(this.vaultDir, filePath), fs.readFileSync(filePath, 'utf8'));
        } catch (err) {
          // Logged, not swallowed: a permissions problem used to index as an
          // empty graph with no signal at all.
          console.warn('[lightGraphRAG] skipping', filePath, err.message);
        }
      }
    } else {
      console.warn('[lightGraphRAG] vault directory does not exist:', this.vaultDir);
    }

    // 3. Index Facts and System Memory
    for (const fact of additionalFacts) {
      if (typeof fact === 'string') {
        this.indexFactString(fact);
      }
    }

    this.lastIndexedAt = new Date().toISOString();

    return {
      nodeCount: this.graph.entities.size,
      edgeCount: this.graph.edges.length,
      themeCount: this.graph.themes.size,
      timestamp: this.lastIndexedAt
    };
  }

  /**
   * Indexes a single markdown note into entities and relations.
   */
  indexNoteContent(fileName, content) {
    const noteId = `note-${fileName.replace(/\.md$/i, '')}`;
    this.addEntity(noteId, fileName, 'Note', { path: fileName });

    // Extract headers (sub-themes or concepts)
    const headerRegex = /^(#{1,3})\s+(.+)$/gm;
    let match;
    while ((match = headerRegex.exec(content)) !== null) {
      const heading = match[2].trim();
      const entityId = `concept-${heading.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      this.addEntity(entityId, heading, 'Concept', { sourceNote: fileName });
      this.addEdge(noteId, entityId, 'defines');

      // Map to themes
      if (/home|assistant|light|lock|switch/i.test(heading)) {
        this.linkEntityToTheme('theme-smarthome', entityId);
      } else if (/media|rip|autorip|video|jellyfin/i.test(heading)) {
        this.linkEntityToTheme('theme-media', entityId);
      } else if (/heph|athena|apollo|minerva|hermes|pantheon/i.test(heading)) {
        this.linkEntityToTheme('theme-agentic', entityId);
      } else {
        this.linkEntityToTheme('theme-environment', entityId);
      }
    }
  }

  /**
   * Indexes a plain text fact into graph nodes and edges.
   */
  indexFactString(fact) {
    const factId = `fact-${Math.abs(this.hashCode(fact)).toString(16)}`;
    this.addEntity(factId, fact, 'Fact', { raw: fact });

    if (/home assistant|homeassistant|hass|light|lock|calendar/i.test(fact)) {
      this.linkEntityToTheme('theme-smarthome', factId);
    } else if (/autorip|nvenc|h\.264|h\.265|rip|transcode/i.test(fact)) {
      this.linkEntityToTheme('theme-media', factId);
    } else if (/windows|vs code|python|docker/i.test(fact)) {
      this.linkEntityToTheme('theme-environment', factId);
    } else {
      this.linkEntityToTheme('theme-agentic', factId);
    }
  }

  addEntity(id, label, type, metadata = {}) {
    if (!this.graph.entities.has(id)) {
      this.graph.entities.set(id, { id, label, type, metadata });
    }
  }

  addEdge(source, target, relation, weight = 1.0) {
    this.graph.edges.push({ source, target, relation, weight });
  }

  linkEntityToTheme(themeId, entityId) {
    const theme = this.graph.themes.get(themeId);
    if (theme) {
      theme.entityIds.add(entityId);
      this.addEdge(themeId, entityId, 'contains_entity');
    }
  }

  /**
   * Multi-Hop Subgraph Retrieval:
   * Traverses graph to retrieve relevant high-level themes, low-level entities, and connected notes.
   * @param {string} query 
   * @param {Object} [options]
   * @returns {{ themes: Array<Object>, entities: Array<Object>, contextMarkdown: string }}
   */
  queryGraph(query, options = {}) {
    const lower = (query || '').toLowerCase();
    const matchedThemesMap = new Map();
    const matchedEntities = [];

    // 1. Identify relevant themes directly (High-Level search)
    for (const theme of this.graph.themes.values()) {
      if (lower.includes(theme.label.toLowerCase()) || theme.description.toLowerCase().split(' ').some(w => w.length > 3 && lower.includes(w))) {
        matchedThemesMap.set(theme.id, {
          id: theme.id,
          label: theme.label,
          description: theme.description
        });
      }
    }

    // 2. Identify relevant entities (Low-Level search)
    for (const entity of this.graph.entities.values()) {
      const labelLower = entity.label.toLowerCase();
      const rawLower = (entity.metadata?.raw || '').toLowerCase();
      if (labelLower.includes(lower) || lower.includes(labelLower) || rawLower.includes(lower)) {
        matchedEntities.push(entity);

        // Multi-Hop: Find which themes contain this entity and add them
        for (const [tId, themeObj] of this.graph.themes.entries()) {
          if (themeObj.entityIds.has(entity.id) && !matchedThemesMap.has(tId)) {
            matchedThemesMap.set(tId, {
              id: themeObj.id,
              label: themeObj.label,
              description: themeObj.description
            });
          }
        }
      }
    }

    // 3. Multi-Hop expansion: if themes matched, bring in top connected entities
    for (const theme of matchedThemesMap.values()) {
      const fullTheme = this.graph.themes.get(theme.id);
      if (fullTheme) {
        for (const entityId of fullTheme.entityIds) {
          const ent = this.graph.entities.get(entityId);
          if (ent && !matchedEntities.some(e => e.id === ent.id) && matchedEntities.length < 15) {
            matchedEntities.push(ent);
          }
        }
      }
    }

    const matchedThemes = Array.from(matchedThemesMap.values());

    // 4. Synthesize structured GraphRAG Context
    const mdLines = ['### 🌐 Dual-Level Knowledge Graph Retrieval:'];
    if (matchedThemes.length > 0) {
      mdLines.push('\n**Thematic Clusters:**');
      matchedThemes.forEach(t => mdLines.push(`- **${t.label}**: ${t.description}`));
    }

    if (matchedEntities.length > 0) {
      mdLines.push('\n**Connected Entities & Notes:**');
      matchedEntities.slice(0, 10).forEach(e => {
        mdLines.push(`- [${e.type}] **${e.label}**`);
      });
    }

    return {
      themes: matchedThemes,
      entities: matchedEntities,
      contextMarkdown: mdLines.join('\n')
    };
  }

  hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }
}

const globalLightGraphRAG = new LightGraphRAG();

module.exports = {
  LightGraphRAG,
  globalLightGraphRAG
};
