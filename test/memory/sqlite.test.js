const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  EmbeddingsIndex,
  createEmbeddingsIndex,
  SCHEMA_VERSION,
} = require('../../memory/index/sqlite');

function generateEmbedding(dimensions = 768, seed = 1) {
  const embedding = [];
  for (let i = 0; i < dimensions; i++) {
    embedding.push(Math.sin(seed + i * 0.1) * 0.5 + 0.5);
  }
  return embedding;
}

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'embeddings-test-'));
}

function cleanupTempDir(tempDir) {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('EmbeddingsIndex initializes with dbPath', () => {
  const index = new EmbeddingsIndex('/tmp/test.sqlite3');
  assert.equal(index.dbPath, '/tmp/test.sqlite3');
  assert.equal(index.db, null);
});

test('createEmbeddingsIndex factory returns EmbeddingsIndex instance', () => {
  const index = createEmbeddingsIndex('/tmp/factory-test.sqlite3');
  assert.ok(index instanceof EmbeddingsIndex);
});

test('EmbeddingsIndex opens and closes database', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const index = new EmbeddingsIndex(dbPath);

  await index.open();
  assert.ok(index.db);

  await index.close();
  assert.equal(index.db, null);

  cleanupTempDir(tempDir);
});

test('EmbeddingsIndex creates directory if needed', async () => {
  const tempDir = createTempDir();
  const nestedDir = path.join(tempDir, 'nested', 'deep', 'path');
  const dbPath = path.join(nestedDir, 'test.sqlite3');
  const index = new EmbeddingsIndex(dbPath);

  await index.open();
  assert.ok(fs.existsSync(nestedDir));

  await index.close();
  cleanupTempDir(tempDir);
});

test('EmbeddingsIndex migrate creates schema', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const index = new EmbeddingsIndex(dbPath);

  await index.open();
  const version = await index.migrate();
  assert.equal(version, SCHEMA_VERSION);

  const tables = await index.all(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  );
  const tableNames = tables.map(t => t.name);
  assert.ok(tableNames.includes('embeddings'));
  assert.ok(tableNames.includes('schema_version'));

  await index.close();
  cleanupTempDir(tempDir);
});

test('EmbeddingsIndex migrate creates indexes', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const index = new EmbeddingsIndex(dbPath);

  await index.open();
  await index.migrate();

  const indexes = await index.all(
    "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'"
  );
  const indexNames = indexes.map(i => i.name);
  assert.ok(indexNames.includes('idx_embeddings_context'));
  assert.ok(indexNames.includes('idx_embeddings_timestamp'));
  assert.ok(indexNames.includes('idx_embeddings_pinned'));

  await index.close();
  cleanupTempDir(tempDir);
});

test('EmbeddingsIndex insert stores embedding', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const index = new EmbeddingsIndex(dbPath);

  await index.open();
  await index.migrate();

  const entry = {
    id: 'test-1',
    embedding: generateEmbedding(768, 1),
    path: 'logs/test.md',
    line: 42,
    timestamp: '2026-01-30T14:23:55.000Z',
    role: 'user',
    context_id: 'ctx-123',
    pinned: false,
  };

  const lastId = await index.insert(entry);
  assert.ok(lastId);

  const retrieved = await index.getById('test-1');
  assert.ok(retrieved);
  assert.equal(retrieved.id, 'test-1');
  assert.equal(retrieved.path, 'logs/test.md');
  assert.equal(retrieved.line, 42);
  assert.equal(retrieved.timestamp, '2026-01-30T14:23:55.000Z');
  assert.equal(retrieved.role, 'user');
  assert.equal(retrieved.context_id, 'ctx-123');
  assert.equal(retrieved.pinned, false);
  assert.ok(Array.isArray(retrieved.embedding));
  assert.equal(retrieved.embedding.length, 768);

  await index.close();
  cleanupTempDir(tempDir);
});

test('EmbeddingsIndex insert preserves pinned status', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const index = new EmbeddingsIndex(dbPath);

  await index.open();
  await index.migrate();

  const entry = {
    id: 'pinned-1',
    embedding: generateEmbedding(768, 2),
    path: 'logs/test.md',
    line: 1,
    timestamp: '2026-01-30T14:23:55.000Z',
    role: 'agent',
    context_id: 'ctx-456',
    pinned: true,
  };

  await index.insert(entry);

  const retrieved = await index.getById('pinned-1');
  assert.equal(retrieved.pinned, true);

  await index.close();
  cleanupTempDir(tempDir);
});

test('EmbeddingsIndex getById returns null for unknown id', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const index = new EmbeddingsIndex(dbPath);

  await index.open();
  await index.migrate();

  const result = await index.getById('nonexistent');
  assert.equal(result, null);

  await index.close();
  cleanupTempDir(tempDir);
});

test('EmbeddingsIndex getByContextId returns matching entries', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const index = new EmbeddingsIndex(dbPath);

  await index.open();
  await index.migrate();

  await index.insert({
    id: 'ctx-a-1',
    embedding: generateEmbedding(768, 1),
    path: 'logs/a.md',
    line: 1,
    timestamp: '2026-01-30T10:00:00.000Z',
    role: 'user',
    context_id: 'context-a',
    pinned: false,
  });

  await index.insert({
    id: 'ctx-a-2',
    embedding: generateEmbedding(768, 2),
    path: 'logs/a.md',
    line: 2,
    timestamp: '2026-01-30T10:01:00.000Z',
    role: 'agent',
    context_id: 'context-a',
    pinned: false,
  });

  await index.insert({
    id: 'ctx-b-1',
    embedding: generateEmbedding(768, 3),
    path: 'logs/b.md',
    line: 1,
    timestamp: '2026-01-30T10:02:00.000Z',
    role: 'user',
    context_id: 'context-b',
    pinned: false,
  });

  const contextA = await index.getByContextId('context-a');
  assert.equal(contextA.length, 2);
  assert.ok(contextA.find(e => e.id === 'ctx-a-1'));
  assert.ok(contextA.find(e => e.id === 'ctx-a-2'));

  const contextB = await index.getByContextId('context-b');
  assert.equal(contextB.length, 1);
  assert.equal(contextB[0].id, 'ctx-b-1');

  await index.close();
  cleanupTempDir(tempDir);
});

test('EmbeddingsIndex getAll returns all entries', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const index = new EmbeddingsIndex(dbPath);

  await index.open();
  await index.migrate();

  await index.insert({
    id: 'all-1',
    embedding: generateEmbedding(768, 1),
    path: 'logs/test.md',
    line: 1,
    timestamp: '2026-01-30T10:00:00.000Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: false,
  });

  await index.insert({
    id: 'all-2',
    embedding: generateEmbedding(768, 2),
    path: 'logs/test.md',
    line: 2,
    timestamp: '2026-01-30T10:01:00.000Z',
    role: 'agent',
    context_id: 'ctx-2',
    pinned: false,
  });

  const all = await index.getAll();
  assert.equal(all.length, 2);

  await index.close();
  cleanupTempDir(tempDir);
});

test('EmbeddingsIndex updatePinned changes pinned status', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const index = new EmbeddingsIndex(dbPath);

  await index.open();
  await index.migrate();

  await index.insert({
    id: 'update-pin',
    embedding: generateEmbedding(768, 1),
    path: 'logs/test.md',
    line: 1,
    timestamp: '2026-01-30T10:00:00.000Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: false,
  });

  let retrieved = await index.getById('update-pin');
  assert.equal(retrieved.pinned, false);

  const updated = await index.updatePinned('update-pin', true);
  assert.equal(updated, true);

  retrieved = await index.getById('update-pin');
  assert.equal(retrieved.pinned, true);

  const updatedAgain = await index.updatePinned('update-pin', false);
  assert.equal(updatedAgain, true);

  retrieved = await index.getById('update-pin');
  assert.equal(retrieved.pinned, false);

  await index.close();
  cleanupTempDir(tempDir);
});

test('EmbeddingsIndex updatePinned returns false for unknown id', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const index = new EmbeddingsIndex(dbPath);

  await index.open();
  await index.migrate();

  const result = await index.updatePinned('nonexistent', true);
  assert.equal(result, false);

  await index.close();
  cleanupTempDir(tempDir);
});

test('EmbeddingsIndex delete removes entry', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const index = new EmbeddingsIndex(dbPath);

  await index.open();
  await index.migrate();

  await index.insert({
    id: 'delete-me',
    embedding: generateEmbedding(768, 1),
    path: 'logs/test.md',
    line: 1,
    timestamp: '2026-01-30T10:00:00.000Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: false,
  });

  let retrieved = await index.getById('delete-me');
  assert.ok(retrieved);

  const deleted = await index.delete('delete-me');
  assert.equal(deleted, true);

  retrieved = await index.getById('delete-me');
  assert.equal(retrieved, null);

  await index.close();
  cleanupTempDir(tempDir);
});

test('EmbeddingsIndex delete returns false for unknown id', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const index = new EmbeddingsIndex(dbPath);

  await index.open();
  await index.migrate();

  const result = await index.delete('nonexistent');
  assert.equal(result, false);

  await index.close();
  cleanupTempDir(tempDir);
});

test('EmbeddingsIndex deleteByContextId removes multiple entries', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const index = new EmbeddingsIndex(dbPath);

  await index.open();
  await index.migrate();

  await index.insert({
    id: 'multi-1',
    embedding: generateEmbedding(768, 1),
    path: 'logs/test.md',
    line: 1,
    timestamp: '2026-01-30T10:00:00.000Z',
    role: 'user',
    context_id: 'delete-ctx',
    pinned: false,
  });

  await index.insert({
    id: 'multi-2',
    embedding: generateEmbedding(768, 2),
    path: 'logs/test.md',
    line: 2,
    timestamp: '2026-01-30T10:01:00.000Z',
    role: 'agent',
    context_id: 'delete-ctx',
    pinned: false,
  });

  await index.insert({
    id: 'multi-3',
    embedding: generateEmbedding(768, 3),
    path: 'logs/other.md',
    line: 1,
    timestamp: '2026-01-30T10:02:00.000Z',
    role: 'user',
    context_id: 'keep-ctx',
    pinned: false,
  });

  const deletedCount = await index.deleteByContextId('delete-ctx');
  assert.equal(deletedCount, 2);

  const remaining = await index.getAll();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, 'multi-3');

  await index.close();
  cleanupTempDir(tempDir);
});

test('EmbeddingsIndex getPinned returns only pinned entries', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const index = new EmbeddingsIndex(dbPath);

  await index.open();
  await index.migrate();

  await index.insert({
    id: 'pin-1',
    embedding: generateEmbedding(768, 1),
    path: 'logs/test.md',
    line: 1,
    timestamp: '2026-01-30T10:00:00.000Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: true,
  });

  await index.insert({
    id: 'no-pin-1',
    embedding: generateEmbedding(768, 2),
    path: 'logs/test.md',
    line: 2,
    timestamp: '2026-01-30T10:01:00.000Z',
    role: 'agent',
    context_id: 'ctx-1',
    pinned: false,
  });

  await index.insert({
    id: 'pin-2',
    embedding: generateEmbedding(768, 3),
    path: 'logs/other.md',
    line: 1,
    timestamp: '2026-01-30T10:02:00.000Z',
    role: 'user',
    context_id: 'ctx-2',
    pinned: true,
  });

  const pinned = await index.getPinned();
  assert.equal(pinned.length, 2);
  assert.ok(pinned.find(e => e.id === 'pin-1'));
  assert.ok(pinned.find(e => e.id === 'pin-2'));
  assert.ok(!pinned.find(e => e.id === 'no-pin-1'));

  await index.close();
  cleanupTempDir(tempDir);
});

test('EmbeddingsIndex getRecent returns most recent entries', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const index = new EmbeddingsIndex(dbPath);

  await index.open();
  await index.migrate();

  for (let i = 1; i <= 5; i++) {
    await index.insert({
      id: `recent-${i}`,
      embedding: generateEmbedding(768, i),
      path: 'logs/test.md',
      line: i,
      timestamp: `2026-01-30T10:0${i}:00.000Z`,
      role: 'user',
      context_id: 'ctx-1',
      pinned: false,
    });
  }

  const recent = await index.getRecent(3);
  assert.equal(recent.length, 3);
  assert.equal(recent[0].id, 'recent-3');
  assert.equal(recent[1].id, 'recent-4');
  assert.equal(recent[2].id, 'recent-5');

  await index.close();
  cleanupTempDir(tempDir);
});

test('EmbeddingsIndex searchSimilar returns ranked results', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const index = new EmbeddingsIndex(dbPath);

  await index.open();
  await index.migrate();

  const queryEmbedding = generateEmbedding(768, 1);

  await index.insert({
    id: 'sim-1',
    embedding: generateEmbedding(768, 1),
    path: 'logs/test.md',
    line: 1,
    timestamp: '2026-01-30T10:00:00.000Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: false,
  });

  await index.insert({
    id: 'sim-2',
    embedding: generateEmbedding(768, 5),
    path: 'logs/test.md',
    line: 2,
    timestamp: '2026-01-30T10:01:00.000Z',
    role: 'agent',
    context_id: 'ctx-1',
    pinned: false,
  });

  await index.insert({
    id: 'sim-3',
    embedding: generateEmbedding(768, 10),
    path: 'logs/other.md',
    line: 1,
    timestamp: '2026-01-30T10:02:00.000Z',
    role: 'user',
    context_id: 'ctx-2',
    pinned: false,
  });

  const results = await index.searchSimilar(queryEmbedding, { limit: 3 });
  assert.equal(results.length, 3);

  assert.ok(typeof results[0].similarity === 'number');
  assert.ok(results[0].similarity >= results[1].similarity);
  assert.ok(results[1].similarity >= results[2].similarity);

  await index.close();
  cleanupTempDir(tempDir);
});

test('EmbeddingsIndex searchSimilar excludes context', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const index = new EmbeddingsIndex(dbPath);

  await index.open();
  await index.migrate();

  const queryEmbedding = generateEmbedding(768, 1);

  await index.insert({
    id: 'excl-1',
    embedding: generateEmbedding(768, 1),
    path: 'logs/test.md',
    line: 1,
    timestamp: '2026-01-30T10:00:00.000Z',
    role: 'user',
    context_id: 'exclude-me',
    pinned: false,
  });

  await index.insert({
    id: 'excl-2',
    embedding: generateEmbedding(768, 1),
    path: 'logs/test.md',
    line: 2,
    timestamp: '2026-01-30T10:01:00.000Z',
    role: 'user',
    context_id: 'keep-me',
    pinned: false,
  });

  const results = await index.searchSimilar(queryEmbedding, {
    limit: 10,
    excludeContextId: 'exclude-me',
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'excl-2');

  await index.close();
  cleanupTempDir(tempDir);
});

test('EmbeddingsIndex cosineSimilarity calculates correctly', () => {
  const index = new EmbeddingsIndex(':memory:');

  const a = [1, 0, 0];
  const b = [1, 0, 0];
  assert.equal(index.cosineSimilarity(a, b), 1);

  const c = [1, 0, 0];
  const d = [0, 1, 0];
  assert.equal(index.cosineSimilarity(c, d), 0);

  const e = [1, 1, 0];
  const f = [1, 1, 0];
  const sim = index.cosineSimilarity(e, f);
  assert.ok(sim > 0.99 && sim <= 1);
});

test('EmbeddingsIndex serialize/deserialize roundtrip', () => {
  const index = new EmbeddingsIndex(':memory:');

  const original = [0.1, 0.2, 0.3, 0.4, 0.5];
  const serialized = index.serializeEmbedding(original);
  assert.ok(Buffer.isBuffer(serialized));
  assert.equal(serialized.length, original.length * 4);

  const deserialized = index.deserializeEmbedding(serialized);
  assert.equal(deserialized.length, original.length);

  for (let i = 0; i < original.length; i++) {
    assert.ok(Math.abs(deserialized[i] - original[i]) < 0.0001);
  }
});

test('EmbeddingsIndex handles multiple migrations idempotently', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const index = new EmbeddingsIndex(dbPath);

  await index.open();

  const version1 = await index.migrate();
  assert.equal(version1, SCHEMA_VERSION);

  const version2 = await index.migrate();
  assert.equal(version2, SCHEMA_VERSION);

  await index.insert({
    id: 'mig-test',
    embedding: generateEmbedding(768, 1),
    path: 'logs/test.md',
    line: 1,
    timestamp: '2026-01-30T10:00:00.000Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: false,
  });

  const retrieved = await index.getById('mig-test');
  assert.ok(retrieved);

  await index.close();
  cleanupTempDir(tempDir);
});

test('EmbeddingsIndex handles empty database operations', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');
  const index = new EmbeddingsIndex(dbPath);

  await index.open();
  await index.migrate();

  const all = await index.getAll();
  assert.equal(all.length, 0);

  const pinned = await index.getPinned();
  assert.equal(pinned.length, 0);

  const byContext = await index.getByContextId('nonexistent');
  assert.equal(byContext.length, 0);

  const recent = await index.getRecent(10);
  assert.equal(recent.length, 0);

  const searchResults = await index.searchSimilar(generateEmbedding(768, 1), { limit: 10 });
  assert.equal(searchResults.length, 0);

  await index.close();
  cleanupTempDir(tempDir);
});
