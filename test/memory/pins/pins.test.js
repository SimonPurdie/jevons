const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  PinsManager,
  createPinsManager,
  handleRemember,
  pinMessage,
} = require('../../../memory/pins/pins');
const { createEmbeddingsIndex } = require('../../../memory/index/sqlite');

function generateEmbedding(dimensions = 768, seed = 1) {
  const embedding = [];
  for (let i = 0; i < dimensions; i++) {
    embedding.push(Math.sin(seed + i * 0.1) * 0.5 + 0.5);
  }
  return embedding;
}

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pins-test-'));
}

function cleanupTempDir(tempDir) {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function createLogFile(logsRoot, surface, contextId, windowTimestamp, seq, entries) {
  const logsDir = path.join(logsRoot, 'logs', surface, contextId);
  fs.mkdirSync(logsDir, { recursive: true });
  const seqStr = String(seq).padStart(4, '0');
  const logPath = path.join(logsDir, `${windowTimestamp}_${seqStr}.md`);

  let content = `# Context Window: ${surface}/${contextId}\n` +
    `# Started: ${windowTimestamp}\n` +
    `# Sequence: ${seq}\n\n`;

  for (const entry of entries) {
    const metaStr = entry.metadata
      ? ` (${Object.entries(entry.metadata).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')})`
      : '';
    content += `- **${entry.timestamp}** [${entry.role}] ${entry.content}${metaStr}\n`;
  }

  fs.writeFileSync(logPath, content, 'utf8');
  return logPath;
}

test('PinsManager initializes with options', () => {
  const manager = new PinsManager({
    indexPath: '/tmp/test.sqlite3',
    logsRoot: '/tmp/logs',
  });
  assert.equal(manager.indexPath, '/tmp/test.sqlite3');
  assert.equal(manager.logsRoot, '/tmp/logs');
  assert.equal(manager.index, null);
});

test('createPinsManager factory returns PinsManager instance', () => {
  const manager = createPinsManager({
    indexPath: '/tmp/test.sqlite3',
    logsRoot: '/tmp/logs',
  });
  assert.ok(manager instanceof PinsManager);
});

test('PinsManager parses Discord URL reference', () => {
  const manager = createPinsManager({});
  const content = '/remember https://discord.com/channels/123456/789012/345678901234567890';
  const result = manager.parseMessageReference(content);

  assert.ok(result);
  assert.equal(result.messageId, '345678901234567890');
  assert.equal(result.channelId, '789012');
  assert.equal(result.guildId, '123456');
  assert.equal(result.source, 'url');
});

test('PinsManager parses raw message ID', () => {
  const manager = createPinsManager({});
  const content = '/remember 1234567890123456789';
  const result = manager.parseMessageReference(content);

  assert.ok(result);
  assert.equal(result.messageId, '1234567890123456789');
  assert.equal(result.source, 'id');
});

test('PinsManager parses reply reference', () => {
  const manager = createPinsManager({});
  const content = '/remember';
  const repliedMessageId = '9876543210987654321';
  const result = manager.parseMessageReference(content, repliedMessageId);

  assert.ok(result);
  assert.equal(result.messageId, '9876543210987654321');
  assert.equal(result.source, 'reply');
});

test('PinsManager returns null for invalid command', () => {
  const manager = createPinsManager({});
  const content = '/remember'; // No message ID or URL
  const result = manager.parseMessageReference(content);

  assert.equal(result, null);
});

test('PinsManager finds message in logs by message ID', async () => {
  const tempDir = createTempDir();
  const logsRoot = path.join(tempDir, 'logs');
  const dbPath = path.join(tempDir, 'test.sqlite3');

  const manager = createPinsManager({
    indexPath: dbPath,
    logsRoot,
  });

  // Create a log file with a message
  const entries = [
    {
      timestamp: '2026-01-30T10:00:00Z',
      role: 'user',
      content: 'Hello, this is a test message',
      metadata: { messageId: '1234567890123456789', authorId: 'user-1' },
    },
  ];
  createLogFile(logsRoot, 'discord-channel', 'ctx-1', '20260130T100000Z', 0, entries);

  const result = await manager.findMessageInLogs('1234567890123456789');

  assert.ok(result);
  assert.equal(result.messageId, '1234567890123456789');
  assert.equal(result.content, 'Hello, this is a test message');
  assert.equal(result.role, 'user');

  await manager.close();
  cleanupTempDir(tempDir);
});

test('PinsManager returns null for non-existent message', async () => {
  const tempDir = createTempDir();
  const logsRoot = path.join(tempDir, 'logs');
  const dbPath = path.join(tempDir, 'test.sqlite3');

  const manager = createPinsManager({
    indexPath: dbPath,
    logsRoot,
  });

  const result = await manager.findMessageInLogs('nonexistent');
  assert.equal(result, null);

  await manager.close();
  cleanupTempDir(tempDir);
});

test('PinsManager pins a message successfully', async () => {
  const tempDir = createTempDir();
  const logsRoot = path.join(tempDir, 'logs');
  const dbPath = path.join(tempDir, 'test.sqlite3');

  const manager = createPinsManager({
    indexPath: dbPath,
    logsRoot,
  });

  // Create log file and index entry
  const entries = [
    {
      timestamp: '2026-01-30T10:00:00Z',
      role: 'user',
      content: 'Important information to remember',
      metadata: { messageId: '1234567890123456789', authorId: 'user-1' },
    },
  ];
  const logPath = createLogFile(logsRoot, 'discord-channel', 'ctx-1', '20260130T100000Z', 0, entries);

  // Create the embedding entry in the database
  await manager.initialize();
  await manager.index.insert({
    id: 'emb-1',
    embedding: generateEmbedding(768, 1),
    path: logPath,
    line: 5, // Line number of the entry in the log file
    timestamp: '2026-01-30T10:00:00Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: false,
  });

  // Pin the message
  const result = await manager.pinMessage('1234567890123456789');

  assert.ok(result.success);
  assert.ok(result.entry);
  assert.equal(result.entry.pinned, true);

  await manager.close();
  cleanupTempDir(tempDir);
});

test('PinsManager returns success for already pinned message', async () => {
  const tempDir = createTempDir();
  const logsRoot = path.join(tempDir, 'logs');
  const dbPath = path.join(tempDir, 'test.sqlite3');

  const manager = createPinsManager({
    indexPath: dbPath,
    logsRoot,
  });

  // Create log file and pinned index entry
  const entries = [
    {
      timestamp: '2026-01-30T10:00:00Z',
      role: 'user',
      content: 'Already pinned message',
      metadata: { messageId: '1234567890123456789', authorId: 'user-1' },
    },
  ];
  const logPath = createLogFile(logsRoot, 'discord-channel', 'ctx-1', '20260130T100000Z', 0, entries);

  // Create the embedding entry already pinned
  await manager.initialize();
  await manager.index.insert({
    id: 'emb-1',
    embedding: generateEmbedding(768, 1),
    path: logPath,
    line: 5,
    timestamp: '2026-01-30T10:00:00Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: true,
  });

  // Try to pin again
  const result = await manager.pinMessage('1234567890123456789');

  assert.ok(result.success);
  assert.ok(result.message.includes('already pinned'));

  await manager.close();
  cleanupTempDir(tempDir);
});

test('PinsManager returns failure for non-existent message', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');

  const manager = createPinsManager({
    indexPath: dbPath,
    logsRoot: tempDir,
  });

  // Try to pin non-existent message
  const result = await manager.pinMessage('nonexistent');

  assert.equal(result.success, false);
  assert.ok(result.message.includes('not found'));

  await manager.close();
  cleanupTempDir(tempDir);
});

test('PinsManager unpins a message successfully', async () => {
  const tempDir = createTempDir();
  const logsRoot = path.join(tempDir, 'logs');
  const dbPath = path.join(tempDir, 'test.sqlite3');

  const manager = createPinsManager({
    indexPath: dbPath,
    logsRoot,
  });

  // Create log file and pinned index entry
  const entries = [
    {
      timestamp: '2026-01-30T10:00:00Z',
      role: 'user',
      content: 'Message to unpin',
      metadata: { messageId: '1234567890123456789', authorId: 'user-1' },
    },
  ];
  const logPath = createLogFile(logsRoot, 'discord-channel', 'ctx-1', '20260130T100000Z', 0, entries);

  // Create the embedding entry already pinned
  await manager.initialize();
  await manager.index.insert({
    id: 'emb-1',
    embedding: generateEmbedding(768, 1),
    path: logPath,
    line: 5,
    timestamp: '2026-01-30T10:00:00Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: true,
  });

  // Unpin the message
  const result = await manager.unpinMessage('1234567890123456789');

  assert.ok(result.success);
  assert.ok(result.entry);
  assert.equal(result.entry.pinned, false);

  await manager.close();
  cleanupTempDir(tempDir);
});

test('PinsManager handles /remember command with URL', async () => {
  const tempDir = createTempDir();
  const logsRoot = path.join(tempDir, 'logs');
  const dbPath = path.join(tempDir, 'test.sqlite3');

  const manager = createPinsManager({
    indexPath: dbPath,
    logsRoot,
  });

  // Create log file and index entry
  const entries = [
    {
      timestamp: '2026-01-30T10:00:00Z',
      role: 'user',
      content: 'Remember this URL message',
      metadata: { messageId: '9876543210987654321', authorId: 'user-1' },
    },
  ];
  const logPath = createLogFile(logsRoot, 'discord-channel', 'ctx-1', '20260130T100000Z', 0, entries);

  // Create the embedding entry
  await manager.initialize();
  await manager.index.insert({
    id: 'emb-1',
    embedding: generateEmbedding(768, 1),
    path: logPath,
    line: 5,
    timestamp: '2026-01-30T10:00:00Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: false,
  });

  // Handle /remember command with URL
  const content = '/remember https://discord.com/channels/123/456/9876543210987654321';
  const result = await manager.handleRememberCommand(content);

  assert.ok(result.success);
  assert.ok(result.message.includes('pinned'));
  assert.ok(result.entry);

  await manager.close();
  cleanupTempDir(tempDir);
});

test('PinsManager handles /remember command with reply', async () => {
  const tempDir = createTempDir();
  const logsRoot = path.join(tempDir, 'logs');
  const dbPath = path.join(tempDir, 'test.sqlite3');

  const manager = createPinsManager({
    indexPath: dbPath,
    logsRoot,
  });

  // Create log file and index entry
  const entries = [
    {
      timestamp: '2026-01-30T10:00:00Z',
      role: 'user',
      content: 'Reply to this message',
      metadata: { messageId: '5555555555555555555', authorId: 'user-1' },
    },
  ];
  const logPath = createLogFile(logsRoot, 'discord-channel', 'ctx-1', '20260130T100000Z', 0, entries);

  // Create the embedding entry
  await manager.initialize();
  await manager.index.insert({
    id: 'emb-1',
    embedding: generateEmbedding(768, 1),
    path: logPath,
    line: 5,
    timestamp: '2026-01-30T10:00:00Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: false,
  });

  // Handle /remember command with reply reference
  const content = '/remember';
  const repliedMessageId = '5555555555555555555';
  const result = await manager.handleRememberCommand(content, repliedMessageId);

  assert.ok(result.success);
  assert.ok(result.message.includes('pinned'));

  await manager.close();
  cleanupTempDir(tempDir);
});

test('PinsManager returns failure for invalid /remember command', async () => {
  const tempDir = createTempDir();
  const dbPath = path.join(tempDir, 'test.sqlite3');

  const manager = createPinsManager({
    indexPath: dbPath,
    logsRoot: tempDir,
  });

  // Handle invalid /remember command (no reference)
  const content = '/remember';
  const result = await manager.handleRememberCommand(content);

  assert.equal(result.success, false);
  assert.ok(result.message.includes('Invalid'));

  await manager.close();
  cleanupTempDir(tempDir);
});

test('PinsManager gets all pinned memories', async () => {
  const tempDir = createTempDir();
  const logsRoot = path.join(tempDir, 'logs');
  const dbPath = path.join(tempDir, 'test.sqlite3');

  const manager = createPinsManager({
    indexPath: dbPath,
    logsRoot,
  });

  await manager.initialize();

  // Insert multiple entries, some pinned
  await manager.index.insert({
    id: 'emb-1',
    embedding: generateEmbedding(768, 1),
    path: 'logs/test.md',
    line: 1,
    timestamp: '2026-01-30T10:00:00Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: true,
  });

  await manager.index.insert({
    id: 'emb-2',
    embedding: generateEmbedding(768, 2),
    path: 'logs/test.md',
    line: 2,
    timestamp: '2026-01-30T10:01:00Z',
    role: 'agent',
    context_id: 'ctx-1',
    pinned: false,
  });

  await manager.index.insert({
    id: 'emb-3',
    embedding: generateEmbedding(768, 3),
    path: 'logs/test.md',
    line: 3,
    timestamp: '2026-01-30T10:02:00Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: true,
  });

  const pinned = await manager.getPinnedMemories();

  assert.equal(pinned.length, 2);
  assert.ok(pinned.some(p => p.id === 'emb-1'));
  assert.ok(pinned.some(p => p.id === 'emb-3'));

  await manager.close();
  cleanupTempDir(tempDir);
});

test('PinsManager checks if message is pinned', async () => {
  const tempDir = createTempDir();
  const logsRoot = path.join(tempDir, 'logs');
  const dbPath = path.join(tempDir, 'test.sqlite3');

  const manager = createPinsManager({
    indexPath: dbPath,
    logsRoot,
  });

  // Create log file and index entries
  const entries = [
    {
      timestamp: '2026-01-30T10:00:00Z',
      role: 'user',
      content: 'Pinned message',
      metadata: { messageId: '1111111111111111111', authorId: 'user-1' },
    },
    {
      timestamp: '2026-01-30T10:01:00Z',
      role: 'user',
      content: 'Unpinned message',
      metadata: { messageId: '2222222222222222222', authorId: 'user-1' },
    },
  ];
  const logPath = createLogFile(logsRoot, 'discord-channel', 'ctx-1', '20260130T100000Z', 0, entries);

  await manager.initialize();

  await manager.index.insert({
    id: 'emb-1',
    embedding: generateEmbedding(768, 1),
    path: logPath,
    line: 5,
    timestamp: '2026-01-30T10:00:00Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: true,
  });

  await manager.index.insert({
    id: 'emb-2',
    embedding: generateEmbedding(768, 2),
    path: logPath,
    line: 6,
    timestamp: '2026-01-30T10:01:00Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: false,
  });

  const isPinned1 = await manager.isPinned('1111111111111111111');
  const isPinned2 = await manager.isPinned('2222222222222222222');
  const isPinned3 = await manager.isPinned('nonexistent');

  assert.equal(isPinned1, true);
  assert.equal(isPinned2, false);
  assert.equal(isPinned3, false);

  await manager.close();
  cleanupTempDir(tempDir);
});

test('handleRemember convenience function works', async () => {
  const tempDir = createTempDir();
  const logsRoot = path.join(tempDir, 'logs');
  const dbPath = path.join(tempDir, 'test.sqlite3');

  // Create log file and index entry
  const entries = [
    {
      timestamp: '2026-01-30T10:00:00Z',
      role: 'user',
      content: 'Convenience function test',
      metadata: { messageId: '9999999999999999999', authorId: 'user-1' },
    },
  ];
  const logPath = createLogFile(logsRoot, 'discord-channel', 'ctx-1', '20260130T100000Z', 0, entries);

  // Create the embedding entry
  const index = createEmbeddingsIndex(dbPath);
  await index.open();
  await index.migrate();
  await index.insert({
    id: 'emb-1',
    embedding: generateEmbedding(768, 1),
    path: logPath,
    line: 5,
    timestamp: '2026-01-30T10:00:00Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: false,
  });
  await index.close();

  // Use convenience function
  const content = '/remember https://discord.com/channels/123/456/9999999999999999999';
  const result = await handleRemember(content, {
    indexPath: dbPath,
    logsRoot,
  });

  assert.ok(result.success);
  assert.ok(result.message.includes('pinned'));

  cleanupTempDir(tempDir);
});

test('pinMessage convenience function works', async () => {
  const tempDir = createTempDir();
  const logsRoot = path.join(tempDir, 'logs');
  const dbPath = path.join(tempDir, 'test.sqlite3');

  // Create log file and index entry
  const entries = [
    {
      timestamp: '2026-01-30T10:00:00Z',
      role: 'user',
      content: 'Pin convenience test',
      metadata: { messageId: '8888888888888888888', authorId: 'user-1' },
    },
  ];
  const logPath = createLogFile(logsRoot, 'discord-channel', 'ctx-1', '20260130T100000Z', 0, entries);

  // Create the embedding entry
  const index = createEmbeddingsIndex(dbPath);
  await index.open();
  await index.migrate();
  await index.insert({
    id: 'emb-1',
    embedding: generateEmbedding(768, 1),
    path: logPath,
    line: 5,
    timestamp: '2026-01-30T10:00:00Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: false,
  });
  await index.close();

  // Use convenience function
  const result = await pinMessage('8888888888888888888', {
    indexPath: dbPath,
    logsRoot,
  });

  assert.ok(result.success);
  assert.ok(result.entry);

  cleanupTempDir(tempDir);
});

test('PinsManager searches by context when contextId provided', async () => {
  const tempDir = createTempDir();
  const logsRoot = path.join(tempDir, 'logs');
  const dbPath = path.join(tempDir, 'test.sqlite3');

  const manager = createPinsManager({
    indexPath: dbPath,
    logsRoot,
  });

  // Create log files in different contexts
  const entries1 = [
    {
      timestamp: '2026-01-30T10:00:00Z',
      role: 'user',
      content: 'Context 1 message',
      metadata: { messageId: '7777777777777777777', authorId: 'user-1' },
    },
  ];
  createLogFile(logsRoot, 'discord-channel', 'ctx-1', '20260130T100000Z', 0, entries1);

  const entries2 = [
    {
      timestamp: '2026-01-30T11:00:00Z',
      role: 'user',
      content: 'Context 2 message',
      metadata: { messageId: '7777777777777777777', authorId: 'user-1' },
    },
  ];
  createLogFile(logsRoot, 'discord-channel', 'ctx-2', '20260130T110000Z', 0, entries2);

  // Search with contextId
  const result = await manager.findMessageInLogs('7777777777777777777', 'ctx-1');

  assert.ok(result);
  assert.equal(result.content, 'Context 1 message');

  await manager.close();
  cleanupTempDir(tempDir);
});

test('PinsManager pins are boosted in retrieval', async () => {
  const tempDir = createTempDir();
  const logsRoot = path.join(tempDir, 'logs');
  const dbPath = path.join(tempDir, 'test.sqlite3');

  const manager = createPinsManager({
    indexPath: dbPath,
    logsRoot,
  });

  // Create log files
  const entries = [
    {
      timestamp: '2026-01-30T10:00:00Z',
      role: 'user',
      content: 'Low similarity pinned',
      metadata: { messageId: '111', authorId: 'user-1' },
    },
    {
      timestamp: '2026-01-30T10:01:00Z',
      role: 'user',
      content: 'High similarity unpinned',
      metadata: { messageId: '222', authorId: 'user-1' },
    },
  ];
  const logPath = createLogFile(logsRoot, 'discord-channel', 'ctx-1', '20260130T100000Z', 0, entries);

  await manager.initialize();

  // Insert entries: one pinned with low similarity (seed 50), one unpinned with high similarity (seed 1)
  await manager.index.insert({
    id: 'emb-pinned',
    embedding: generateEmbedding(768, 50), // Low similarity to query (seed 1)
    path: logPath,
    line: 5,
    timestamp: '2026-01-30T10:00:00Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: true,
  });

  await manager.index.insert({
    id: 'emb-unpinned',
    embedding: generateEmbedding(768, 1), // High similarity to query (seed 1)
    path: logPath,
    line: 6,
    timestamp: '2026-01-30T10:01:00Z',
    role: 'user',
    context_id: 'ctx-1',
    pinned: false,
  });

  // Verify pinned memory is in the database
  const pinnedMemories = await manager.getPinnedMemories();
  assert.equal(pinnedMemories.length, 1);
  assert.equal(pinnedMemories[0].id, 'emb-pinned');
  assert.equal(pinnedMemories[0].pinned, true);

  // Verify unpinned memory is not in pinned list
  const unpinned = await manager.index.getById('emb-unpinned');
  assert.equal(unpinned.pinned, false);

  await manager.close();
  cleanupTempDir(tempDir);
});
