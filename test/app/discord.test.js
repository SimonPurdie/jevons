import test from 'node:test';
import { strict as assert } from 'node:assert';
import { EventEmitter } from 'events';
import { createDiscordBot, extractContext, splitMessage, sendDiscordMessage } from '../../app/discord.js';

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

test('splitMessage splits text into chunks', () => {
  const short = 'hello';
  assert.deepEqual(splitMessage(short, 10), ['hello']);

  const long = 'this is a long message';
  // Splits at space before 10
  assert.deepEqual(splitMessage(long, 10), ['this is a', 'long', 'message']);

  const withNewlines = 'line one\nline two\nline three';
  assert.deepEqual(splitMessage(withNewlines, 10), ['line one', 'line two', 'line three']);

  const noBreak = 'abcdefghij';
  assert.deepEqual(splitMessage(noBreak, 5), ['abcde', 'fghij']);
});

test('sendDiscordMessage sends multiple chunks for long content', async () => {
  const sentMessages = [];
  const mockChannel = {
    send: (msg) => {
      sentMessages.push(msg);
      return Promise.resolve({ id: 'msg-' + sentMessages.length });
    },
  };
  const mockClient = {
    channels: {
      fetch: () => Promise.resolve(mockChannel),
    },
  };

  const longContent = 'A'.repeat(2500);
  await sendDiscordMessage(mockClient, {
    content: longContent,
    channelId: 'root',
  });

  assert.equal(sentMessages.length, 2);
  assert.equal(sentMessages[0].length, 2000);
  assert.equal(sentMessages[1].length, 500);
});

test('sendDiscordMessage sends attachments with message payload', async () => {
  const sentMessages = [];
  const mockChannel = {
    send: (msg) => {
      sentMessages.push(msg);
      return Promise.resolve({ id: 'msg-' + sentMessages.length });
    },
  };
  const mockClient = {
    channels: {
      fetch: () => Promise.resolve(mockChannel),
    },
  };

  await sendDiscordMessage(mockClient, {
    content: 'Here is the file',
    files: [{ attachment: Buffer.from('abc'), name: 'test.txt' }],
    channelId: 'root',
  });

  assert.equal(sentMessages.length, 1);
  assert.equal(typeof sentMessages[0], 'object');
  assert.equal(sentMessages[0].content, 'Here is the file');
  assert.equal(sentMessages[0].files.length, 1);
  assert.equal(sentMessages[0].files[0].name, 'test.txt');
});

test('sendDiscordMessage skips oversized attachments and appends fallback note', async () => {
  const sentMessages = [];
  const mockChannel = {
    send: (msg) => {
      sentMessages.push(msg);
      return Promise.resolve({ id: 'msg-' + sentMessages.length });
    },
  };
  const mockClient = {
    channels: {
      fetch: () => Promise.resolve(mockChannel),
    },
  };

  await sendDiscordMessage(mockClient, {
    content: 'Attempting attachment',
    files: [{ attachment: Buffer.alloc(9 * 1024 * 1024), name: 'too-big.bin' }],
    channelId: 'root',
    maxAttachmentBytes: 8 * 1024 * 1024,
  });

  assert.equal(sentMessages.length, 1);
  assert.equal(typeof sentMessages[0], 'string');
  assert.ok(sentMessages[0].includes('Attempting attachment'));
  assert.ok(sentMessages[0].includes('Attachment skipped'));
});
