const { EventEmitter } = require('events');

function isThreadChannel(channel) {
  return Boolean(channel && channel.isThread);
}

function extractContext(messageOrInteraction, rootChannelId) {
  const channel = messageOrInteraction.channel;
  if (!channel) {
    return null;
  }

  const guildName = messageOrInteraction.guild ? messageOrInteraction.guild.name : 'Unknown';

  if (channel.id === rootChannelId) {
    return {
      channelId: channel.id,
      threadId: null,
      contextId: channel.id,
      isThread: false,
      guildName,
    };
  }

  if (isThreadChannel(channel) && channel.parentId === rootChannelId) {
    return {
      channelId: rootChannelId,
      threadId: channel.id,
      contextId: channel.id,
      isThread: true,
      guildName,
    };
  }

  return null;
}

function createDiscordBot(options) {
  const {
    client,
    token,
    channelId,
    onMessage,
    onInteraction,
    onReady,
    onError,
  } = options || {};

  if (!client) {
    throw new Error('Discord client is required');
  }
  if (!token) {
    throw new Error('Discord token is required');
  }
  if (!channelId) {
    throw new Error('Discord channelId is required');
  }
  if (typeof onMessage !== 'function') {
    throw new Error('onMessage callback is required');
  }

  const emitter = client instanceof EventEmitter ? client : null;
  if (!emitter && typeof client.on !== 'function') {
    throw new Error('Discord client must support .on(event, handler)');
  }

  client.on('ready', () => {
    if (typeof onReady === 'function') {
      onReady();
    }
  });

  client.on('error', (err) => {
    if (typeof onError === 'function') {
      onError(err);
    }
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const context = extractContext(interaction, channelId);
    if (!context) {
      return;
    }

    if (typeof onInteraction === 'function') {
      onInteraction({
        commandName: interaction.commandName,
        options: interaction.options,
        authorId: interaction.user ? interaction.user.id : null,
        interaction,
        ...context,
      });
    }
  });

  client.on('messageCreate', (message) => {
    if (!message || !message.channel) {
      return;
    }
    if (message.author && message.author.bot) {
      return;
    }
    const context = extractContext(message, channelId);
    if (!context) {
      return;
    }
    onMessage({
      content: message.content || '',
      authorId: message.author ? message.author.id : null,
      messageId: message.id || null,
      referencedMessageId: message.reference && message.reference.messageId ? message.reference.messageId : null,
      ...context,
    });
  });

  async function start() {
    return client.login(token);
  }

  return {
    start,
  };
}

module.exports = {
  createDiscordBot,
  extractContext,
};
