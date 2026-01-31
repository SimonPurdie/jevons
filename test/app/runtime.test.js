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

class MockAgent {
  constructor(options) {
    this.state = {
      messages: [...(options.initialState.messages || [])]
    };
    this.model = options.initialState.model;
  }

  async prompt(msg) {
    this.state.messages.push(msg);
    const reply = await this.model.completeSimple(this.model, { messages: this.state.messages });
    const content = Array.isArray(reply.content) ? reply.content : [{ type: 'text', text: reply.content }];
    this.state.messages.push({ role: 'assistant', content });
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
  guildName = 'TestGuild',
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
    guild: { name: guildName },
  };
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 10));
}

test('createDiscordRuntime sends model reply via sendMessage', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const modelInstance = {
    id: 'model-test',
    completeSimple: async () => ({
      content: [{ type: 'text', text: 'hi there' }],
    })
  };

  createDiscordRuntime({
    client,
    token: 'token-123',
    channelId: 'root',
    modelInstance,
    sendMessage: (payload) => {
      sends.push(payload);
      return Promise.resolve();
    },
    deps: { Agent: MockAgent }
  });

  client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Hello' }));
  await flush();

  assert.equal(sends.length, 1);
  assert.equal(sends[0].content, 'hi there');
  assert.equal(sends[0].channelId, 'root');
});

test('createDiscordRuntime logs user messages and agent replies', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const modelInstance = {
    id: 'model-test',
    completeSimple: async () => ({
      content: [{ type: 'text', text: 'Hello user' }],
    })
  };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-runtime-test-'));

  try {
    createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'root',
      modelInstance,
      memoryRoot: tempDir,
      sendMessage: (payload) => {
        sends.push(payload);
        return Promise.resolve();
      },
      deps: { Agent: MockAgent }
    });

    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Hello bot' }));
    await flush();

    const files = fs.readdirSync(tempDir).filter(f => f.endsWith('.md'));
    assert.ok(files.length > 0, 'Should create at least one log file');
    const logContent = fs.readFileSync(path.join(tempDir, files[0]), 'utf8');
    assert.ok(logContent.includes('user: [Discord Guild #TestGuild'));
    assert.ok(logContent.includes('Hello bot'));
    assert.ok(logContent.includes('assistant: [Discord Guild #TestGuild'));
    assert.ok(logContent.includes('Hello user'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('createDiscordRuntime /new command resets context window', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  let modelCalls = 0;
  const modelInstance = {
    id: 'model-test',
    completeSimple: async () => {
      modelCalls += 1;
      return { content: [{ type: 'text', text: 'reply' }] };
    }
  };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-runtime-test-'));

  try {
    createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'root',
      modelInstance,
      memoryRoot: tempDir,
      sendMessage: (payload) => {
        sends.push(payload);
        return Promise.resolve();
      },
      deps: { Agent: MockAgent }
    });

    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Hello' }));
    await flush();

    client.emit('messageCreate', makeMessage({ channelId: 'root', content: '/new' }));
    await flush();

    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'After reset' }));
    await flush();

    const newConfirmation = sends.find(s => s.content.includes('Context window reset'));
    assert.ok(newConfirmation);
    assert.equal(modelCalls, 2);

    // Note: With the new format, if all messages happen within the same minute,
    // they will be in the same file. The reset still clears the active window
    // from memory, but the file is determined by the timestamp.
    const files = fs.readdirSync(tempDir).filter(f => f.endsWith('.md')).sort();
    assert.ok(files.length >= 1, 'Should create at least one log file');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('createDiscordRuntime passes chat history to model', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const calls = [];
  const modelInstance = {
    id: 'model-test',
    completeSimple: async (model, request) => {
      calls.push([...request.messages]);
      return { content: [{ type: 'text', text: 'reply' }] };
    }
  };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-runtime-test-'));

  try {
    createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'root',
      modelInstance,
      memoryRoot: tempDir,
      sendMessage: (payload) => {
        sends.push(payload);
        return Promise.resolve();
      },
      deps: { Agent: MockAgent }
    });

    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'First message' }));
    await flush();

    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Second message' }));
    await flush();

    assert.equal(calls.length, 2);
    assert.equal(calls[0].length, 1); // current user message
    assert.equal(calls[1].length, 3); // history (user, agent) + current user message
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
