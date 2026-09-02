import { describe, it, expect } from 'vitest';
import { BM25Index, tokenize, reciprocalRankFusion, extractSnippet, hybridSearch } from './hybridRetriever.cjs';
import { chunkDocumentDeepDoc, normalizeDocumentToMarkdown } from './mineruNormalizer.cjs';

describe('Hybrid Retrieval Engine (RAGFlow Harvest)', () => {
  describe('BM25 Tokenization & Indexing', () => {
    it('preserves technical tokens, ports, and underscores while filtering standard stopwords', () => {
      const tokens = tokenize('The server is running on port 7890 with lock.front_door and nvenc_preset=p5');
      expect(tokens).toContain('7890');
      expect(tokens).toContain('lock.front_door');
      expect(tokens).toContain('nvenc_preset');
      expect(tokens).not.toContain('the');
      expect(tokens).not.toContain('is');
      expect(tokens).not.toContain('on');
    });

    it('scores exact technical queries with high precision using BM25', () => {
      const docs = [
        { id: 'doc1', text: 'Jellyfin media server transcoding with NVENC hardware acceleration on port 8096.' },
        { id: 'doc2', text: 'Home Assistant smart lighting automation and front door security lock on port 8123.' },
        { id: 'doc3', text: 'Aloy subagent Hephaestus code forge running autonomous QLoRA tests.' }
      ];

      const bm25 = new BM25Index();
      bm25.buildIndex(docs);

      const results1 = bm25.search('NVENC port 8096');
      expect(results1.length).toBeGreaterThan(0);
      expect(results1[0].id).toBe('doc1');
      expect(results1[0].matchedTerms).toContain('nvenc');

      const results2 = bm25.search('front door lock');
      expect(results2.length).toBeGreaterThan(0);
      expect(results2[0].id).toBe('doc2');
    });
  });

  describe('Reciprocal Rank Fusion (RRF)', () => {
    it('merges vector results and BM25 results with proper hybrid boosting', () => {
      const dense = [
        { id: 'docA', score: 0.95 },
        { id: 'docB', score: 0.85 }
      ];
      const sparse = [
        { id: 'docB', score: 3.5, matchedTerms: ['query'] },
        { id: 'docC', score: 2.1, matchedTerms: ['query'] }
      ];

      const merged = reciprocalRankFusion(dense, sparse, { k: 60, denseWeight: 0.6, sparseWeight: 0.4 });
      expect(merged.length).toBe(3);
      // docB appears in both dense and sparse, so its RRF score is boosted
      const docBEntry = merged.find(m => m.id === 'docB');
      expect(docBEntry.matchType).toBe('hybrid');
      expect(docBEntry.denseRank).toBe(2);
      expect(docBEntry.sparseRank).toBe(1);
    });

    it('extracts contextual snippets around matched terms', () => {
      const longText = 'The Aloy ecosystem includes Athena for deep research, Apollo for persistent vault memories, and Hermes for daily briefings.';
      const snippet = extractSnippet(longText, ['Apollo'], 60);
      expect(snippet).toContain('Apollo');
    });
  });

  describe('End-to-End Hybrid Search', () => {
    it('successfully retrieves relevant entries with citation tags', async () => {
      const corpus = [
        { id: 'c1', text: 'Hephaestus autonomous code forge generates patches and verifies unit tests.', embedding: [0.1, 0.2, 0.3] },
        { id: 'c2', text: 'Apollo organizes Obsidian Vault notes and maintains skills matrix proficiency.', embedding: [0.8, 0.1, 0.1] }
      ];

      const results = await hybridSearch('code forge unit tests', corpus, { topK: 2 });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].citationTag).toBe('[1]');
      expect(results[0].entry.id).toBe('c1');
    });
  });

  describe('DeepDoc Structure-Aware Atomic Chunking', () => {
    it('keeps markdown tables completely intact as atomic units', () => {
      const markdown = `
# System Port Map

Here is the table of ports:

| Service | Port | Protocol |
| --- | --- | --- |
| Aloy Server | 7890 | HTTP/WS |
| Home Assistant | 8123 | HTTP |
| Jellyfin | 8096 | HTTP |

End of table.
      `;

      const chunks = chunkDocumentDeepDoc(markdown, { maxTokens: 50 });
      const tableChunk = chunks.find(c => c.contentType === 'table');
      expect(tableChunk).toBeDefined();
      expect(tableChunk.content).toContain('| Aloy Server | 7890 | HTTP/WS |');
      expect(tableChunk.content).toContain('| Jellyfin | 8096 | HTTP |');
      expect(tableChunk.sectionBreadcrumbs).toContain('System Port Map');
    });

    it('keeps code blocks intact as atomic units', () => {
      const markdown = `
## Configuration Example

\`\`\`json
{
  "serverPort": 7890,
  "model": "aloy-ai:latest"
}
\`\`\`
      `;

      const chunks = chunkDocumentDeepDoc(markdown, { maxTokens: 50 });
      const codeChunk = chunks.find(c => c.contentType === 'code');
      expect(codeChunk).toBeDefined();
      expect(codeChunk.content).toContain('serverPort');
      expect(codeChunk.sectionBreadcrumbs).toContain('Configuration Example');
    });
  });
});
