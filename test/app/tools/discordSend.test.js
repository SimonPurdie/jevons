import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createDiscordSendTool } from '../../../app/tools/discordSend.js';

test('discord_send sends text content with context', async () => {
  const sent = [];
  const tool = createDiscordSendTool({
    sendMessage: async (payload) => {
      sent.push(payload);
    },
    context: {
      channelId: 'root',
      threadId: 'thread-1',
      contextId: 'thread-1',
      messageId: 'msg-1',
      authorId: 'user-1',
    },
  });

  const result = await tool.execute('call-1', { content: 'hello from tool' });
  assert.equal(result.details.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].content, 'hello from tool');
  assert.equal(sent[0].channelId, 'root');
  assert.equal(sent[0].threadId, 'thread-1');
});

test('discord_send attaches file paths when present', async () => {
  const sent = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-discord-send-'));
  const filePath = path.join(tempDir, 'image.png');
  fs.writeFileSync(filePath, Buffer.from('image-bytes'));

  try {
    const tool = createDiscordSendTool({
      sendMessage: async (payload) => {
        sent.push(payload);
      },
      context: { channelId: 'root' },
    });

    const result = await tool.execute('call-2', {
      content: 'with file',
      files: [{ path: filePath }],
    });

    assert.equal(result.details.ok, true);
    assert.equal(result.details.fileCount, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].files.length, 1);
    assert.equal(sent[0].files[0].attachment, filePath);
    assert.equal(sent[0].files[0].name, 'image.png');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
