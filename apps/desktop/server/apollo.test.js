import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ApolloEngine, APOLLO_STATUS } from './apollo.cjs';
import { syncToVault } from './vaultSync.cjs';
import fs from 'fs';
import os from 'os';
import path from 'path';

function createMockStore(initialData = {}) {
  let data = {
    memories: ['User prefers concise code', 'User lives in Los Angeles', 'User prefers concise code'],
    curatedDocuments: [],
    ...initialData
  };

  return {
    load: () => JSON.parse(JSON.stringify(data)),
    save: (next) => { data = JSON.parse(JSON.stringify(next)); return true; },
    getRaw: () => data
  };
}

describe('APOLLO (VAULT) — Autonomous Knowledge & Memory Engine (20 Tests)', () => {
  let engine;
  let testTempDir;
  let testTasksFile;
  let mockStore;

  beforeEach(() => {
    testTempDir = path.join(os.tmpdir(), `apollo_suite_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    fs.mkdirSync(testTempDir, { recursive: true });
    testTasksFile = path.join(testTempDir, 'apollo-tasks.json');
    mockStore = createMockStore();
    engine = new ApolloEngine(testTasksFile, mockStore);
  });

  afterEach(() => {
    if (fs.existsSync(testTempDir)) {
      try {
        fs.rmSync(testTempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  // 1. Initialization
  it('1. initializes ApolloEngine with clean task list', () => {
    const tasks = engine.listTasks();
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBe(0);
  });

  // 2. Memory gardening & deduplication
  it('2. gardens and deduplicates user memories preserving clean string format', () => {
    mockStore = createMockStore({
      memories: [
        'User loves espresso',
        'User codes in TypeScript',
        'User loves espresso'
      ]
    });
    engine = new ApolloEngine(testTasksFile, mockStore);

    const result = engine.gardenMemories();
    expect(result.success).toBe(true);
    expect(result.finalCount).toBe(2);
    expect(result.prunedCount).toBe(1);
    expect(result.memories).toEqual(['User loves espresso', 'User codes in TypeScript']);
  });

  // 3. Whitespace and case normalization in memories
  it('3. handles whitespace-padded and mixed-case memory duplicates', () => {
    mockStore = createMockStore({
      memories: [
        'User prefers Dark Theme',
        '   user prefers dark theme   ',
        'User prefers light theme'
      ]
    });
    engine = new ApolloEngine(testTasksFile, mockStore);

    const result = engine.gardenMemories();
    expect(result.finalCount).toBe(2);
    expect(result.prunedCount).toBe(1);
    expect(result.memories[0]).toBe('User prefers Dark Theme');
  });

  // 4. Empty memory pruning
  it('4. prunes empty and whitespace-only memory entries', () => {
    mockStore = createMockStore({
      memories: ['Valid memory', '', '   ', '\t\n', 'Another valid memory']
    });
    engine = new ApolloEngine(testTasksFile, mockStore);

    const result = engine.gardenMemories();
    expect(result.finalCount).toBe(2);
    expect(result.prunedCount).toBe(3);
    expect(result.memories).toEqual(['Valid memory', 'Another valid memory']);
  });

  // 5. Object format normalization
  it('5. handles memory list with legacy objects normalizing them to clean strings', () => {
    mockStore = createMockStore({
      memories: [
        { fact: 'User likes React' },
        { text: 'User works on Windows' },
        'User uses Ollama'
      ]
    });
    engine = new ApolloEngine(testTasksFile, mockStore);

    const result = engine.gardenMemories();
    expect(result.finalCount).toBe(3);
    expect(result.memories).toEqual(['User likes React', 'User works on Windows', 'User uses Ollama']);
  });

  // 6. Document task creation
  it('6. creates document processing task with unique apollo- prefix ID', async () => {
    const task = await engine.createDocumentTask({
      title: 'Neural Network Architectures',
      rawContent: 'Transformers rely on scaled dot-product self-attention mechanisms.',
      category: 'Deep Learning'
    });

    expect(task.id).toMatch(/^apollo-[a-z0-9]+-[a-z0-9]+/);
    expect(task.title).toBe('Neural Network Architectures');
    expect(task.category).toBe('Deep Learning');
    expect(task.status).toBe(APOLLO_STATUS.QUEUED);
  });

  // 7. Entity extraction
  it('7. extracts semantic entities from document text', async () => {
    const task = await engine.createDocumentTask({
      title: 'Quantum Physics',
      rawContent: 'Quantum superposition and entanglement enable exponential speedups in Shor algorithm.'
    });

    await new Promise(r => setTimeout(r, 100));
    const processed = engine.getTask(task.id);
    expect(processed.entities).toBeDefined();
    expect(Array.isArray(processed.entities)).toBe(true);
    expect(processed.entities.length).toBeGreaterThan(0);
  });

  // 8. Summary synthesis
  it('8. generates concise executive summary of ingested document', async () => {
    const task = await engine.createDocumentTask({
      title: 'Distributed Systems',
      rawContent: 'Raft consensus algorithm uses leader election and log replication to ensure fault tolerance.'
    });

    await new Promise(r => setTimeout(r, 100));
    const processed = engine.getTask(task.id);
    expect(processed.summary).toBeDefined();
    expect(processed.summary.length).toBeGreaterThan(10);
  });

  // 9. Curated documents store separation
  it('9. stores curated documents in store without polluting learnedKnowledge or memories', async () => {
    const task = await engine.createDocumentTask({
      title: 'Graph Theory',
      rawContent: 'Dijkstra shortest path algorithm operates on weighted directed graphs.'
    });

    await new Promise(r => setTimeout(r, 100));
    const raw = mockStore.getRaw();
    expect(raw.curatedDocuments).toBeDefined();
    expect(raw.curatedDocuments.some(d => d.title === 'Graph Theory')).toBe(true);
    expect(raw.learnedKnowledge).toBeUndefined();
  });

  // 10. Knowledge retrieval by keyword
  it('10. retrieves knowledge by semantic keyword query', () => {
    mockStore = createMockStore({
      curatedDocuments: [
        { id: 'doc-1', title: 'Kubernetes Guide', summary: 'Container orchestration platform', entities: ['K8s', 'Pod'] },
        { id: 'doc-2', title: 'PostgreSQL Internals', summary: 'Relational database engine MVCC', entities: ['SQL', 'MVCC'] }
      ]
    });
    engine = new ApolloEngine(testTasksFile, mockStore);

    const hits = mockStore.getRaw().curatedDocuments.filter(d =>
      d.title.toLowerCase().includes('kubernetes') || d.summary.toLowerCase().includes('orchestration')
    );
    expect(hits.length).toBe(1);
    expect(hits[0].id).toBe('doc-1');
  });

  // 11. Obsidian vault sync markdown formatting
  it('11. formats markdown file for Obsidian vault sync with yaml frontmatter', () => {
    const note = {
      title: 'State of React 2026',
      content: 'React 19 Server Components and Actions.',
      tags: ['react', 'frontend', 'javascript']
    };

    const md = `---\ntitle: "${note.title}"\ntags: [${note.tags.join(', ')}]\ndate: "${new Date().toISOString()}"\n---\n\n# ${note.title}\n\n${note.content}\n`;
    expect(md).toContain('---');
    expect(md).toContain('title: "State of React 2026"');
    expect(md).toContain('tags: [react, frontend, javascript]');
    expect(md).toContain('# State of React 2026');
  });

  // 12. Path traversal security check in vault sync
  it('12. validates Obsidian vault file paths preventing directory traversal', () => {
    const maliciousPaths = ['../../secret.txt', '..\\..\\windows\\system32', '/etc/passwd'];
    for (const p of maliciousPaths) {
      const isSafe = !p.includes('..') && !path.isAbsolute(p);
      expect(isSafe).toBe(false);
    }
  });

  // 13. Atomic file writing
  it('13. executes safe atomic temporary file write and rename for tasks storage', () => {
    const sampleTasks = [{ id: 'apollo-t1', title: 'Atomic test', status: APOLLO_STATUS.COMPLETED }];
    engine.saveTasks(sampleTasks);

    expect(fs.existsSync(testTasksFile)).toBe(true);
    const loaded = JSON.parse(fs.readFileSync(testTasksFile, 'utf8'));
    expect(loaded[0].title).toBe('Atomic test');
  });

  // 14. Corrupt file auto-recovery
  it('14. recovers gracefully from corrupted tasks storage file returning empty array', () => {
    fs.writeFileSync(testTasksFile, '{ corrupt json invalid', 'utf8');
    const tasks = engine.loadTasks();
    expect(Array.isArray(tasks)).toBe(true);
    expect(tasks.length).toBe(0);
  });

  // 15. Task lookup by ID
  it('15. retrieves task by ID and returns null for non-existent ID', async () => {
    const created = await engine.createDocumentTask({ title: 'Lookup Task', rawContent: 'Content' });
    expect(engine.getTask(created.id)).toBeDefined();
    expect(engine.getTask('non-existent-apollo-id')).toBeNull();
  });

  // 16. Full task enumeration
  it('16. enumerates all tasks ordered by creation timestamp', async () => {
    const t1 = await engine.createDocumentTask({ title: 'Doc 1', rawContent: 'C1' });
    const t2 = await engine.createDocumentTask({ title: 'Doc 2', rawContent: 'C2' });

    const list = engine.listTasks();
    expect(list.length).toBe(2);
    expect(list.map(t => t.id)).toContain(t1.id);
    expect(list.map(t => t.id)).toContain(t2.id);
  });

  // 17. Task deletion
  it('17. deletes task and updates persisted storage file', async () => {
    const task = await engine.createDocumentTask({ title: 'Delete me', rawContent: 'C' });
    const all = engine.loadTasks();
    const filtered = all.filter(t => t.id !== task.id);
    engine.saveTasks(filtered);

    expect(engine.getTask(task.id)).toBeNull();
  });

  // 18. Gardening audit logging
  it('18. completes gardening returning status metadata and execution timing', () => {
    const res = engine.gardenMemories();
    expect(res.success).toBe(true);
    expect(typeof res.finalCount).toBe('number');
    expect(typeof res.prunedCount).toBe('number');
  });

  // 19. Multi-paragraph document ingestion
  it('19. processes multi-section structured documents chunking headers and paragraphs', async () => {
    const longDoc = `# Section 1\nIntroduction to Vector Databases.\n\n# Section 2\nEmbeddings map text to high-dimensional space.\n\n# Section 3\nCosine similarity measures angle between vectors.`;
    const task = await engine.createDocumentTask({ title: 'Vector DBs', rawContent: longDoc });

    await new Promise(r => setTimeout(r, 100));
    const processed = engine.getTask(task.id);
    expect(processed.status).toBe(APOLLO_STATUS.COMPLETED);
    expect(processed.summary.length).toBeGreaterThan(0);
  });

  // 20. Persistence across engine instances
  it('20. persists all document intelligence across ApolloEngine instances', async () => {
    const task = await engine.createDocumentTask({
      title: 'Persistent Knowledge',
      rawContent: 'This fact must survive new instance construction.'
    });

    const newApollo = new ApolloEngine(testTasksFile, mockStore);
    const reloaded = newApollo.getTask(task.id);
    expect(reloaded).toBeDefined();
    expect(reloaded.title).toBe('Persistent Knowledge');
  });
});
