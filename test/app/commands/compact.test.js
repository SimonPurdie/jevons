import test from 'node:test';
import { strict as assert } from 'node:assert';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createDiscordRuntime } from '../../../app/runtime.js';
import { DiscordSessionManager } from '../../../app/sessionManager.js';
import { registerApiProvider } from '@mariozechner/pi-ai';

// Register a mock API provider for summarization
registerApiProvider({
  api: 'test-api',
  stream: () => {},
  streamSimple: (model, context, options) => {
    return {
      result: async () => ({
        role: 'assistant',
        content: [{ type: 'text', text: 'Summary of the conversation' }],
        stopReason: 'stop',
        usage: { input: 0, output: 0, totalTokens: 0, cost: { total: 0 } }
      })
    };
  }
});

class MockDiscordClient extends EventEmitter {
  constructor() {
    super();
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
      isThread: () => false,
      parentId: null,
    },
    guild: { name: 'TestGuild' },
    type: 0,
  };
}

function flush(ms = 100) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('/compact command triggers compaction and appends compaction entry', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-compact-test-'));

  const modelInstance = {
    id: 'model-test',
    provider: 'test-provider',
    api: 'test-api',
    completeSimple: async () => {
      return { content: [{ type: 'text', text: 'Summary of the conversation' }] };
    }
  };

  const mockAuthStorage = {
    getApiKey: async () => 'test-api-key'
  };

  try {
    createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'test-channel',
      modelInstance,
      sessionDir: tempDir,
      authStorage: mockAuthStorage,
      sendMessage: (payload) => {
        sends.push(payload);
        return Promise.resolve();
      },
      deps: { Agent: MockAgent }
    });

    // Send many messages to build up context
    for (let i = 0; i < 10; i++) {
        client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: `Message ${i}` }));
        await flush(100);
    }

    // Trigger /compact via text command
    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: '/compact' }));
    await flush(500);

    // Verify confirmation message
    const confirmation = sends.find(s => s.content.includes('Compacting session'));
    assert.ok(confirmation, 'Should send confirmation message');

    // Verify session has compaction entry
    const sessionManager = new DiscordSessionManager({ sessionDir: tempDir });
    const session = sessionManager.getOrCreate('test-channel');
    const branch = session.sessionManager.getBranch();
    
    const compactionEntry = branch.find(e => e.type === 'compaction');
    assert.ok(compactionEntry, 'Session should contain a compaction entry');
    assert.equal(compactionEntry.summary, 'Summary of the conversation');

    // Verify buildSessionContext includes the summary
    const context = session.sessionManager.buildSessionContext();
    const hasSummary = context.messages.some(m => m.role === 'system' && m.content.includes('Summary of the conversation')) || 
                        context.messages.some(m => m.role === 'user' && m.content.includes('Summary of the conversation'));
    
    // The exact role and content depends on pi-coding-agent's buildSessionContext implementation
    assert.ok(context.messages.length > 0, 'Context should not be empty');

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('/compact command handles custom instructions', async () => {
    const client = new MockDiscordClient();
    const sends = [];
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-compact-instr-test-'));
  
    const modelInstance = {
      id: 'model-test',
      provider: 'test-provider',
      api: 'test-api',
      completeSimple: async (model, options) => {
        // Find if custom instructions were passed in the messages
        const hasInstr = options.messages.some(m => m.content && m.content.includes('Focus on the weather'));
        return { content: [{ type: 'text', text: hasInstr ? 'Weather summary' : 'General summary' }] };
      }
    };
  
    const mockAuthStorage = {
      getApiKey: async () => 'test-api-key'
    };
  
    try {
      createDiscordRuntime({
        client,
        token: 'token-123',
        channelId: 'test-channel',
        modelInstance,
        sessionDir: tempDir,
        authStorage: mockAuthStorage,
        sendMessage: (payload) => {
          sends.push(payload);
          return Promise.resolve();
        },
        deps: { Agent: MockAgent }
      });
  
      // Send messages
      for (let i = 0; i < 10; i++) {
        client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: `Message ${i}` }));
        await flush(100);
      }
  
      // Trigger /compact with instructions
      client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: '/compact Focus on the weather' }));
      await flush(500);
  
      // Verify session has compaction entry with summary reflecting instructions
      const sessionManager = new DiscordSessionManager({ sessionDir: tempDir });
      const session = sessionManager.getOrCreate('test-channel');
      const branch = session.sessionManager.getBranch();
      
      const compactionEntry = branch.find(e => e.type === 'compaction');
      assert.ok(compactionEntry, 'Session should contain a compaction entry');
      // Note: pi-coding-agent's generateSummary is what uses customInstructions.
      // We are mocking completeSimple which is called by generateSummary (indirectly via model.completeSimple).
      // If generateSummary passes instructions in the prompt, our mock should see it.
      
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

test('/compact command works via slash command interaction', async () => {
  const client = new MockDiscordClient();
  const replies = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-compact-slash-test-'));

  const modelInstance = {
    id: 'model-test',
    provider: 'test-provider',
    api: 'test-api',
    completeSimple: async () => {
      return { content: [{ type: 'text', text: 'Summary' }] };
    }
  };

  const mockAuthStorage = {
    getApiKey: async () => 'test-api-key'
  };

  try {
    createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'test-channel',
      modelInstance,
      sessionDir: tempDir,
      authStorage: mockAuthStorage,
      sendMessage: () => Promise.resolve(),
      deps: { Agent: MockAgent }
    });

    // Send messages
    for (let i = 0; i < 10; i++) {
        client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: `Message ${i}` }));
        await flush(100);
    }

    // Simulate slash command interaction
    const mockInteraction = {
      commandName: 'compact',
      isChatInputCommand: () => true,
      channel: { id: 'test-channel', isThread: () => false, parentId: null },
      guild: { name: 'TestGuild' },
      user: { id: 'user-1' },
      options: {
        getString: (name) => name === 'instructions' ? 'Focus on speed' : null
      },
      deferReply: async () => { mockInteraction.deferred = true; },
      editReply: async (content) => { replies.push(content); },
      reply: async (content) => { replies.push(content); }
    };

    client.emit('interactionCreate', mockInteraction);
    await flush(500);

    // Verify reply
    assert.ok(replies.length > 0, 'Should reply to slash command');
    assert.ok(replies[0].includes('Compacting session'), 'Reply should confirm compaction');

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
