const { Client, GatewayIntentBits } = require('discord.js');
const { loadConfig } = require('./config');
const { createDiscordRuntime } = require('./runtime');
const { createSchedulerService } = require('../scheduler/service');

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

function startDiscordRuntime() {
  const config = loadConfig();
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

  const client = createDiscordClient();
  const sendMessage = (payload) => sendDiscordMessage(client, payload);

  const scheduler = createSchedulerService({
    remindersFilePath: remindersConfig.file_path,
    sendMessage,
    channelId: discordConfig.channel_id,
    interval: 60000,
    onError: (err) => {
      // eslint-disable-next-line no-console
      console.error('Scheduler error', err);
    },
    onLog: (msg) => {
      // eslint-disable-next-line no-console
      console.log(msg);
    },
  });

  const runtime = createDiscordRuntime({
    client,
    token: discordConfig.token,
    channelId: discordConfig.channel_id,
    provider: modelConfig.provider,
    model: modelConfig.model,
    logsRoot: memoryConfig.logs_root,
    memoryIndexPath: memoryConfig.index_path,
    embeddingApiKey: process.env.GEMINI_API_KEY,
    embeddingModel: memoryConfig.embedding_model,
    sendMessage,
    onReady: () => {
      // eslint-disable-next-line no-console
      console.log('Discord runtime ready');
      if (remindersConfig.file_path) {
        scheduler.start();
      } else {
        // eslint-disable-next-line no-console
        console.warn('Reminders file path not configured, scheduler disabled');
      }
    },
    onError: (err) => {
      // eslint-disable-next-line no-console
      console.error('Discord runtime error', err);
    },
  });

  return runtime.start();
}

module.exports = {
  startDiscordRuntime,
};

if (require.main === module) {
  startDiscordRuntime().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to start Discord runtime', err);
    process.exitCode = 1;
  });
}
