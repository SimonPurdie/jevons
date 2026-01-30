const { Client, GatewayIntentBits } = require('discord.js');
const { loadConfig } = require('./config');
const { createDiscordRuntime } = require('./runtime');

function buildProviderOptions(modelConfig) {
  const options = { ...(modelConfig.options || {}) };
  if (modelConfig.api_key && options.apiKey === undefined) {
    options.apiKey = modelConfig.api_key;
  }
  return options;
}

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

  const runtime = createDiscordRuntime({
    client,
    token: discordConfig.token,
    channelId: discordConfig.channel_id,
    provider: modelConfig.provider,
    model: modelConfig.model,
    providerOptions: buildProviderOptions(modelConfig),
    sendMessage: (payload) => sendDiscordMessage(client, payload),
    onReady: () => {
      // eslint-disable-next-line no-console
      console.log('Discord runtime ready');
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
  buildProviderOptions,
};

if (require.main === module) {
  startDiscordRuntime().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Failed to start Discord runtime', err);
    process.exitCode = 1;
  });
}
