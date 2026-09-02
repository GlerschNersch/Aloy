// Advanced Vector Embedding RAG Knowledge Base using Ollama's nomic-embed-text model
import { fetchWithTimeout } from './fetchWithTimeout.js';

const OLLAMA_URL = import.meta.env?.VITE_OLLAMA_URL || 'http://localhost:11434';

async function getEmbedding(text) {
  try {
    const res = await fetchWithTimeout(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'nomic-embed-text',
        prompt: text.slice(0, 1000)
      })
    }, 20000);
    if (!res.ok) return null;
    const data = await res.json();
    return data.embedding || null;
  } catch (err) {
    console.error('Embedding error:', err);
    return null;
  }
}

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class DocumentKnowledgeBase {
  constructor() {
    this.documents = [];
  }

  async addDocument(filename, content, source = 'upload') {
    const chunks = this.chunkText(content, 400);
    const chunkPromises = chunks.map(async (c, i) => {
      const vec = await getEmbedding(c);
      return { chunkId: i, text: c, vector: vec };
    });

    const processedChunks = await Promise.all(chunkPromises);

    const docObj = {
      id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      filename,
      content,
      chunks: processedChunks,
      source
    };

    this.documents.push(docObj);
    return docObj;
  }

  removeDocument(id) {
    this.documents = this.documents.filter(d => d.id !== id);
  }

  chunkText(text, chunkSize = 400) {
    const paragraphs = text.split('\n\n');
    const chunks = [];
    let currentChunk = '';

    for (const p of paragraphs) {
      if ((currentChunk + p).length > chunkSize) {
        if (currentChunk) chunks.push(currentChunk.trim());
        currentChunk = p;
      } else {
        currentChunk += '\n\n' + p;
      }
    }
    if (currentChunk.trim()) chunks.push(currentChunk.trim());
    return chunks;
  }

  // Below this cosine similarity, a chunk is treated as "not actually
  // relevant" rather than a weak match — a lightweight Corrective-RAG check
  // so a near-empty knowledge base doesn't get padded with noise that the
  // model then treats as real context (the same failure mode as the
  // server's calendar hallucination, just for uploaded docs instead).
  static MIN_VECTOR_SIMILARITY = 0.35;
  // Reciprocal Rank Fusion constant (standard default) — combines the dense
  // (vector) and sparse (keyword) rankings without needing to normalize two
  // differently-scaled scores (cosine similarity vs. raw term-match counts).
  static RRF_K = 60;

  async search(query, topK = 3) {
    if (this.documents.length === 0) return '';

    const allChunks = [];
    this.documents.forEach(doc => {
      doc.chunks.forEach(chunk => {
        allChunks.push({ filename: doc.filename, text: chunk.text, vector: chunk.vector });
      });
    });
    if (allChunks.length === 0) return '';

    const queryVec = await getEmbedding(query);

    // Dense ranking — only chunks confident enough to trust.
    const vectorRanked = queryVec
      ? allChunks
          .filter(c => c.vector)
          .map(c => ({ ...c, vecScore: cosineSimilarity(queryVec, c.vector) }))
          .filter(c => c.vecScore >= DocumentKnowledgeBase.MIN_VECTOR_SIMILARITY)
          .sort((a, b) => b.vecScore - a.vecScore)
      : [];

    // Sparse ranking — always computed (not just an embedding-failure
    // fallback), so exact terms embeddings can blur (filenames, IDs, names)
    // still surface a match.
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    const keywordRanked = allChunks
      .map(c => {
        const textLower = c.text.toLowerCase();
        const kwScore = queryTerms.reduce((n, t) => n + (textLower.includes(t) ? 1 : 0), 0);
        return { ...c, kwScore };
      })
      .filter(c => c.kwScore > 0)
      .sort((a, b) => b.kwScore - a.kwScore);

    if (vectorRanked.length === 0 && keywordRanked.length === 0) return '';

    const fused = new Map();
    const addRanking = (ranked) => {
      ranked.forEach((c, rank) => {
        const key = `${c.filename}::${c.text}`;
        const prev = fused.get(key) || { filename: c.filename, text: c.text, rrfScore: 0 };
        prev.rrfScore += 1 / (DocumentKnowledgeBase.RRF_K + rank + 1);
        fused.set(key, prev);
      });
    };
    addRanking(vectorRanked);
    addRanking(keywordRanked);

    const topResults = [...fused.values()].sort((a, b) => b.rrfScore - a.rrfScore).slice(0, topK);
    if (topResults.length === 0) return '';

    let ragContext = `[LOCAL KNOWLEDGE BASE — HYBRID SEARCH (${topResults.length} Excerpts)]:\n`;
    topResults.forEach((res, i) => {
      ragContext += `--- Excerpt ${i + 1} (from file: ${res.filename}) ---\n${res.text}\n\n`;
    });

    return ragContext;
  }
}
