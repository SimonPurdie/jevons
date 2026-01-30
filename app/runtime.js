const { createDiscordBot } = require('./discord');

function resolvePiAi() {
  try {
    return require('@mariozechner/pi-ai');
  } catch (err) {
    throw new Error('pi-ai is not installed; run npm install');
  }
}

function extractReplyContent(response) {
  if (!response) {
    return null;
  }
  if (typeof response === 'string') {
    return response;
  }
  if (typeof response.text === 'string') {
    return response.text;
  }
  if (response.message && typeof response.message.content === 'string') {
    return response.message.content;
  }
  if (Array.isArray(response.content)) {
    for (const block of response.content) {
      if (block && block.type === 'text' && typeof block.text === 'string') {
        return block.text;
      }
    }
  }
  if (Array.isArray(response.choices)) {
    for (const choice of response.choices) {
      if (choice && choice.message && typeof choice.message.content === 'string') {
        return choice.message.content;
      }
      if (choice && typeof choice.text === 'string') {
        return choice.text;
      }
    }
  }
  return null;
}

async function handleDiscordMessage(payload, modelInstance, completeFn, sendMessage) {
  if (!payload || typeof payload.content !== 'string') {
    return;
  }
  const trimmed = payload.content.trim();
  if (!trimmed) {
    return;
  }

  const response = await completeFn(modelInstance, {
    messages: [{ role: 'user', content: trimmed }],
  });
  const reply = extractReplyContent(response);
  if (!reply || !reply.trim()) {
    throw new Error('Model response missing content');
  }
  await sendMessage({
    content: reply,
    channelId: payload.channelId,
    threadId: payload.threadId,
    contextId: payload.contextId,
    messageId: payload.messageId,
    authorId: payload.authorId,
  });
}

function createDiscordRuntime(options) {
  const {
    client,
    token,
    channelId,
    provider,
    model,
    providers,
    modelInstance,
    getModel: getModelOverride,
    completeSimple: completeSimpleOverride,
    sendMessage,
    onReady,
    onError,
  } = options || {};

  if (typeof sendMessage !== 'function') {
    throw new Error('sendMessage callback is required');
  }

  if (!modelInstance && (!provider || !model)) {
    throw new Error('model provider and model name are required');
  }

  let resolvedModel = modelInstance;
  let completeFn = completeSimpleOverride;
  if (!resolvedModel || !completeFn) {
    const piAi = resolvePiAi();
    const getModelFn = getModelOverride || piAi.getModel;
    const getModelsFn = piAi.getModels;
    if (!resolvedModel) {
      resolvedModel = getModelFn(provider, model, providers);
      if (!resolvedModel) {
        const available = typeof getModelsFn === 'function' ? getModelsFn(provider) : [];
        const names = available.map((entry) => entry.id || entry);
        const preview = names.slice(0, 10).join(', ');
        const suffix = names.length > 10 ? '…' : '';
        throw new Error(`Unknown model "${model}" for provider "${provider}". Available: ${preview}${suffix}`);
      }
    }
    if (!completeFn) {
      completeFn = piAi.completeSimple;
    }
  }

  const bot = createDiscordBot({
    client,
    token,
    channelId,
    onReady,
    onError,
    onMessage: (payload) => {
      handleDiscordMessage(payload, resolvedModel, completeFn, sendMessage).catch((err) => {
        if (typeof onError === 'function') {
          onError(err);
          return;
        }
        throw err;
      });
    },
  });

  return {
    start: bot.start,
    model: resolvedModel,
  };
}

module.exports = {
  createDiscordRuntime,
  extractReplyContent,
  handleDiscordMessage,
};
