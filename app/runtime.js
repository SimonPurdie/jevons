const { createDiscordBot } = require('./discord');
const { createContextWindowResolver } = require('../memory/logs/logWriter');
const { formatMemoryInjection } = require('../memory/index/injection');
const { retrieveMemories } = require('../memory/index/retrieval');
const { generateEmbedding } = require('../memory/index/embeddings');
const { readLogEntry } = require('../memory/logs/logReader');
const { readChatHistory } = require('../memory/chatHistory');
const { createPinsManager } = require('../memory/pins/pins');
const { loadSkill } = require('../skills/loader');
const { createBashTool } = require('./tools/bash');

function resolvePiAi() {
  try {
    return require('@mariozechner/pi-ai');
  } catch (err) {
    throw new Error('pi-ai is not installed; run npm install');
  }
}

async function resolvePiAgentCore() {
  try {
    return await import('@mariozechner/pi-agent-core');
  } catch (err) {
    throw new Error('pi-agent-core is not installed; run npm install');
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

const fs = require('fs');
const path = require('path');

function logContextToFile(context) {
  const logsDir = path.join(process.cwd(), 'logs');
  const contextPath = path.join(logsDir, 'context.txt');
  
  try {
    const logEntry = {
      "systemPrompt": context.systemPrompt,
      "model": context.model,
      "tools": context.tools,
      "messages": context.messages,
      "prompt": {
        "role": "user",
        "content": context.userContent,
        "timestamp": context.timestamp,
      },
    };

    fs.writeFileSync(contextPath, JSON.stringify(logEntry, null, 2));
  } catch (err) {
    // Silently fail - logging should not interrupt bot operation
  }
}

function extractTextFromBlocks(blocks) {
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
    if (block.type === 'text' && typeof block.text === 'string') {
      return block.text;
    }
  }
  return null;
}

function extractLatestAssistantText(messages) {
  if (!Array.isArray(messages)) {
    return null;
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.role !== 'assistant') {
      continue;
    }
    if (typeof message.content === 'string') {
      return message.content;
    }
    const text = extractTextFromBlocks(message.content);
    if (text && text.trim()) {
      return text;
    }
  }
  return null;
}

/**
 * Reads specified workspace files and formats them for injection.
 * 
 * @param {string[]} fileNames - List of file names to read.
 * @param {string} baseDir - Directory where files are located.
 * @returns {string} Formatted content string.
 */
function readWorkspaceFiles(fileNames, baseDir) {
  let content = '';
  for (const fileName of fileNames) {
    const filePath = path.join(baseDir, fileName);
    try {
      if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        content += `\n---\nPath: ${filePath}\n\n${fileContent}\n`;
      }
    } catch (err) {
      // Silently skip files that cannot be read
    }
  }
  return content;
}

function buildSystemPrompt(skills, workspaceFilesContent) {
  let sections = [];
  
  if (skills && skills.length > 0) {
    const skillsContent = skills.map((skill) => skill.content).join('\n\n');
    sections.push(`You have access to the following skills:\n\n${skillsContent}\n\nUse the bash tool to execute these skills when needed.`);
  }
  
  if (workspaceFilesContent) {
    const header = `- **Workspace Files (injected)**: AGENTS.md SOUL.md TOOLS.md IDENTITY.md USER.md ( all located in /home/simon/jevons and labelled with their full path and filename before their content )`;
    sections.push(`${header}\n${workspaceFilesContent}`);
  }
  
  return sections.join('\n\n');
}

/**
 * Formats current system time for injection.
 * Format: <Current Time: YYYY-MM-DD HH:mm:ss weekday timeOfDay>
 */
function formatCurrentTime(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const weekday = weekdays[date.getDay()];
  
  const hour = date.getHours();
  let timeOfDay = 'night';
  if (hour >= 5 && hour < 12) timeOfDay = 'morning';
  else if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
  else if (hour >= 17 && hour < 21) timeOfDay = 'evening';
  
  return `<Current Time: ${yyyy}-${mm}-${dd} ${hh}:${min}:${ss} ${weekday} ${timeOfDay}>`;
}

function normalizeHistoryMessages(history, modelInstance) {
  if (!Array.isArray(history)) {
    return [];
  }
  const normalized = normalizePiAiMessages(history, modelInstance);
  const now = Date.now();
  return normalized.map((msg) => {
    if (!msg || typeof msg !== 'object') {
      return msg;
    }
    if (msg.role === 'user') {
      return {
        ...msg,
        timestamp: msg.timestamp || now,
      };
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

  let injectionText = null;
  let content = trimmed;
  const injectionFn = options.injection;
  if (typeof injectionFn === 'function') {
    const injected = await injectionFn(trimmed, payload);
    if (injected) {
      injectionText = injected;
    }
  }

  const timeInjection = formatCurrentTime();
  if (injectionText) {
    content = `${injectionText}\n${timeInjection}\n${trimmed}`;
  } else {
    content = `${timeInjection}\n${trimmed}`;
  }

  const { Agent } = await resolvePiAgentCore();

  const workspaceFileNames = ['AGENTS.md', 'SOUL.md', 'TOOLS.md', 'IDENTITY.md', 'USER.md'];
  const workspaceFilesContent = readWorkspaceFiles(workspaceFileNames, '/home/simon/jevons');
  const systemPrompt = buildSystemPrompt(options.skills, workspaceFilesContent);
  const historyMessages = normalizeHistoryMessages(options.chatHistory || [], modelInstance);

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model: modelInstance,
      tools: Array.isArray(options.tools) ? options.tools : [],
      messages: historyMessages,
    },
  });

  logContextToFile({
    systemPrompt,
    model: modelInstance,
    tools: Array.isArray(options.tools) ? options.tools : [],
    messages: historyMessages,
    userContent: content,
    timestamp: Date.now(),
  });

  await agent.prompt({
    role: 'user',
    content,
    timestamp: Date.now(),
  });

  const reply = extractLatestAssistantText(agent.state.messages);
  if (!reply || !reply.trim()) {
    const hasToolCalls = agent.state.messages.some(m => m.role === 'assistant' && Array.isArray(m.content) && m.content.some(c => c.type === 'tool_call'));
    if (hasToolCalls) {
      // If the model made tool calls but didn't provide a final summary, 
      // return a default acknowledgement.
      return 'Action completed.';
    }
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
    skillsDir,
    skillPlaceholders = {},
    ipcPort,
  } = options || {};

  if (typeof sendMessage !== 'function') {
    throw new Error('sendMessage callback is required');
  }

  // Load and process skills
  let loadedSkills = [];
  if (skillsDir) {
    try {
      loadedSkills = loadSkill({ skillsDir });
    } catch (err) {
      if (typeof onError === 'function') {
        onError(new Error(`Failed to load skills: ${err.message}`));
      }
    }
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

        // Create tools with per-message IPC context
        const extraEnv = {
          JEVONS_IPC_PORT: String(ipcPort),
        };
        if (payload.channelId && payload.channelId !== 'null') {
          extraEnv.JEVONS_CHANNEL_ID = payload.channelId;
        }
        if (payload.threadId && payload.threadId !== 'null') {
          extraEnv.JEVONS_THREAD_ID = payload.threadId;
        }
        const runtimeTools = [createBashTool(process.cwd(), extraEnv)];

        let reply;
        try {
          reply = await generateReply(payload, resolvedModel, completeFn, {
            injection: memoryInjectionProvider,
            chatHistory,
            skills: loadedSkills,
            tools: runtimeTools,
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
