const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  createLogWriter,
  createContextWindowResolver,
  formatTimestamp,
  formatWindowTimestamp,
  formatLocalDiscordTimestamp,
  getDefaultHistoryRoot,
  resolveLogPath,
} = require('../../history/logs/logWriter');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-test-'));
}

function cleanupTempDir(tempDir) {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('formatTimestamp returns ISO string', () => {
  const date = new Date('2026-01-30T14:23:55.000Z');
  const result = formatTimestamp(date);
  assert.equal(result, '2026-01-30T14:23:55.000Z');
});

test('formatWindowTimestamp returns local time format YYYY-MM-DD-hhmm', () => {
  const date = new Date('2026-01-30T14:23:55.000Z');
  // Convert to local time for comparison
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const expected = `${year}-${month}-${day}-${hours}${minutes}`;
  
  const result = formatWindowTimestamp(date);
  assert.equal(result, expected);
});

test('formatWindowTimestamp handles single digit months/days', () => {
  const date = new Date('2026-03-05T08:05:09.000Z');
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const expected = `${year}-${month}-${day}-${hours}${minutes}`;
  
  const result = formatWindowTimestamp(date);
  assert.equal(result, expected);
});

test('formatLocalDiscordTimestamp returns YYYY-MM-DD hh:mm format', () => {
  const date = new Date('2026-01-30T14:23:55.000Z');
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const expected = `${year}-${month}-${day} ${hours}:${minutes}`;
  
  const result = formatLocalDiscordTimestamp(date);
  assert.equal(result, expected);
});

test('getDefaultHistoryRoot returns ~/jevons/history', () => {
  const result = getDefaultHistoryRoot();
  const expected = path.join(os.homedir(), 'jevons', 'history');
  assert.equal(result, expected);
});

test('resolveLogPath builds flat path structure', () => {
  const result = resolveLogPath(
    '/root',
    '2026-01-30-1423'
  );
  assert.equal(result.dir, '/root');
  assert.equal(result.path, '/root/2026-01-30-1423.md');
});

test('createLogWriter requires all options', () => {
  const tempDir = createTempDir();
  try {
    assert.throws(() => createLogWriter({ historyRoot: tempDir }), /windowTimestamp is required/);
    assert.throws(() => createLogWriter({ historyRoot: tempDir, windowTimestamp: '2026-01-30-1423' }), /context is required/);
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('createLogWriter creates directory if not exists', () => {
  const tempDir = createTempDir();
  try {
    const historyRoot = path.join(tempDir, 'history');
    const writer = createLogWriter({
      historyRoot,
      windowTimestamp: '2026-01-30-1423',
      context: {
        surface: 'channel',
        contextId: '123',
        guildName: 'TestGuild',
      },
    });
    
    assert.equal(fs.existsSync(historyRoot), true);
    assert.equal(fs.existsSync(writer.path), true);
    // Verify header was written
    const content = fs.readFileSync(writer.path, 'utf8');
    assert.ok(content.includes('# Session:'));
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('createLogWriter append writes markdown entry in new format', () => {
  const tempDir = createTempDir();
  try {
    const writer = createLogWriter({
      historyRoot: tempDir,
      windowTimestamp: '2026-01-30-1423',
      context: {
        surface: 'channel',
        contextId: '123',
        guildName: 'TestGuild',
      },
    });
    
    const result = writer.append({
      timestamp: '2026-01-30T14:24:00.000Z',
      role: 'user',
      content: 'Hello bot',
      authorName: 'testuser',
    });
    
    const content = fs.readFileSync(writer.path, 'utf8');
    assert.ok(content.includes('user: [Discord Guild #TestGuild channel id:123'));
    assert.ok(content.includes('testuser:'));
    assert.ok(content.includes('Hello bot'));
    assert.equal(result.path, writer.path);
    assert.ok(result.line > 0);
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('createLogWriter append with messageId', () => {
  const tempDir = createTempDir();
  try {
    const writer = createLogWriter({
      historyRoot: tempDir,
      windowTimestamp: '2026-01-30-1423',
      context: {
        surface: 'channel',
        contextId: '123',
        guildName: 'TestGuild',
      },
    });
    
    writer.append({
      timestamp: '2026-01-30T14:24:00.000Z',
      role: 'assistant',
      content: 'Hello user',
      authorName: 'Jevons',
      messageId: 'abc123',
    });
    
    const content = fs.readFileSync(writer.path, 'utf8');
    assert.ok(content.includes('assistant: [Discord Guild #TestGuild channel id:123'));
    assert.ok(content.includes('Jevons:'));
    assert.ok(content.includes('Hello user'));
    assert.ok(content.includes('[message_id: abc123]'));
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('createLogWriter is append-only', () => {
  const tempDir = createTempDir();
  try {
    const writer = createLogWriter({
      historyRoot: tempDir,
      windowTimestamp: '2026-01-30-1423',
      context: {
        surface: 'channel',
        contextId: '123',
        guildName: 'TestGuild',
      },
    });
    
    writer.append({ role: 'user', content: 'First', authorName: 'user1' });
    writer.append({ role: 'assistant', content: 'Second', authorName: 'bot' });
    writer.append({ role: 'user', content: 'Third', authorName: 'user1' });
    
    const content = fs.readFileSync(writer.path, 'utf8');
    // Should have header + 3 entries
    assert.ok(content.includes('user:') && content.includes('First'));
    assert.ok(content.includes('assistant:') && content.includes('Second'));
    assert.ok(content.includes('user:') && content.includes('Third'));
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('createContextWindowResolver requires historyRoot', () => {
  assert.throws(() => createContextWindowResolver({}), /historyRoot is required/);
});

test('createContextWindowResolver creates new window on first access', () => {
  const tempDir = createTempDir();
  try {
    const resolver = createContextWindowResolver({ historyRoot: tempDir });
    const now = new Date('2026-01-30T14:23:55.000Z');
    const context = { guildName: 'TestGuild' };
    
    const window = resolver.getOrCreateContextWindow('channel', '456', context, now);
    
    assert.ok(window);
    assert.ok(window.path);
    assert.ok(window.path.includes('.md'));
    // Filename should be in YYYY-MM-DD-hhmm format (local time)
    const filename = path.basename(window.path);
    assert.match(filename, /^\d{4}-\d{2}-\d{2}-\d{4}\.md$/);
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('createContextWindowResolver returns same window for subsequent calls', () => {
  const tempDir = createTempDir();
  try {
    const resolver = createContextWindowResolver({ historyRoot: tempDir });
    const now = new Date('2026-01-30T14:23:55.000Z');
    const context = { guildName: 'TestGuild' };
    
    const window1 = resolver.getOrCreateContextWindow('channel', '456', context, now);
    const window2 = resolver.getOrCreateContextWindow('channel', '456', context, now);
    
    assert.equal(window1.path, window2.path);
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('createContextWindowResolver different contexts have different windows', () => {
  const tempDir = createTempDir();
  try {
    const resolver = createContextWindowResolver({ historyRoot: tempDir });
    const now = new Date('2026-01-30T14:23:55.000Z');
    const context = { guildName: 'TestGuild' };
    
    const window1 = resolver.getOrCreateContextWindow('channel', '456', context, now);
    // Add 1 minute to ensure different filename
    const later = new Date(now.getTime() + 60000);
    const window2 = resolver.getOrCreateContextWindow('channel', '789', context, later);
    
    assert.notEqual(window1.path, window2.path);
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('createContextWindowResolver endContextWindow removes window', () => {
  const tempDir = createTempDir();
  try {
    const resolver = createContextWindowResolver({ historyRoot: tempDir });
    const now = new Date('2026-01-30T14:23:55.000Z');
    const context = { guildName: 'TestGuild' };
    
    const window1 = resolver.getOrCreateContextWindow('channel', '456', context, now);
    resolver.endContextWindow('channel', '456');
    // After ending, a new window will be created with a new timestamp
    const later = new Date(now.getTime() + 60000);
    const window2 = resolver.getOrCreateContextWindow('channel', '456', context, later);
    
    assert.notEqual(window1.path, window2.path);
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('createContextWindowResolver resetContextWindow creates new window', () => {
  const tempDir = createTempDir();
  try {
    const resolver = createContextWindowResolver({ historyRoot: tempDir });
    const now = new Date('2026-01-30T14:23:55.000Z');
    const context = { guildName: 'TestGuild' };
    
    const window1 = resolver.getOrCreateContextWindow('channel', '456', context, now);
    // Reset with a later time to ensure different filename
    const later = new Date(now.getTime() + 60000);
    const window2 = resolver.resetContextWindow('channel', '456', context, later);
    
    assert.notEqual(window1.path, window2.path);
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('createContextWindowResolver tracks multiple windows independently', () => {
  const tempDir = createTempDir();
  try {
    const resolver = createContextWindowResolver({ historyRoot: tempDir });
    const now = new Date('2026-01-30T14:23:55.000Z');
    const context = { guildName: 'TestGuild' };
    
    const window1 = resolver.getOrCreateContextWindow('channel', '123', context, now);
    const window2 = resolver.getOrCreateContextWindow('channel', '456', context, now);
    const window3 = resolver.getOrCreateContextWindow('thread', '789', context, now);
    
    assert.equal(resolver._activeWindows.size, 3);
    
    resolver.endContextWindow('channel', '123');
    assert.equal(resolver._activeWindows.size, 2);
    
    resolver.endContextWindow('channel', '456');
    resolver.endContextWindow('thread', '789');
    assert.equal(resolver._activeWindows.size, 0);
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('end-to-end: write multiple entries to same window', () => {
  const tempDir = createTempDir();
  try {
    const resolver = createContextWindowResolver({ historyRoot: tempDir });
    const now = new Date('2026-01-30T14:23:55.000Z');
    const context = { guildName: 'TestGuild' };
    
    const window = resolver.getOrCreateContextWindow('channel', '123', context, now);
    
    window.append({
      timestamp: '2026-01-30T14:24:00.000Z',
      role: 'user',
      content: 'What time is it?',
      authorName: 'user1',
    });
    
    window.append({
      timestamp: '2026-01-30T14:24:05.000Z',
      role: 'assistant',
      content: 'It is 14:24 UTC.',
      authorName: 'Jevons',
    });
    
    const content = fs.readFileSync(window.path, 'utf8');
    assert.ok(content.includes('What time is it?'));
    assert.ok(content.includes('It is 14:24 UTC.'));
    assert.ok(content.includes('user: [Discord Guild #TestGuild'));
    assert.ok(content.includes('assistant: [Discord Guild #TestGuild'));
  } finally {
    cleanupTempDir(tempDir);
  }
});
