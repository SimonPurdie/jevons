const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createDiscordRuntime } = require('../../app/runtime');

class MockDiscordClient extends EventEmitter {
  constructor() {
    super();
    this.loginCalls = [];
  }

  login(token) {
    this.loginCalls.push(token);
    return Promise.resolve('ok');
  }
}

function makeMessage({
  channelId,
  parentId,
  isThread = false,
  content = 'hello',
  authorId = 'user-1',
  bot = false,
  messageId = 'msg-1',
} = {}) {
  return {
    id: messageId,
    content,
    author: { id: authorId, bot },
    channel: {
      id: channelId,
      isThread,
      parentId,
    },
  };
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('createDiscordRuntime sends model reply via sendMessage', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const modelInstance = { id: 'model-test' };
  const completeSimple = async () => ({
    content: [{ type: 'text', text: 'hi there' }],
  });

  createDiscordRuntime({
    client,
    token: 'token-123',
    channelId: 'root',
    modelInstance,
    completeSimple,
    sendMessage: (payload) => {
      sends.push(payload);
      return Promise.resolve();
    },
  });

  client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Hello' }));
  await flush();

  assert.equal(sends.length, 1);
  assert.equal(sends[0].content, 'hi there');
  assert.equal(sends[0].channelId, 'root');
});

test('createDiscordRuntime sends API error message when model fails', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const modelInstance = { id: 'model-test' };
  const completeSimple = async () => {
    throw new Error('No API key for provider: google');
  };

  createDiscordRuntime({
    client,
    token: 'token-123',
    channelId: 'root',
    modelInstance,
    completeSimple,
    sendMessage: (payload) => {
      sends.push(payload);
      return Promise.resolve();
    },
  });

  client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Hello' }));
  await flush();

  assert.equal(sends.length, 1);
  assert.equal(sends[0].content, 'API error: No API key for provider: google');
});

test('createDiscordRuntime sends API error when response is empty', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const modelInstance = { id: 'model-test' };
  const completeSimple = async () => ({ content: [] });

  createDiscordRuntime({
    client,
    token: 'token-123',
    channelId: 'root',
    modelInstance,
    completeSimple,
    sendMessage: (payload) => {
      sends.push(payload);
      return Promise.resolve();
    },
  });

  client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Hello' }));
  await flush();

  assert.equal(sends.length, 1);
  assert.equal(sends[0].content, 'API error: Model response missing content');
});

test('createDiscordRuntime ignores empty messages', async () => {
  const client = new MockDiscordClient();
  let called = 0;
  const modelInstance = { id: 'model-test' };
  const completeSimple = async () => {
    called += 1;
    return { content: [{ type: 'text', text: 'ok' }] };
  };

  createDiscordRuntime({
    client,
    token: 'token-123',
    channelId: 'root',
    modelInstance,
    completeSimple,
    sendMessage: () => Promise.resolve(),
  });

  client.emit('messageCreate', makeMessage({ channelId: 'root', content: '   ' }));
  await flush();

  assert.equal(called, 0);
});

test('createDiscordRuntime passes thread context to sendMessage', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const modelInstance = { id: 'model-test' };
  const completeSimple = async () => ({ content: [{ type: 'text', text: 'thread-reply' }] });

  createDiscordRuntime({
    client,
    token: 'token-123',
    channelId: 'root',
    modelInstance,
    completeSimple,
    sendMessage: (payload) => {
      sends.push(payload);
      return Promise.resolve();
    },
  });

  client.emit('messageCreate', makeMessage({
    channelId: 'thread-1',
    parentId: 'root',
    isThread: true,
  }));
  await flush();

  assert.equal(sends.length, 1);
  assert.equal(sends[0].threadId, 'thread-1');
  assert.equal(sends[0].channelId, 'root');
});

test('createDiscordRuntime logs user messages and agent replies', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const modelInstance = { id: 'model-test' };
  const completeSimple = async () => ({
    content: [{ type: 'text', text: 'Hello user' }],
  });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-runtime-test-'));

  try {
    createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'root',
      modelInstance,
      completeSimple,
      logsRoot: tempDir,
      sendMessage: (payload) => {
        sends.push(payload);
        return Promise.resolve();
      },
    });

    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Hello bot' }));
    await flush();

    // Check that log file was created
    const logsDir = path.join(tempDir, 'logs', 'discord-channel', 'root');
    assert.equal(fs.existsSync(logsDir), true);
    
    const files = fs.readdirSync(logsDir);
    assert.equal(files.length, 1);
    
    const logContent = fs.readFileSync(path.join(logsDir, files[0]), 'utf8');
    assert.ok(logContent.includes('[user] Hello bot'));
    assert.ok(logContent.includes('[agent] Hello user'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('createDiscordRuntime logs errors when model fails', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const modelInstance = { id: 'model-test' };
  const completeSimple = async () => {
    throw new Error('Model API error');
  };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-runtime-test-'));

  try {
    createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'root',
      modelInstance,
      completeSimple,
      logsRoot: tempDir,
      sendMessage: (payload) => {
        sends.push(payload);
        return Promise.resolve();
      },
    });

    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Hello bot' }));
    await flush();

    const logsDir = path.join(tempDir, 'logs', 'discord-channel', 'root');
    const files = fs.readdirSync(logsDir);
    const logContent = fs.readFileSync(path.join(logsDir, files[0]), 'utf8');
    
    assert.ok(logContent.includes('[user] Hello bot'));
    assert.ok(logContent.includes('[agent]'));
    assert.ok(logContent.includes('error'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('createDiscordRuntime works without logsRoot (logging disabled)', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const modelInstance = { id: 'model-test' };
  const completeSimple = async () => ({
    content: [{ type: 'text', text: 'hi there' }],
  });

  createDiscordRuntime({
    client,
    token: 'token-123',
    channelId: 'root',
    modelInstance,
    completeSimple,
    // logsRoot not provided
    sendMessage: (payload) => {
      sends.push(payload);
      return Promise.resolve();
    },
  });

  client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Hello' }));
  await flush();

  // Should still work without logging
  assert.equal(sends.length, 1);
  assert.equal(sends[0].content, 'hi there');
});
