const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  ReconciliationJob,
  createReconciliationJob,
  runReconciliation,
} = require('../../memory/index/reconciliation');
const { createEmbeddingsIndex } = require('../../memory/index/sqlite');
const { createEmbeddingQueue } = require('../../memory/index/embeddings');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'recon-test-'));
}

function cleanupTempDir(tempDir) {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function generateEmbedding(dimensions = 768, seed = 1) {
  const embedding = [];
  for (let i = 0; i < dimensions; i++) {
    embedding.push(Math.sin(seed + i * 0.1) * 0.5 + 0.5);
  }
  return embedding;
}

function createTestLogFile(logsRoot, surface, contextId, timestamp, entries) {
  const logsDir = path.join(logsRoot, 'logs', surface, contextId);
  fs.mkdirSync(logsDir, { recursive: true });
  
  const filePath = path.join(logsDir, `${timestamp}_0000.md`);
  
  let content = `# Context Window: ${surface}/${contextId}\n` +
    `# Started: ${timestamp}\n` +
    `# Sequence: 0\n\n`;
  
  for (const entry of entries) {
    const timestamp = entry.timestamp || '2026-01-30T14:23:55.000Z';
    const role = entry.role || 'user';
    const message = entry.content || 'Test message';
    content += `- **${timestamp}** [${role}] ${message}\n`;
  }
  
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

test('createReconciliationJob factory returns ReconciliationJob instance', () => {
  const job = createReconciliationJob({
    logsRoot: '/tmp/logs',
    dbPath: '/tmp/test.sqlite3',
  });
  
  assert.ok(job instanceof ReconciliationJob);
  assert.equal(job.logsRoot, '/tmp/logs');
  assert.equal(job.dbPath, '/tmp/test.sqlite3');
});

test('ReconciliationJob parseLogFile extracts entries correctly', () => {
  const tempDir = createTempDir();
  
  try {
    const entries = [
      { timestamp: '2026-01-30T14:23:55.000Z', role: 'user', content: 'Hello bot' },
      { timestamp: '2026-01-30T14:24:00.000Z', role: 'agent', content: 'Hello user' },
    ];
    
    const filePath = createTestLogFile(tempDir, 'discord-channel', '123', '20260130T142355Z', entries);
    
    const job = createReconciliationJob({ logsRoot: tempDir });
    const parsed = job.parseLogFile(filePath, '123');
    
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].path, filePath);
    assert.equal(parsed[0].line, 5); // After 4-line header
    assert.equal(parsed[0].timestamp, '2026-01-30T14:23:55.000Z');
    assert.equal(parsed[0].role, 'user');
    assert.equal(parsed[0].content, 'Hello bot');
    assert.equal(parsed[0].text, 'Hello bot');
    assert.equal(parsed[0].contextId, '123');
    
    assert.equal(parsed[1].line, 6);
    assert.equal(parsed[1].role, 'agent');
    assert.equal(parsed[1].content, 'Hello user');
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('ReconciliationJob parseLogFile skips tool entries', () => {
  const tempDir = createTempDir();
  
  try {
    const logsDir = path.join(tempDir, 'logs', 'discord-channel', '456');
    fs.mkdirSync(logsDir, { recursive: true });
    
    const filePath = path.join(logsDir, '20260130T142355Z_0000.md');
    const content = `# Context Window: discord-channel/456\n` +
      `# Started: 20260130T142355Z\n` +
      `# Sequence: 0\n\n` +
      `- **2026-01-30T14:23:55.000Z** [user] Hello bot\n` +
      `- **2026-01-30T14:24:00.000Z** [tool_call] {"command": "ls"}\n` +
      `- **2026-01-30T14:24:05.000Z** [agent] Here are the files\n` +
      `- **2026-01-30T14:24:10.000Z** [tool] {"output": "file1.txt file2.txt"}\n`;
    
    fs.writeFileSync(filePath, content, 'utf8');
    
    const job = createReconciliationJob({ logsRoot: tempDir });
    const parsed = job.parseLogFile(filePath, '456');
    
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].role, 'user');
    assert.equal(parsed[1].role, 'agent');
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('ReconciliationJob findLogFiles discovers all log files', () => {
  const tempDir = createTempDir();
  
  try {
    // Create multiple log files in different contexts
    createTestLogFile(tempDir, 'discord-channel', '123', '20260130T142355Z', [
      { role: 'user', content: 'Hello' },
    ]);
    createTestLogFile(tempDir, 'discord-channel', '456', '20260130T142400Z', [
      { role: 'user', content: 'Hi' },
    ]);
    createTestLogFile(tempDir, 'discord-thread', '789', '20260130T142500Z', [
      { role: 'user', content: 'Hey' },
    ]);
    
    const job = createReconciliationJob({ logsRoot: tempDir });
    const files = job.findLogFiles();
    
    assert.equal(files.length, 3);
    
    const paths = files.map(f => f.path);
    assert.ok(paths.some(p => p.includes('discord-channel/123')));
    assert.ok(paths.some(p => p.includes('discord-channel/456')));
    assert.ok(paths.some(p => p.includes('discord-thread/789')));
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('ReconciliationJob findLogFiles returns empty array for non-existent logsRoot', () => {
  const job = createReconciliationJob({ logsRoot: '/nonexistent/path' });
  const files = job.findLogFiles();
  
  assert.equal(files.length, 0);
});

test('ReconciliationJob hasEmbedding returns false for missing embeddings', async () => {
  const tempDir = createTempDir();
  
  try {
    const dbPath = path.join(tempDir, 'test.sqlite3');
    const index = createEmbeddingsIndex(dbPath);
    await index.open();
    await index.migrate();
    
    const job = createReconciliationJob({
      logsRoot: tempDir,
      index,
    });
    
    const hasEmbedding = await job.hasEmbedding('/some/path.md', 5);
    assert.equal(hasEmbedding, false);
    
    await index.close();
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('ReconciliationJob hasEmbedding returns true for existing embeddings', async () => {
  const tempDir = createTempDir();
  
  try {
    const dbPath = path.join(tempDir, 'test.sqlite3');
    const index = createEmbeddingsIndex(dbPath);
    await index.open();
    await index.migrate();
    
    // Insert an embedding
    await index.insert({
      id: 'test-1',
      embedding: generateEmbedding(768, 1),
      path: '/some/path.md',
      line: 5,
      timestamp: '2026-01-30T14:23:55.000Z',
      role: 'user',
      context_id: '123',
      pinned: false,
    });
    
    const job = createReconciliationJob({
      logsRoot: tempDir,
      index,
    });
    
    const hasEmbedding = await job.hasEmbedding('/some/path.md', 5);
    assert.equal(hasEmbedding, true);
    
    const hasWrongLine = await job.hasEmbedding('/some/path.md', 6);
    assert.equal(hasWrongLine, false);
    
    await index.close();
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('ReconciliationJob run finds missing embeddings', async () => {
  const tempDir = createTempDir();
  
  try {
    const dbPath = path.join(tempDir, 'test.sqlite3');
    
    // Create a log file with entries
    const entries = [
      { timestamp: '2026-01-30T14:23:55.000Z', role: 'user', content: 'First message' },
      { timestamp: '2026-01-30T14:24:00.000Z', role: 'agent', content: 'First response' },
      { timestamp: '2026-01-30T14:24:05.000Z', role: 'user', content: 'Second message' },
    ];
    const filePath = createTestLogFile(tempDir, 'discord-channel', '123', '20260130T142355Z', entries);
    
    // Insert embedding for first entry only
    const index = createEmbeddingsIndex(dbPath);
    await index.open();
    await index.migrate();
    
    await index.insert({
      id: 'emb-1',
      embedding: generateEmbedding(768, 1),
      path: filePath,
      line: 5, // First entry is on line 5
      timestamp: '2026-01-30T14:23:55.000Z',
      role: 'user',
      context_id: '123',
      pinned: false,
    });
    
    await index.close();
    
    const job = createReconciliationJob({
      logsRoot: tempDir,
      dbPath,
    });
    
    const report = await job.run();
    
    assert.equal(report.filesScanned, 1);
    assert.equal(report.entriesFound, 3);
    assert.equal(report.entriesMissing, 2); // 2 entries without embeddings
    assert.equal(report.missingEntries.length, 2);
    
    // Verify which entries are missing
    const missingLines = report.missingEntries.map(e => e.line);
    assert.ok(missingLines.includes(6)); // Second entry
    assert.ok(missingLines.includes(7)); // Third entry
    assert.ok(!missingLines.includes(5)); // First entry has embedding
    
    await job.close();
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('ReconciliationJob run enqueues missing entries when queue provided', async () => {
  const tempDir = createTempDir();
  
  try {
    const dbPath = path.join(tempDir, 'test.sqlite3');
    
    // Create a log file with entries
    const entries = [
      { timestamp: '2026-01-30T14:23:55.000Z', role: 'user', content: 'First message' },
      { timestamp: '2026-01-30T14:24:00.000Z', role: 'agent', content: 'First response' },
    ];
    const filePath = createTestLogFile(tempDir, 'discord-channel', '123', '20260130T142355Z', entries);
    
    // No embeddings in database - all entries are missing
    
    const queue = createEmbeddingQueue();
    queue.pause(); // Pause so jobs don't actually process
    
    const enqueuedEntries = [];
    
    const job = createReconciliationJob({
      logsRoot: tempDir,
      dbPath,
      queue,
      onEnqueued: (entry, jobId) => {
        enqueuedEntries.push({ entry, jobId });
      },
    });
    
    const report = await job.run();
    
    assert.equal(report.entriesMissing, 2);
    assert.equal(report.entriesEnqueued, 2);
    assert.equal(enqueuedEntries.length, 2);
    
    // Verify the enqueued data
    assert.equal(enqueuedEntries[0].entry.content, 'First message');
    assert.equal(enqueuedEntries[1].entry.content, 'First response');
    
    // Verify jobs were added to queue
    assert.equal(queue.getPendingCount(), 2);
    
    await job.close();
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('ReconciliationJob run calls progress callbacks', async () => {
  const tempDir = createTempDir();
  
  try {
    const dbPath = path.join(tempDir, 'test.sqlite3');
    
    // Create a log file
    const entries = [
      { role: 'user', content: 'Hello' },
    ];
    createTestLogFile(tempDir, 'discord-channel', '123', '20260130T142355Z', entries);
    
    const progressEvents = [];
    const missingEvents = [];
    const completeEvents = [];
    
    const job = createReconciliationJob({
      logsRoot: tempDir,
      dbPath,
      onProgress: (event) => {
        progressEvents.push(event);
      },
      onMissingFound: (entry) => {
        missingEvents.push(entry);
      },
      onComplete: (report) => {
        completeEvents.push(report);
      },
    });
    
    await job.run();
    
    // Check progress events
    assert.ok(progressEvents.some(e => e.phase === 'scanning'));
    assert.ok(progressEvents.some(e => e.phase === 'complete'));
    
    // Check missing events
    assert.equal(missingEvents.length, 1);
    assert.equal(missingEvents[0].content, 'Hello');
    
    // Check complete events
    assert.equal(completeEvents.length, 1);
    assert.equal(completeEvents[0].filesScanned, 1);
    assert.equal(completeEvents[0].entriesMissing, 1);
    
    await job.close();
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('ReconciliationJob run handles empty logs gracefully', async () => {
  const tempDir = createTempDir();
  
  try {
    const dbPath = path.join(tempDir, 'test.sqlite3');
    
    const job = createReconciliationJob({
      logsRoot: tempDir,
      dbPath,
    });
    
    const report = await job.run();
    
    assert.equal(report.filesScanned, 0);
    assert.equal(report.entriesFound, 0);
    assert.equal(report.entriesMissing, 0);
    assert.equal(report.missingEntries.length, 0);
    assert.equal(report.errors.length, 0);
    
    await job.close();
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('ReconciliationJob run handles log files with no entries', async () => {
  const tempDir = createTempDir();
  
  try {
    const dbPath = path.join(tempDir, 'test.sqlite3');
    
    // Create a log file with no entries (just header)
    const logsDir = path.join(tempDir, 'logs', 'discord-channel', '123');
    fs.mkdirSync(logsDir, { recursive: true });
    const filePath = path.join(logsDir, '20260130T142355Z_0000.md');
    fs.writeFileSync(filePath, 
      `# Context Window: discord-channel/123\n` +
      `# Started: 20260130T142355Z\n` +
      `# Sequence: 0\n\n`,
      'utf8'
    );
    
    const job = createReconciliationJob({
      logsRoot: tempDir,
      dbPath,
    });
    
    const report = await job.run();
    
    assert.equal(report.filesScanned, 1);
    assert.equal(report.entriesFound, 0);
    assert.equal(report.entriesMissing, 0);
    
    await job.close();
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('runReconciliation convenience function works', async () => {
  const tempDir = createTempDir();
  
  try {
    const dbPath = path.join(tempDir, 'test.sqlite3');
    
    // Create a log file
    const entries = [
      { role: 'user', content: 'Test message' },
    ];
    createTestLogFile(tempDir, 'discord-channel', '123', '20260130T142355Z', entries);
    
    const report = await runReconciliation({
      logsRoot: tempDir,
      dbPath,
    });
    
    assert.equal(report.filesScanned, 1);
    assert.equal(report.entriesFound, 1);
    assert.equal(report.entriesMissing, 1);
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('ReconciliationJob handles errors during parsing', async () => {
  const tempDir = createTempDir();
  
  try {
    const dbPath = path.join(tempDir, 'test.sqlite3');
    
    // Create a log file
    const entries = [
      { role: 'user', content: 'Hello' },
    ];
    createTestLogFile(tempDir, 'discord-channel', '123', '20260130T142355Z', entries);
    
    const errorEvents = [];
    
    const job = createReconciliationJob({
      logsRoot: tempDir,
      dbPath,
      onError: (phase, data, error) => {
        errorEvents.push({ phase, data, error: error.message });
      },
    });
    
    // Monkey-patch parseLogFile to throw an error
    job.parseLogFile = () => {
      throw new Error('Parse error');
    };
    
    const report = await job.run();
    
    assert.equal(report.errors.length, 1);
    assert.equal(report.errors[0].phase, 'parsing');
    assert.ok(report.errors[0].error.includes('Parse error'));
    
    await job.close();
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('EmbeddingsIndex getByPathAndLine retrieves existing entry', async () => {
  const tempDir = createTempDir();
  
  try {
    const dbPath = path.join(tempDir, 'test.sqlite3');
    const index = createEmbeddingsIndex(dbPath);
    await index.open();
    await index.migrate();
    
    await index.insert({
      id: 'test-1',
      embedding: generateEmbedding(768, 1),
      path: '/logs/test.md',
      line: 42,
      timestamp: '2026-01-30T14:23:55.000Z',
      role: 'user',
      context_id: '123',
      pinned: false,
    });
    
    const retrieved = await index.getByPathAndLine('/logs/test.md', 42);
    assert.ok(retrieved);
    assert.equal(retrieved.id, 'test-1');
    assert.equal(retrieved.path, '/logs/test.md');
    assert.equal(retrieved.line, 42);
    
    const notFound = await index.getByPathAndLine('/logs/test.md', 99);
    assert.equal(notFound, null);
    
    await index.close();
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('ReconciliationJob handles entries with metadata', () => {
  const tempDir = createTempDir();
  
  try {
    const logsDir = path.join(tempDir, 'logs', 'discord-channel', '123');
    fs.mkdirSync(logsDir, { recursive: true });
    
    const filePath = path.join(logsDir, '20260130T142355Z_0000.md');
    const content = `# Context Window: discord-channel/123\n` +
      `# Started: 20260130T142355Z\n` +
      `# Sequence: 0\n\n` +
      `- **2026-01-30T14:23:55.000Z** [user] Hello bot (tool="bash" command="ls")\n` +
      `- **2026-01-30T14:24:00.000Z** [agent] Here are the files\n`;
    
    fs.writeFileSync(filePath, content, 'utf8');
    
    const job = createReconciliationJob({ logsRoot: tempDir });
    const parsed = job.parseLogFile(filePath, '123');
    
    assert.equal(parsed.length, 2);
    // Metadata should be stripped from content
    assert.equal(parsed[0].content, 'Hello bot');
    assert.equal(parsed[0].text, 'Hello bot');
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('ReconciliationJob run handles multiple log files across surfaces', async () => {
  const tempDir = createTempDir();
  
  try {
    const dbPath = path.join(tempDir, 'test.sqlite3');
    
    // Create log files in different surfaces
    createTestLogFile(tempDir, 'discord-channel', 'ch1', '20260130T142355Z', [
      { role: 'user', content: 'Channel message' },
    ]);
    createTestLogFile(tempDir, 'discord-thread', 'th1', '20260130T142400Z', [
      { role: 'user', content: 'Thread message 1' },
      { role: 'agent', content: 'Thread response' },
    ]);
    createTestLogFile(tempDir, 'discord-thread', 'th2', '20260130T142500Z', [
      { role: 'user', content: 'Another thread' },
    ]);
    
    const job = createReconciliationJob({
      logsRoot: tempDir,
      dbPath,
    });
    
    const report = await job.run();
    
    assert.equal(report.filesScanned, 3);
    assert.equal(report.entriesFound, 4);
    assert.equal(report.entriesMissing, 4);
    
    // Verify all entries have correct context IDs
    const contextIds = report.missingEntries.map(e => e.contextId);
    assert.ok(contextIds.includes('ch1'));
    assert.ok(contextIds.includes('th1'));
    assert.ok(contextIds.includes('th2'));
    
    await job.close();
  } finally {
    cleanupTempDir(tempDir);
  }
});
