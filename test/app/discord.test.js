const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { createDiscordBot, extractContext } = require('../../app/discord');

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
  system = false,
  type = 0,
} = {}) {
  return {
    id: messageId,
    content,
    author: { id: authorId, bot },
    system: Boolean(system),
    type: type || 0,
    channel: {
      id: channelId,
      isThread,
      parentId,
    },
  };
}

test('extractContext returns null for unrelated channel', () => {
  const message = makeMessage({ channelId: 'other' });
  const context = extractContext(message, 'root');
  assert.equal(context, null);
});

test('extractContext returns channel context', () => {
  const message = makeMessage({ channelId: 'root' });
  const context = extractContext(message, 'root');
  assert.deepEqual(context, {
    channelId: 'root',
    threadId: null,
    contextId: 'root',
    isThread: false,
    guildName: 'Unknown',
  });
});

test('extractContext returns thread context for matching parent', () => {
  const message = makeMessage({
    channelId: 'thread-1',
    parentId: 'root',
    isThread: true,
  });
  const context = extractContext(message, 'root');
  assert.deepEqual(context, {
    channelId: 'root',
    threadId: 'thread-1',
    contextId: 'thread-1',
    isThread: true,
    guildName: 'Unknown',
  });
});

test('createDiscordBot start calls login with token', async () => {
  const client = new MockDiscordClient();
  const bot = createDiscordBot({
    client,
    token: 'token-123',
    channelId: 'root',
    onMessage: () => { },
  });
  const result = await bot.start();
  assert.equal(result, 'ok');
  assert.deepEqual(client.loginCalls, ['token-123']);
});

test('createDiscordBot filters messages and handles threads', () => {
  const client = new MockDiscordClient();
  const received = [];
  createDiscordBot({
    client,
    token: 'token-123',
    channelId: 'root',
    onMessage: (payload) => received.push(payload),
  });

  client.emit('messageCreate', makeMessage({ channelId: 'other' }));
  client.emit('messageCreate', makeMessage({ channelId: 'root' }));
  client.emit('messageCreate', makeMessage({
    channelId: 'thread-1',
    parentId: 'root',
    isThread: true,
  }));
  client.emit('messageCreate', makeMessage({
    channelId: 'root',
    authorId: 'bot-1',
    bot: true,
  }));

  assert.equal(received.length, 2);
  assert.equal(received[0].contextId, 'root');
  assert.equal(received[1].contextId, 'thread-1');
});

test('createDiscordBot only allows whitelisted message types', () => {
  const client = new MockDiscordClient();
  const received = [];
  createDiscordBot({
    client,
    token: 'token-123',
    channelId: 'root',
    onMessage: (payload) => received.push(payload),
  });

  // Whitelisted Types
  client.emit('messageCreate', makeMessage({ channelId: 'root', type: 0, content: 'default' }));
  client.emit('messageCreate', makeMessage({ channelId: 'root', type: 19, content: 'reply' }));
  client.emit('messageCreate', makeMessage({
    channelId: 'thread-1',
    parentId: 'root',
    isThread: true,
    type: 21,
    content: 'starter'
  }));

  // Non-whitelisted Types
  client.emit('messageCreate', makeMessage({ channelId: 'root', type: 18 })); // ThreadCreated
  client.emit('messageCreate', makeMessage({ channelId: 'root', type: 6 }));  // Pin
  client.emit('messageCreate', makeMessage({ channelId: 'root', type: 1 }));  // RecipientAdd

  assert.equal(received.length, 3);
  assert.equal(received[0].content, 'default');
  assert.equal(received[1].content, 'reply');
  assert.equal(received[2].content, 'starter');
});
