/**
 * Hybrid Retrieval Engine for Aloy Pantheon (Apollo Memory/Vault & Athena Research)
 * Inspired by RAGFlow's DeepDoc & Hybrid Retrieval Architecture.
 * 
 * Features:
 * 1. Okapi BM25 Indexing & Sparse Retrieval with technical token preservation.
 * 2. Dense Vector Semantic Retrieval (Cosine Similarity).
 * 3. Reciprocal Rank Fusion (RRF, k=60) for mathematically robust rank merging.
 * 4. Grounded Citation Annotations & Excerpt Extraction.
 */

const { getEmbedding, cosineSimilarity } = require('./confidenceEscalation.cjs');

// Common English stopwords to ignore during BM25 indexing (unless part of code/technical tokens)
const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren',
  'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'could', 'did', 'didn', 'do', 'does', 'doesn', 'doing', 'don', 'down', 'during', 'each',
  'few', 'for', 'from', 'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers',
  'herself', 'him', 'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'isn', 'it', 'its',
  'itself', 'just', 'll', 'm', 'ma', 'me', 'more', 'most', 'my', 'myself', 'no', 'nor', 'not', 'now',
  'o', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over',
  'own', 're', 's', 'same', 'she', 'should', 'so', 'some', 'such', 't', 'than', 'that', 'the',
  'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those',
  'through', 'to', 'too', 'under', 'until', 'up', 've', 'very', 'was', 'wasn', 'we', 'were',
  'weren', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'won',
  'would', 'y', 'you', 'your', 'yours', 'yourself', 'yourselves'
]);

/**
 * Tokenizes text into normalized terms while preserving technical identifiers,
 * ports, device names, and underscores.
 */
function tokenize(text) {
  if (!text) return [];
  const clean = String(text).toLowerCase();
  const tokens = clean.match(/[a-z0-9_#@.:/-]{2,}/g) || [];
  return tokens.filter(t => !STOPWORDS.has(t) || /\d/.test(t) || t.includes('_') || t.includes('.'));
}

/**
 * In-memory Okapi BM25 Index for fast, exact keyword retrieval.
 */
class BM25Index {
  constructor(k1 = 1.2, b = 0.75) {
    this.k1 = k1;
    this.b = b;
    this.docs = [];           // Array of { id, text, tokens, length, original }
    this.docCount = 0;
    this.avgDocLength = 0;
    this.docFrequencies = {}; // term -> number of docs containing term
  }

  /**
   * Clears and builds the BM25 index from a list of documents.
   * @param {Array<{ id: string, text: string, [key: string]: any }>} documents 
   */
  buildIndex(documents = []) {
    this.docs = [];
    this.docFrequencies = {};
    this.docCount = documents.length;

    let totalLength = 0;

    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      const tokens = tokenize(doc.text || '');
      const docLength = tokens.length;
      totalLength += docLength;

      const termCounts = {};
      const uniqueTerms = new Set();

      for (const t of tokens) {
        termCounts[t] = (termCounts[t] || 0) + 1;
        uniqueTerms.add(t);
      }

      for (const t of uniqueTerms) {
        this.docFrequencies[t] = (this.docFrequencies[t] || 0) + 1;
      }

      this.docs.push({
        id: doc.id || `doc-${i}`,
        text: doc.text || '',
        tokens,
        termCounts,
        docLength,
        original: doc
      });
    }

    this.avgDocLength = this.docCount > 0 ? totalLength / this.docCount : 0;
  }

  /**
   * Scores all documents against a search query using Okapi BM25.
   * @param {string} query 
   * @returns {Array<{ id: string, doc: any, score: number, matchedTerms: string[] }>}
   */
  search(query) {
    const qTokens = tokenize(query);
    if (qTokens.length === 0 || this.docCount === 0) return [];

    const results = [];

    for (let i = 0; i < this.docs.length; i++) {
      const d = this.docs[i];
      let score = 0;
      const matchedTerms = [];

      for (const qt of qTokens) {
        const tf = d.termCounts[qt] || 0;
        if (tf > 0) {
          matchedTerms.push(qt);
          const df = this.docFrequencies[qt] || 0;
          // Standard Okapi BM25 IDF with smoothing
          const idf = Math.log(1 + (this.docCount - df + 0.5) / (df + 0.5));
          const num = tf * (this.k1 + 1);
          const denom = tf + this.k1 * (1 - this.b + this.b * (d.docLength / (this.avgDocLength || 1)));
          score += idf * (num / denom);
        }
      }

      if (score > 0) {
        results.push({
          id: d.id,
          doc: d.original,
          score,
          matchedTerms
        });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }
}

/**
 * Merges dense vector ranking and sparse BM25 ranking using Reciprocal Rank Fusion (RRF).
 * Formula: RRF(d) = sum( weight / (k + rank) )
 * 
 * @param {Array<{ id: string, doc: any, score: number, [key: string]: any }>} denseResults
 * @param {Array<{ id: string, doc: any, score: number, matchedTerms: string[] }>} sparseResults
 * @param {Object} options
 * @returns {Array<{ doc: any, rrfScore: number, denseRank: number, sparseRank: number, matchType: string, matchedTerms: string[] }>}
 */
function reciprocalRankFusion(denseResults = [], sparseResults = [], options = {}) {
  const k = options.k || 60;
  const denseWeight = options.denseWeight !== undefined ? options.denseWeight : 0.6;
  const sparseWeight = options.sparseWeight !== undefined ? options.sparseWeight : 0.4;

  const merged = new Map();

  // 1. Process Dense Results
  for (let rank = 0; rank < denseResults.length; rank++) {
    const item = denseResults[rank];
    const id = item.id || (item.doc && item.doc.id);
    if (!id) continue;

    const rrfScore = denseWeight / (k + (rank + 1));
    merged.set(id, {
      id,
      doc: item.doc,
      rrfScore,
      denseScore: item.score,
      denseRank: rank + 1,
      sparseScore: 0,
      sparseRank: null,
      matchedTerms: [],
      matchType: 'semantic_vector'
    });
  }

  // 2. Process Sparse BM25 Results
  for (let rank = 0; rank < sparseResults.length; rank++) {
    const item = sparseResults[rank];
    const id = item.id || (item.doc && item.doc.id);
    if (!id) continue;

    const sparseContribution = sparseWeight / (k + (rank + 1));

    if (merged.has(id)) {
      const existing = merged.get(id);
      existing.rrfScore += sparseContribution;
      existing.sparseScore = item.score;
      existing.sparseRank = rank + 1;
      existing.matchedTerms = item.matchedTerms || [];
      existing.matchType = 'hybrid';
    } else {
      merged.set(id, {
        id,
        doc: item.doc,
        rrfScore: sparseContribution,
        denseScore: 0,
        denseRank: null,
        sparseScore: item.score,
        sparseRank: rank + 1,
        matchedTerms: item.matchedTerms || [],
        matchType: 'exact_keyword'
      });
    }
  }

  return Array.from(merged.values()).sort((a, b) => b.rrfScore - a.rrfScore);
}

/**
 * Extracts a concise highlighted snippet around matched terms or query keywords.
 */
function extractSnippet(text, keywords = [], maxChars = 240) {
  if (!text) return '';
  const clean = String(text).replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;

  const lower = clean.toLowerCase();
  let firstIdx = -1;

  for (const kw of keywords) {
    const idx = lower.indexOf(String(kw).toLowerCase());
    if (idx !== -1 && (firstIdx === -1 || idx < firstIdx)) {
      firstIdx = idx;
    }
  }

  if (firstIdx === -1) {
    return clean.slice(0, maxChars) + '...';
  }

  const start = Math.max(0, firstIdx - 40);
  const end = Math.min(clean.length, start + maxChars);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < clean.length ? '...' : '';

  return prefix + clean.slice(start, end).trim() + suffix;
}

/**
 * High-Level Hybrid Search across any structured document / fact collection.
 * 
 * @param {string} query 
 * @param {Array<{ id: string, text: string, embedding?: number[], [key: string]: any }>} corpus 
 * @param {Object} options 
 * @returns {Promise<Array<{ entry: any, rrfScore: number, matchType: string, citationTag: string, snippet: string, matchedTerms: string[] }>>}
 */
async function hybridSearch(query, corpus = [], options = {}) {
  const cleanQuery = (query || '').trim();
  if (!cleanQuery || corpus.length === 0) return [];

  const topK = options.topK || 5;
  const minScore = options.minScore || 0.005;

  // 1. Sparse BM25 Search
  const bm25 = new BM25Index(options.k1, options.b);
  bm25.buildIndex(corpus);
  const sparseResults = bm25.search(cleanQuery);

  // 2. Dense Vector Search (if embeddings available or generated)
  let denseResults = [];
  let queryEmbedding = options.queryEmbedding;

  if (!queryEmbedding && corpus.some(c => Array.isArray(c.embedding) && c.embedding.length > 0)) {
    try {
      queryEmbedding = await getEmbedding(cleanQuery);
    } catch {}
  }

  if (queryEmbedding) {
    const scoredDense = [];
    for (const doc of corpus) {
      if (Array.isArray(doc.embedding) && doc.embedding.length > 0) {
        const sim = cosineSimilarity(queryEmbedding, doc.embedding);
        if (sim > 0.15) {
          scoredDense.push({ id: doc.id, doc, score: sim });
        }
      }
    }
    denseResults = scoredDense.sort((a, b) => b.score - a.score);
  }

  // 3. Reciprocal Rank Fusion
  const merged = reciprocalRankFusion(denseResults, sparseResults, options);

  // 4. Grounded Citations Formatting
  return merged
    .filter(m => m.rrfScore >= minScore)
    .slice(0, topK)
    .map((m, idx) => ({
      entry: m.doc,
      rrfScore: m.rrfScore,
      denseScore: m.denseScore,
      sparseScore: m.sparseScore,
      matchType: m.matchType,
      citationTag: `[${idx + 1}]`,
      snippet: extractSnippet(m.doc.text || m.doc.content || m.doc.summary || '', m.matchedTerms, 220),
      matchedTerms: m.matchedTerms
    }));
}

module.exports = {
  BM25Index,
  tokenize,
  reciprocalRankFusion,
  extractSnippet,
  hybridSearch
};
