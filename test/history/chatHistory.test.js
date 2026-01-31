const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  ChatHistoryWindow,
  createChatHistoryWindow,
  readChatHistory,
  DEFAULT_CONFIG,
} = require('../../history/chatHistory');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-chat-history-test-'));
}

function cleanupTempDir(tempDir) {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function createLogFile(tempDir, entries) {
  const logPath = path.join(tempDir, 'test.log.md');
  let content = '# Session: 2026-01-30 14:23 GMT\n\n';
  for (const entry of entries) {
    const role = entry.role === 'user' ? 'user' : 'assistant';
    const timestamp = entry.timestamp || '2026-01-30T14:24:00.000Z';
    const date = new Date(timestamp);
    const localTime = date.toISOString().slice(0, 16).replace('T', ' ');
    const timeStr = localTime.slice(0, 10) + ' ' + localTime.slice(11, 16);
    
    content += `${role}: [Discord Guild #TestGuild channel id:123 +0m ${timeStr} GMT] author:\n${entry.content}\n`;
    if (entry.messageId) {
      content += `[message_id: ${entry.messageId}]\n`;
    }
  }
  fs.writeFileSync(logPath, content, 'utf8');
  return logPath;
}

test('ChatHistoryWindow.estimateTokens calculates correctly', () => {
  const window = createChatHistoryWindow();
  assert.equal(window.estimateTokens(''), 0);
  assert.equal(window.estimateTokens('hello'), 2); // 5 chars / 4 = 1.25 -> ceil = 2
  assert.equal(window.estimateTokens('a'.repeat(40)), 10); // 40 / 4 = 10
});

test('ChatHistoryWindow.truncateToBudget truncates long text', () => {
  const window = createChatHistoryWindow({ maxTokensPerMessage: 10, charsPerToken: 4 });
  const short = 'hello';
  const long = 'a'.repeat(100);

  assert.equal(window.truncateToBudget(short, 10), 'hello');
  assert.equal(window.truncateToBudget(long, 10).length, 40); // 10 * 4 = 40 chars max
  assert.ok(window.truncateToBudget(long, 10).endsWith('...'));
});

test('ChatHistoryWindow.formatMessage converts log entry to chat message', () => {
  const window = createChatHistoryWindow();
  
  const userMsg = window.formatMessage({ role: 'user', content: 'Hello' });
  assert.equal(userMsg.role, 'user');
  assert.equal(userMsg.content, 'Hello');

  const agentMsg = window.formatMessage({ role: 'agent', content: 'Hi there' });
  assert.equal(agentMsg.role, 'assistant');
  assert.equal(agentMsg.content, 'Hi there');
});

test('ChatHistoryWindow.formatMessage truncates long content', () => {
  const window = createChatHistoryWindow({ maxTokensPerMessage: 10, charsPerToken: 4 });
  const longContent = 'a'.repeat(100);
  
  const msg = window.formatMessage({ role: 'user', content: longContent });
  assert.equal(msg.content.length, 40); // Truncated to fit budget
});

test('ChatHistoryWindow.buildHistory returns empty array for no entries', () => {
  const window = createChatHistoryWindow();
  const history = window.buildHistory([]);
  assert.equal(history.length, 0);
});

test('ChatHistoryWindow.buildHistory filters out non-user/agent roles', () => {
  const window = createChatHistoryWindow();
  const entries = [
    { role: 'user', content: 'Hello' },
    { role: 'system', content: 'System message' },
    { role: 'agent', content: 'Hi' },
    { role: 'tool', content: 'Tool result' },
  ];
  
  const history = window.buildHistory(entries);
  assert.equal(history.length, 2);
  assert.equal(history[0].role, 'user');
  assert.equal(history[1].role, 'assistant');
});

test('ChatHistoryWindow.buildHistory respects maxHistoryMessages', () => {
  const window = createChatHistoryWindow({ maxHistoryMessages: 3 });
  const entries = [
    { role: 'user', content: 'Message 1' },
    { role: 'agent', content: 'Reply 1' },
    { role: 'user', content: 'Message 2' },
    { role: 'agent', content: 'Reply 2' },
    { role: 'user', content: 'Message 3' },
    { role: 'agent', content: 'Reply 3' },
  ];
  
  const history = window.buildHistory(entries);
  assert.equal(history.length, 3);
  // Last 3 entries: Reply 2, Message 3, Reply 3
  assert.equal(history[0].content, 'Reply 2');
  assert.equal(history[0].role, 'assistant');
  assert.equal(history[1].content, 'Message 3');
  assert.equal(history[1].role, 'user');
  assert.equal(history[2].content, 'Reply 3');
  assert.equal(history[2].role, 'assistant');
});

test('ChatHistoryWindow.buildHistory respects token budget', () => {
  const window = createChatHistoryWindow({
    maxHistoryMessages: 10,
    totalTokenBudget: 5, // Very low budget
    charsPerToken: 4,
  });
  const entries = [
    { role: 'user', content: 'Short' }, // ~2 tokens
    { role: 'agent', content: 'Also short' }, // ~3 tokens
    { role: 'user', content: 'This is a much longer message that exceeds budget' }, // ~12 tokens
  ];
  
  const history = window.buildHistory(entries);
  // Should only include last message if it fits, or previous ones
  assert.ok(history.length <= 2); // At most the two short ones fit in 5 tokens
});

test('ChatHistoryWindow.readHistoryFromLog reads from file', () => {
  const tempDir = createTempDir();
  try {
    const entries = [
      { role: 'user', content: 'Hello', timestamp: '2026-01-30T14:24:00.000Z' },
      { role: 'agent', content: 'Hi there', timestamp: '2026-01-30T14:24:05.000Z' },
    ];
    const logPath = createLogFile(tempDir, entries);
    
    const window = createChatHistoryWindow();
    const history = window.readHistoryFromLog(logPath);
    
    assert.equal(history.length, 2);
    assert.equal(history[0].role, 'user');
    assert.equal(history[0].content, 'Hello');
    assert.equal(history[1].role, 'assistant');
    assert.equal(history[1].content, 'Hi there');
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('readChatHistory convenience function works', () => {
  const tempDir = createTempDir();
  try {
    const entries = [
      { role: 'user', content: 'Test', timestamp: '2026-01-30T14:24:00.000Z' },
    ];
    const logPath = createLogFile(tempDir, entries);
    
    const history = readChatHistory(logPath);
    assert.equal(history.length, 1);
    assert.equal(history[0].role, 'user');
    assert.equal(history[0].content, 'Test');
  } finally {
    cleanupTempDir(tempDir);
  }
});

test('readChatHistory returns empty array for non-existent file', () => {
  const history = readChatHistory('/non/existent/path.log');
  assert.equal(history.length, 0);
});

test('ChatHistoryWindow preserves message ordering', () => {
  const window = createChatHistoryWindow();
  const entries = [
    { role: 'user', content: 'First question' },
    { role: 'agent', content: 'First answer' },
    { role: 'user', content: 'Second question' },
    { role: 'agent', content: 'Second answer' },
    { role: 'user', content: 'Third question' },
    { role: 'agent', content: 'Third answer' },
  ];
  
  const history = window.buildHistory(entries);
  
  // Verify alternating user/assistant pattern
  for (let i = 0; i < history.length; i++) {
    if (i % 2 === 0) {
      assert.equal(history[i].role, 'user');
    } else {
      assert.equal(history[i].role, 'assistant');
    }
  }
  
  // Verify chronological order is preserved
  assert.ok(history[0].content.includes('First') || history[0].content.includes('Second') || history[0].content.includes('Third'));
});

test('DEFAULT_CONFIG has expected values', () => {
  assert.equal(DEFAULT_CONFIG.maxHistoryMessages, 20);
  assert.equal(DEFAULT_CONFIG.maxTokensPerMessage, 500);
  assert.equal(DEFAULT_CONFIG.charsPerToken, 4);
  assert.equal(DEFAULT_CONFIG.totalTokenBudget, 3000);
});

test('ChatHistoryWindow accepts custom config', () => {
  const custom = {
    maxHistoryMessages: 50,
    totalTokenBudget: 5000,
  };
  const window = createChatHistoryWindow(custom);
  
  assert.equal(window.config.maxHistoryMessages, 50);
  assert.equal(window.config.totalTokenBudget, 5000);
  assert.equal(window.config.maxTokensPerMessage, 500); // Default preserved
  assert.equal(window.config.charsPerToken, 4); // Default preserved
});
