const { createDiscordBot } = require('./discord');
const { createContextWindowResolver } = require('../memory/logs/logWriter');
const { formatMemoryInjection } = require('../memory/index/injection');
const { retrieveMemories } = require('../memory/index/retrieval');
const { generateEmbedding } = require('../memory/index/embeddings');
const { readLogEntry } = require('../memory/logs/logReader');
const { readChatHistory } = require('../memory/chatHistory');
const { createPinsManager } = require('../memory/pins/pins');

function resolvePiAi() {
  try {
    return require('@mariozechner/pi-ai');
  } catch (err) {
    throw new Error('pi-ai is not installed; run npm install');
  }
}

function extractReplyContent(response) {
  const extractFromBlocks = (blocks) => {
    if (!Array.isArray(blocks)) {
      return null;
    }
    for (const block of blocks) {
      if (!block) {
        continue;
      }
      if (typeof block === 'string') {
        return block;
      }
      if (typeof block.text === 'string') {
        return block.text;
      }
      if (typeof block.content === 'string') {
        return block.content;
      }
      if (typeof block.thinking === 'string') {
        return block.thinking;
      }
      if (block.type === 'text' && typeof block.text === 'string') {
        return block.text;
      }
    }
    return null;
  };

  if (!response) {
    return null;
  }
  if (typeof response === 'string') {
    return response;
  }
  if (typeof response.output_text === 'string') {
    return response.output_text;
  }
  if (response.output && typeof response.output.text === 'string') {
    return response.output.text;
  }
  if (typeof response.text === 'string') {
    return response.text;
  }
  if (response.message) {
    if (typeof response.message.content === 'string') {
      return response.message.content;
    }
    const messageBlockText = extractFromBlocks(response.message.content);
    if (messageBlockText) {
      return messageBlockText;
    }
  }
  const contentBlockText = extractFromBlocks(response.content);
  if (contentBlockText) {
    return contentBlockText;
  }
  if (Array.isArray(response.choices)) {
    for (const choice of response.choices) {
      if (choice && choice.message && typeof choice.message.content === 'string') {
        return choice.message.content;
      }
      const choiceMessageBlocks = extractFromBlocks(choice && choice.message && choice.message.content);
      if (choiceMessageBlocks) {
        return choiceMessageBlocks;
      }
      if (choice && typeof choice.text === 'string') {
        return choice.text;
      }
    }
  }
  if (typeof response.errorMessage === 'string') {
    return response.errorMessage;
  }
  return null;
}

function formatModelError(err) {
  if (err && typeof err.message === 'string' && err.message.trim()) {
    return `API error: ${err.message}`;
  }
  return 'API error: request failed';
}

function normalizePiAiMessages(messages, modelInstance) {
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages.map((msg) => {
    if (!msg || typeof msg !== 'object') {
      return msg;
    }
    if (msg.role === 'assistant') {
      const needsWrap = typeof msg.content === 'string';
      const hasArray = Array.isArray(msg.content);
      const contentBlocks = needsWrap
        ? [{ type: 'text', text: msg.content }]
        : hasArray
          ? msg.content
          : [];
      const normalized = {
        ...msg,
        content: contentBlocks,
      };
      if (normalized.timestamp === undefined) {
        normalized.timestamp = Date.now();
      }
      if (normalized.stopReason === undefined) {
        normalized.stopReason = 'stop';
      }
      if (!normalized.usage) {
        normalized.usage = {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        };
      }
      if (modelInstance) {
        if (normalized.api === undefined && modelInstance.api) {
          normalized.api = modelInstance.api;
        }
        if (normalized.provider === undefined && modelInstance.provider) {
          normalized.provider = modelInstance.provider;
        }
        if (normalized.model === undefined && modelInstance.id) {
          normalized.model = modelInstance.id;
        }
      }
      return normalized;
    }
    return msg;
  });
}

async function generateReply(payload, modelInstance, completeFn, options = {}) {
  if (!payload || typeof payload.content !== 'string') {
    return null;
  }
  const trimmed = payload.content.trim();
  if (!trimmed) {
    return null;
  }

  let content = trimmed;
  const injectionFn = options.injection;
  if (typeof injectionFn === 'function') {
    const injected = await injectionFn(trimmed, payload);
    if (injected) {
      content = `${injected}\n${trimmed}`;
    }
  }

  // Build messages array with chat history
  const messages = [];

  // Add chat history if available
  if (options.chatHistory && options.chatHistory.length > 0) {
    messages.push(...options.chatHistory);
  }

  // Add current user message
  messages.push({ role: 'user', content });

  const normalizedMessages = normalizePiAiMessages(messages, modelInstance);

  const response = await completeFn(modelInstance, {
    messages: normalizedMessages,
  });
  const reply = extractReplyContent(response);
  if (!reply || !reply.trim()) {
    throw new Error('Model response missing content');
  }
  return reply;
}

function createMemoryInjectionProvider(options = {}) {
  const {
    indexPath,
    embeddingApiKey,
    embeddingModel,
    embedder,
    retriever,
    logReader,
    injectorOptions,
    maxMemories,
    onError,
  } = options;

  const canEmbed = typeof embedder === 'function' || embeddingApiKey;
  const canRetrieve = typeof retriever === 'function' || indexPath;
  if (!canEmbed || !canRetrieve) {
    return null;
  }

  const embed = embedder || ((text) => generateEmbedding(text, {
    apiKey: embeddingApiKey,
    embeddingModel,
  }));
  const retrieve = retriever || ((embedding, retrieveOptions) => retrieveMemories(embedding, {
    dbPath: indexPath,
    ...retrieveOptions,
  }));
  const readEntry = logReader || ((path, line) => readLogEntry(path, line));

  return async function getInjection(trimmed) {
    try {
      const queryEmbedding = await embed(trimmed);
      const retrieved = await retrieve(queryEmbedding, { limit: maxMemories });
      if (!retrieved || retrieved.length === 0) {
        return null;
      }

      const hydrated = retrieved.map((memory) => {
        if (memory && typeof memory.content === 'string') {
          return memory;
        }
        const entry = readEntry(memory.path, memory.line);
        return {
          ...memory,
          content: entry ? entry.content : '',
        };
      });

      return formatMemoryInjection(hydrated, injectorOptions);
    } catch (error) {
      if (typeof onError === 'function') {
        onError(error);
      }
      return null;
    }
  };
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
    memoryIndexPath,
    memoryInjection,
    memoryEmbedder,
    memoryRetriever,
    memoryLogReader,
    memoryInjectorOptions,
    memoryMaxMemories,
    embeddingApiKey,
    embeddingModel,
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

  function getChatHistoryForContext(contextId, threadId) {
    if (!windowResolver) {
      return [];
    }
    const surface = getSurfaceFromContext(contextId, threadId);
    const window = windowResolver.getOrCreateContextWindow(surface, contextId);
    // Read history from the current window's log file
    return readChatHistory(window.path);
  }

  if (!modelInstance && (!provider || !model)) {
    throw new Error('model provider and model name are required');
  }

  const memoryInjectionProvider = typeof memoryInjection === 'function'
    ? memoryInjection
    : createMemoryInjectionProvider({
      indexPath: memoryIndexPath,
      embeddingApiKey,
      embeddingModel,
      embedder: memoryEmbedder,
      retriever: memoryRetriever,
      logReader: memoryLogReader,
      injectorOptions: memoryInjectorOptions,
      maxMemories: memoryMaxMemories,
      onError,
    });

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

  function isNewCommand(content) {
    return typeof content === 'string' && content.trim() === '/new';
  }

  function isRememberCommand(content) {
    return typeof content === 'string' && content.trim().startsWith('/remember');
  }

  const bot = createDiscordBot({
    client,
    token,
    channelId,
    onReady,
    onError,
    onMessage: (payload) => {
      (async () => {
        // Handle /new command: reset context window and confirm
        if (isNewCommand(payload.content)) {
          if (windowResolver) {
            const surface = getSurfaceFromContext(payload.contextId, payload.threadId);
            windowResolver.resetContextWindow(surface, payload.contextId);
          }
          try {
            await sendMessage({
              content: 'Context window reset. Starting fresh conversation.',
              channelId: payload.channelId,
              threadId: payload.threadId,
              contextId: payload.contextId,
              messageId: payload.messageId,
              authorId: payload.authorId,
            });
          } catch (err) {
            if (typeof onError === 'function') {
              onError(err);
            }
          }
          return;
        }

        // Handle /remember command: pin the referenced message
        if (isRememberCommand(payload.content)) {
          // Extract the replied message ID if this is a reply
          const repliedMessageId = payload.referencedMessageId || null;

          const pinsManager = createPinsManager({
            indexPath: memoryIndexPath,
            logsRoot,
          });

          try {
            const result = await pinsManager.handleRememberCommand(
              payload.content,
              repliedMessageId,
              payload.contextId
            );

            // Log the pin action
            logEvent(payload, 'agent', result.message, {
              action: 'pin',
              success: result.success,
              pinnedMessageId: result.entry ? result.entry.id : null,
            });

            // Send confirmation to Discord
            await sendMessage({
              content: result.message,
              channelId: payload.channelId,
              threadId: payload.threadId,
              contextId: payload.contextId,
              messageId: payload.messageId,
              authorId: payload.authorId,
            });
          } catch (err) {
            const errorMessage = `Failed to pin message: ${err.message}`;
            logEvent(payload, 'agent', errorMessage, {
              action: 'pin',
              success: false,
              error: err.message,
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
          } finally {
            await pinsManager.close();
          }
          return;
        }

        // Get chat history for this context BEFORE logging current message
        const chatHistory = getChatHistoryForContext(payload.contextId, payload.threadId);

        // Log user message
        logEvent(payload, 'user', payload.content, {
          authorId: payload.authorId,
          messageId: payload.messageId,
        });

        let reply;
        try {
          reply = await generateReply(payload, resolvedModel, completeFn, {
            injection: memoryInjectionProvider,
            chatHistory,
          });
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
