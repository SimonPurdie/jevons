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
          sendTyping: async () => {},
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

test('/fork command replies with select menu containing user messages', async () => {
  const client = new MockDiscordClient();
  const replies = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-fork-menu-test-'));

  const modelInstance = {
    id: 'model-test',
    completeSimple: async () => {
      return { content: [{ type: 'text', text: 'Test response' }] };
    }
  };

  try {
    createDiscordRuntime({
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

    // Create some messages first
    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: 'User message 1' }));
    await flush(200);
    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: 'User message 2' }));
    await flush(200);

    // Simulate /fork slash command
    const mockInteraction = {
      commandName: 'fork',
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

    client.emit('interactionCreate', mockInteraction);
    await flush(200);

    // Verify reply was sent with components
    assert.equal(replies.length, 1, 'Should reply to /fork command');
    const reply = replies[0];
    assert.ok(reply.components, 'Reply should have components');
    assert.ok(Array.isArray(reply.components) && reply.components.length > 0, 'Reply should have at least one component row');
    assert.ok(reply.content.includes('Select a message to fork'), 'Reply should mention forking');

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Selecting a fork point creates a new branched session', async () => {
  const client = new MockDiscordClient();
  const replies = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-fork-switch-test-'));

  const modelInstance = {
    id: 'model-test',
    completeSimple: async () => {
      return { content: [{ type: 'text', text: 'Test response' }] };
    }
  };

  try {
    const sessionManager = new DiscordSessionManager({ sessionDir: tempDir });
    const runtime = createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'test-channel',
      modelInstance,
      sessionDir: tempDir,
      sessionManager,
      sendMessage: (payload) => {
        return Promise.resolve();
      },
      deps: { Agent: MockAgent }
    });

    // Create messages
    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: 'User message 1' }));
    await flush(200);
    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: 'User message 2' }));
    await flush(200);

    // Get the session and entry IDs
    const session = sessionManager.getOrCreate('test-channel');
    const branch = session.sessionManager.getBranch();
    const userEntries = branch.filter(e => e.type === 'message' && e.message.role === 'user');
    const firstMessageId = userEntries[0].id;

    assert.ok(firstMessageId, 'Should have an entry ID for the message');

    // Record session files before fork
    const contextSessionDir = path.join(tempDir, 'test-channel');
    const filesBefore = fs.readdirSync(contextSessionDir).filter(f => f.endsWith('.jsonl'));

    // Simulate selecting the first message to fork from
    const selectInteraction = {
      customId: 'fork_session_select',
      values: [firstMessageId],
      isStringSelectMenu: () => true,
      isChatInputCommand: () => false,
      channel: {
        id: 'test-channel',
        isThread: () => false,
        parentId: null,
      },
      guild: { name: 'TestGuild' },
      user: { id: 'user-1' },
      reply: async (content) => {
        replies.push(content);
      }
    };

    client.emit('interactionCreate', selectInteraction);
    await flush(200);

    // Verify confirmation was sent
    assert.ok(replies.some(r => {
      const content = typeof r === 'string' ? r : r.content;
      return content && content.includes('Forked session');
    }), 'Should confirm session fork');

    // Verify new session file exists
    const filesAfter = fs.readdirSync(contextSessionDir).filter(f => f.endsWith('.jsonl'));
    assert.ok(filesAfter.length > filesBefore.length, 'Should create a new session file after forking');

    // Verify the new active session context only has messages up to the fork point
    const activeSession = sessionManager.getOrCreate('test-channel');
    const branchAfter = activeSession.sessionManager.getBranch();
    
    // It should have the forked user message, but not the second user message
    const activeUserEntries = branchAfter.filter(e => e.type === 'message' && e.message.role === 'user');
    assert.equal(activeUserEntries.length, 1, 'Forked session should only have one user message');
    assert.ok(activeUserEntries[0].message.content.includes('User message 1'), 'Forked session should have the first user message');

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('/fork text command also works', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-fork-text-test-'));

  const modelInstance = {
    id: 'model-test',
    completeSimple: async () => {
      return { content: [{ type: 'text', text: 'Test response' }] };
    }
  };

  try {
    createDiscordRuntime({
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

    // Create messages
    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: 'User message 1' }));
    await flush(200);

    // Send /fork text command
    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: '/fork' }));
    await flush(200);

    // Verify reply with components was sent
    const forkReply = sends.find(s => s.content.includes('Select a message to fork'));
    assert.ok(forkReply, 'Should send fork message');
    assert.ok(forkReply.components, 'Fork reply should have components');

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
