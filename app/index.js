const { Client, GatewayIntentBits } = require('discord.js');
const { loadConfig } = require('./config');
const { createDiscordRuntime } = require('./runtime');
const { createSchedulerService } = require('../scheduler/service');
const { createIpcServer } = require('./ipc');
const logger = require('./logger');

function createDiscordClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
}

async function sendDiscordMessage(client, payload) {
  const { content, channelId, threadId } = payload;
  const targetId = threadId || channelId;
  const channel = await client.channels.fetch(targetId);
  if (!channel || typeof channel.send !== 'function') {
    throw new Error(`Unable to send message to channel ${targetId}`);
  }
  await channel.send(content);
}

async function startDiscordRuntime(deps = {}) {
  const _loadConfig = deps.loadConfig || loadConfig;
  const _createDiscordRuntime = deps.createDiscordRuntime || createDiscordRuntime;
  const _createSchedulerService = deps.createSchedulerService || createSchedulerService;
  const _createDiscordClient = deps.createDiscordClient || createDiscordClient;

  const config = _loadConfig();
  const modelConfig = config.model || {};
  const discordConfig = config.discord || {};
  const memoryConfig = config.memory || {};
  const remindersConfig = config.reminders || {};

  if (!discordConfig.token) {
    throw new Error('Discord token missing in config');
  }
  if (!discordConfig.channel_id) {
    throw new Error('Discord channel_id missing in config');
  }
  if (!modelConfig.provider || !modelConfig.model) {
    throw new Error('Model provider and model name must be configured');
  }

  const client = _createDiscordClient();
  const sendMessage = (payload) => sendDiscordMessage(client, payload);

  // Start IPC server
  const ipcServer = createIpcServer({ sendMessage, logger });
  const ipcPort = await ipcServer.start();
  logger.info(`IPC server listening on port ${ipcPort}`);

  const scheduler = _createSchedulerService({
    remindersFilePath: remindersConfig.file_path,
    stateFilePath: require('path').join(__dirname, '../data/scheduler_state.json'),
    sendMessage,
    channelId: discordConfig.channel_id,
    userId: remindersConfig.user_id,
    interval: 60000,
    onError: (err) => {
      logger.error('Scheduler error', err);
    },
    onLog: (msg) => {
      logger.info(msg, { source: 'scheduler' });
    },
  });

  const runtime = _createDiscordRuntime({
    client,
    token: discordConfig.token,
    channelId: discordConfig.channel_id,
    provider: modelConfig.provider,
    model: modelConfig.model,
    logsRoot: memoryConfig.logs_root,
    memoryIndexPath: memoryConfig.index_path,
    embeddingApiKey: process.env.GEMINI_API_KEY,
    embeddingModel: memoryConfig.embedding_model,
    skillsDir: require('path').join(__dirname, '../skills'),
    sendMessage,
    ipcPort,
    onReady: () => {
      logger.info('Discord runtime ready');
      if (remindersConfig.file_path) {
        scheduler.start();
      } else {
        logger.warn('Reminders file path not configured, scheduler disabled');
      }
    },
    onError: (err) => {
      logger.error('Discord runtime error', err);
    },
  });

  return runtime.start();
}

module.exports = {
  startDiscordRuntime,
};

if (require.main === module) {
  startDiscordRuntime().catch((err) => {
    logger.error('Failed to start Discord runtime', err);
    process.exitCode = 1;
  });
}
