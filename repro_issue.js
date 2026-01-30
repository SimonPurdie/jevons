const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createLogWriter } = require('./memory/logs/logWriter');
const { readAllLogEntries } = require('./memory/logs/logReader');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-test-repro-'));
}

function cleanupTempDir(tempDir) {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('reproduce multi-line logging issue', () => {
  const tempDir = createTempDir();
  try {
    const writer = createLogWriter({
      logsRoot: tempDir,
      surface: 'discord-channel',
      contextId: '123',
      windowTimestamp: '20260130T142355Z',
      seq: 0,
    });
    
    const multiLineContent = 'Line 1\nLine 2\nLine 3';
    writer.append({
      timestamp: '2026-01-30T14:24:00.000Z',
      role: 'agent',
      content: multiLineContent,
    });
    
    const entries = readAllLogEntries(writer.path);
    assert.equal(entries.length, 1, 'Should have exactly 1 entry');
    assert.equal(entries[0].content, multiLineContent, 'Content should match exactly');
  } finally {
    cleanupTempDir(tempDir);
  }
});
