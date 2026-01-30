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
  getSequenceNumber,
  resolveLogPath,
} = require('../../memory/logs/logWriter');

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

test('formatWindowTimestamp returns compact UTC format', () => {
  const date = new Date('2026-01-30T14:23:55.000Z');
  const result = formatWindowTimestamp(date);
  assert.equal(result, '20260130T142355Z');
});

test('formatWindowTimestamp handles single digit months/days', () => {
  const date = new Date('2026-03-05T08:05:09.000Z');
  const result = formatWindowTimestamp(date);
  assert.equal(result, '20260305T080509Z');
});

test('resolveLogPath builds correct path structure', () => {
  const result = resolveLogPath(
    '/root',
    'discord-channel',
    '123456',
    '20260130T142355Z',
    0
  );
  assert.equal(result.dir, '/root/logs/discord-channel/123456');
  assert.equal(result.path, '/root/logs/discord-channel/123456/20260130T142355Z_0000.md');
});

test('resolveLogPath handles higher sequence numbers', () => {
  const result = resolveLogPath(
    '/root',
    'discord-thread',
    'abc123',
    '20260130T142355Z',
    42
  );
  assert.equal(result.path, '/root/logs/discord-thread/abc123/20260130T142355Z_0042.md');
});

test('getSequenceNumber returns 0 for empty directory', () => {
  const tempDir = createTempDir();
  try {
    const seq = getSequenceNumber(tempDir, '123', '20260130T142355Z');
    assert.equal(seq, 0);
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('getSequenceNumber returns next number for existing files', () => {
  const tempDir = createTempDir();
  try {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, '20260130T142355Z_0000.md'), '');
    fs.writeFileSync(path.join(tempDir, '20260130T142355Z_0001.md'), '');
    fs.writeFileSync(path.join(tempDir, '20260130T142355Z_0002.md'), '');
    
    const seq = getSequenceNumber(tempDir, '123', '20260130T142355Z');
    assert.equal(seq, 3);
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('getSequenceNumber ignores files with different timestamp', () => {
  const tempDir = createTempDir();
  try {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, '20260130T142355Z_0000.md'), '');
    fs.writeFileSync(path.join(tempDir, '20260130T142400Z_0000.md'), '');
    
    const seq = getSequenceNumber(tempDir, '123', '20260130T142355Z');
    assert.equal(seq, 1);
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('createLogWriter requires all options', () => {
  const tempDir = createTempDir();
  try {
    assert.throws(() => createLogWriter({ logsRoot: tempDir }), /surface is required/);
    assert.throws(() => createLogWriter({ logsRoot: tempDir, surface: 'discord-channel' }), /contextId is required/);
    assert.throws(() => createLogWriter({ logsRoot: tempDir, surface: 'discord-channel', contextId: '123' }), /windowTimestamp is required/);
    assert.throws(() => createLogWriter({ logsRoot: tempDir, surface: 'discord-channel', contextId: '123', windowTimestamp: '20260130T142355Z' }), /seq is required/);
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('createLogWriter creates directory if not exists', () => {
  const tempDir = createTempDir();
  try {
    const logsRoot = path.join(tempDir, 'logs-root');
    const writer = createLogWriter({
      logsRoot,
      surface: 'discord-channel',
      contextId: '123',
      windowTimestamp: '20260130T142355Z',
      seq: 0,
    });
    
    assert.equal(fs.existsSync(path.join(logsRoot, 'logs', 'discord-channel', '123')), true);
    assert.equal(fs.existsSync(writer.path), true);
    // Verify header was written
    const content = fs.readFileSync(writer.path, 'utf8');
    assert.ok(content.includes('# Context Window: discord-channel/123'));
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('createLogWriter append writes markdown entry', () => {
  const tempDir = createTempDir();
  try {
    const writer = createLogWriter({
      logsRoot: tempDir,
      surface: 'discord-channel',
      contextId: '123',
      windowTimestamp: '20260130T142355Z',
      seq: 0,
    });
    
    const result = writer.append({
      timestamp: '2026-01-30T14:24:00.000Z',
      role: 'user',
      content: 'Hello bot',
    });
    
    const content = fs.readFileSync(writer.path, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    // Header: 3 lines + entry: 1 line = 4 total non-empty
    assert.equal(lines.length, 4);
    assert.ok(lines[3].includes('[user] Hello bot'));
    assert.equal(result.path, writer.path);
    assert.equal(result.line, 5); // After 4-line header
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('createLogWriter append with metadata', () => {
  const tempDir = createTempDir();
  try {
    const writer = createLogWriter({
      logsRoot: tempDir,
      surface: 'discord-channel',
      contextId: '123',
      windowTimestamp: '20260130T142355Z',
      seq: 0,
    });
    
    writer.append({
      timestamp: '2026-01-30T14:24:00.000Z',
      role: 'agent',
      content: 'Hello user',
      metadata: { tool: 'bash', command: 'ls' },
    });
    
    const content = fs.readFileSync(writer.path, 'utf8');
    assert.ok(content.includes('[agent] Hello user'));
    assert.ok(content.includes('tool="bash"'));
    assert.ok(content.includes('command="ls"'));
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('createLogWriter is append-only', () => {
  const tempDir = createTempDir();
  try {
    const writer = createLogWriter({
      logsRoot: tempDir,
      surface: 'discord-channel',
      contextId: '123',
      windowTimestamp: '20260130T142355Z',
      seq: 0,
    });
    
    writer.append({ role: 'user', content: 'First' });
    writer.append({ role: 'agent', content: 'Second' });
    writer.append({ role: 'user', content: 'Third' });
    
    const content = fs.readFileSync(writer.path, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    // Header: 3 lines + 3 entries = 6 total non-empty
    assert.equal(lines.length, 6);
    assert.ok(lines[3].includes('[user] First'));
    assert.ok(lines[4].includes('[agent] Second'));
    assert.ok(lines[5].includes('[user] Third'));
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('createLogWriter returns correct line numbers', () => {
  const tempDir = createTempDir();
  try {
    const writer = createLogWriter({
      logsRoot: tempDir,
      surface: 'discord-channel',
      contextId: '123',
      windowTimestamp: '20260130T142355Z',
      seq: 0,
    });
    
    const r1 = writer.append({ role: 'user', content: 'First' });
    const r2 = writer.append({ role: 'agent', content: 'Second' });
    const r3 = writer.append({ role: 'user', content: 'Third' });
    
    // Lines are 1-indexed, header is 4 lines, so first append is line 5
    assert.equal(r1.line, 5);
    assert.equal(r2.line, 6);
    assert.equal(r3.line, 7);
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('createContextWindowResolver requires logsRoot', () => {
  assert.throws(() => createContextWindowResolver({}), /logsRoot is required/);
});

test('createContextWindowResolver creates new window on first access', () => {
  const tempDir = createTempDir();
  try {
    const resolver = createContextWindowResolver({ logsRoot: tempDir });
    const now = new Date('2026-01-30T14:23:55.000Z');
    
    const window = resolver.getOrCreateContextWindow('discord-channel', '456', now);
    
    assert.ok(window);
    assert.ok(window.path);
    assert.ok(window.path.includes('discord-channel'));
    assert.ok(window.path.includes('456'));
    assert.ok(window.path.includes('20260130T142355Z'));
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('createContextWindowResolver returns same window for subsequent calls', () => {
  const tempDir = createTempDir();
  try {
    const resolver = createContextWindowResolver({ logsRoot: tempDir });
    const now = new Date('2026-01-30T14:23:55.000Z');
    
    const window1 = resolver.getOrCreateContextWindow('discord-channel', '456', now);
    const window2 = resolver.getOrCreateContextWindow('discord-channel', '456', now);
    
    assert.equal(window1.path, window2.path);
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('createContextWindowResolver different contexts have different windows', () => {
  const tempDir = createTempDir();
  try {
    const resolver = createContextWindowResolver({ logsRoot: tempDir });
    const now = new Date('2026-01-30T14:23:55.000Z');
    
    const window1 = resolver.getOrCreateContextWindow('discord-channel', '456', now);
    const window2 = resolver.getOrCreateContextWindow('discord-channel', '789', now);
    
    assert.notEqual(window1.path, window2.path);
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('createContextWindowResolver endContextWindow removes window', () => {
  const tempDir = createTempDir();
  try {
    const resolver = createContextWindowResolver({ logsRoot: tempDir });
    const now = new Date('2026-01-30T14:23:55.000Z');
    
    const window1 = resolver.getOrCreateContextWindow('discord-channel', '456', now);
    resolver.endContextWindow('discord-channel', '456');
    const window2 = resolver.getOrCreateContextWindow('discord-channel', '456', now);
    
    assert.notEqual(window1.path, window2.path);
    assert.ok(window1.path.includes('_0000.md'));
    assert.ok(window2.path.includes('_0001.md'));
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('createContextWindowResolver resetContextWindow creates new window', () => {
  const tempDir = createTempDir();
  try {
    const resolver = createContextWindowResolver({ logsRoot: tempDir });
    const now = new Date('2026-01-30T14:23:55.000Z');
    
    const window1 = resolver.getOrCreateContextWindow('discord-channel', '456', now);
    const window2 = resolver.resetContextWindow('discord-channel', '456', now);
    
    assert.notEqual(window1.path, window2.path);
    assert.ok(window1.path.includes('_0000.md'));
    assert.ok(window2.path.includes('_0001.md'));
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('createContextWindowResolver tracks multiple windows independently', () => {
  const tempDir = createTempDir();
  try {
    const resolver = createContextWindowResolver({ logsRoot: tempDir });
    const now = new Date('2026-01-30T14:23:55.000Z');
    
    const window1 = resolver.getOrCreateContextWindow('discord-channel', '123', now);
    const window2 = resolver.getOrCreateContextWindow('discord-channel', '456', now);
    const window3 = resolver.getOrCreateContextWindow('discord-thread', '789', now);
    
    assert.equal(resolver._activeWindows.size, 3);
    
    resolver.endContextWindow('discord-channel', '123');
    assert.equal(resolver._activeWindows.size, 2);
    
    resolver.endContextWindow('discord-channel', '456');
    resolver.endContextWindow('discord-thread', '789');
    assert.equal(resolver._activeWindows.size, 0);
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('end-to-end: write multiple entries to same window', () => {
  const tempDir = createTempDir();
  try {
    const resolver = createContextWindowResolver({ logsRoot: tempDir });
    const now = new Date('2026-01-30T14:23:55.000Z');
    
    const window = resolver.getOrCreateContextWindow('discord-channel', '123', now);
    
    window.append({
      timestamp: '2026-01-30T14:24:00.000Z',
      role: 'user',
      content: 'What time is it?',
    });
    
    window.append({
      timestamp: '2026-01-30T14:24:05.000Z',
      role: 'agent',
      content: 'It is 14:24 UTC.',
    });
    
    const content = fs.readFileSync(window.path, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    // Header: 3 lines + 2 entries = 5 total non-empty
    assert.equal(lines.length, 5);
    assert.ok(lines[3].includes('What time is it?'));
    assert.ok(lines[4].includes('It is 14:24 UTC.'));
  } finally {
    cleanupTempDir(tempDir);
  }
});
