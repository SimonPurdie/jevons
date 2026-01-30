const { createDiscordBot } = require('./discord');
const { createModelClient } = require('./model');

function extractReplyContent(response) {
  if (!response) {
    return null;
  }
  if (typeof response === 'string') {
    return response;
  }
  if (typeof response.text === 'string') {
    return response.text;
  }
  if (response.message && typeof response.message.content === 'string') {
    return response.message.content;
  }
  if (Array.isArray(response.choices)) {
    for (const choice of response.choices) {
      if (choice && choice.message && typeof choice.message.content === 'string') {
        return choice.message.content;
      }
      if (choice && typeof choice.text === 'string') {
        return choice.text;
      }
    }
  }
  return null;
}

async function handleDiscordMessage(payload, modelClient, sendMessage) {
  if (!payload || typeof payload.content !== 'string') {
    return;
  }
  const trimmed = payload.content.trim();
  if (!trimmed) {
    return;
  }

  const response = await modelClient.generateChatCompletion({
    messages: [{ role: 'user', content: trimmed }],
  });
  const reply = extractReplyContent(response);
  if (!reply || !reply.trim()) {
    throw new Error('Model response missing content');
  }
  await sendMessage({
    content: reply,
    channelId: payload.channelId,
    threadId: payload.threadId,
    contextId: payload.contextId,
    messageId: payload.messageId,
    authorId: payload.authorId,
  });
}

function createDiscordRuntime(options) {
  const {
    client,
    token,
    channelId,
    provider,
    model,
    providers,
    providerOptions,
    modelClient,
    sendMessage,
    onReady,
    onError,
  } = options || {};

  if (typeof sendMessage !== 'function') {
    throw new Error('sendMessage callback is required');
  }

  const resolvedModelClient = modelClient || createModelClient({
    provider,
    model,
    providers,
    providerOptions,
  });

  const bot = createDiscordBot({
    client,
    token,
    channelId,
    onReady,
    onError,
    onMessage: (payload) => {
      handleDiscordMessage(payload, resolvedModelClient, sendMessage).catch((err) => {
        if (typeof onError === 'function') {
          onError(err);
          return;
        }
        throw err;
      });
    },
  });

  return {
    start: bot.start,
    modelClient: resolvedModelClient,
  };
}

module.exports = {
  createDiscordRuntime,
  extractReplyContent,
  handleDiscordMessage,
};
