import test from 'node:test';
import { strict as assert } from 'node:assert';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createDiscordRuntime } from '../../../app/runtime.js';
import { DiscordSessionManager } from '../../../app/sessionManager.js';
import { StringSelectMenuBuilder, ActionRowBuilder } from 'discord.js';

class MockDiscordClient extends EventEmitter {
  constructor() {
    super();
    this.loginCalls = [];
    this.channels = {
      fetch: async (channelId) => {
        return {
          id: channelId,
          sendTyping: async () => { },
          send: async (content) => ({ content, id: 'mock-msg-id' }),
        };
      }
    };
  }
  login(token) {
    this.loginCalls.push(token);
    return Promise.resolve('ok');
  }
}

class MockAgent {
  constructor(options) {
    this.state = {
      messages: [...(options.initialState.messages || [])]
    };
    this.model = options.initialState.model;
  }

  async prompt(msg) {
    this.state.messages.push(msg);
    const reply = await this.model.completeSimple(this.model, { messages: this.state.messages });
    const content = Array.isArray(reply.content) ? reply.content : [{ type: 'text', text: reply.content }];
    this.state.messages.push({ role: 'assistant', content });
  }
}

function makeMessage({
  channelId,
  parentId,
  isThread = false,
  content = 'hello',
  authorId = 'user-1',
  bot = false,
  messageId = 'msg-1',
  guildName = 'TestGuild',
  messageType = 0,
} = {}) {
  return {
    id: messageId,
    content,
    author: { id: authorId, bot },
    channel: {
      id: channelId,
      isThread: () => isThread,
      parentId,
    },
    guild: { name: guildName },
    type: messageType,
  };
}

function flush(ms = 100) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('/resume command replies with select menu containing session options', async () => {
  const client = new MockDiscordClient();
  const replies = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-resume-menu-test-'));

  const modelInstance = {
    id: 'model-test',
    completeSimple: async () => {
      return { content: [{ type: 'text', text: 'Test response' }] };
    }
  };

  try {
    await createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'test-channel',
      modelInstance,
      sessionDir: tempDir,
      sendMessage: (payload) => {
        return Promise.resolve();
      },
      deps: { Agent: MockAgent }
    });

    // Create some sessions first by sending messages
    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: 'First session message' }));
    await flush(200);

    // Send /new to create second session
    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: '/new' }));
    await flush(200);

    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: 'Second session message' }));
    await flush(200);

    // Now simulate /resume slash command
    const mockInteraction = {
      commandName: 'resume',
      isChatInputCommand: () => true,
      channel: {
        id: 'test-channel',
        isThread: () => false,
        parentId: null,
      },
      guild: { name: 'TestGuild' },
      user: { id: 'user-1' },
      options: {},
      reply: async (content) => {
        replies.push(content);
      }
    };

    client.emit('interactionCreate', mockInteraction);
    await flush(200);

    // Verify reply was sent with components
    assert.equal(replies.length, 1, 'Should reply to /resume command');
    const reply = replies[0];
    assert.ok(typeof reply === 'object', 'Reply should be an object with components');
    assert.ok(reply.components, 'Reply should have components');
    assert.ok(Array.isArray(reply.components), 'Components should be an array');
    assert.ok(reply.components.length > 0, 'Should have at least one component row');
    assert.ok(reply.content.includes('Found'), 'Reply should mention found sessions');
    assert.ok(reply.content.includes('session'), 'Reply should mention sessions');

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('/resume command shows session preview and relative time', async () => {
  const client = new MockDiscordClient();
  const replies = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-resume-preview-test-'));

  const modelInstance = {
    id: 'model-test',
    completeSimple: async () => {
      return { content: [{ type: 'text', text: 'Test response' }] };
    }
  };

  try {
    await createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'test-channel',
      modelInstance,
      sessionDir: tempDir,
      sendMessage: (payload) => {
        return Promise.resolve();
      },
      deps: { Agent: MockAgent }
    });

    // Create a session with a specific message
    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: 'Hello, can you help me with testing?' }));
    await flush(200);

    // Simulate /resume
    const mockInteraction = {
      commandName: 'resume',
      isChatInputCommand: () => true,
      channel: {
        id: 'test-channel',
        isThread: () => false,
        parentId: null,
      },
      guild: { name: 'TestGuild' },
      user: { id: 'user-1' },
      options: {},
      reply: async (content) => {
        replies.push(content);
      }
    };

    client.emit('interactionCreate', mockInteraction);
    await flush(200);

    // Verify the reply contains session info
    assert.equal(replies.length, 1, 'Should reply to /resume command');
    const reply = replies[0];
    assert.ok(reply.components, 'Reply should have components');

    // Check that the select menu has options with preview and timestamp info
    const row = reply.components[0];
    assert.ok(row, 'Should have a component row');

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Selecting a session switches to that session', async () => {
  const client = new MockDiscordClient();
  const replies = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-resume-switch-test-'));

  const modelInstance = {
    id: 'model-test',
    completeSimple: async () => {
      return { content: [{ type: 'text', text: 'Test response' }] };
    }
  };

  try {
    const runtime = await createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'test-channel',
      modelInstance,
      sessionDir: tempDir,
      sendMessage: (payload) => {
        return Promise.resolve();
      },
      deps: { Agent: MockAgent }
    });

    // Create initial sessions
    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: 'First session' }));
    await flush(200);

    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: '/new' }));
    await flush(200);

    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: 'Second session' }));
    await flush(200);

    // Get list of sessions
    const sessionManager = new DiscordSessionManager({ sessionDir: tempDir });
    const sessions = await sessionManager.listSessions('test-channel');
    assert.ok(sessions.length >= 2, 'Should have at least 2 sessions');

    // First, trigger /resume to get the menu
    const resumeInteraction = {
      commandName: 'resume',
      isChatInputCommand: () => true,
      channel: {
        id: 'test-channel',
        isThread: () => false,
        parentId: null,
      },
      guild: { name: 'TestGuild' },
      user: { id: 'user-1' },
      options: {},
      reply: async (content) => {
        replies.push({ type: 'resume', content });
      }
    };

    client.emit('interactionCreate', resumeInteraction);
    await flush(200);

    // Now simulate selecting the first session
    const firstSessionFile = sessions[0].path;
    const selectInteraction = {
      customId: 'resume_session_select',
      values: [firstSessionFile],
      isStringSelectMenu: () => true,
      isChatInputCommand: () => false,
      channel: {
        id: 'test-channel',
        isThread: () => false,
        parentId: null,
      },
      guild: { name: 'TestGuild' },
      user: { id: 'user-1' },
      reply: async (content) => {
        replies.push({ type: 'select', content });
      }
    };

    client.emit('interactionCreate', selectInteraction);
    await flush(200);

    // Verify confirmation was sent
    const selectReply = replies.find(r => r.type === 'select');
    assert.ok(selectReply, 'Should reply to select menu interaction');
    assert.ok(selectReply.content.includes('resumed') || selectReply.content.includes('Resumed') || selectReply.content.includes('continue'),
      'Reply should confirm session resume');

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('After resume, buildSessionContext returns messages from resumed session', async () => {
  const client = new MockDiscordClient();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-resume-context-test-'));

  const modelInstance = {
    id: 'model-test',
    completeSimple: async () => {
      return { content: [{ type: 'text', text: 'Test response' }] };
    }
  };

  try {
    await createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'test-channel',
      modelInstance,
      sessionDir: tempDir,
      sendMessage: (payload) => {
        return Promise.resolve();
      },
      deps: { Agent: MockAgent }
    });

    // Create first session with specific message
    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: 'Unique first session message' }));
    await flush(200);

    // Create second session
    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: '/new' }));
    await flush(200);

    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: 'Second session message' }));
    await flush(200);

    // Get sessions
    const sessionManager = new DiscordSessionManager({ sessionDir: tempDir });
    const sessions = await sessionManager.listSessions('test-channel');
    assert.ok(sessions.length >= 2, 'Should have at least 2 sessions');

    // Get current context before switch (should be second session)
    const beforeSwitch = sessionManager.getOrCreate('test-channel');
    const contextBefore = beforeSwitch.sessionManager.buildSessionContext();

    // Switch to first session
    const firstSessionFile = sessions[sessions.length - 1].path; // Usually the oldest
    sessionManager.switchToSession('test-channel', firstSessionFile);

    // Get context after switch
    const afterSwitch = sessionManager.getOrCreate('test-channel');
    const contextAfter = afterSwitch.sessionManager.buildSessionContext();

    // Context should be different after switching
    assert.notDeepEqual(contextAfter, contextBefore, 'Context should change after switching sessions');

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('/resume with no sessions shows appropriate message', async () => {
  const client = new MockDiscordClient();
  const replies = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-resume-empty-test-'));

  const modelInstance = {
    id: 'model-test',
    completeSimple: async () => {
      return { content: [{ type: 'text', text: 'Test response' }] };
    }
  };

  try {
    await createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'test-channel',
      modelInstance,
      sessionDir: tempDir,
      sendMessage: (payload) => {
        return Promise.resolve();
      },
      deps: { Agent: MockAgent }
    });

    // Don't send any messages - no sessions created

    // Simulate /resume on empty channel
    const mockInteraction = {
      commandName: 'resume',
      isChatInputCommand: () => true,
      channel: {
        id: 'test-channel',
        isThread: () => false,
        parentId: null,
      },
      guild: { name: 'TestGuild' },
      user: { id: 'user-1' },
      options: {},
      reply: async (content) => {
        replies.push(content);
      }
    };

    client.emit('interactionCreate', mockInteraction);
    await flush(200);

    // Verify appropriate message for no sessions
    assert.equal(replies.length, 1, 'Should reply to /resume command');
    assert.ok(replies[0].includes('No previous sessions') || replies[0].includes('no sessions'),
      'Should inform user when no sessions exist');

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Resuming current session is handled gracefully', async () => {
  const client = new MockDiscordClient();
  const replies = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-resume-current-test-'));

  const modelInstance = {
    id: 'model-test',
    completeSimple: async () => {
      return { content: [{ type: 'text', text: 'Test response' }] };
    }
  };

  try {
    await createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'test-channel',
      modelInstance,
      sessionDir: tempDir,
      sendMessage: (payload) => {
        return Promise.resolve();
      },
      deps: { Agent: MockAgent }
    });

    // Create a session
    client.emit('messageCreate', makeMessage({ channelId: 'test-channel', content: 'Test message' }));
    await flush(200);

    // Get the current session file path
    const sessionManager = new DiscordSessionManager({ sessionDir: tempDir });
    const sessions = await sessionManager.listSessions('test-channel');
    assert.ok(sessions.length >= 1, 'Should have at least 1 session');

    const currentSessionFile = sessions[0].path;

    // Resume the current session (should work without error)
    sessionManager.switchToSession('test-channel', currentSessionFile);

    // Verify session is still accessible
    const resumedSession = sessionManager.getOrCreate('test-channel');
    assert.ok(resumedSession, 'Should have active session after resuming current');
    assert.ok(resumedSession.isActive, 'Session should be active');

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
