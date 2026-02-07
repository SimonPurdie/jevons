import { Type } from '@sinclair/typebox';
import fs from 'fs';
import path from 'path';

const discordSendSchema = Type.Object({
  content: Type.Optional(Type.String({ description: 'Message text to send to Discord.' })),
  files: Type.Optional(
    Type.Array(
      Type.Object({
        path: Type.String({ description: 'Absolute or workspace-relative file path to attach. For generated media, prefer provider_api details.artifacts[].storage.path.' }),
        name: Type.Optional(Type.String({ description: 'Optional attachment filename override.' })),
      }),
      { description: 'Files to attach to the message.' }
    )
  ),
});

export function createDiscordSendTool(options = {}) {
  const {
    sendMessage,
    context = {},
  } = options;

  if (typeof sendMessage !== 'function') {
    throw new Error('createDiscordSendTool requires sendMessage function');
  }

  return {
    name: 'discord_send',
    label: 'discord_send',
    description:
      'Send a Discord message directly (text and optional file attachments). For generated media, pass files[].path from provider_api details.artifacts[].storage.path. Treat send as successful only when this tool returns details.ok=true.',
    parameters: discordSendSchema,
    execute: async (_toolCallId, params) => {
      const content = typeof params?.content === 'string' ? params.content : '';
      const requestedFiles = Array.isArray(params?.files) ? params.files : [];

      const files = [];
      for (const entry of requestedFiles) {
        if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string' || !entry.path.trim()) {
          continue;
        }
        const filePath = path.resolve(entry.path.trim());
        if (!fs.existsSync(filePath)) {
          continue;
        }
        files.push({
          attachment: filePath,
          name: typeof entry.name === 'string' && entry.name.trim()
            ? entry.name.trim()
            : path.basename(filePath),
        });
      }

      if (!content.trim() && files.length === 0) {
        return {
          content: [{
            type: 'text',
            text: 'discord_send skipped: no content or valid files were provided.',
          }],
          details: {
            ok: false,
            sent: false,
            reason: 'empty_payload',
          },
        };
      }

      await sendMessage({
        content,
        files,
        channelId: context.channelId,
        threadId: context.threadId,
        contextId: context.contextId,
        messageId: context.messageId,
        authorId: context.authorId,
      });

      return {
        content: [{
          type: 'text',
          text: `Discord message sent (${content.trim() ? 'text' : 'no text'}, ${files.length} file(s)).`,
        }],
        details: {
          ok: true,
          sent: true,
          fileCount: files.length,
        },
      };
    },
  };
}
