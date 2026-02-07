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
    this.channels = {
      fetch: async (channelId) => ({
        id: channelId,
        sendTyping: async () => { },
        send: async (content) => ({ content, id: 'mock-msg-id' }),
      }),
    };
  }
}

class MockAgent {
  constructor(options) {
    this.state = {
      messages: [...(options.initialState.messages || [])],
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

function makeMessage(content) {
  return {
    id: `msg-${Math.random()}`,
    content,
    author: { id: 'user-1', bot: false },
    channel: {
      id: 'test-channel',
      isThread: () => false,
      parentId: null,
    },
    guild: { name: 'TestGuild' },
    type: 0,
  };
}

function flush(ms = 120) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeModel(provider, id) {
  return {
    provider,
    id,
    completeSimple: async () => ({
      content: [{ type: 'text', text: `reply:${provider}/${id}` }],
    }),
  };
}

test('/model command shows paginated list and supports next-page navigation', async () => {
  const client = new MockDiscordClient();
  const replies = [];
  const updates = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-model-menu-test-'));
  const configPath = path.join(tempDir, 'config.json');
  const models = Array.from({ length: 30 }, (_, i) => ({ provider: 'p', model: `m-${i}` }));

  try {
    await createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'test-channel',
      activeModel: 'p/m-0',
      models,
      configPath,
      authStorage: { getApiKey: async () => 'test-key' },
      getModel: (provider, model) => makeModel(provider, model),
      sendMessage: () => Promise.resolve(),
      deps: { Agent: MockAgent },
    });

    const modelInteraction = {
      commandName: 'model',
      isChatInputCommand: () => true,
      isStringSelectMenu: () => false,
      channel: { id: 'test-channel', isThread: () => false, parentId: null },
      guild: { name: 'TestGuild' },
      user: { id: 'user-1' },
      options: { getString: () => null },
      reply: async (payload) => { replies.push(payload); },
    };
    client.emit('interactionCreate', modelInteraction);
    await flush();

    assert.equal(replies.length, 1);
    assert.equal(replies[0].ephemeral, true);
    assert.ok(replies[0].content.includes('page 1/2'));

    const selectInteraction = {
      isChatInputCommand: () => false,
      isStringSelectMenu: () => true,
      customId: 'model_switch_select:0',
      values: ['nav:next'],
      channel: { id: 'test-channel', isThread: () => false, parentId: null },
      guild: { name: 'TestGuild' },
      user: { id: 'user-1' },
      update: async (payload) => { updates.push(payload); },
      reply: async () => { },
    };
    client.emit('interactionCreate', selectInteraction);
    await flush();

    assert.equal(updates.length, 1);
    assert.ok(updates[0].content.includes('page 2/2'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('/model add flow persists config and switches runtime without resetting session history', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const replies = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-model-switch-test-'));
  const sessionDir = path.join(tempDir, 'sessions');
  fs.mkdirSync(sessionDir, { recursive: true });
  const configPath = path.join(tempDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    activeModel: 'p/old',
    models: [{ provider: 'p', model: 'old' }],
  }), 'utf8');

  try {
    await createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'test-channel',
      activeModel: 'p/old',
      models: [{ provider: 'p', model: 'old' }],
      configPath,
      sessionDir,
      authStorage: { getApiKey: async () => 'test-key' },
      getModel: (provider, model) => makeModel(provider, model),
      sendMessage: (payload) => {
        sends.push(payload);
        return Promise.resolve();
      },
      deps: { Agent: MockAgent },
    });

    client.emit('messageCreate', makeMessage('before switch'));
    await flush(200);

    const addInteraction = {
      commandName: 'model',
      isChatInputCommand: () => true,
      isStringSelectMenu: () => false,
      channel: { id: 'test-channel', isThread: () => false, parentId: null },
      guild: { name: 'TestGuild' },
      user: { id: 'user-1' },
      options: {
        getString: (name) => {
          if (name === 'provider') return 'p2';
          if (name === 'model') return 'new';
          return null;
        },
      },
      reply: async (payload) => { replies.push(payload); },
    };
    client.emit('interactionCreate', addInteraction);
    await flush(200);

    client.emit('messageCreate', makeMessage('after switch'));
    await flush(200);

    assert.ok(sends.some((entry) => entry.content.includes('reply:p/old')));
    assert.ok(sends.some((entry) => entry.content.includes('reply:p2/new')));
    assert.equal(replies.length, 1);
    assert.ok(replies[0].content.includes('Added model and switched active model.'));

    const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(savedConfig.activeModel, 'p2/new');
    assert.ok(savedConfig.models.some((entry) => entry.provider === 'p2' && entry.model === 'new'));

    const sessionManager = new DiscordSessionManager({ sessionDir });
    const branch = sessionManager.getOrCreate('test-channel').sessionManager.getBranch();
    const messageEntries = branch.filter((entry) => entry.type === 'message');
    assert.ok(messageEntries.length >= 4, 'Expected conversation history to remain in the same session');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
