const { createDiscordBot } = require('./discord');
const { createContextWindowResolver } = require('../memory/logs/logWriter');

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

function formatModelError(err) {
  if (err && typeof err.message === 'string' && err.message.trim()) {
    return `API error: ${err.message}`;
  }
  return 'API error: request failed';
}

async function generateReply(payload, modelInstance, completeFn) {
  if (!payload || typeof payload.content !== 'string') {
    return null;
  }
  const trimmed = payload.content.trim();
  if (!trimmed) {
    return null;
  }

  const response = await completeFn(modelInstance, {
    messages: [{ role: 'user', content: trimmed }],
  });
  const reply = extractReplyContent(response);
  if (!reply || !reply.trim()) {
    throw new Error('Model response missing content');
  }
  return reply;
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
    logsRoot,
  } = options || {};

  if (typeof sendMessage !== 'function') {
    throw new Error('sendMessage callback is required');
  }

  // Set up context window resolver for logging if logsRoot is provided
  const windowResolver = logsRoot ? createContextWindowResolver({ logsRoot }) : null;

  function getSurfaceFromContext(contextId, threadId) {
    return threadId ? 'discord-thread' : 'discord-channel';
  }

  function logEvent(payload, role, content, metadata) {
    if (!windowResolver) {
      return;
    }
    const surface = getSurfaceFromContext(payload.contextId, payload.threadId);
    const window = windowResolver.getOrCreateContextWindow(surface, payload.contextId);
    window.append({
      timestamp: new Date().toISOString(),
      role,
      content,
      metadata: metadata || undefined,
    });
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
      (async () => {
        // Log user message
        logEvent(payload, 'user', payload.content, {
          authorId: payload.authorId,
          messageId: payload.messageId,
        });

        let reply;
        try {
          reply = await generateReply(payload, resolvedModel, completeFn);
        } catch (err) {
          const errorMessage = formatModelError(err);
          // Log error as agent response with error metadata
          logEvent(payload, 'agent', errorMessage, {
            error: true,
            errorType: 'model',
          });
          try {
            await sendMessage({
              content: errorMessage,
              channelId: payload.channelId,
              threadId: payload.threadId,
              contextId: payload.contextId,
              messageId: payload.messageId,
              authorId: payload.authorId,
            });
          } catch (sendErr) {
            if (typeof onError === 'function') {
              onError(sendErr);
            }
          }
          if (typeof onError === 'function') {
            onError(err);
          }
          return;
        }

        if (!reply) {
          return;
        }

        // Log agent reply before sending
        logEvent(payload, 'agent', reply);

        try {
          await sendMessage({
            content: reply,
            channelId: payload.channelId,
            threadId: payload.threadId,
            contextId: payload.contextId,
            messageId: payload.messageId,
            authorId: payload.authorId,
          });
        } catch (err) {
          if (typeof onError === 'function') {
            onError(err);
            return;
          }
          throw err;
        }
      })();
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
  generateReply,
  formatModelError,
};
