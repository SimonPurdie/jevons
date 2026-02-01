import { createDiscordBot, sendDiscordMessage } from './discord.js';
import { StringSelectMenuBuilder, ActionRowBuilder } from 'discord.js';
import { DiscordSessionManager } from './sessionManager.js';
import { performCompaction } from './compaction.js';
import { loadSkill } from '../skills/loader.js';
import { createBashTool } from './tools/bash.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function resolvePiAi() {
  try {
    // Dynamic import for ESM module
    const module = await import('@mariozechner/pi-ai');
    return module;
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

function logAgentInteraction(agent, userContent, timestamp) {
  const logsDir = path.join(process.cwd(), 'logs');
  const debugLogPath = path.join(logsDir, 'agent_debug.log');

  try {
    const logEntry = {
      timestamp: new Date().toISOString(),
      userPrompt: {
        content: userContent,
        timestamp,
      },
      systemPrompt: agent.state.systemPrompt,
      model: agent.state.model ? {
        provider: agent.state.model.provider,
        id: agent.state.model.id,
      } : null,
      messages: agent.state.messages,
    };

    const logString = `--- INTERACTION START: ${logEntry.timestamp} ---\n` +
      JSON.stringify(logEntry, null, 2) +
      `\n--- INTERACTION END ---\n\n`;

    fs.appendFileSync(debugLogPath, logString, 'utf8');
  } catch (err) {
    // Silently fail - logging should not interrupt bot operation
  }
}

/**
 * Extracts text from an array of message blocks.
 */
function getTextFromBlocks(blocks) {
  if (!Array.isArray(blocks)) {
    return typeof blocks === 'string' ? blocks : null;
  }
  return blocks
    .map(block => {
      if (!block) return '';
      if (typeof block === 'string') return block;
      if (block.type === 'text') return block.text || '';
      return '';
    })
    .join('')
    .trim();
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

/**
 * Formats a date as a relative time string (e.g., "2 hours ago", "yesterday").
 * @param {Date} date - The date to format
 * @returns {string} Relative time description
 */
function formatTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) {
    return 'just now';
  } else if (diffMins < 60) {
    return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  } else if (diffDays === 1) {
    return 'yesterday';
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks} week${weeks !== 1 ? 's' : ''} ago`;
  } else {
    return date.toLocaleDateString();
  }
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

export async function generateReply(payload, modelInstance, options = {}) {
  if (!payload || typeof payload.content !== 'string') {
    return null;
  }
  const trimmed = payload.content.trim();
  if (!trimmed) {
    return null;
  }

  const timeInjection = formatCurrentTime();
  const content = `${timeInjection}\n${trimmed}`;

  const { Agent: AgentClass } = options.Agent ? { Agent: options.Agent } : await (options.resolvePiAgentCore || resolvePiAgentCore)();

  // Get session context for this Discord context
  let sessionContext = { messages: [] };
  if (options.sessionManager && payload.contextId) {
    const session = options.sessionManager.getOrCreate(payload.contextId);
    sessionContext = session.sessionManager.buildSessionContext();
  }

  const workspaceFileNames = ['AGENTS.md', 'SOUL.md', 'TOOLS.md', 'IDENTITY.md', 'USER.md'];
  const workspaceFilesContent = readWorkspaceFiles(workspaceFileNames, '/home/simon/jevons');
  const systemPrompt = buildSystemPrompt(options.skills, workspaceFilesContent);
  const historyMessages = normalizeHistoryMessages(sessionContext.messages || [], modelInstance);

  const agent = new AgentClass({
    initialState: {
      systemPrompt,
      model: modelInstance,
      tools: Array.isArray(options.tools) ? options.tools : [],
      messages: historyMessages,
    },
    getApiKey: async (provider) => {
      if (options.authStorage) {
        const key = await options.authStorage.getApiKey(provider);
        if (key) return key;
      }
      // Fallback or error
      throw new Error(`No API key found for provider "${provider}". Check .env or auth.json.`);
    }
  });

  // Persist user message to session before prompting
  if (options.sessionManager && payload.contextId) {
    const session = options.sessionManager.getOrCreate(payload.contextId);
    session.sessionManager.appendMessage({
      role: 'user',
      content,
      timestamp: Date.now(),
    });
  }

  await agent.prompt({
    role: 'user',
    content,
    timestamp: Date.now(),
  });

  logAgentInteraction(agent, content, Date.now());

  // Get the absolute latest message from the agent's state
  const latestMessage = agent.state.messages[agent.state.messages.length - 1];

  if (!latestMessage || latestMessage.role !== 'assistant') {
    return '...';
  }

  // Handle API Errors directly from the message record
  if (latestMessage.stopReason === 'error' || latestMessage.errorMessage) {
    const errorMsg = latestMessage.errorMessage || 'API error: request failed';
    return `API error: ${errorMsg}`;
  }

  const reply = getTextFromBlocks(latestMessage.content);

  // Persist assistant response to session
  if (options.sessionManager && payload.contextId && reply && reply.trim()) {
    const session = options.sessionManager.getOrCreate(payload.contextId);
    session.sessionManager.appendMessage({
      role: 'assistant',
      content: reply,
      timestamp: Date.now(),
    });
  }

  if (!reply || !reply.trim()) {
    const hasToolCalls = Array.isArray(latestMessage.content) && latestMessage.content.some(c => c.type === 'tool_call');
    if (hasToolCalls) {
      return 'Action completed.';
    }
    return '...';
  }
  return reply;
}

export async function createDiscordRuntime(options) {
  const {
    client,
    token,
    channelId,
    applicationId,
    activeModel,
    models,
    providers,
    modelInstance,
    getModel: getModelOverride,
    sendMessage,
    onReady,
    onError,
    sessionDir,
    skillsDir,
    ipcPort,
    deps = {},
    authStorage,
  } = options || {};

  const _Agent = deps.Agent;
  const _resolvePiAi = deps.resolvePiAi || resolvePiAi;
  const _resolvePiAgentCore = deps.resolvePiAgentCore || resolvePiAgentCore;

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

  // Set up DiscordSessionManager for session-based history
  let sessionManager = options.sessionManager || null;
  if (!sessionManager && sessionDir) {
    try {
      sessionManager = new DiscordSessionManager({ sessionDir });
    } catch (err) {
      if (typeof onError === 'function') {
        onError(new Error(`Failed to initialize session manager: ${err.message}`));
      }
    }
  }

  function startTypingLoop(contextId) {
    const sendTyping = async () => {
      try {
        const channel = await client.channels.fetch(contextId);
        if (channel && typeof channel.sendTyping === 'function') {
          await channel.sendTyping();
        }
      } catch (err) {
        // Silently fail typing indicator errors
      }
    };

    // Send immediately
    sendTyping();

    // Loop every 9 seconds (Discord typing lasts ~10s)
    const interval = setInterval(sendTyping, 9000);

    return () => clearInterval(interval);
  }

  let resolvedModel = modelInstance;
  if (!resolvedModel) {
    const piAi = await _resolvePiAi();
    const getModelFn = getModelOverride || piAi.getModel;

    let targetProvider;
    let targetModel;

    if (activeModel && typeof activeModel === 'string' && activeModel.includes('/')) {
      [targetProvider, targetModel] = activeModel.split('/');
    } else if (Array.isArray(models) && models.length > 0) {
      // Fallback to first model in list
      targetProvider = models[0].provider;
      targetModel = models[0].model;
    }

    if (!targetProvider || !targetModel) {
      // Construct a helpful error message
      const configDebug = { activeModel, modelsLength: Array.isArray(models) ? models.length : 0 };
      throw new Error(`No active model configuration found or activeModel format invalid. Please check config.json. Debug: ${JSON.stringify(configDebug)}`);
    }

    resolvedModel = getModelFn(targetProvider, targetModel, providers);
    // getModel might return null/undefined if provider not found
    if (!resolvedModel) {
      const getModelsFn = piAi.getModels;
      const available = typeof getModelsFn === 'function' ? getModelsFn(targetProvider) : [];
      const names = available.map((entry) => entry.id || entry);
      const preview = names.slice(0, 10).join(', ');
      const suffix = names.length > 10 ? '…' : '';
      throw new Error(`Unknown model "${targetModel}" for provider "${targetProvider}". Available: ${preview}${suffix}`);
    }
  }

  function isNewCommand(content) {
    return typeof content === 'string' && content.trim() === '/new';
  }

  function isCompactCommand(content) {
    return typeof content === 'string' && content.trim().startsWith('/compact');
  }

  function isForkCommand(content) {
    return typeof content === 'string' && content.trim().startsWith('/fork');
  }

  const bot = createDiscordBot({
    client,
    token,
    channelId,
    applicationId,
    onReady,
    onError,
    onInteraction: (payload) => {
      (async () => {
        if (payload.commandName === 'new') {
          if (sessionManager && payload.contextId) {
            sessionManager.newSession(payload.contextId);
          }
          try {
            await payload.interaction.reply('New session started. Use /resume to access previous sessions.');
          } catch (err) {
            if (typeof onError === 'function') {
              onError(err);
            }
          }
          return;
        }

        if (payload.commandName === 'resume') {
          if (!sessionManager || !payload.contextId) {
            try {
              await payload.interaction.reply('Session manager is not available.');
            } catch (err) {
              if (typeof onError === 'function') {
                onError(err);
              }
            }
            return;
          }

          try {
            const sessions = await sessionManager.listSessions(payload.contextId);

            if (sessions.length === 0) {
              await payload.interaction.reply('No previous sessions found for this channel.');
              return;
            }

            // Create select menu options from sessions
            const options = sessions.slice(0, 25).map((session, index) => { // Discord allows max 25 options
              const timestamp = new Date(session.created || session.modified);
              const timeAgo = formatTimeAgo(timestamp);
              // Extract text without time injection prefix for cleaner preview
              let preview = session.firstMessage || 'No preview available';
              if (Array.isArray(preview)) {
                preview = getTextFromBlocks(preview) || 'No preview available';
              }
              // Remove time injection prefix if present (format: <Current Time: ...>\n)
              preview = preview.replace(/<Current Time:.*?>[\r\n]*/, '').trim();

              const truncatedPreview = preview.length > 60 ? preview.slice(0, 60) + '...' : preview;
              const label = `Session ${index + 1}: ${truncatedPreview}`.slice(0, 100);
              const description = `${timeAgo} - ${session.messageCount || 0} messages`.slice(0, 100);

              return {
                label,
                description,
                value: path.basename(session.path),
              };
            });

            const selectMenu = new StringSelectMenuBuilder()
              .setCustomId('resume_session_select')
              .setPlaceholder('Select a session to resume')
              .addOptions(options);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            await payload.interaction.reply({
              content: `Found ${sessions.length} session(s). Select one to resume:`,
              components: [row],
            });
          } catch (err) {
            console.error('DEBUG: Error in /resume:', err.message);
            if (err.errors) {
              console.error('DEBUG: Validation errors:', JSON.stringify(err.errors, null, 2));
            }
            console.error('DEBUG: Options that failed:', JSON.stringify(options, null, 2));
            if (typeof onError === 'function') {
              onError(err);
            }
            try {
              await payload.interaction.reply('Failed to list sessions. Please try again.');
            } catch (replyErr) {
              // Ignore secondary errors
            }
          }
          return;
        }

        // Handle select menu interactions for resume
        if (payload.isSelectMenu && payload.customId === 'resume_session_select') {
          if (!sessionManager || !payload.contextId) {
            try {
              await payload.interaction.reply('Session manager is not available.');
            } catch (err) {
              if (typeof onError === 'function') {
                onError(err);
              }
            }
            return;
          }

          try {
            const selectedFilePath = payload.values[0];
            if (!selectedFilePath) {
              await payload.interaction.reply('No session selected.');
              return;
            }

            // Switch to the selected session
            sessionManager.switchToSession(payload.contextId, selectedFilePath);

            await payload.interaction.reply('Session resumed. Ready to continue.');
          } catch (err) {
            if (typeof onError === 'function') {
              onError(err);
            }
            try {
              await payload.interaction.reply('Failed to resume session. The session file may be corrupt.');
            } catch (replyErr) {
              // Ignore secondary errors
            }
          }
          return;
        }

        if (payload.commandName === 'fork') {
          if (!sessionManager || !payload.contextId) {
            try {
              await payload.interaction.reply('Session manager is not available.');
            } catch (err) {
              if (typeof onError === 'function') {
                onError(err);
              }
            }
            return;
          }

          try {
            const session = sessionManager.getOrCreate(payload.contextId);
            const branch = session.sessionManager.getBranch();

            // Filter for user messages to fork from
            const userEntries = branch.filter(entry =>
              entry.type === 'message' &&
              entry.message &&
              entry.message.role === 'user'
            );

            if (userEntries.length === 0) {
              await payload.interaction.reply('No user messages found to fork from.');
              return;
            }

            // Create select menu options from user messages
            const options = userEntries.slice(-25).reverse().map((entry, index) => {
              const msg = entry.message;
              // Extract text without time injection prefix
              let text = msg.content || 'No content';
              if (Array.isArray(text)) {
                text = extractTextFromBlocks(text) || 'No text content';
              }
              text = text.replace(/<Current Time:.*?>[\r\n]*/, '').trim();

              const truncatedText = text.length > 80 ? text.slice(0, 80) + '...' : text;
              const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date(msg.timestamp);
              const timeLabel = formatTimeAgo(timestamp);

              return {
                label: `Message ${userEntries.length - index}: ${truncatedText}`.slice(0, 100),
                description: `Sent ${timeLabel}`.slice(0, 100),
                value: entry.id,
              };
            });

            const selectMenu = new StringSelectMenuBuilder()
              .setCustomId('fork_session_select')
              .setPlaceholder('Select a message to fork from')
              .addOptions(options);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            await payload.interaction.reply({
              content: 'Select a message to fork the conversation from:',
              components: [row],
            });
          } catch (err) {
            if (typeof onError === 'function') {
              onError(err);
            }
            try {
              await payload.interaction.reply(`Failed to list messages for forking: ${err.message}`);
            } catch (replyErr) {
              // Ignore
            }
          }
          return;
        }

        // Handle select menu interactions for fork
        if (payload.isSelectMenu && payload.customId === 'fork_session_select') {
          if (!sessionManager || !payload.contextId) {
            try {
              await payload.interaction.reply('Session manager is not available.');
            } catch (err) {
              if (typeof onError === 'function') {
                onError(err);
              }
            }
            return;
          }

          try {
            const selectedEntryId = payload.values[0];
            if (!selectedEntryId) {
              await payload.interaction.reply('No message selected.');
              return;
            }

            // Fork the session
            sessionManager.forkSession(payload.contextId, selectedEntryId);

            await payload.interaction.reply('Forked session. You can now continue from that point.');
          } catch (err) {
            if (typeof onError === 'function') {
              onError(err);
            }
            try {
              await payload.interaction.reply(`Failed to fork session: ${err.message}`);
            } catch (replyErr) {
              // Ignore
            }
          }
          return;
        }

        if (payload.commandName === 'compact') {
          if (!sessionManager || !payload.contextId) {
            try {
              await payload.interaction.reply('Session manager is not available.');
            } catch (err) {
              if (typeof onError === 'function') {
                onError(err);
              }
            }
            return;
          }

          try {
            await payload.interaction.deferReply();

            const session = sessionManager.getOrCreate(payload.contextId);
            const customInstructions = payload.interaction.options?.getString('instructions');

            // Get API key for the model
            const apiKey = await authStorage.getApiKey(resolvedModel.provider);

            const result = await performCompaction(session, resolvedModel, apiKey, customInstructions);

            await payload.interaction.editReply(`Compacting session... Summarized messages into summary. Context now reduced.`);
          } catch (err) {
            if (typeof onError === 'function') {
              onError(err);
            }
            try {
              const errorMessage = `Failed to compact session: ${err.message}`;
              if (payload.interaction.deferred) {
                await payload.interaction.editReply(errorMessage);
              } else {
                await payload.interaction.reply(errorMessage);
              }
            } catch (replyErr) {
              // Ignore secondary errors
            }
          }
          return;
        }
      })();
    },
    onMessage: (payload) => {
      (async () => {
        // Handle /new command: reset context window and confirm
        if (isNewCommand(payload.content)) {
          if (sessionManager && payload.contextId) {
            sessionManager.newSession(payload.contextId);
          }
          try {
            await sendMessage({
              content: 'New session started. Use /resume to access previous sessions.',
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

        // Handle /compact command
        if (isCompactCommand(payload.content)) {
          if (!sessionManager || !payload.contextId) {
            try {
              await sendMessage({
                content: 'Session manager is not available.',
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

          try {
            const session = sessionManager.getOrCreate(payload.contextId);
            const parts = payload.content.trim().split(/\s+/);
            const customInstructions = parts.length > 1 ? parts.slice(1).join(' ') : undefined;

            const apiKey = await authStorage.getApiKey(resolvedModel.provider);
            await performCompaction(session, resolvedModel, apiKey, customInstructions);

            await sendMessage({
              content: 'Compacting session... Summarized messages into summary. Context now reduced.',
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
            try {
              await sendMessage({
                content: `Failed to compact session: ${err.message}`,
                channelId: payload.channelId,
                threadId: payload.threadId,
                contextId: payload.contextId,
                messageId: payload.messageId,
                authorId: payload.authorId,
              });
            } catch (sendErr) {
              // Ignore secondary errors
            }
          }
          return;
        }

        // Handle /fork command
        if (isForkCommand(payload.content)) {
          if (!sessionManager || !payload.contextId) {
            try {
              await sendMessage({
                content: 'Session manager is not available.',
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

          try {
            const session = sessionManager.getOrCreate(payload.contextId);
            const branch = session.sessionManager.getBranch();

            // Filter for user messages to fork from
            const userEntries = branch.filter(entry =>
              entry.type === 'message' &&
              entry.message &&
              entry.message.role === 'user'
            );

            if (userEntries.length === 0) {
              await sendMessage({
                content: 'No user messages found to fork from.',
                channelId: payload.channelId,
                threadId: payload.threadId,
                contextId: payload.contextId,
                messageId: payload.messageId,
                authorId: payload.authorId,
              });
              return;
            }

            // Create select menu options from user messages
            const options = userEntries.slice(-25).reverse().map((entry, index) => {
              const msg = entry.message;
              // Extract text without time injection prefix
              let text = msg.content || 'No content';
              if (Array.isArray(text)) {
                text = extractTextFromBlocks(text) || 'No text content';
              }
              text = text.replace(/<Current Time:.*?>[\r\n]*/, '').trim();

              const truncatedText = text.length > 80 ? text.slice(0, 80) + '...' : text;
              const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date(msg.timestamp);
              const timeLabel = formatTimeAgo(timestamp);

              return {
                label: `Message ${userEntries.length - index}: ${truncatedText}`.slice(0, 100),
                description: `Sent ${timeLabel}`.slice(0, 100),
                value: entry.id,
              };
            });

            const selectMenu = new StringSelectMenuBuilder()
              .setCustomId('fork_session_select')
              .setPlaceholder('Select a message to fork from')
              .addOptions(options);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            await sendMessage({
              content: 'Select a message to fork the conversation from:',
              components: [row],
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
            try {
              await sendMessage({
                content: `Failed to list messages for forking: ${err.message}`,
                channelId: payload.channelId,
                threadId: payload.threadId,
                contextId: payload.contextId,
                messageId: payload.messageId,
                authorId: payload.authorId,
              });
            } catch (sendErr) {
              // Ignore
            }
          }
          return;
        }

        // Create tools with per-message IPC context
        const extraEnv = {
          JEVONS_IPC_PORT: String(ipcPort),
        };

        if (authStorage) {
          const braveKey = await authStorage.getApiKey('brave');
          if (braveKey) extraEnv.BRAVE_API_KEY = braveKey;
        }

        if (payload.channelId && payload.channelId !== 'null') {
          extraEnv.JEVONS_CHANNEL_ID = payload.channelId;
        }
        if (payload.threadId && payload.threadId !== 'null') {
          extraEnv.JEVONS_THREAD_ID = payload.threadId;
        }
        const runtimeTools = [createBashTool(process.cwd(), extraEnv)];

        let stopTyping = () => { };
        try {
          stopTyping = startTypingLoop(payload.contextId);
          const reply = await generateReply(payload, resolvedModel, {
            sessionManager,
            skills: loadedSkills,
            tools: runtimeTools,
            Agent: _Agent,
            resolvePiAgentCore: _resolvePiAgentCore,
            authStorage,
          });

          if (reply) {
            await sendMessage({
              content: reply,
              channelId: payload.channelId,
              threadId: payload.threadId,
              contextId: payload.contextId,
              messageId: payload.messageId,
              authorId: payload.authorId,
            });
          }
        } catch (err) {
          if (typeof onError === 'function') {
            onError(err);
          }
        } finally {
          stopTyping();
        }
      })();
    },
  });

  return {
    start: bot.start,
    model: resolvedModel,
  };
}

export { getTextFromBlocks };
