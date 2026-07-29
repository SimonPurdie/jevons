import test from 'node:test';
import { strict as assert } from 'node:assert';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createDiscordRuntime, generateReply } from '../../app/runtime.js';
import { DiscordSessionManager } from '../../app/sessionManager.js';

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

function readDebugInteractions(logPath) {
  if (!fs.existsSync(logPath)) {
    return [];
  }
  const raw = fs.readFileSync(logPath, 'utf8');
  const entries = [];
  const pattern = /--- INTERACTION START: [^\n]* ---\n([\s\S]*?)\n--- INTERACTION END ---/g;
  let match;
  while ((match = pattern.exec(raw)) !== null) {
    entries.push(JSON.parse(match[1]));
  }
  return entries;
}

test('generateReply passes pi-ai streamSimple to pi-agent-core Agent', async () => {
  const streamSimple = () => {
    throw new Error('The capturing Agent should not invoke the stream function');
  };
  let agentOptions;

  class CapturingAgent {
    constructor(options) {
      agentOptions = options;
      this.state = {
        ...options.initialState,
        messages: [...options.initialState.messages],
      };
    }

    async prompt(message) {
      this.state.messages.push(message, {
        role: 'assistant',
        content: [{ type: 'text', text: 'stream configured' }],
      });
    }
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-stream-test-'));
  try {
    const reply = await generateReply(
      { content: 'hello' },
      { id: 'test-model', provider: 'test-provider' },
      {
        resolvePiAgentCore: async () => ({ Agent: CapturingAgent }),
        resolvePiAi: async () => ({ streamSimple }),
        agentDebugLogPath: path.join(tempDir, 'agent.log'),
      }
    );

    assert.strictEqual(agentOptions.streamFn, streamSimple);
    assert.equal(reply.content, 'stream configured');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('createDiscordRuntime sends model reply via sendMessage', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const errors = [];
  const modelInstance = {
    id: 'model-test',
    completeSimple: async () => ({
      content: [{ type: 'text', text: 'hi there' }],
    })
  };

  const runtime = await createDiscordRuntime({
    client,
    token: 'token-123',
    channelId: 'root',
    modelInstance,
    sendMessage: (payload) => {
      sends.push(payload);
      return Promise.resolve();
    },
    onError: (err) => {
      errors.push(err);
    },
    deps: { Agent: MockAgent }
  });

  const message = makeMessage({ channelId: 'root', content: 'Hello' });
  client.emit('messageCreate', message);
  await flush(200);

  assert.equal(sends.length, 1, `Expected 1 send, got ${sends.length}. Errors: ${errors.map(e => e.message + '\n' + e.stack).join(', ')}`);
  assert.equal(sends[0].content, 'hi there');
  assert.equal(sends[0].channelId, 'root');
});

test('createDiscordRuntime persists user messages and agent replies to session', async () => {
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
    await createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'root',
      modelInstance,
      sessionDir: tempDir,
      sendMessage: (payload) => {
        sends.push(payload);
        return Promise.resolve();
      },
      deps: { Agent: MockAgent }
    });

    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Hello bot' }));
    await flush(200);

    // Verify session file was created
    const contextId = 'root';
    const contextSessionDir = path.join(tempDir, contextId);
    assert.ok(fs.existsSync(contextSessionDir), 'Session directory should exist');

    const sessionFiles = fs.readdirSync(contextSessionDir).filter(f => f.endsWith('.jsonl'));
    assert.ok(sessionFiles.length > 0, 'Should create at least one session file');

    // Verify session content
    const sessionFile = path.join(contextSessionDir, sessionFiles[0]);
    const lines = fs.readFileSync(sessionFile, 'utf8').trim().split('\n');
    const entries = lines.map(line => JSON.parse(line));

    // Should have: session entry + user message + assistant message
    assert.ok(entries.length >= 3, 'Should have session entry and at least 2 messages');

    const userMessages = entries.filter(e => e.type === 'message' && e.message?.role === 'user');
    const assistantMessages = entries.filter(e => e.type === 'message' && e.message?.role === 'assistant');

    assert.equal(userMessages.length, 1, 'Should have one user message');
    assert.ok(userMessages[0].message.content.includes('Hello bot'), 'User message should contain the sent content');
    assert.equal(assistantMessages.length, 1, 'Should have one assistant message');
    assert.ok(assistantMessages[0].message.content.includes('Hello user'), 'Assistant message should contain the response');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('createDiscordRuntime /new command creates new session', async () => {
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
    await createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'root',
      modelInstance,
      sessionDir: tempDir,
      sendMessage: (payload) => {
        sends.push(payload);
        return Promise.resolve();
      },
      deps: { Agent: MockAgent }
    });

    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Hello' }));
    await flush(200);

    client.emit('messageCreate', makeMessage({ channelId: 'root', content: '/new' }));
    await flush(200);

    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'After reset' }));
    await flush(200);

    const newConfirmation = sends.find(s => s.content.includes('New session started'));
    assert.ok(newConfirmation, 'Should confirm new session started');
    assert.equal(modelCalls, 2);

    // Verify multiple session files were created
    const contextSessionDir = path.join(tempDir, 'root');
    const sessionFiles = fs.readdirSync(contextSessionDir).filter(f => f.endsWith('.jsonl'));
    assert.ok(sessionFiles.length >= 1, 'Should create at least one session file');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('createDiscordRuntime passes chat history from session to model', async () => {
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
    await createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'root',
      modelInstance,
      sessionDir: tempDir,
      sendMessage: (payload) => {
        sends.push(payload);
        return Promise.resolve();
      },
      deps: { Agent: MockAgent }
    });

    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'First message' }));
    await flush(200);

    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Second message' }));
    await flush(200);

    assert.equal(calls.length, 2);
    assert.equal(calls[0].length, 1); // current user message
    assert.equal(calls[1].length, 3); // history (user, agent) + current user message
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('createDiscordRuntime rolls debug log entries with configured limit', async () => {
  const client = new MockDiscordClient();
  const modelInstance = {
    id: 'model-test',
    completeSimple: async () => ({
      content: [{ type: 'text', text: 'ok' }],
    })
  };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-runtime-debug-log-'));
  const debugLogPath = path.join(tempDir, 'agent_debug.log');

  try {
    await createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'root',
      modelInstance,
      sendMessage: () => Promise.resolve(),
      agentDebugInteractionLimit: 2,
      agentDebugLogPath: debugLogPath,
      deps: { Agent: MockAgent }
    });

    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'First message', messageId: 'd1' }));
    await flush(200);
    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Second message', messageId: 'd2' }));
    await flush(200);
    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Third message', messageId: 'd3' }));
    await flush(200);

    const interactions = readDebugInteractions(debugLogPath);
    assert.equal(interactions.length, 2);
    assert.ok(interactions[0].userPrompt.content.includes('Second message'));
    assert.ok(interactions[1].userPrompt.content.includes('Third message'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('createDiscordRuntime defaults debug log to last 3 interactions', async () => {
  const client = new MockDiscordClient();
  const modelInstance = {
    id: 'model-test',
    completeSimple: async () => ({
      content: [{ type: 'text', text: 'ok' }],
    })
  };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-runtime-debug-log-default-'));
  const debugLogPath = path.join(tempDir, 'agent_debug.log');

  try {
    await createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'root',
      modelInstance,
      sendMessage: () => Promise.resolve(),
      agentDebugLogPath: debugLogPath,
      deps: { Agent: MockAgent }
    });

    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'One', messageId: 'm1' }));
    await flush(200);
    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Two', messageId: 'm2' }));
    await flush(200);
    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Three', messageId: 'm3' }));
    await flush(200);
    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Four', messageId: 'm4' }));
    await flush(200);

    const interactions = readDebugInteractions(debugLogPath);
    assert.equal(interactions.length, 3);
    assert.ok(interactions[0].userPrompt.content.includes('Two'));
    assert.ok(interactions[2].userPrompt.content.includes('Four'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
