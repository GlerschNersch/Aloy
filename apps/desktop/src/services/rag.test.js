import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DocumentKnowledgeBase } from './rag';

describe('DocumentKnowledgeBase (RAG Service)', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2, 0.3, 0.4, 0.5] })
    });
  });

  it('should initialize with an empty document list', () => {
    const rag = new DocumentKnowledgeBase();
    expect(rag.documents).toEqual([]);
  });

  it('should add a document and compute token chunks', async () => {
    const rag = new DocumentKnowledgeBase();
    const doc = await rag.addDocument('test.txt', 'This is a sample document for testing local RAG retrieval.');
    
    expect(rag.documents.length).toBe(1);
    expect(doc.filename).toBe('test.txt');
    expect(doc.chunks.length).toBeGreaterThan(0);
  });

  it('should search relevant context based on user query', async () => {
    const rag = new DocumentKnowledgeBase();
    await rag.addDocument('react.txt', 'React is a JavaScript library for building user interfaces with components.');
    await rag.addDocument('python.txt', 'Python is a high-level programming language used for machine learning and web apps.');

    const searchResults = await rag.search('Tell me about React user interfaces');
    expect(searchResults).toContain('React is a JavaScript library');
  });

  it('should remove a document by ID', async () => {
    const rag = new DocumentKnowledgeBase();
    const doc = await rag.addDocument('delete_me.txt', 'Content to delete');
    expect(rag.documents.length).toBe(1);

    rag.removeDocument(doc.id);
    expect(rag.documents.length).toBe(0);
  });

  it('should return no context when nothing is relevant (corrective threshold)', async () => {
    // Query embedding orthogonal to every stored chunk's embedding, and no
    // shared keywords either — should not pad the prompt with noise.
    global.fetch = vi.fn().mockImplementation((_url, opts) => {
      const { prompt } = JSON.parse(opts.body);
      const embedding = prompt.includes('unrelated_query_xyz')
        ? [1, 0, 0, 0, 0]
        : [0, 1, 0, 0, 0];
      return Promise.resolve({ ok: true, json: async () => ({ embedding }) });
    });

    const rag = new DocumentKnowledgeBase();
    await rag.addDocument('finance.txt', 'Quarterly budget report for household expenses.');

    const searchResults = await rag.search('unrelated_query_xyz');
    expect(searchResults).toBe('');
  });

  it('should surface an exact keyword match even with a weak embedding score (hybrid search)', async () => {
    // Every chunk's embedding is orthogonal to the query's (cosine 0, well
    // below the vector threshold), but the query shares exact terms with
    // one document — hybrid search should still surface it via keywords.
    global.fetch = vi.fn().mockImplementation((_url, opts) => {
      const { prompt } = JSON.parse(opts.body);
      let embedding = [0, 0, 1, 0, 0]; // default: unrelated direction
      if (prompt.includes('What is the status of ProjectZeta')) embedding = [1, 0, 0, 0, 0];
      else if (prompt.includes('ProjectZeta status')) embedding = [0, 1, 0, 0, 0];
      return Promise.resolve({ ok: true, json: async () => ({ embedding }) });
    });

    const rag = new DocumentKnowledgeBase();
    await rag.addDocument('project_zeta.txt', 'ProjectZeta status: deployment pending review.');
    await rag.addDocument('other.txt', 'Unrelated content about gardening tips.');

    const searchResults = await rag.search('What is the status of ProjectZeta');
    expect(searchResults).toContain('ProjectZeta status: deployment pending review.');
  });
});
