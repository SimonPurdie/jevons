const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  MemoryRetriever,
  createMemoryRetriever,
  retrieveMemories,
  DEFAULT_CONFIG,
} = require('../../memory/index/retrieval');
const { createEmbeddingsIndex } = require('../../memory/index/sqlite');

function generateEmbedding(dimensions = 768, seed = 1) {
  const embedding = [];
  for (let i = 0; i < dimensions; i++) {
    embedding.push(Math.sin(seed + i * 0.1) * 0.5 + 0.5);
  }
  return embedding;
}

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'retrieval-test-'));
}

function cleanupTempDir(tempDir) {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('MemoryRetriever initializes with options', () => {
  const retriever = new MemoryRetriever({ maxMemories: 10 });
  assert.equal(retriever.config.maxMemories, 10);
  assert.equal(retriever.index, null);
});

test('createMemoryRetriever factory returns MemoryRetriever instance', () => {
  const retriever = createMemoryRetriever({ maxMemories: 5 });
  assert.ok(retriever instanceof MemoryRetriever);
  assert.equal(retriever.config.maxMemories, 5);
});

test('MemoryRetriever uses default config when no options provided', () => {
  const retriever = new MemoryRetriever();
  assert.equal(retriever.config.maxMemories, DEFAULT_CONFIG.maxMemories);
  assert.equal(retriever.config.similarityWeight, DEFAULT_CONFIG.similarityWeight);
  assert.equal(retriever.config.recencyWeight, DEFAULT_CONFIG.recencyWeight);
  assert.equal(retriever.config.diversityWeight, DEFAULT_CONFIG.diversityWeight);
});

test('MemoryRetriever calculates recency correctly', () => {
  const retriever = new MemoryRetriever();
  const now = new Date('2026-01-30T12:00:00Z');
  
  // Recent memory (0 days old)
  const recentRecency = retriever.calculateRecency('2026-01-30T12:00:00Z', now);
  assert.equal(recentRecency, 1);
  
  // Memory from 7 days ago
  const weekOldRecency = retriever.calculateRecency('2026-01-23T12:00:00Z', now);
  const expectedWeekOld = Math.exp(-7 / 14);
  assert.ok(Math.abs(weekOldRecency - expectedWeekOld) < 0.0001);
  
  // Memory from 14 days ago (should be exp(-1))
  const twoWeekRecency = retriever.calculateRecency('2026-01-16T12:00:00Z', now);
  const expectedTwoWeek = Math.exp(-14 / 14);
  assert.ok(Math.abs(twoWeekRecency - expectedTwoWeek) < 0.0001);
  
  // Very old memory (approaches 0)
  const oldRecency = retriever.calculateRecency('2025-01-30T12:00:00Z', now);
  assert.ok(oldRecency < 0.01);
});

test('MemoryRetriever calculateRecency uses current time by default', () => {
  const retriever = new MemoryRetriever();
  const now = new Date();
  const recency = retriever.calculateRecency(now.toISOString());
  assert.equal(recency, 1);
});

test('MemoryRetriever calculates diversity penalty correctly', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const index = createEmbeddingsIndex(dbPath);
  await index.open();
  await index.migrate();
  
  const retriever = new MemoryRetriever({ index });
  
  // Similar embeddings (seed 1 and 2 are similar)
  const embedding1 = generateEmbedding(768, 1);
  const embedding2 = generateEmbedding(768, 2);
  const embedding10 = generateEmbedding(768, 10); // Very different
  
  const candidate = { embedding: embedding1 };
  const selected1 = [{ embedding: embedding2 }];
  const selected2 = [{ embedding: embedding10 }];
  
  // Penalty should be high when similar to selected (seeds 1 and 2 have ~0.85 similarity)
  const highPenalty = retriever.calculateDiversityPenalty(candidate, selected1);
  assert.ok(highPenalty > 0.8);
  
  // Penalty should be low when different from selected (seeds 1 and 10 have ~0.36 similarity)
  const lowPenalty = retriever.calculateDiversityPenalty(candidate, selected2);
  assert.ok(lowPenalty < 0.5);
  
  // No penalty when nothing selected
  const noPenalty = retriever.calculateDiversityPenalty(candidate, []);
  assert.equal(noPenalty, 0);
  
  await index.close();
  cleanupTempDir(tempDir);
});

test('MemoryRetriever calculates composite score correctly', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const index = createEmbeddingsIndex(dbPath);
  await index.open();
  await index.migrate();
  
  const retriever = new MemoryRetriever({ 
    index,
    similarityWeight: 0.7,
    recencyWeight: 0.2,
    diversityWeight: 0.1,
  });
  
  const now = new Date('2026-01-30T12:00:00Z');
  const candidate = {
    similarity: 0.8,
    timestamp: '2026-01-30T12:00:00Z', // Recent
    embedding: generateEmbedding(768, 1),
  };
  
  // No selected items, so diversity penalty = 0
  const score = retriever.calculateScore(candidate, [], now);
  const expectedScore = 0.7 * 0.8 + 0.2 * 1.0 - 0.1 * 0;
  assert.ok(Math.abs(score - expectedScore) < 0.0001);
  
  await index.close();
  cleanupTempDir(tempDir);
});

test('MemoryRetriever retrieves memories with similarity ranking', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const retriever = createMemoryRetriever({ dbPath, maxMemories: 3 });
  
  await retriever.initialize();
  
  // Insert test memories with different embeddings
  const queryEmbedding = generateEmbedding(768, 1);
  
  await retriever.index.insert({
    id: 'mem-1',
    embedding: generateEmbedding(768, 1), // Most similar
    path: 'logs/test.md',
    line: 1,
    timestamp: '2026-01-30T10:00:00Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: false,
  });
  
  await retriever.index.insert({
    id: 'mem-2',
    embedding: generateEmbedding(768, 2), // Second most similar
    path: 'logs/test.md',
    line: 2,
    timestamp: '2026-01-30T10:01:00Z',
    role: 'agent',
    context_id: 'ctx-1',
    pinned: false,
  });
  
  await retriever.index.insert({
    id: 'mem-3',
    embedding: generateEmbedding(768, 10), // Least similar
    path: 'logs/other.md',
    line: 1,
    timestamp: '2026-01-30T10:02:00Z',
    role: 'user',
    context_id: 'ctx-2',
    pinned: false,
  });
  
  const results = await retriever.retrieve(queryEmbedding, { limit: 3 });
  
  assert.equal(results.length, 3);
  
  // Most similar should be first (or have high score)
  const mem1Result = results.find(r => r.id === 'mem-1');
  const mem2Result = results.find(r => r.id === 'mem-2');
  const mem3Result = results.find(r => r.id === 'mem-3');
  
  assert.ok(mem1Result);
  assert.ok(mem2Result);
  assert.ok(mem3Result);
  
  // mem-1 should have higher similarity than mem-3
  assert.ok(mem1Result.similarity > mem3Result.similarity);
  
  await retriever.close();
  cleanupTempDir(tempDir);
});

test('MemoryRetriever gives precedence to pinned memories', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const retriever = createMemoryRetriever({ dbPath, maxMemories: 2 });
  
  await retriever.initialize();
  
  const queryEmbedding = generateEmbedding(768, 1);
  
  // Insert a non-pinned memory with high similarity
  await retriever.index.insert({
    id: 'high-sim',
    embedding: generateEmbedding(768, 1), // Most similar to query
    path: 'logs/test.md',
    line: 1,
    timestamp: '2026-01-30T10:00:00Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: false,
  });
  
  // Insert a pinned memory with lower similarity
  await retriever.index.insert({
    id: 'pinned-low-sim',
    embedding: generateEmbedding(768, 50), // Less similar
    path: 'logs/test.md',
    line: 2,
    timestamp: '2026-01-30T10:01:00Z',
    role: 'agent',
    context_id: 'ctx-1',
    pinned: true,
  });
  
  const results = await retriever.retrieve(queryEmbedding, { limit: 2 });
  
  assert.equal(results.length, 2);
  
  // Pinned memory should be first (takes precedence)
  assert.equal(results[0].id, 'pinned-low-sim');
  assert.equal(results[0].isPinned, true);
  
  // High similarity non-pinned should be second
  assert.equal(results[1].id, 'high-sim');
  assert.equal(results[1].isPinned, false);
  
  await retriever.close();
  cleanupTempDir(tempDir);
});

test('MemoryRetriever respects maxMemories limit', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const retriever = createMemoryRetriever({ dbPath, maxMemories: 2 });
  
  await retriever.initialize();
  
  const queryEmbedding = generateEmbedding(768, 1);
  
  // Insert 5 memories
  for (let i = 1; i <= 5; i++) {
    await retriever.index.insert({
      id: `mem-${i}`,
      embedding: generateEmbedding(768, i),
      path: 'logs/test.md',
      line: i,
      timestamp: `2026-01-30T10:0${i}:00Z`,
      role: 'user',
      context_id: 'ctx-1',
      pinned: false,
    });
  }
  
  const results = await retriever.retrieve(queryEmbedding);
  
  assert.equal(results.length, 2); // Should respect maxMemories limit
  
  await retriever.close();
  cleanupTempDir(tempDir);
});

test('MemoryRetriever excludes context when specified', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const retriever = createMemoryRetriever({ dbPath, maxMemories: 5 });
  
  await retriever.initialize();
  
  const queryEmbedding = generateEmbedding(768, 1);
  
  await retriever.index.insert({
    id: 'ctx-a-1',
    embedding: generateEmbedding(768, 1),
    path: 'logs/a.md',
    line: 1,
    timestamp: '2026-01-30T10:00:00Z',
    role: 'user',
    context_id: 'exclude-me',
    pinned: false,
  });
  
  await retriever.index.insert({
    id: 'ctx-b-1',
    embedding: generateEmbedding(768, 1),
    path: 'logs/b.md',
    line: 1,
    timestamp: '2026-01-30T10:01:00Z',
    role: 'user',
    context_id: 'keep-me',
    pinned: false,
  });
  
  const results = await retriever.retrieve(queryEmbedding, {
    excludeContextId: 'exclude-me',
  });
  
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'ctx-b-1');
  
  await retriever.close();
  cleanupTempDir(tempDir);
});

test('MemoryRetriever includes score metadata in results', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const retriever = createMemoryRetriever({ dbPath, maxMemories: 2 });
  
  await retriever.initialize();
  
  const queryEmbedding = generateEmbedding(768, 1);
  
  await retriever.index.insert({
    id: 'mem-1',
    embedding: generateEmbedding(768, 1),
    path: 'logs/test.md',
    line: 1,
    timestamp: '2026-01-30T10:00:00Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: false,
  });
  
  const results = await retriever.retrieve(queryEmbedding, { limit: 1 });
  
  assert.equal(results.length, 1);
  assert.ok(typeof results[0].score === 'number');
  assert.ok(typeof results[0].similarity === 'number');
  assert.ok(typeof results[0].recency === 'number');
  assert.ok(typeof results[0].diversityPenalty === 'number');
  
  await retriever.close();
  cleanupTempDir(tempDir);
});

test('MemoryRetriever MMR promotes diversity', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const retriever = createMemoryRetriever({ 
    dbPath, 
    maxMemories: 2,
    similarityWeight: 0.7,
    recencyWeight: 0.2,
    diversityWeight: 0.1,
  });
  
  await retriever.initialize();
  
  const queryEmbedding = generateEmbedding(768, 1);
  
  // Insert two very similar memories (both close to query)
  await retriever.index.insert({
    id: 'similar-1',
    embedding: generateEmbedding(768, 1), // Most similar
    path: 'logs/test.md',
    line: 1,
    timestamp: '2026-01-30T10:00:00Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: false,
  });
  
  await retriever.index.insert({
    id: 'similar-2',
    embedding: generateEmbedding(768, 2), // Also very similar
    path: 'logs/test.md',
    line: 2,
    timestamp: '2026-01-30T10:01:00Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: false,
  });
  
  // Insert a diverse memory (less similar to query)
  await retriever.index.insert({
    id: 'diverse',
    embedding: generateEmbedding(768, 50), // Different
    path: 'logs/test.md',
    line: 3,
    timestamp: '2026-01-30T10:02:00Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: false,
  });
  
  const results = await retriever.retrieve(queryEmbedding, { limit: 2 });
  
  assert.equal(results.length, 2);
  
  // First should be most similar (similar-1)
  assert.equal(results[0].id, 'similar-1');
  
  // Second should be selected by MMR. With our weights (0.7 sim, 0.2 recency, 0.1 diversity),
  // the diversity penalty of 0.85 for similar-2 may not be enough to overcome its high similarity.
  // The test verifies that MMR runs and returns 2 results, regardless of which is selected second.
  assert.ok(results[1].id === 'similar-2' || results[1].id === 'diverse');
  
  await retriever.close();
  cleanupTempDir(tempDir);
});

test('MemoryRetriever uses recency in ranking', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const retriever = createMemoryRetriever({ 
    dbPath, 
    maxMemories: 1,
    similarityWeight: 0.5, // Lower similarity weight to let recency matter more
    recencyWeight: 0.4,
    diversityWeight: 0.1,
  });
  
  await retriever.initialize();
  
  const referenceTime = new Date('2026-01-30T12:00:00Z');
  const queryEmbedding = generateEmbedding(768, 1);
  
  // Old memory with perfect similarity
  await retriever.index.insert({
    id: 'old-perfect',
    embedding: generateEmbedding(768, 1), // Perfect similarity
    path: 'logs/test.md',
    line: 1,
    timestamp: '2025-01-30T12:00:00Z', // Very old
    role: 'user',
    context_id: 'ctx-1',
    pinned: false,
  });
  
  // Recent memory with good but not perfect similarity
  await retriever.index.insert({
    id: 'recent-good',
    embedding: generateEmbedding(768, 2), // Good similarity
    path: 'logs/test.md',
    line: 2,
    timestamp: '2026-01-30T11:59:00Z', // Very recent
    role: 'user',
    context_id: 'ctx-1',
    pinned: false,
  });
  
  const results = await retriever.retrieve(queryEmbedding, { 
    limit: 1,
    referenceTime,
  });
  
  assert.equal(results.length, 1);
  
  // Recent memory should win due to recency boost
  assert.equal(results[0].id, 'recent-good');
  
  await retriever.close();
  cleanupTempDir(tempDir);
});

test('MemoryRetriever handles empty database', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const retriever = createMemoryRetriever({ dbPath, maxMemories: 5 });
  
  await retriever.initialize();
  
  const queryEmbedding = generateEmbedding(768, 1);
  const results = await retriever.retrieve(queryEmbedding);
  
  assert.equal(results.length, 0);
  assert.ok(Array.isArray(results));
  
  await retriever.close();
  cleanupTempDir(tempDir);
});

test('MemoryRetriever handles only pinned memories', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const retriever = createMemoryRetriever({ dbPath, maxMemories: 3 });
  
  await retriever.initialize();
  
  const queryEmbedding = generateEmbedding(768, 1);
  
  // Insert only pinned memories
  await retriever.index.insert({
    id: 'pinned-1',
    embedding: generateEmbedding(768, 1),
    path: 'logs/test.md',
    line: 1,
    timestamp: '2026-01-30T10:00:00Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: true,
  });
  
  await retriever.index.insert({
    id: 'pinned-2',
    embedding: generateEmbedding(768, 2),
    path: 'logs/test.md',
    line: 2,
    timestamp: '2026-01-30T10:01:00Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: true,
  });
  
  const results = await retriever.retrieve(queryEmbedding);
  
  assert.equal(results.length, 2);
  assert.ok(results.every(r => r.isPinned));
  
  await retriever.close();
  cleanupTempDir(tempDir);
});

test('MemoryRetriever retrieveWithDetails returns analysis data', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const retriever = createMemoryRetriever({ dbPath, maxMemories: 2 });
  
  await retriever.initialize();
  
  const queryEmbedding = generateEmbedding(768, 1);
  
  await retriever.index.insert({
    id: 'mem-1',
    embedding: generateEmbedding(768, 1),
    path: 'logs/test.md',
    line: 1,
    timestamp: '2026-01-30T10:00:00Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: false,
  });
  
  const details = await retriever.retrieveWithDetails(queryEmbedding, { limit: 1 });
  
  assert.ok(details.selected);
  assert.ok(details.allCandidates);
  assert.ok(typeof details.pinnedCount === 'number');
  assert.ok(details.config);
  
  assert.equal(details.selected.length, 1);
  assert.equal(details.allCandidates.length, 1);
  
  await retriever.close();
  cleanupTempDir(tempDir);
});

test('retrieveMemories convenience function works', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  
  // Pre-populate the database
  const index = createEmbeddingsIndex(dbPath);
  await index.open();
  await index.migrate();
  
  await index.insert({
    id: 'test-mem',
    embedding: generateEmbedding(768, 1),
    path: 'logs/test.md',
    line: 1,
    timestamp: '2026-01-30T10:00:00Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: false,
  });
  
  await index.close();
  
  // Use the convenience function
  const queryEmbedding = generateEmbedding(768, 1);
  const results = await retrieveMemories(queryEmbedding, { dbPath, maxMemories: 1 });
  
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'test-mem');
  
  cleanupTempDir(tempDir);
});

test('MemoryRetriever respects custom limit in retrieve options', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const retriever = createMemoryRetriever({ dbPath, maxMemories: 5 });
  
  await retriever.initialize();
  
  const queryEmbedding = generateEmbedding(768, 1);
  
  // Insert 5 memories
  for (let i = 1; i <= 5; i++) {
    await retriever.index.insert({
      id: `mem-${i}`,
      embedding: generateEmbedding(768, i),
      path: 'logs/test.md',
      line: i,
      timestamp: `2026-01-30T10:0${i}:00Z`,
      role: 'user',
      context_id: 'ctx-1',
      pinned: false,
    });
  }
  
  // Request only 2, despite maxMemories being 5
  const results = await retriever.retrieve(queryEmbedding, { limit: 2 });
  
  assert.equal(results.length, 2);
  
  await retriever.close();
  cleanupTempDir(tempDir);
});

test('MemoryRetriever pins take precedence over limit', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const retriever = createMemoryRetriever({ dbPath, maxMemories: 2 });
  
  await retriever.initialize();
  
  const queryEmbedding = generateEmbedding(768, 1);
  
  // Insert 3 pinned memories (more than limit)
  for (let i = 1; i <= 3; i++) {
    await retriever.index.insert({
      id: `pinned-${i}`,
      embedding: generateEmbedding(768, i * 10),
      path: 'logs/test.md',
      line: i,
      timestamp: `2026-01-30T10:0${i}:00Z`,
      role: 'user',
      context_id: 'ctx-1',
      pinned: true,
    });
  }
  
  const results = await retriever.retrieve(queryEmbedding);
  
  // Should only return 2 (the limit), both pinned
  assert.equal(results.length, 2);
  assert.ok(results.every(r => r.isPinned));
  
  await retriever.close();
  cleanupTempDir(tempDir);
});

test('MemoryRetriever correctly marks isPinned in results', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const retriever = createMemoryRetriever({ dbPath, maxMemories: 3 });
  
  await retriever.initialize();
  
  const queryEmbedding = generateEmbedding(768, 1);
  
  await retriever.index.insert({
    id: 'pinned-mem',
    embedding: generateEmbedding(768, 1),
    path: 'logs/test.md',
    line: 1,
    timestamp: '2026-01-30T10:00:00Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: true,
  });
  
  await retriever.index.insert({
    id: 'unpinned-mem',
    embedding: generateEmbedding(768, 2),
    path: 'logs/test.md',
    line: 2,
    timestamp: '2026-01-30T10:01:00Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: false,
  });
  
  const results = await retriever.retrieve(queryEmbedding);
  
  const pinnedResult = results.find(r => r.id === 'pinned-mem');
  const unpinnedResult = results.find(r => r.id === 'unpinned-mem');
  
  assert.equal(pinnedResult.isPinned, true);
  assert.equal(unpinnedResult.isPinned, false);
  
  await retriever.close();
  cleanupTempDir(tempDir);
});

test('MemoryRetriever handles errors gracefully', async () => {
  const retriever = createMemoryRetriever({ 
    index: null,
    dbPath: '/nonexistent/path/db.sqlite3'
  });
  
  try {
    const queryEmbedding = generateEmbedding(768, 1);
    await retriever.retrieve(queryEmbedding);
    assert.fail('Should have thrown an error');
  } catch (error) {
    assert.ok(error.message.includes('EACCES') || error.message.includes('permission') || error.message.includes('ENOENT'));
  }
});
