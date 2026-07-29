import { createDiscordBot, sendDiscordMessage } from './discord.js';
import { StringSelectMenuBuilder, ActionRowBuilder } from 'discord.js';
import { DiscordSessionManager } from './sessionManager.js';
import { performCompaction } from './compaction.js';
import { loadSkill } from '../skills/loader.js';
import { createBashTool } from './tools/bash.js';
import { createProviderApiTool } from './tools/providerApi.js';
import { createDiscordSendTool } from './tools/discordSend.js';
import { readConfigFile, saveConfig } from './config.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_AGENT_DEBUG_INTERACTION_LIMIT = 3;
const THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);
const DEFAULT_THINKING_LEVEL = 'off';
const MAX_DISCORD_ERROR_LENGTH = 1500;


function normalizeAgentDebugInteractionLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_AGENT_DEBUG_INTERACTION_LIMIT;
  }
  return parsed;
}

function normalizeThinkingLevel(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return THINKING_LEVELS.has(normalized) ? normalized : null;
}

function formatThinkingLevel(value) {
  if (!value) {
    return DEFAULT_THINKING_LEVEL;
  }
  return value;
}

function formatDiscordError(error) {
  const rawMessage = error instanceof Error ? error.message : String(error ?? '');
  const message = rawMessage.trim() || 'Unknown error';
  const mentionSafeMessage = message.replaceAll('@', '@\u200b');
  const truncatedMessage = mentionSafeMessage.length > MAX_DISCORD_ERROR_LENGTH
    ? `${mentionSafeMessage.slice(0, MAX_DISCORD_ERROR_LENGTH - 3)}...`
    : mentionSafeMessage;
  return `Sorry, I couldn't process that message.\n\nError: ${truncatedMessage}`;
}

function parseAgentDebugInteractions(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return [];
  }

  const interactions = [];
  const interactionPattern = /--- INTERACTION START: [^\n]* ---\n([\s\S]*?)\n--- INTERACTION END ---/g;
  let match;
  while ((match = interactionPattern.exec(raw)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed && typeof parsed === 'object') {
        interactions.push(parsed);
      }
    } catch (err) {
      // Ignore malformed historical entries
    }
  }

  return interactions;
}

function formatAgentDebugInteractions(interactions) {
  if (!Array.isArray(interactions) || interactions.length === 0) {
    return '';
  }

  return interactions
    .map((entry) => {
      const timestamp = typeof entry.timestamp === 'string' && entry.timestamp.trim()
        ? entry.timestamp
        : new Date().toISOString();
      return `--- INTERACTION START: ${timestamp} ---\n${JSON.stringify(entry, null, 2)}\n--- INTERACTION END ---`;
    })
    .join('\n\n') + '\n';
}

async function resolvePiAi() {
  try {
    // Dynamic import for ESM module
    const module = await import('@earendil-works/pi-ai/compat');
    return module;
  } catch (err) {
    throw new Error('pi-ai is not installed; run npm install');
  }
}

async function resolvePiAgentCore() {
  try {
    return await import('@earendil-works/pi-agent-core');
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

function logAgentInteraction(agent, userContent, timestamp, options = {}) {
  const interactionLimit = normalizeAgentDebugInteractionLimit(options.maxInteractions);
  const debugLogPath = typeof options.debugLogPath === 'string' && options.debugLogPath.trim()
    ? options.debugLogPath
    : path.join(process.cwd(), 'logs', 'agent_debug.log');
  const logsDir = path.dirname(debugLogPath);

  try {
    fs.mkdirSync(logsDir, { recursive: true });

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

    const existingRaw = fs.existsSync(debugLogPath)
      ? fs.readFileSync(debugLogPath, 'utf8')
      : '';
    const existingEntries = parseAgentDebugInteractions(existingRaw);
    existingEntries.push(logEntry);

    const rolledEntries = existingEntries.slice(-interactionLimit);
    const logString = formatAgentDebugInteractions(rolledEntries);
    fs.writeFileSync(debugLogPath, logString, 'utf8');
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

function buildSystemPrompt(skills, workspaceFilesContent, workspaceFilesBaseDir) {
  let sections = [];

  if (skills && skills.length > 0) {
    const skillsContent = skills.map((skill) => skill.content).join('\n\n');
    sections.push(`You have access to the following skills:\n\n${skillsContent}\n\nUse the available tools to execute these skills when needed.`);
  }

  if (workspaceFilesContent) {
    const header = `- **Workspace Files (injected)**: AGENTS.md SOUL.md TOOLS.md IDENTITY.md USER.md ( all located in ${workspaceFilesBaseDir} and labelled with their full path and filename before their content )`;
    sections.push(`${header}\n${workspaceFilesContent}`);
  }

  sections.push(
    'Provider tool guidance:\n' +
    '- For image generation, use image-capable models/endpoints only.\n' +
    '- Call `provider_api` with `action: "request"` and explicit `params.url`.\n' +
    '- Prefer `params.responseType: "json"` for Gemini-style JSON responses with `inlineData` image parts.\n' +
    '- If `provider_api` returns `details.fullData.storage.path`, inspect that file with tools before making exact claims from large payloads.\n' +
    '- If the API response has no real image bytes, do not fabricate output; explain capability mismatch and ask user to enable an image-capable endpoint.'
  );

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

const MODEL_PROVIDER_SELECT_MENU_PREFIX = 'model_provider_select';
const MODEL_MODEL_SELECT_MENU_PREFIX = 'model_model_select';
const PROVIDERS_PER_PAGE = 23;
const MODELS_PER_PAGE = 22;
const MAX_RECENT_OPTIONS = 5;

function truncateForDiscord(value, max = 100) {
  const text = typeof value === 'string' ? value : '';
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function compareModelEntries(a, b) {
  if (!a || !b) {
    return 0;
  }
  const providerDiff = a.provider.localeCompare(b.provider);
  if (providerDiff !== 0) {
    return providerDiff;
  }
  return a.model.localeCompare(b.model);
}

function parseModelId(modelId) {
  if (typeof modelId !== 'string') {
    return null;
  }
  const firstSlash = modelId.indexOf('/');
  if (firstSlash <= 0 || firstSlash >= modelId.length - 1) {
    return null;
  }
  const provider = modelId.slice(0, firstSlash).trim();
  const model = modelId.slice(firstSlash + 1).trim();
  if (!provider || !model) {
    return null;
  }
  return { provider, model };
}

function toModelId(modelEntry) {
  if (!modelEntry || typeof modelEntry !== 'object') {
    return null;
  }
  if (typeof modelEntry.provider !== 'string' || typeof modelEntry.model !== 'string') {
    return null;
  }
  const provider = modelEntry.provider.trim();
  const model = modelEntry.model.trim();
  if (!provider || !model) {
    return null;
  }
  return `${provider}/${model}`;
}

function normalizeModels(models) {
  if (!Array.isArray(models)) {
    return [];
  }
  const normalized = [];
  const seen = new Set();
  for (const entry of models) {
    const id = toModelId(entry);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const firstSlash = id.indexOf('/');
    const provider = id.slice(0, firstSlash);
    const model = id.slice(firstSlash + 1);
    normalized.push({ provider, model });
  }
  normalized.sort(compareModelEntries);
  return normalized;
}

function normalizeRecentOptions(items, maxItems = MAX_RECENT_OPTIONS) {
  if (!Array.isArray(items)) {
    return [];
  }
  const normalized = [];
  const seen = new Set();
  for (const item of items) {
    if (typeof item !== 'string') {
      continue;
    }
    const value = item.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
    if (normalized.length >= maxItems) {
      break;
    }
  }
  return normalized;
}

function normalizeRecentModelsByProvider(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  const normalized = {};
  for (const [provider, models] of Object.entries(value)) {
    if (typeof provider !== 'string' || !provider.trim()) {
      continue;
    }
    const recentModels = normalizeRecentOptions(models);
    if (recentModels.length > 0) {
      normalized[provider.trim()] = recentModels;
    }
  }
  return normalized;
}

function prioritizeWithRecents(values, recentValues) {
  const uniqueValues = [];
  const seen = new Set();
  for (const raw of values || []) {
    if (typeof raw !== 'string') {
      continue;
    }
    const value = raw.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    uniqueValues.push(value);
  }

  uniqueValues.sort((a, b) => a.localeCompare(b));

  const recentList = normalizeRecentOptions(recentValues).filter((value) => seen.has(value));
  const recentSet = new Set(recentList);
  const remaining = uniqueValues.filter((value) => !recentSet.has(value));

  return [...recentList, ...remaining];
}

function getProviderIdsFromModelCatalog(modelEntries) {
  const providers = [];
  const seen = new Set();
  for (const entry of modelEntries || []) {
    if (!entry || typeof entry.provider !== 'string') {
      continue;
    }
    const provider = entry.provider.trim();
    if (!provider || seen.has(provider)) {
      continue;
    }
    seen.add(provider);
    providers.push(provider);
  }
  return providers;
}

function getModelsForProviderFromModelCatalog(modelEntries, provider) {
  const providerId = typeof provider === 'string' ? provider.trim() : '';
  if (!providerId) {
    return [];
  }

  const models = [];
  const seen = new Set();
  for (const entry of modelEntries || []) {
    if (!entry || entry.provider !== providerId || typeof entry.model !== 'string') {
      continue;
    }
    const model = entry.model.trim();
    if (!model || seen.has(model)) {
      continue;
    }
    seen.add(model);
    models.push(model);
  }
  return models;
}

function parseProviderSelectCustomId(customId) {
  if (typeof customId !== 'string' || !customId.startsWith(`${MODEL_PROVIDER_SELECT_MENU_PREFIX}:`)) {
    return null;
  }
  const raw = customId.slice(`${MODEL_PROVIDER_SELECT_MENU_PREFIX}:`.length);
  const page = Number.parseInt(raw, 10);
  return Number.isFinite(page) ? page : 0;
}

function parseProviderModelSelectCustomId(customId) {
  if (typeof customId !== 'string' || !customId.startsWith(`${MODEL_MODEL_SELECT_MENU_PREFIX}:`)) {
    return null;
  }
  const raw = customId.slice(`${MODEL_MODEL_SELECT_MENU_PREFIX}:`.length);
  const separatorIndex = raw.lastIndexOf(':');
  if (separatorIndex <= 0 || separatorIndex >= raw.length - 1) {
    return null;
  }
  const encodedProvider = raw.slice(0, separatorIndex);
  const pageRaw = raw.slice(separatorIndex + 1);
  const page = Number.parseInt(pageRaw, 10);
  if (!Number.isFinite(page)) {
    return null;
  }
  let provider;
  try {
    provider = decodeURIComponent(encodedProvider);
  } catch (_err) {
    return null;
  }
  if (!provider) {
    return null;
  }
  return { provider, page };
}

function createProviderMenuView(providers, activeModel, requestedPage = 0, contentPrefix = '') {
  const safeProviders = Array.isArray(providers) ? providers : [];
  if (safeProviders.length === 0) {
    const prefix = contentPrefix ? `${contentPrefix}\n` : '';
    return {
      content: `${prefix}No providers available from Pi model registry.`,
      components: [],
    };
  }

  const totalPages = Math.max(1, Math.ceil(safeProviders.length / PROVIDERS_PER_PAGE));
  const page = Math.max(0, Math.min(requestedPage, totalPages - 1));
  const start = page * PROVIDERS_PER_PAGE;
  const pageItems = safeProviders.slice(start, start + PROVIDERS_PER_PAGE);

  const options = pageItems.map((provider, offset) => {
    const absoluteIndex = start + offset;
    const isActive = typeof activeModel === 'string' && activeModel.startsWith(`${provider}/`);
    return {
      label: truncateForDiscord(isActive ? `${provider} (active)` : provider),
      description: isActive ? 'Contains active model' : 'Select provider',
      value: `provider:set:${absoluteIndex}`,
    };
  });

  if (totalPages > 1) {
    if (page > 0) {
      options.push({
        label: 'Previous page',
        description: `Page ${page} of ${totalPages}`,
        value: 'provider:nav:prev',
      });
    }
    if (page < totalPages - 1) {
      options.push({
        label: 'Next page',
        description: `Page ${page + 2} of ${totalPages}`,
        value: 'provider:nav:next',
      });
    }
  }

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`${MODEL_PROVIDER_SELECT_MENU_PREFIX}:${page}`)
    .setPlaceholder('Choose a provider')
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(selectMenu);
  const prefix = contentPrefix ? `${contentPrefix}\n` : '';

  return {
    content: `${prefix}Active model: \`${activeModel || 'None'}\`\nProviders: ${safeProviders.length} (page ${page + 1}/${totalPages})`,
    components: [row],
  };
}

function createProviderModelMenuView(provider, models, activeModel, requestedPage = 0, contentPrefix = '') {
  const safeProvider = typeof provider === 'string' ? provider.trim() : '';
  const safeModels = Array.isArray(models) ? models : [];
  if (!safeProvider) {
    return {
      content: 'Invalid provider selection.',
      components: [],
    };
  }

  const totalPages = Math.max(1, Math.ceil(Math.max(safeModels.length, 1) / MODELS_PER_PAGE));
  const page = Math.max(0, Math.min(requestedPage, totalPages - 1));
  const start = page * MODELS_PER_PAGE;
  const pageItems = safeModels.slice(start, start + MODELS_PER_PAGE);

  const options = pageItems.map((modelId, offset) => {
    const absoluteIndex = start + offset;
    const id = `${safeProvider}/${modelId}`;
    const isActive = id === activeModel;
    return {
      label: truncateForDiscord(isActive ? `${modelId} (active)` : modelId),
      description: isActive ? 'Currently active model' : truncateForDiscord(`Provider: ${safeProvider}`),
      value: `model:set:${absoluteIndex}`,
    };
  });

  if (totalPages > 1) {
    if (page > 0) {
      options.push({
        label: 'Previous page',
        description: `Page ${page} of ${totalPages}`,
        value: 'model:nav:prev',
      });
    }
    if (page < totalPages - 1) {
      options.push({
        label: 'Next page',
        description: `Page ${page + 2} of ${totalPages}`,
        value: 'model:nav:next',
      });
    }
  }

  options.push({
    label: 'Change provider',
    description: 'Return to provider list',
    value: 'model:back',
  });

  const encodedProvider = encodeURIComponent(safeProvider);
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(`${MODEL_MODEL_SELECT_MENU_PREFIX}:${encodedProvider}:${page}`)
    .setPlaceholder(truncateForDiscord(`Choose model for ${safeProvider}`, 100))
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(selectMenu);
  const prefix = contentPrefix ? `${contentPrefix}\n` : '';
  const body = safeModels.length === 0
    ? `Provider: \`${safeProvider}\`\nNo models available for this provider.`
    : `Provider: \`${safeProvider}\`\nModels: ${safeModels.length} (page ${page + 1}/${totalPages})`;

  return {
    content: `${prefix}Active model: \`${activeModel || 'None'}\`\n${body}`,
    components: [row],
  };
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

  const usesInjectedAgent = typeof options.Agent === 'function';
  const { Agent: AgentClass } = usesInjectedAgent
    ? { Agent: options.Agent }
    : await (options.resolvePiAgentCore || resolvePiAgentCore)();
  let streamFn = options.streamFn;
  if (typeof streamFn !== 'function' && !usesInjectedAgent) {
    const piAi = await (options.resolvePiAi || resolvePiAi)();
    streamFn = piAi.streamSimple;
  }
  if (typeof streamFn !== 'function' && !usesInjectedAgent) {
    throw new Error('pi-ai does not export streamSimple; check that the pi package versions match.');
  }

  // Get session context for this Discord context
  let sessionContext = { messages: [] };
  if (options.sessionManager && payload.contextId) {
    const session = options.sessionManager.getOrCreate(payload.contextId);
    sessionContext = session.sessionManager.buildSessionContext();
  }

  const workspaceFileNames = ['AGENTS.md', 'SOUL.md', 'TOOLS.md', 'IDENTITY.md', 'USER.md'];
  const workspaceFilesBaseDir = path.join(process.cwd(), 'identity');
  const workspaceFilesContent = readWorkspaceFiles(workspaceFileNames, workspaceFilesBaseDir);
  const systemPrompt = buildSystemPrompt(options.skills, workspaceFilesContent, workspaceFilesBaseDir);
  const historyMessages = normalizeHistoryMessages(sessionContext.messages || [], modelInstance);

  const initialState = {
    systemPrompt,
    model: modelInstance,
    tools: Array.isArray(options.tools) ? options.tools : [],
    messages: historyMessages,
  };
  if (options.thinkingLevel !== undefined && options.thinkingLevel !== null) {
    initialState.thinkingLevel = options.thinkingLevel;
  }

  const agent = new AgentClass({
    initialState,
    ...(typeof streamFn === 'function' ? { streamFn } : {}),
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

  logAgentInteraction(agent, content, Date.now(), {
    maxInteractions: options.agentDebugInteractionLimit,
    debugLogPath: options.agentDebugLogPath,
  });

  // Get the absolute latest message from the agent's state
  const latestMessage = agent.state.messages[agent.state.messages.length - 1];

  if (!latestMessage || latestMessage.role !== 'assistant') {
    return {
      content: '...',
      files: collectReplyFiles(options.artifacts),
    };
  }

  // Handle API Errors directly from the message record
  if (latestMessage.stopReason === 'error' || latestMessage.errorMessage) {
    const errorMsg = latestMessage.errorMessage || 'API error: request failed';
    return {
      content: `API error: ${errorMsg}`,
      files: collectReplyFiles(options.artifacts),
    };
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
      const files = collectReplyFiles(options.artifacts);
      return {
        content: files.length > 0 ? `Action completed. Attached ${files.length} file(s).` : 'Action completed.',
        files,
      };
    }
    return {
      content: '...',
      files: collectReplyFiles(options.artifacts),
    };
  }
  return {
    content: reply,
    files: collectReplyFiles(options.artifacts),
  };
}

function collectReplyFiles(artifacts) {
  if (!Array.isArray(artifacts)) {
    return [];
  }
  const files = [];
  for (const artifact of artifacts) {
    if (!artifact || artifact.kind !== 'file') {
      continue;
    }
    if (artifact.attachment === undefined || artifact.attachment === null) {
      continue;
    }
    files.push({
      attachment: artifact.attachment,
      name: typeof artifact.name === 'string' && artifact.name.trim() ? artifact.name.trim() : 'attachment.bin',
    });
  }
  return files;
}

export async function createDiscordRuntime(options) {
  const {
    client,
    token,
    channelId,
    applicationId,
    activeModel,
    providers,
    modelInstance,
    getModel: getModelOverride,
    sendMessage,
    onReady,
    onError,
    sessionDir,
    skillsDir,
    ipcPort,
    configPath,
    thinkingLevel,
    agentDebugInteractionLimit: configuredAgentDebugInteractionLimit,
    agentDebugLogPath,
    deps = {},
    authStorage,
  } = options || {};

  const _Agent = deps.Agent;
  const _resolvePiAi = deps.resolvePiAi || resolvePiAi;
  const _resolvePiAgentCore = deps.resolvePiAgentCore || resolvePiAgentCore;
  const agentDebugInteractionLimit = normalizeAgentDebugInteractionLimit(configuredAgentDebugInteractionLimit);

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

  const effectiveConfigPath = configPath || path.join(process.cwd(), 'config', 'config.json');
  let runtimeActiveModel = typeof activeModel === 'string' ? activeModel : null;
  let runtimeModels = [];
  if (runtimeActiveModel) {
    const parsedActiveModel = parseModelId(runtimeActiveModel);
    if (parsedActiveModel) runtimeModels = [parsedActiveModel];
  }
  let resolvedModel = modelInstance;
  let runtimeThinkingLevel = normalizeThinkingLevel(thinkingLevel);
  if (!runtimeThinkingLevel && typeof thinkingLevel === 'string' && thinkingLevel.trim()) {
    console.warn('Invalid thinking level "' + thinkingLevel + '"; defaulting to "' + DEFAULT_THINKING_LEVEL + '".');
  }

  function loadModelPickerRecents() {
    const diskConfig = readConfigFile(effectiveConfigPath);
    const modelPicker = diskConfig?.modelPicker;
    return {
      recentProviders: normalizeRecentOptions(modelPicker?.recentProviders),
      recentModelsByProvider: normalizeRecentModelsByProvider(modelPicker?.recentModelsByProvider),
    };
  }

  let modelPickerRecents = loadModelPickerRecents();

  function getOrderedProviders() {
    const providersFromCatalog = getProviderIdsFromModelCatalog(runtimeModels);
    return prioritizeWithRecents(providersFromCatalog, modelPickerRecents.recentProviders);
  }

  function getOrderedModelsForProvider(provider) {
    const modelsFromCatalog = getModelsForProviderFromModelCatalog(runtimeModels, provider);
    const recentModels = modelPickerRecents.recentModelsByProvider?.[provider] || [];
    return prioritizeWithRecents(modelsFromCatalog, recentModels);
  }

  function markRecentProvider(provider) {
    const providerId = typeof provider === 'string' ? provider.trim() : '';
    if (!providerId) {
      return;
    }
    modelPickerRecents = {
      ...modelPickerRecents,
      recentProviders: normalizeRecentOptions([providerId, ...modelPickerRecents.recentProviders]),
    };
  }

  function markRecentModel(provider, modelId) {
    const providerId = typeof provider === 'string' ? provider.trim() : '';
    const model = typeof modelId === 'string' ? modelId.trim() : '';
    if (!providerId || !model) {
      return;
    }
    const providerRecentModels = modelPickerRecents.recentModelsByProvider?.[providerId] || [];
    modelPickerRecents = {
      ...modelPickerRecents,
      recentModelsByProvider: {
        ...modelPickerRecents.recentModelsByProvider,
        [providerId]: normalizeRecentOptions([model, ...providerRecentModels]),
      },
    };
  }

  async function persistModelPickerRecents() {
    const diskConfig = readConfigFile(effectiveConfigPath);
    diskConfig.modelPicker = {
      recentProviders: normalizeRecentOptions(modelPickerRecents.recentProviders),
      recentModelsByProvider: normalizeRecentModelsByProvider(modelPickerRecents.recentModelsByProvider),
    };
    saveConfig(diskConfig, { configPath: effectiveConfigPath });
  }

  async function resolveModelById(modelId) {
    if (typeof modelId !== 'string' || !modelId.includes('/')) {
      return null;
    }
    const firstSlash = modelId.indexOf('/');
    const provider = modelId.slice(0, firstSlash);
    const modelName = modelId.slice(firstSlash + 1);
    if (!provider || !modelName) {
      return null;
    }
    const piAi = await _resolvePiAi();
    const getModelFn = getModelOverride || piAi.getModel;
    return getModelFn(provider, modelName, providers) || null;
  }

  async function refreshRuntimeModelsFromPi() {
    const piAi = await _resolvePiAi();
    if (typeof piAi.getProviders !== 'function' || typeof piAi.getModels !== 'function') {
      return runtimeModels;
    }

    const catalog = [];
    const seen = new Set();
    const providerIds = piAi.getProviders();
    if (!Array.isArray(providerIds)) {
      return runtimeModels;
    }
    for (const providerEntry of providerIds) {
      if (typeof providerEntry !== 'string' || !providerEntry.trim()) {
        continue;
      }
      const provider = providerEntry.trim();
      let modelsForProvider = [];
      try {
        modelsForProvider = piAi.getModels(provider);
      } catch (_err) {
        continue;
      }
      if (!Array.isArray(modelsForProvider)) {
        continue;
      }
      for (const modelEntry of modelsForProvider) {
        const modelId = typeof modelEntry === 'string'
          ? modelEntry.trim()
          : typeof modelEntry?.id === 'string'
            ? modelEntry.id.trim()
            : '';
        const modelProvider = typeof modelEntry?.provider === 'string' && modelEntry.provider.trim()
          ? modelEntry.provider.trim()
          : provider;
        if (!modelId || !modelProvider) {
          continue;
        }
        const key = `${modelProvider}/${modelId}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        catalog.push({ provider: modelProvider, model: modelId });
      }
    }

    if (catalog.length > 0) {
      runtimeModels = normalizeModels(catalog);
    }

    if (runtimeActiveModel && !runtimeModels.some((entry) => toModelId(entry) === runtimeActiveModel)) {
      const parsedActiveModel = parseModelId(runtimeActiveModel);
      if (parsedActiveModel) {
        runtimeModels = normalizeModels([...runtimeModels, parsedActiveModel]);
      }
    }

    return runtimeModels;
  }

  async function getUnknownModelMessage(modelId) {
    const parsed = parseModelId(modelId);
    if (!parsed) {
      return `Model "${modelId}" must be in provider/model format.`;
    }

    const piAi = await _resolvePiAi();
    const getModelsFn = piAi.getModels;
    const available = typeof getModelsFn === 'function' ? getModelsFn(parsed.provider) : [];
    const names = available
      .map((entry) => (typeof entry === 'string' ? entry : entry?.id))
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim());
    const preview = names.slice(0, 10).join(', ');
    const suffix = names.length > 10 ? '…' : '';
    const availableText = preview ? `${preview}${suffix}` : '(none reported by Pi)';
    return `Unknown model "${parsed.model}" for provider "${parsed.provider}". Available: ${availableText}`;
  }

  async function persistActiveModel(nextActiveModel) {
    const diskConfig = readConfigFile(effectiveConfigPath);
    diskConfig.activeModel = nextActiveModel;
    saveConfig(diskConfig, { configPath: effectiveConfigPath });
  }

  async function persistThinkingLevel(nextThinkingLevel) {
    const diskConfig = readConfigFile(effectiveConfigPath);
    diskConfig.thinkingLevel = nextThinkingLevel || DEFAULT_THINKING_LEVEL;
    saveConfig(diskConfig, { configPath: effectiveConfigPath });
  }

  async function switchActiveModel(nextModelId) {
    await persistActiveModel(nextModelId);
    runtimeActiveModel = nextModelId;

    try {
      const model = await resolveModelById(nextModelId);
      if (model) {
        resolvedModel = model;
        return { switchedInRuntime: true };
      }
      return { switchedInRuntime: false, warning: 'Model selection was saved, but runtime could not resolve it immediately.' };
    } catch (err) {
      return { switchedInRuntime: false, warning: `Model selection was saved, but runtime switch failed: ${err.message}` };
    }
  }

  try {
    await refreshRuntimeModelsFromPi();
  } catch (_err) {
    // Keep runtime model list as-is if Pi catalog lookup is unavailable.
  }

  if (!resolvedModel) {
    let targetModelId = runtimeActiveModel;
    if (!targetModelId || !targetModelId.includes('/')) {
      throw new Error('No active model configuration found or activeModel format is invalid. Please check config.json.');
    }

    const model = await resolveModelById(targetModelId);
    if (!model) {
      const unknownModelMessage = await getUnknownModelMessage(targetModelId);
      throw new Error(unknownModelMessage);
    }
    resolvedModel = model;
  }

  if (!runtimeActiveModel && resolvedModel && resolvedModel.provider && resolvedModel.id) {
    runtimeActiveModel = `${resolvedModel.provider}/${resolvedModel.id}`;
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

  async function reportMessageError(payload, error) {
    if (typeof onError === 'function') {
      try {
        onError(error);
      } catch (_onErrorErr) {
        // Error logging must not prevent the Discord response below.
      }
    }
    try {
      await sendMessage({
        content: formatDiscordError(error),
        channelId: payload.channelId,
        threadId: payload.threadId,
        contextId: payload.contextId,
        messageId: payload.messageId,
        authorId: payload.authorId,
      });
    } catch (sendErr) {
      if (typeof onError === 'function') {
        try {
          const message = sendErr instanceof Error ? sendErr.message : String(sendErr);
          onError(new Error(`Failed to send Discord error response: ${message}`));
        } catch (_onErrorErr) {
          // There is no remaining delivery channel for this error.
        }
      }
    }
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

        if (payload.commandName === 'thinking') {
          try {
            const levelInput = payload.interaction.options?.getString('level');
            if (!levelInput) {
              const currentLevel = formatThinkingLevel(runtimeThinkingLevel);
              await payload.interaction.reply({
                content: 'Current thinking level is `' + currentLevel + '`.',
                ephemeral: true,
              });
              return;
            }

            const normalizedLevel = normalizeThinkingLevel(levelInput);
            if (!normalizedLevel) {
              await payload.interaction.reply({
                content: 'Unknown thinking level `' + levelInput + '`. Allowed: off, minimal, low, medium, high, xhigh.',
                ephemeral: true,
              });
              return;
            }

            runtimeThinkingLevel = normalizedLevel;
            await persistThinkingLevel(runtimeThinkingLevel);
            await payload.interaction.reply({
              content: 'Thinking level set to `' + runtimeThinkingLevel + '`.',
              ephemeral: true,
            });
          } catch (err) {
            if (typeof onError === 'function') {
              onError(err);
            }
            try {
              await payload.interaction.reply({
                content: 'Failed to update thinking level: ' + err.message,
                ephemeral: true,
              });
            } catch (_replyErr) {
              // Ignore secondary errors
            }
          }
          return;
        }

        if (payload.commandName === 'model') {
          try {
            try {
              await refreshRuntimeModelsFromPi();
            } catch (_err) {
              // Keep last known runtime models if Pi catalog lookup fails.
            }

            const providers = getOrderedProviders();
            const activeProvider = parseModelId(runtimeActiveModel)?.provider || '';
            const activeProviderIndex = activeProvider ? providers.indexOf(activeProvider) : -1;
            const initialPage = activeProviderIndex >= 0 ? Math.floor(activeProviderIndex / PROVIDERS_PER_PAGE) : 0;

            const view = createProviderMenuView(providers, runtimeActiveModel, initialPage);
            await payload.interaction.reply({
              ...view,
              ephemeral: true,
            });
          } catch (err) {
            if (typeof onError === 'function') {
              onError(err);
            }
            try {
              await payload.interaction.reply({
                content: `Failed to manage models: ${err.message}`,
                ephemeral: true,
              });
            } catch (_replyErr) {
              // Ignore secondary errors
            }
          }
          return;
        }

        if (
          payload.isSelectMenu &&
          typeof payload.customId === 'string' &&
          payload.customId.startsWith(`${MODEL_PROVIDER_SELECT_MENU_PREFIX}:`)
        ) {
          try {
            try {
              await refreshRuntimeModelsFromPi();
            } catch (_err) {
              // Keep last known runtime models if Pi catalog lookup fails.
            }

            const currentPage = parseProviderSelectCustomId(payload.customId) || 0;
            const selectedValue = payload.values && payload.values[0] ? payload.values[0] : '';
            const providers = getOrderedProviders();

            if (selectedValue === 'provider:nav:prev' || selectedValue === 'provider:nav:next') {
              const nextPage = selectedValue === 'provider:nav:next' ? currentPage + 1 : currentPage - 1;
              const view = createProviderMenuView(providers, runtimeActiveModel, nextPage);
              await payload.interaction.update(view);
              return;
            }

            if (!selectedValue.startsWith('provider:set:')) {
              const view = createProviderMenuView(providers, runtimeActiveModel, currentPage, 'Unknown selection.');
              await payload.interaction.update(view);
              return;
            }

            const selectedIndex = Number.parseInt(selectedValue.slice('provider:set:'.length), 10);
            if (!Number.isFinite(selectedIndex) || selectedIndex < 0 || selectedIndex >= providers.length) {
              const view = createProviderMenuView(providers, runtimeActiveModel, currentPage, 'Selected provider is no longer available.');
              await payload.interaction.update(view);
              return;
            }

            const provider = providers[selectedIndex];
            if (!provider) {
              const view = createProviderMenuView(providers, runtimeActiveModel, currentPage, 'Selected provider entry is invalid.');
              await payload.interaction.update(view);
              return;
            }

            markRecentProvider(provider);
            await persistModelPickerRecents();

            const modelsForProvider = getOrderedModelsForProvider(provider);
            const activeModelIndex = modelsForProvider.findIndex((modelId) => `${provider}/${modelId}` === runtimeActiveModel);
            const modelPage = activeModelIndex >= 0 ? Math.floor(activeModelIndex / MODELS_PER_PAGE) : 0;
            const view = createProviderModelMenuView(provider, modelsForProvider, runtimeActiveModel, modelPage);
            await payload.interaction.update(view);
          } catch (err) {
            if (typeof onError === 'function') {
              onError(err);
            }
            try {
              await payload.interaction.reply({
                content: `Failed to select provider: ${err.message}`,
                ephemeral: true,
              });
            } catch (_replyErr) {
              // Ignore
            }
          }
          return;
        }

        if (
          payload.isSelectMenu &&
          typeof payload.customId === 'string' &&
          payload.customId.startsWith(`${MODEL_MODEL_SELECT_MENU_PREFIX}:`)
        ) {
          try {
            try {
              await refreshRuntimeModelsFromPi();
            } catch (_err) {
              // Keep last known runtime models if Pi catalog lookup fails.
            }

            const parsedCustomId = parseProviderModelSelectCustomId(payload.customId);
            if (!parsedCustomId) {
              await payload.interaction.reply({
                content: 'Unable to parse model selection state. Run `/model` again.',
                ephemeral: true,
              });
              return;
            }

            const { provider, page: currentPage } = parsedCustomId;
            const selectedValue = payload.values && payload.values[0] ? payload.values[0] : '';
            const modelsForProvider = getOrderedModelsForProvider(provider);

            if (selectedValue === 'model:back') {
              const providers = getOrderedProviders();
              const providerIndex = providers.indexOf(provider);
              const providerPage = providerIndex >= 0 ? Math.floor(providerIndex / PROVIDERS_PER_PAGE) : 0;
              const view = createProviderMenuView(providers, runtimeActiveModel, providerPage);
              await payload.interaction.update(view);
              return;
            }

            if (selectedValue === 'model:nav:prev' || selectedValue === 'model:nav:next') {
              const nextPage = selectedValue === 'model:nav:next' ? currentPage + 1 : currentPage - 1;
              const view = createProviderModelMenuView(provider, modelsForProvider, runtimeActiveModel, nextPage);
              await payload.interaction.update(view);
              return;
            }

            if (!selectedValue.startsWith('model:set:')) {
              const view = createProviderModelMenuView(provider, modelsForProvider, runtimeActiveModel, currentPage, 'Unknown selection.');
              await payload.interaction.update(view);
              return;
            }

            const selectedIndex = Number.parseInt(selectedValue.slice('model:set:'.length), 10);
            if (!Number.isFinite(selectedIndex) || selectedIndex < 0 || selectedIndex >= modelsForProvider.length) {
              const view = createProviderModelMenuView(provider, modelsForProvider, runtimeActiveModel, currentPage, 'Selected model is no longer available.');
              await payload.interaction.update(view);
              return;
            }

            const modelId = modelsForProvider[selectedIndex];
            if (!modelId) {
              const view = createProviderModelMenuView(provider, modelsForProvider, runtimeActiveModel, currentPage, 'Selected model entry is invalid.');
              await payload.interaction.update(view);
              return;
            }

            const selectedModelId = `${provider}/${modelId}`;
            const switchResult = await switchActiveModel(selectedModelId);
            markRecentProvider(provider);
            markRecentModel(provider, modelId);
            await persistModelPickerRecents();

            const reorderedModels = getOrderedModelsForProvider(provider);
            const reorderedIndex = reorderedModels.indexOf(modelId);
            const page = reorderedIndex >= 0 ? Math.floor(reorderedIndex / MODELS_PER_PAGE) : 0;
            const warning = switchResult.warning ? `\n${switchResult.warning}` : '';
            const view = createProviderModelMenuView(
              provider,
              reorderedModels,
              runtimeActiveModel,
              page,
              `Switched active model to \`${selectedModelId}\`.${warning}`
            );
            await payload.interaction.update(view);
          } catch (err) {
            if (typeof onError === 'function') {
              onError(err);
            }
            try {
              await payload.interaction.reply({
                content: `Failed to switch model: ${err.message}`,
                ephemeral: true,
              });
            } catch (_replyErr) {
              // Ignore
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
        const pendingArtifacts = [];
        const allowedProviders = new Set();
        for (const entry of runtimeModels) {
          if (entry && typeof entry.provider === 'string' && entry.provider.trim()) {
            allowedProviders.add(entry.provider.trim());
          }
        }

        const runtimeTools = [createBashTool(process.cwd(), extraEnv)];
        runtimeTools.push(
          createDiscordSendTool({
            sendMessage,
            context: {
              channelId: payload.channelId,
              threadId: payload.threadId,
              contextId: payload.contextId,
              messageId: payload.messageId,
              authorId: payload.authorId,
            },
          })
        );
        if (authStorage) {
          runtimeTools.push(createProviderApiTool({
            authStorage,
            allowedProviders: [...allowedProviders],
            onArtifact: (artifact) => {
              pendingArtifacts.push(artifact);
            },
          }));
        }

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
            artifacts: pendingArtifacts,
            agentDebugInteractionLimit,
            agentDebugLogPath,
            thinkingLevel: runtimeThinkingLevel,
          });

          if (reply && (typeof reply.content === 'string' || (Array.isArray(reply.files) && reply.files.length > 0))) {
            await sendMessage({
              content: typeof reply.content === 'string' ? reply.content : '',
              files: Array.isArray(reply.files) ? reply.files : [],
              channelId: payload.channelId,
              threadId: payload.threadId,
              contextId: payload.contextId,
              messageId: payload.messageId,
              authorId: payload.authorId,
            });
          }
        } catch (err) {
          await reportMessageError(payload, err);
        } finally {
          stopTyping();
        }
      })().catch((err) => reportMessageError(payload, err));
    },
  });

  return {
    start: bot.start,
    model: resolvedModel,
  };
}

export { getTextFromBlocks };
