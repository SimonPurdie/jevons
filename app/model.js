function loadDefaultProviders() {
  try {
    // Optional dependency; injected providers are preferred in tests and runtime wiring.
    const piAi = require('@mariozechner/pi-ai');
    if (typeof piAi.createProviderRegistry === 'function') {
      return piAi.createProviderRegistry();
    }
    if (piAi.providers && typeof piAi.providers === 'object') {
      return piAi.providers;
    }
  } catch (err) {
    return null;
  }
  return null;
}

function resolveProviderFactory(provider, providers) {
  if (typeof providers === 'function') {
    return providers(provider);
  }
  if (providers && typeof providers === 'object') {
    return providers[provider];
  }
  const defaultProviders = loadDefaultProviders();
  if (defaultProviders && typeof defaultProviders === 'object') {
    return defaultProviders[provider];
  }
  return null;
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('messages must be a non-empty array');
  }
}

function buildChatRequest(model, params) {
  const {
    messages,
    temperature,
    maxTokens,
    topP,
    stop,
  } = params || {};

  validateMessages(messages);

  const request = {
    model,
    messages,
  };

  if (temperature !== undefined) {
    request.temperature = temperature;
  }
  if (maxTokens !== undefined) {
    request.maxTokens = maxTokens;
  }
  if (topP !== undefined) {
    request.topP = topP;
  }
  if (stop !== undefined) {
    request.stop = stop;
  }

  return request;
}

function callProvider(client, request) {
  if (client && typeof client.createChatCompletion === 'function') {
    return client.createChatCompletion(request);
  }
  if (client && typeof client.chat === 'function') {
    return client.chat(request);
  }
  if (client && typeof client.complete === 'function') {
    return client.complete(request);
  }
  throw new Error('Provider client does not implement chat completion');
}

function createModelClient(options) {
  const {
    provider,
    model,
    providers,
    providerOptions,
  } = options || {};

  if (!provider) {
    throw new Error('model provider is required');
  }
  if (!model) {
    throw new Error('model name is required');
  }

  const factory = resolveProviderFactory(provider, providers);
  if (typeof factory !== 'function') {
    throw new Error(`Unknown model provider: ${provider}`);
  }

  const client = factory({
    provider,
    model,
    ...(providerOptions || {}),
  });

  return {
    provider,
    model,
    generateChatCompletion(params) {
      const request = buildChatRequest(model, params);
      return callProvider(client, request);
    },
  };
}

module.exports = {
  createModelClient,
  buildChatRequest,
  resolveProviderFactory,
};
