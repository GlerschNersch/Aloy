// Unified Knowledge Graph & Hybrid RAG Engine (GraphRAG) for Aloy.
// Connects Obsidian Vault Notes, Home Assistant Topology, Calendar Events,
// and P:\ Filesystem Media into a single queryable world model.

class BM25Index {
  constructor(k1 = 1.5, b = 0.75) {
    this.k1 = k1;
    this.b = b;
    this.documents = [];
    this.docLengths = [];
    this.avgDocLength = 0;
    this.termFreqs = [];
    this.docFreqs = new Map();
  }

  tokenize(text) {
    if (!text || typeof text !== 'string') return [];
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1);
  }

  addDocuments(docs) {
    this.documents = docs;
    this.docLengths = [];
    this.termFreqs = [];
    this.docFreqs.clear();

    let totalLength = 0;

    for (const doc of docs) {
      const tokens = this.tokenize(doc.content || doc.text || doc.title || '');
      const len = tokens.length;
      this.docLengths.push(len);
      totalLength += len;

      const tf = new Map();
      const uniqueTokens = new Set(tokens);

      for (const t of tokens) {
        tf.set(t, (tf.get(t) || 0) + 1);
      }
      this.termFreqs.push(tf);

      for (const t of uniqueTokens) {
        this.docFreqs.set(t, (this.docFreqs.get(t) || 0) + 1);
      }
    }

    this.avgDocLength = docs.length > 0 ? totalLength / docs.length : 0;
  }

  search(query, topK = 10) {
    const queryTokens = this.tokenize(query);
    if (queryTokens.length === 0 || this.documents.length === 0) return [];

    const N = this.documents.length;
    const scores = [];

    for (let i = 0; i < N; i++) {
      let score = 0;
      const tfMap = this.termFreqs[i];
      const docLen = this.docLengths[i];

      for (const token of queryTokens) {
        if (!tfMap.has(token)) continue;
        const df = this.docFreqs.get(token) || 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const tf = tfMap.get(token);
        const numerator = tf * (this.k1 + 1);
        const denominator = tf + this.k1 * (1 - this.b + this.b * (docLen / (this.avgDocLength || 1)));
        score += idf * (numerator / denominator);
      }

      if (score > 0) {
        scores.push({ document: this.documents[i], score, index: i });
      }
    }

    return scores.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}

/**
 * Unified Knowledge Graph representing entities, notes, files, and events.
 */
class UnifiedKnowledgeGraph {
  constructor() {
    this.nodes = new Map(); // id -> { id, type, label, properties }
    this.edges = []; // { source, target, relationship, weight }
    this.bm25Index = new BM25Index();
  }

  addNode(id, type, label, properties = {}) {
    const node = { id, type, label, properties, content: `${label} ${JSON.stringify(properties)}` };
    this.nodes.set(id, node);
    return node;
  }

  addEdge(source, target, relationship, weight = 1.0) {
    this.edges.push({ source, target, relationship, weight });
  }

  /**
   * Ingests Home Assistant entity topology into the graph.
   */
  ingestHomeAssistant(categories) {
    if (!categories) return;

    for (const [catName, entities] of Object.entries(categories)) {
      const catNodeId = `ha_cat:${catName}`;
      this.addNode(catNodeId, 'ha_category', catName);

      if (Array.isArray(entities)) {
        for (const ent of entities) {
          const entNodeId = `ha_entity:${ent.entity_id}`;
          this.addNode(entNodeId, 'ha_entity', ent.name || ent.entity_id, {
            entity_id: ent.entity_id,
            state: ent.state,
            category: catName,
            domain: ent.domain,
            friendly_name: ent.name
          });
          this.addEdge(catNodeId, entNodeId, 'contains_entity');
        }
      }
    }
  }

  /**
   * Ingests Obsidian vault notes.
   */
  ingestVaultNotes(notes) {
    if (!Array.isArray(notes)) return;
    for (const note of notes) {
      const noteId = `vault_note:${note.filename || note.title}`;
      this.addNode(noteId, 'vault_note', note.filename || note.title, {
        filename: note.filename,
        title: note.title,
        excerpt: (note.content || '').slice(0, 300)
      });
    }
  }

  /**
   * Ingests Media filesystem libraries (P:\).
   */
  ingestMediaLibrary(mediaData = {}) {
    const { movies = [], tvShows = [], musicArtists = [] } = mediaData;

    const rootP = this.addNode('fs:P', 'filesystem_drive', 'Drive P: Media Storage');

    if (movies.length > 0) {
      const movieDirNode = this.addNode('fs:P_Movies', 'media_library', 'Movies Library', { count: movies.length });
      this.addEdge(rootP.id, movieDirNode.id, 'contains_folder');
      for (const m of movies.slice(0, 50)) { // Sample key titles into graph
        const mNode = this.addNode(`movie:${m}`, 'movie_title', m);
        this.addEdge(movieDirNode.id, mNode.id, 'contains_title');
      }
    }

    if (tvShows.length > 0) {
      const tvDirNode = this.addNode('fs:P_TV', 'media_library', 'TV Shows Library', { count: tvShows.length });
      this.addEdge(rootP.id, tvDirNode.id, 'contains_folder');
      for (const tv of tvShows) {
        const tvNode = this.addNode(`tv:${tv}`, 'tv_show', tv);
        this.addEdge(tvDirNode.id, tvNode.id, 'contains_show');
      }
    }
  }

  /**
   * Builds the fast searchable index across all graph nodes.
   */
  rebuildSearchIndex() {
    const allDocs = Array.from(this.nodes.values()).map(node => ({
      id: node.id,
      type: node.type,
      label: node.label,
      content: `${node.label} ${node.type} ${JSON.stringify(node.properties)}`
    }));
    this.bm25Index.addDocuments(allDocs);
  }

  /**
   * Unified search across knowledge graph combining BM25 and connected neighbors.
   */
  searchUnified(query, limit = 6) {
    const directHits = this.bm25Index.search(query, limit);
    const enrichedResults = [];

    for (const hit of directHits) {
      const node = hit.document;
      const connected = this.edges
        .filter(e => e.source === node.id || e.target === node.id)
        .map(e => {
          const otherId = e.source === node.id ? e.target : e.source;
          return { relationship: e.relationship, node: this.nodes.get(otherId) };
        })
        .filter(c => c.node);

      enrichedResults.push({
        node,
        score: hit.score,
        connections: connected.slice(0, 4)
      });
    }

    return enrichedResults;
  }
}

const store = require('./store.cjs');

function ingestStoreNotes(kg, d) {
  const memories = d.memories || [];
  const notes = memories.map((m, i) => ({
    filename: `memory_${i}`,
    title: typeof m === 'object' ? (m.category || `Memory ${i + 1}`) : `Memory ${i + 1}`,
    content: typeof m === 'string' ? m : (m.content || JSON.stringify(m))
  }));

  const learned = d.learnedKnowledge || [];
  for (const item of learned) {
    notes.push({
      filename: `learned_${item.id || item.topic}`,
      title: item.topic || 'Learned Fact',
      content: item.summary || ''
    });
  }

  kg.ingestVaultNotes(notes);
}

/**
 * Builds a fresh graph from current HA topology + the store's
 * memories/learnedKnowledge domains. Rebuilt on every call rather than
 * cached — the graph is small (hundreds of nodes at most) and rebuilding
 * avoids a stale-index class of bug for near-zero cost.
 */
function buildGraph(haCategories) {
  const kg = new UnifiedKnowledgeGraph();
  if (haCategories) kg.ingestHomeAssistant(haCategories);
  ingestStoreNotes(kg, store.load());
  kg.rebuildSearchIndex();
  return kg;
}

function searchKnowledgeGraph(query, haCategories, limit = 6) {
  const kg = buildGraph(haCategories);
  const results = kg.searchUnified(query, limit);
  if (results.length === 0) {
    return 'No matching entities, memories, or knowledge found in the graph for that query.';
  }
  return results
    .map((r) => {
      const conns = r.connections.map((c) => `${c.relationship} -> ${c.node.label}`).join('; ');
      return `- [${r.node.type}] ${r.node.label}${conns ? ` (${conns})` : ''}`;
    })
    .join('\n');
}

module.exports = {
  BM25Index,
  UnifiedKnowledgeGraph,
  buildGraph,
  searchKnowledgeGraph
};
