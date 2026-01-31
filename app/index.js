const { Client, GatewayIntentBits } = require('discord.js');
const { loadConfig } = require('./config');
const { createDiscordRuntime } = require('./runtime');
const { createSchedulerService } = require('../scheduler/service');
const { createIpcServer } = require('./ipc');
const logger = require('./logger');
const { getDefaultHistoryRoot } = require('../history/logs/logWriter');
const { AuthStorage } = require('./auth');
const path = require('path');

function createDiscordClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });
}

function sendDiscordMessage(client, payload) {
  const { content, channelId, threadId } = payload;
  let targetId = (threadId && threadId !== 'null') ? threadId : channelId;

  if (targetId === 'null') targetId = null;

  if (!targetId) {
    return Promise.reject(new Error('Unable to sending message: No valid channelId or threadId provided'));
  }

  return client.channels.fetch(targetId).then(channel => {
    if (!channel || typeof channel.send !== 'function') {
      throw new Error(`Unable to send message to channel ${targetId}`);
    }
    return channel.send(content);
  });
}

async function startDiscordRuntime(deps = {}) {
  const _loadConfig = deps.loadConfig || loadConfig;
  const _createDiscordRuntime = deps.createDiscordRuntime || createDiscordRuntime;
  const _createSchedulerService = deps.createSchedulerService || createSchedulerService;
  const _createDiscordClient = deps.createDiscordClient || createDiscordClient;

  // Initialize AuthStorage
  const authStorage = new AuthStorage(path.join(process.cwd(), 'config', 'auth.json'));

  const config = _loadConfig();
  const discordConfig = config.discord || {};
  const historyConfig = config.history || {};
  const remindersConfig = config.reminders || {};

  const token = process.env.JEVONS_DISCORD_TOKEN || discordConfig.token;
  if (!token) {
    throw new Error('Discord token missing in config (set JEVONS_DISCORD_TOKEN env var)');
  }
  if (!discordConfig.channel_id) {
    throw new Error('Discord channel_id missing in config');
  }

  if (!config.activeModel && (!config.models || Object.keys(config.models).length === 0)) {
    throw new Error('Configuration error: "activeModel" and "models" must be defined in config.json.');
  }

  const client = _createDiscordClient();
  const sendMessage = (payload) => sendDiscordMessage(client, payload);

  // Start IPC server
  const ipcServer = createIpcServer({ sendMessage, logger });
  const ipcPort = await ipcServer.start();
  logger.info(`IPC server listening on port ${ipcPort}`);

  const scheduler = _createSchedulerService({
    remindersFilePath: remindersConfig.file_path,
    stateFilePath: path.join(__dirname, '../logs/scheduler_state.json'),
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
    token: token,
    channelId: discordConfig.channel_id,
    activeModel: config.activeModel,
    models: config.models,
    authStorage,
    skillsDir: path.join(__dirname, '../skills'),
    sendMessage,
    ipcPort,
    historyRoot: historyConfig.root || getDefaultHistoryRoot(),
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

  await runtime.start();

  return {
    stop: async () => {
      await ipcServer.stop();
      scheduler.stop();
    },
  };
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
