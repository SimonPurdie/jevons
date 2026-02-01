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
    // Only respond to Default (0), Reply (19), and ThreadStarterMessage (21)
    const allowedTypes = [0, 19, 21];
    if (!allowedTypes.includes(message.type)) {
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

function sendDiscordMessage(client, payload) {
  const { content, channelId, threadId } = payload;
  let targetId = (threadId && threadId !== 'null') ? threadId : channelId;

  if (targetId === 'null') targetId = null;

  if (!targetId) {
    return Promise.reject(new Error('Unable to send message: No valid channelId or threadId provided'));
  }

  const chunks = splitMessage(content);

  return client.channels.fetch(targetId).then(async (channel) => {
    if (!channel || typeof channel.send !== 'function') {
      throw new Error(`Unable to send message to channel ${targetId}`);
    }
    const results = [];
    for (const chunk of chunks) {
      results.push(await channel.send(chunk));
    }
    return results.length === 1 ? results[0] : results;
  });
}

function splitMessage(text, maxLength = 2000) {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks = [];
  let current = text;

  while (current.length > 0) {
    if (current.length <= maxLength) {
      chunks.push(current);
      break;
    }

    let splitIndex = current.lastIndexOf('\n', maxLength);
    if (splitIndex === -1 || splitIndex === 0) {
      splitIndex = current.lastIndexOf(' ', maxLength);
    }
    if (splitIndex === -1 || splitIndex === 0) {
      splitIndex = maxLength;
    }

    chunks.push(current.substring(0, splitIndex).trim());
    current = current.substring(splitIndex).trim();
  }

  return chunks;
}

module.exports = {
  createDiscordBot,
  extractContext,
  sendDiscordMessage,
  splitMessage,
};
