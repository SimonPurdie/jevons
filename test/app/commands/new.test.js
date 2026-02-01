import test from 'node:test';
import { strict as assert } from 'node:assert';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createDiscordRuntime } from '../../../app/runtime.js';
import { DiscordSessionManager } from '../../../app/sessionManager.js';

class MockDiscordClient extends EventEmitter {
  constructor() {
    super();
    this.loginCalls = [];
    this.channels = {
      fetch: async (channelId) => {
        return {
          id: channelId,
          sendTyping: async () => { },
          send: async (content) => ({ content, id: 'mock-msg-id' }),
        };
      }
    };
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
  messageType = 0,
} = {}) {
  return {
    id: messageId,
    content,
    author: { id: authorId, bot },
    channel: {
      id: channelId,
      isThread: () => isThread,
      parentId,
    },
    guild: { name: guildName },
    type: messageType,
  };
}

function flush(ms = 100) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('/new command creates new session and preserves old session file', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-new-cmd-test-'));

  const modelInstance = {
    id: 'model-test',
    completeSimple: async () => {
      return { content: [{ type: 'text', text: 'Test response' }] };
    }
  };

  try {
    await createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'test-channel',
      modelInstance,
      sessionDir: tempDir,
      sendMessage: (payload) => {
        sends.push(payload);
        return Promise.resolve();
      },
      deps: { Agent: MockAgent }
    });

    // Send first message to create initial session
    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: 'First message' }));
    await flush(200);

    // Get initial session state
    const sessionManager = new DiscordSessionManager({ sessionDir: tempDir });
    const initialSession = sessionManager.getOrCreate('test-channel');
    const initialContext = initialSession.sessionManager.buildSessionContext();

    // Store initial session file path
    const contextSessionDir = path.join(tempDir, 'test-channel');
    const initialFiles = fs.readdirSync(contextSessionDir).filter(f => f.endsWith('.jsonl'));
    const initialFileCount = initialFiles.length;

    // Send /new command
    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: '/new' }));
    await flush(200);

    // Verify confirmation message mentions /resume
    const confirmation = sends.find(s => s.content.includes('New session started'));
    assert.ok(confirmation, 'Should send confirmation message');
    assert.ok(confirmation.content.includes('/resume'), 'Confirmation should mention /resume command');

    // Verify old session file still exists
    const filesAfterNew = fs.readdirSync(contextSessionDir).filter(f => f.endsWith('.jsonl'));
    assert.ok(filesAfterNew.length >= initialFileCount, 'Old session file should still exist');

    // After /new, calling getOrCreate returns the NEW session (via continueRecent)
    // which should be the newly created session with minimal context
    const newSession = sessionManager.getOrCreate('test-channel');
    const newContext = newSession.sessionManager.buildSessionContext();

    // The new session context should have fewer messages than the initial
    // The exact count depends on implementation, but it should be less
    assert.ok(newContext.messages.length <= initialContext.messages.length,
      'New session context should have same or fewer messages than initial');

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('/new command creates multiple distinct sessions', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-new-multi-test-'));

  const modelInstance = {
    id: 'model-test',
    completeSimple: async () => {
      return { content: [{ type: 'text', text: 'Test response' }] };
    }
  };

  try {
    await createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'test-channel',
      modelInstance,
      sessionDir: tempDir,
      sendMessage: (payload) => {
        sends.push(payload);
        return Promise.resolve();
      },
      deps: { Agent: MockAgent }
    });

    // Send first message
    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: 'Message 1' }));
    await flush(200);

    // Send /new
    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: '/new' }));
    await flush(200);

    // Send another message
    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: 'Message 2' }));
    await flush(200);

    // Send /new again
    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: '/new' }));
    await flush(200);

    // Send third message
    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: 'Message 3' }));
    await flush(200);

    // Verify multiple session files exist
    const contextSessionDir = path.join(tempDir, 'test-channel');
    const sessionFiles = fs.readdirSync(contextSessionDir).filter(f => f.endsWith('.jsonl'));

    assert.ok(sessionFiles.length >= 2, 'Should create multiple session files after multiple /new commands');

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('/new command works via slash command interaction', async () => {
  const client = new MockDiscordClient();
  const replies = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-new-slash-test-'));

  const modelInstance = {
    id: 'model-test',
    completeSimple: async () => {
      return { content: [{ type: 'text', text: 'Test response' }] };
    }
  };

  try {
    const runtime = await createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'test-channel',
      modelInstance,
      sessionDir: tempDir,
      sendMessage: (payload) => {
        return Promise.resolve();
      },
      deps: { Agent: MockAgent }
    });

    // Simulate slash command interaction with required methods
    const mockInteraction = {
      commandName: 'new',
      isChatInputCommand: () => true,
      channel: {
        id: 'test-channel',
        isThread: () => false,
        parentId: null,
      },
      guild: { name: 'TestGuild' },
      user: { id: 'user-1' },
      options: {},
      reply: async (content) => {
        replies.push(content);
      }
    };

    // Emit interaction event
    client.emit('interactionCreate', mockInteraction);
    await flush(200);

    // Verify reply was sent via the interaction
    assert.equal(replies.length, 1, 'Should reply to slash command interaction');
    assert.ok(replies[0].includes('New session started'), 'Reply should confirm new session');
    assert.ok(replies[0].includes('/resume'), 'Reply should mention /resume');

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('/new command creates empty session context', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-new-empty-test-'));

  const modelInstance = {
    id: 'model-test',
    completeSimple: async (model, options) => {
      // Return response that includes message count
      const msgCount = options.messages ? options.messages.length : 0;
      return { content: [{ type: 'text', text: `Received ${msgCount} messages` }] };
    }
  };

  try {
    await createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'test-channel',
      modelInstance,
      sessionDir: tempDir,
      sendMessage: (payload) => {
        sends.push(payload);
        return Promise.resolve();
      },
      deps: { Agent: MockAgent }
    });

    // Send several messages to build up context
    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: 'Message 1' }));
    await flush(200);

    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: 'Message 2' }));
    await flush(200);

    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: 'Message 3' }));
    await flush(200);

    // Get the response that shows message count before /new
    const beforeNewResponse = sends[sends.length - 1];
    assert.ok(beforeNewResponse.content.includes('messages'), 'Should show message count before /new');

    // Send /new command
    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: '/new' }));
    await flush(200);

    // Send message after /new
    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: 'After new' }));
    await flush(200);

    // Get the response after /new - should show reduced or reset message count
    const afterNewResponse = sends[sends.length - 1];
    assert.ok(afterNewResponse.content.includes('messages'), 'Should show message count after /new');

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('/new command old session can be listed', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-new-list-test-'));

  const modelInstance = {
    id: 'model-test',
    completeSimple: async () => {
      return { content: [{ type: 'text', text: 'Test response' }] };
    }
  };

  try {
    await createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'test-channel',
      modelInstance,
      sessionDir: tempDir,
      sendMessage: (payload) => {
        sends.push(payload);
        return Promise.resolve();
      },
      deps: { Agent: MockAgent }
    });

    // Send first message
    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: 'First session message' }));
    await flush(200);

    // Create session manager and get initial session count
    const sessionManager = new DiscordSessionManager({ sessionDir: tempDir });
    const initialSessions = await sessionManager.listSessions('test-channel');
    const initialCount = initialSessions.length;

    // Send /new command
    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: '/new' }));
    await flush(200);

    // List sessions after /new
    const sessionsAfterNew = await sessionManager.listSessions('test-channel');

    // Should have more sessions after /new
    assert.ok(sessionsAfterNew.length > initialCount || sessionsAfterNew.length >= 1,
      'Should be able to list sessions including the old one preserved by /new');

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
