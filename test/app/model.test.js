const test = require('node:test');
const assert = require('node:assert/strict');
const { createModelClient, buildChatRequest, resolveProviderFactory } = require('../../app/model');

test('buildChatRequest includes model and messages', () => {
  const request = buildChatRequest('gpt-test', {
    messages: [{ role: 'user', content: 'hello' }],
  });
  assert.equal(request.model, 'gpt-test');
  assert.deepEqual(request.messages, [{ role: 'user', content: 'hello' }]);
});

test('buildChatRequest omits undefined optional fields', () => {
  const request = buildChatRequest('gpt-test', {
    messages: [{ role: 'user', content: 'hello' }],
    temperature: 0,
    maxTokens: 128,
  });
  assert.equal(request.temperature, 0);
  assert.equal(request.maxTokens, 128);
  assert.equal(Object.prototype.hasOwnProperty.call(request, 'topP'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(request, 'stop'), false);
});

test('buildChatRequest rejects empty messages', () => {
  assert.throws(() => buildChatRequest('gpt-test', { messages: [] }), {
    message: 'messages must be a non-empty array',
  });
});

test('resolveProviderFactory supports lookup objects', () => {
  const factory = () => ({});
  const result = resolveProviderFactory('test', { test: factory });
  assert.equal(result, factory);
});

test('createModelClient throws when provider or model missing', () => {
  assert.throws(() => createModelClient({ model: 'gpt-test' }), {
    message: 'model provider is required',
  });
  assert.throws(() => createModelClient({ provider: 'test' }), {
    message: 'model name is required',
  });
});

test('createModelClient rejects unknown provider', () => {
  assert.throws(() => createModelClient({ provider: 'missing', model: 'gpt-test', providers: {} }), {
    message: 'Unknown model provider: missing',
  });
});

test('createModelClient passes request to provider client', async () => {
  const calls = [];
  const providerFactory = (options) => {
    calls.push(options);
    return {
      createChatCompletion: async (request) => ({ request }),
    };
  };

  const client = createModelClient({
    provider: 'test',
    model: 'gpt-test',
    providers: { test: providerFactory },
    providerOptions: { apiKey: 'secret' },
  });

  const result = await client.generateChatCompletion({
    messages: [{ role: 'user', content: 'hi' }],
    temperature: 0.2,
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    provider: 'test',
    model: 'gpt-test',
    apiKey: 'secret',
  });
  assert.equal(result.request.model, 'gpt-test');
  assert.equal(result.request.temperature, 0.2);
});
