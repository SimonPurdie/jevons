const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
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
