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

function getSelectMenuData(payload) {
  const row = payload?.components?.[0];
  const menu = row?.components?.[0];
  if (!menu) {
    return null;
  }
  if (typeof menu.toJSON === 'function') {
    return menu.toJSON();
  }
  return menu.data || menu;
}

function getSelectMenuCustomId(payload) {
  const data = getSelectMenuData(payload);
  if (!data) {
    return '';
  }
  return data.custom_id || data.customId || '';
}

function getSelectOptions(payload, predicate = () => true) {
  const data = getSelectMenuData(payload);
  const options = Array.isArray(data?.options) ? data.options : [];
  return options.filter(predicate);
}

function findOptionByLabel(payload, labelPrefix, predicate = () => true) {
  const options = getSelectOptions(payload, predicate);
  return options.find((option) => typeof option.label === 'string' && option.label.startsWith(labelPrefix));
}

test('/model command starts with provider picker and supports provider pagination', async () => {
  const client = new MockDiscordClient();
  const replies = [];
  const updates = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-model-provider-menu-test-'));
  const configPath = path.join(tempDir, 'config.json');

  const providers = Array.from({ length: 30 }, (_, i) => `provider-${String(i).padStart(2, '0')}`);
  const catalog = providers.map((provider) => makeModel(provider, 'model-1'));

  try {
    await createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'test-channel',
      activeModel: 'provider-00/model-1',
      configPath,
      authStorage: { getApiKey: async () => 'test-key' },
      sendMessage: () => Promise.resolve(),
      deps: {
        Agent: MockAgent,
        resolvePiAi: async () => ({
          getProviders: () => providers,
          getModels: (provider) => catalog.filter((entry) => entry.provider === provider),
          getModel: (provider, model) => catalog.find((entry) => entry.provider === provider && entry.id === model) || null,
        }),
      },
    });

    client.emit('interactionCreate', {
      commandName: 'model',
      isChatInputCommand: () => true,
      isStringSelectMenu: () => false,
      channel: { id: 'test-channel', isThread: () => false, parentId: null },
      guild: { name: 'TestGuild' },
      user: { id: 'user-1' },
      options: {},
      reply: async (payload) => { replies.push(payload); },
    });
    await flush();

    assert.equal(replies.length, 1);
    assert.equal(replies[0].ephemeral, true);
    assert.ok(replies[0].content.includes('Providers: 30 (page 1/2)'));

    client.emit('interactionCreate', {
      isChatInputCommand: () => false,
      isStringSelectMenu: () => true,
      customId: 'model_provider_select:0',
      values: ['provider:nav:next'],
      channel: { id: 'test-channel', isThread: () => false, parentId: null },
      guild: { name: 'TestGuild' },
      user: { id: 'user-1' },
      update: async (payload) => { updates.push(payload); },
      reply: async () => { },
    });
    await flush();

    assert.equal(updates.length, 1);
    assert.ok(updates[0].content.includes('Providers: 30 (page 2/2)'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('/model provider->model flow switches active model and preserves session history', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const replies = [];
  const updates = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-model-flow-switch-test-'));
  const sessionDir = path.join(tempDir, 'sessions');
  fs.mkdirSync(sessionDir, { recursive: true });
  const configPath = path.join(tempDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    activeModel: 'p/old',
    models: [{ provider: 'p', model: 'old' }],
  }), 'utf8');

  const catalog = [
    makeModel('p', 'old'),
    makeModel('p2', 'new'),
  ];
  const providers = ['p', 'p2'];

  try {
    await createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'test-channel',
      activeModel: 'p/old',
      configPath,
      sessionDir,
      authStorage: { getApiKey: async () => 'test-key' },
      sendMessage: (payload) => {
        sends.push(payload);
        return Promise.resolve();
      },
      deps: {
        Agent: MockAgent,
        resolvePiAi: async () => ({
          getProviders: () => providers,
          getModels: (provider) => catalog.filter((entry) => entry.provider === provider),
          getModel: (provider, model) => catalog.find((entry) => entry.provider === provider && entry.id === model) || null,
        }),
      },
    });

    client.emit('messageCreate', makeMessage('before switch'));
    await flush(200);

    client.emit('interactionCreate', {
      commandName: 'model',
      isChatInputCommand: () => true,
      isStringSelectMenu: () => false,
      channel: { id: 'test-channel', isThread: () => false, parentId: null },
      guild: { name: 'TestGuild' },
      user: { id: 'user-1' },
      options: {},
      reply: async (payload) => { replies.push(payload); },
    });
    await flush();

    const providerOption = findOptionByLabel(replies[0], 'p2', (option) => option.value.startsWith('provider:set:'));
    assert.ok(providerOption, 'Expected provider option for p2');

    client.emit('interactionCreate', {
      isChatInputCommand: () => false,
      isStringSelectMenu: () => true,
      customId: getSelectMenuCustomId(replies[0]),
      values: [providerOption.value],
      channel: { id: 'test-channel', isThread: () => false, parentId: null },
      guild: { name: 'TestGuild' },
      user: { id: 'user-1' },
      update: async (payload) => { updates.push(payload); },
      reply: async () => { },
    });
    await flush();

    const modelMenuPayload = updates[0];
    const modelOption = findOptionByLabel(modelMenuPayload, 'new', (option) => option.value.startsWith('model:set:'));
    assert.ok(modelOption, 'Expected model option for p2/new');

    client.emit('interactionCreate', {
      isChatInputCommand: () => false,
      isStringSelectMenu: () => true,
      customId: getSelectMenuCustomId(modelMenuPayload),
      values: [modelOption.value],
      channel: { id: 'test-channel', isThread: () => false, parentId: null },
      guild: { name: 'TestGuild' },
      user: { id: 'user-1' },
      update: async (payload) => { updates.push(payload); },
      reply: async () => { },
    });
    await flush(200);

    client.emit('messageCreate', makeMessage('after switch'));
    await flush(200);

    assert.ok(sends.some((entry) => entry.content.includes('reply:p/old')));
    assert.ok(sends.some((entry) => entry.content.includes('reply:p2/new')));
    assert.ok(updates[1].content.includes('Switched active model to `p2/new`.'));

    const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.equal(savedConfig.activeModel, 'p2/new');
    assert.deepEqual(savedConfig.models, [{ provider: 'p', model: 'old' }]);

    const sessionManager = new DiscordSessionManager({ sessionDir });
    const branch = sessionManager.getOrCreate('test-channel').sessionManager.getBranch();
    const messageEntries = branch.filter((entry) => entry.type === 'message');
    assert.ok(messageEntries.length >= 4, 'Expected conversation history to remain in the same session');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('/model picker prioritizes recent providers/models (max 5) then alphabetical', async () => {
  const client = new MockDiscordClient();
  const replies = [];
  const updates = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-model-recents-test-'));
  const configPath = path.join(tempDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    activeModel: 'alpha/a1',
  }), 'utf8');

  const catalog = [
    makeModel('alpha', 'a1'),
    makeModel('alpha', 'a2'),
    makeModel('beta', 'b1'),
    makeModel('beta', 'b2'),
    makeModel('beta', 'b3'),
    makeModel('delta', 'd1'),
    makeModel('gamma', 'g1'),
  ];
  const providers = ['alpha', 'beta', 'delta', 'gamma'];

  try {
    await createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'test-channel',
      activeModel: 'alpha/a1',
      configPath,
      authStorage: { getApiKey: async () => 'test-key' },
      sendMessage: () => Promise.resolve(),
      deps: {
        Agent: MockAgent,
        resolvePiAi: async () => ({
          getProviders: () => providers,
          getModels: (provider) => catalog.filter((entry) => entry.provider === provider),
          getModel: (provider, model) => catalog.find((entry) => entry.provider === provider && entry.id === model) || null,
        }),
      },
    });

    client.emit('interactionCreate', {
      commandName: 'model',
      isChatInputCommand: () => true,
      isStringSelectMenu: () => false,
      channel: { id: 'test-channel', isThread: () => false, parentId: null },
      guild: { name: 'TestGuild' },
      user: { id: 'user-1' },
      options: {},
      reply: async (payload) => { replies.push(payload); },
    });
    await flush();

    const providerOptionsInitial = getSelectOptions(replies[0], (option) => option.value.startsWith('provider:set:'));
    const providerLabelsInitial = providerOptionsInitial.map((option) => option.label.replace(' (active)', ''));
    assert.deepEqual(providerLabelsInitial.slice(0, 4), ['alpha', 'beta', 'delta', 'gamma']);

    const betaProviderOption = findOptionByLabel(replies[0], 'beta', (option) => option.value.startsWith('provider:set:'));
    assert.ok(betaProviderOption, 'Expected provider option for beta');

    client.emit('interactionCreate', {
      isChatInputCommand: () => false,
      isStringSelectMenu: () => true,
      customId: getSelectMenuCustomId(replies[0]),
      values: [betaProviderOption.value],
      channel: { id: 'test-channel', isThread: () => false, parentId: null },
      guild: { name: 'TestGuild' },
      user: { id: 'user-1' },
      update: async (payload) => { updates.push(payload); },
      reply: async () => { },
    });
    await flush();

    const betaModelMenu = updates[0];
    const betaModelOption = findOptionByLabel(betaModelMenu, 'b3', (option) => option.value.startsWith('model:set:'));
    assert.ok(betaModelOption, 'Expected model option for beta/b3');

    client.emit('interactionCreate', {
      isChatInputCommand: () => false,
      isStringSelectMenu: () => true,
      customId: getSelectMenuCustomId(betaModelMenu),
      values: [betaModelOption.value],
      channel: { id: 'test-channel', isThread: () => false, parentId: null },
      guild: { name: 'TestGuild' },
      user: { id: 'user-1' },
      update: async (payload) => { updates.push(payload); },
      reply: async () => { },
    });
    await flush();

    client.emit('interactionCreate', {
      commandName: 'model',
      isChatInputCommand: () => true,
      isStringSelectMenu: () => false,
      channel: { id: 'test-channel', isThread: () => false, parentId: null },
      guild: { name: 'TestGuild' },
      user: { id: 'user-1' },
      options: {},
      reply: async (payload) => { replies.push(payload); },
    });
    await flush();

    const providerOptionsAfter = getSelectOptions(replies[1], (option) => option.value.startsWith('provider:set:'));
    const providerLabelsAfter = providerOptionsAfter.map((option) => option.label.replace(' (active)', ''));
    assert.equal(providerLabelsAfter[0], 'beta');
    assert.deepEqual(providerLabelsAfter.slice(1, 4), ['alpha', 'delta', 'gamma']);

    const betaProviderOptionAgain = findOptionByLabel(replies[1], 'beta', (option) => option.value.startsWith('provider:set:'));
    assert.ok(betaProviderOptionAgain, 'Expected provider option for beta after recent pick');

    client.emit('interactionCreate', {
      isChatInputCommand: () => false,
      isStringSelectMenu: () => true,
      customId: getSelectMenuCustomId(replies[1]),
      values: [betaProviderOptionAgain.value],
      channel: { id: 'test-channel', isThread: () => false, parentId: null },
      guild: { name: 'TestGuild' },
      user: { id: 'user-1' },
      update: async (payload) => { updates.push(payload); },
      reply: async () => { },
    });
    await flush();

    const recentBetaModelMenu = updates[2];
    const betaModelsAfter = getSelectOptions(recentBetaModelMenu, (option) => option.value.startsWith('model:set:'))
      .map((option) => option.label.replace(' (active)', ''));
    assert.equal(betaModelsAfter[0], 'b3');
    assert.deepEqual(betaModelsAfter.slice(1, 3), ['b1', 'b2']);

    const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.deepEqual(savedConfig.modelPicker.recentProviders, ['beta']);
    assert.deepEqual(savedConfig.modelPicker.recentModelsByProvider.beta, ['b3']);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
