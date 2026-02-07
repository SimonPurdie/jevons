import { EventEmitter } from 'events';
import { REST, Routes } from 'discord.js';
import { getCommandDefinitions } from './commands.js';
import fs from 'fs';

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

/**
 * Ensures Discord slash commands are registered and up-to-date.
 * Compares local command definitions with registered commands and updates if needed.
 */
async function ensureCommandsRegistered(client, token, applicationId) {
  try {
    const rest = new REST({ version: '10' }).setToken(token);
    const localCommands = getCommandDefinitions().map(cmd => cmd.toJSON());

    // Fetch currently registered commands
    const registeredCommands = await rest.get(
      Routes.applicationCommands(applicationId)
    );

    // Compare commands by creating a normalized comparison
    const normalize = (cmd) => JSON.stringify({
      name: cmd.name,
      description: cmd.description,
      options: cmd.options || []
    });

    const localSet = new Set(localCommands.map(normalize));
    const registeredSet = new Set(registeredCommands.map(normalize));

    // Check if commands are in sync
    const needsSync = localCommands.length !== registeredCommands.length ||
      !localCommands.every(cmd => registeredSet.has(normalize(cmd)));

    if (needsSync) {
      console.log('[Discord] Commands out of sync. Registering...');
      await rest.put(
        Routes.applicationCommands(applicationId),
        { body: localCommands }
      );
      console.log(`[Discord] Successfully registered ${localCommands.length} commands.`);
    } else {
      console.log('[Discord] Commands are in sync.');
    }
  } catch (err) {
    console.error('[Discord] Failed to sync commands:', err.message);
    // Don't throw - bot can still function without slash commands
  }
}

export function createDiscordBot(options) {
  const {
    client,
    token,
    channelId,
    applicationId,
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

  client.on('ready', async () => {
    // Sync commands if applicationId is provided
    if (applicationId) {
      await ensureCommandsRegistered(client, token, applicationId);
    }

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
    const context = extractContext(interaction, channelId);
    if (!context) {
      return;
    }

    if (interaction.isChatInputCommand()) {
      if (typeof onInteraction === 'function') {
        onInteraction({
          commandName: interaction.commandName,
          options: interaction.options,
          authorId: interaction.user ? interaction.user.id : null,
          interaction,
          ...context,
        });
      }
    } else if (interaction.isStringSelectMenu()) {
      // Handle select menu interactions
      if (typeof onInteraction === 'function') {
        onInteraction({
          customId: interaction.customId,
          values: interaction.values,
          authorId: interaction.user ? interaction.user.id : null,
          interaction,
          isSelectMenu: true,
          ...context,
        });
      }
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

export function sendDiscordMessage(client, payload) {
  const {
    content,
    files,
    embeds,
    components,
    maxAttachmentBytes = 8 * 1024 * 1024,
    channelId,
    threadId,
  } = payload;
  let targetId = (threadId && threadId !== 'null') ? threadId : channelId;

  if (targetId === 'null') targetId = null;

  if (!targetId) {
    return Promise.reject(new Error('Unable to send message: No valid channelId or threadId provided'));
  }

  const text = typeof content === 'string' ? content : '';
  const chunks = text ? splitMessage(text) : [];
  const { acceptedFiles, fallbackNotes } = normalizeDiscordFiles(files, maxAttachmentBytes);
  const extraFallback = fallbackNotes.length > 0 ? `\n\n${fallbackNotes.join('\n')}` : '';
  const firstChunk = `${chunks[0] || ''}${extraFallback}`.trim();

  return client.channels.fetch(targetId).then(async (channel) => {
    if (!channel || typeof channel.send !== 'function') {
      throw new Error(`Unable to send message to channel ${targetId}`);
    }
    const results = [];
    const hasRichPayload = acceptedFiles.length > 0 || Array.isArray(embeds) || Array.isArray(components);

    if (hasRichPayload) {
      const messagePayload = {};
      if (firstChunk) {
        messagePayload.content = firstChunk;
      }
      if (acceptedFiles.length > 0) {
        messagePayload.files = acceptedFiles;
      }
      if (Array.isArray(embeds) && embeds.length > 0) {
        messagePayload.embeds = embeds;
      }
      if (Array.isArray(components) && components.length > 0) {
        messagePayload.components = components;
      }
      try {
        results.push(await channel.send(messagePayload));
        for (const chunk of chunks.slice(1)) {
          results.push(await channel.send(chunk));
        }
        return results.length === 1 ? results[0] : results;
      } catch (err) {
        const failedFiles = acceptedFiles.map((file) => file.name).join(', ');
        // eslint-disable-next-line no-console
        console.error('[Discord] Failed to send rich payload', {
          targetId,
          error: err && err.message ? err.message : String(err),
          files: failedFiles,
        });

        const failureNotice = acceptedFiles.length > 0
          ? `Attachment upload failed: ${err && err.message ? err.message : 'unknown error'}.`
          : `Rich payload send failed: ${err && err.message ? err.message : 'unknown error'}.`;
        const fallbackContent = [firstChunk, failureNotice].filter(Boolean).join('\n\n').trim() || failureNotice;
        for (const chunk of splitMessage(fallbackContent)) {
          results.push(await channel.send(chunk));
        }
        return results.length === 1 ? results[0] : results;
      }
    }

    if (chunks.length === 0) {
      if (extraFallback.trim()) {
        results.push(await channel.send(extraFallback.trim()));
        return results[0];
      }
      results.push(await channel.send('...'));
      return results[0];
    }
    if (extraFallback.trim()) {
      chunks[0] = `${chunks[0]}\n\n${fallbackNotes.join('\n')}`.trim();
    }
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

function normalizeDiscordFiles(files, maxAttachmentBytes) {
  if (!Array.isArray(files) || files.length === 0) {
    return { acceptedFiles: [], fallbackNotes: [] };
  }

  const acceptedFiles = [];
  const fallbackNotes = [];
  const maxFiles = 10;

  for (const file of files) {
    if (acceptedFiles.length >= maxFiles) {
      fallbackNotes.push(`Attachment skipped: too many files (max ${maxFiles}).`);
      break;
    }
    if (!file || typeof file !== 'object') {
      fallbackNotes.push('Attachment skipped: invalid payload.');
      continue;
    }

    const name = typeof file.name === 'string' && file.name.trim() ? file.name : `attachment-${acceptedFiles.length + 1}.bin`;
    const resolved = resolveAttachment(file.attachment);
    if (!resolved.ok) {
      fallbackNotes.push(`Attachment skipped: "${name}" ${resolved.reason}.`);
      continue;
    }
    const size = resolved.size;

    if (size !== null && size > maxAttachmentBytes) {
      fallbackNotes.push(
        `Attachment skipped: "${name}" exceeds ${Math.floor(maxAttachmentBytes / (1024 * 1024))}MB limit.`
      );
      continue;
    }

    acceptedFiles.push({
      attachment: resolved.attachment,
      name,
    });
  }

  return { acceptedFiles, fallbackNotes };
}

function estimateAttachmentSize(attachment) {
  if (Buffer.isBuffer(attachment)) {
    return attachment.byteLength;
  }
  if (typeof attachment === 'string') {
    try {
      if (fs.existsSync(attachment)) {
        return fs.statSync(attachment).size;
      }
    } catch (_err) {
      return null;
    }
    return null;
  }
  return null;
}

function resolveAttachment(attachment) {
  if (attachment === undefined || attachment === null) {
    return { ok: false, reason: 'has no attachment data' };
  }
  if (Buffer.isBuffer(attachment)) {
    return { ok: true, attachment, size: attachment.byteLength };
  }
  if (typeof attachment === 'string') {
    try {
      if (!fs.existsSync(attachment)) {
        return { ok: false, reason: 'file path does not exist' };
      }
      const fileBuffer = fs.readFileSync(attachment);
      return { ok: true, attachment: fileBuffer, size: fileBuffer.byteLength };
    } catch (_err) {
      return { ok: false, reason: 'file path could not be read' };
    }
  }
  return { ok: false, reason: 'uses unsupported attachment type' };
}

export { extractContext, splitMessage };
