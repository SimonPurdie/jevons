const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createDiscordRuntime } = require('../../app/runtime');
const { registerApiProvider } = require('@mariozechner/pi-ai');

registerApiProvider('test-api', {
  streamSimple: async (model, messages, options) => {
    const modelInstance = typeof model === 'object' ? model : { id: model };
    const result = await modelInstance.completeSimple(messages, options);
    return {
      content: result.content,
      usage: result.usage || { input: 0, output: 0, totalTokens: 0 },
      stopReason: 'stop'
    };
  }
});

class MockDiscordClient extends EventEmitter {
  constructor() {
    super();
    this.loginCalls = [];
  }

  login(token) {
    this.loginCalls.push(token);
    return Promise.resolve('ok');
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
} = {}) {
  return {
    id: messageId,
    content,
    author: { id: authorId, bot },
    channel: {
      id: channelId,
      isThread,
      parentId,
    },
  };
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test('createDiscordRuntime sends model reply via sendMessage', async () => {
  const client = new MockDiscordClient();
  const modelInstance = { 
    id: 'model-test', 
    api: 'test-api',
    completeSimple: async () => ({
      content: [{ type: 'text', text: 'hi there' }],
    })
  };

  createDiscordRuntime({
    client,
    token: 'token-123',
    channelId: 'root',
    modelInstance,
    sendMessage: (payload) => {
      sends.push(payload);
      return Promise.resolve();
    },
  });

  client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Hello' }));
  await flush();

  assert.equal(sends.length, 1);
  assert.equal(sends[0].content, 'hi there');
  assert.equal(sends[0].channelId, 'root');
});

test('createDiscordRuntime sends API error message when model fails', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const modelInstance = { id: 'model-test' };
  const completeSimple = async () => {
    throw new Error('No API key for provider: google');
  };

  createDiscordRuntime({
    client,
    token: 'token-123',
    channelId: 'root',
    modelInstance,
    completeSimple,
    sendMessage: (payload) => {
      sends.push(payload);
      return Promise.resolve();
    },
  });

  client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Hello' }));
  await flush();

  assert.equal(sends.length, 1);
  assert.equal(sends[0].content, 'API error: No API key for provider: google');
});

test('createDiscordRuntime sends API error when response is empty', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const modelInstance = { id: 'model-test' };
  const completeSimple = async () => ({ content: [] });

  createDiscordRuntime({
    client,
    token: 'token-123',
    channelId: 'root',
    modelInstance,
    completeSimple,
    sendMessage: (payload) => {
      sends.push(payload);
      return Promise.resolve();
    },
  });

  client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Hello' }));
  await flush();

  assert.equal(sends.length, 1);
  assert.equal(sends[0].content, 'API error: Model response missing content');
});

test('createDiscordRuntime ignores empty messages', async () => {
  const client = new MockDiscordClient();
  let called = 0;
  const modelInstance = { id: 'model-test' };
  const completeSimple = async () => {
    called += 1;
    return { content: [{ type: 'text', text: 'ok' }] };
  };

  createDiscordRuntime({
    client,
    token: 'token-123',
    channelId: 'root',
    modelInstance,
    completeSimple,
    sendMessage: () => Promise.resolve(),
  });

  client.emit('messageCreate', makeMessage({ channelId: 'root', content: '   ' }));
  await flush();

  assert.equal(called, 0);
});

test('createDiscordRuntime passes thread context to sendMessage', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const modelInstance = { id: 'model-test' };
  const completeSimple = async () => ({ content: [{ type: 'text', text: 'thread-reply' }] });

  createDiscordRuntime({
    client,
    token: 'token-123',
    channelId: 'root',
    modelInstance,
    completeSimple,
    sendMessage: (payload) => {
      sends.push(payload);
      return Promise.resolve();
    },
  });

  client.emit('messageCreate', makeMessage({
    channelId: 'thread-1',
    parentId: 'root',
    isThread: true,
  }));
  await flush();

  assert.equal(sends.length, 1);
  assert.equal(sends[0].threadId, 'thread-1');
  assert.equal(sends[0].channelId, 'root');
});

test('createDiscordRuntime logs user messages and agent replies', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const modelInstance = { id: 'model-test' };
  const completeSimple = async () => ({
    content: [{ type: 'text', text: 'Hello user' }],
  });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-runtime-test-'));

  try {
    createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'root',
      modelInstance,
      completeSimple,
      logsRoot: tempDir,
      sendMessage: (payload) => {
        sends.push(payload);
        return Promise.resolve();
      },
    });

    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Hello bot' }));
    await flush();

    // Check that log file was created
    const logsDir = path.join(tempDir, 'logs', 'discord-channel', 'root');
    assert.equal(fs.existsSync(logsDir), true);
    
    const files = fs.readdirSync(logsDir);
    assert.equal(files.length, 1);
    
    const logContent = fs.readFileSync(path.join(logsDir, files[0]), 'utf8');
    assert.ok(logContent.includes('[user] Hello bot'));
    assert.ok(logContent.includes('[agent] Hello user'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('createDiscordRuntime injects memories before user prompt', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  let receivedMessages = null;
  const injection = 'INJECTED_CONTEXT_RELEVANT_MEMORIES\n{"budget_tokens_est":1,"memories":[]}';
  const modelInstance = { id: 'model-test' };
  const completeSimple = async (model, request) => {
    receivedMessages = request.messages;
    return { content: [{ type: 'text', text: 'Hello user' }] };
  };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-runtime-test-'));

  try {
    createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'root',
      modelInstance,
      completeSimple,
      logsRoot: tempDir,
      memoryInjection: async () => injection,
      sendMessage: (payload) => {
        sends.push(payload);
        return Promise.resolve();
      },
    });

    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Hello bot' }));
    await flush();

    // Get the last message (current user message with injection)
    const lastMessage = receivedMessages[receivedMessages.length - 1];
    assert.ok(lastMessage.content.startsWith(injection));
    assert.ok(lastMessage.content.endsWith('Hello bot'));

    const logsDir = path.join(tempDir, 'logs', 'discord-channel', 'root');
    const files = fs.readdirSync(logsDir);
    const logContent = fs.readFileSync(path.join(logsDir, files[0]), 'utf8');
    assert.ok(!logContent.includes('INJECTED_CONTEXT_RELEVANT_MEMORIES'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('createDiscordRuntime logs errors when model fails', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const modelInstance = { id: 'model-test' };
  const completeSimple = async () => {
    throw new Error('Model API error');
  };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-runtime-test-'));

  try {
    createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'root',
      modelInstance,
      completeSimple,
      logsRoot: tempDir,
      sendMessage: (payload) => {
        sends.push(payload);
        return Promise.resolve();
      },
    });

    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Hello bot' }));
    await flush();

    const logsDir = path.join(tempDir, 'logs', 'discord-channel', 'root');
    const files = fs.readdirSync(logsDir);
    const logContent = fs.readFileSync(path.join(logsDir, files[0]), 'utf8');
    
    assert.ok(logContent.includes('[user] Hello bot'));
    assert.ok(logContent.includes('[agent]'));
    assert.ok(logContent.includes('error'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('createDiscordRuntime works without logsRoot (logging disabled)', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const modelInstance = { id: 'model-test' };
  const completeSimple = async () => ({
    content: [{ type: 'text', text: 'hi there' }],
  });

  createDiscordRuntime({
    client,
    token: 'token-123',
    channelId: 'root',
    modelInstance,
    completeSimple,
    // logsRoot not provided
    sendMessage: (payload) => {
      sends.push(payload);
      return Promise.resolve();
    },
  });

  client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Hello' }));
  await flush();

  // Should still work without logging
  assert.equal(sends.length, 1);
  assert.equal(sends[0].content, 'hi there');
});

test('createDiscordRuntime /new command resets context window', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const modelInstance = { id: 'model-test' };
  let modelCalls = 0;
  const completeSimple = async () => {
    modelCalls += 1;
    return { content: [{ type: 'text', text: 'reply' }] };
  };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-runtime-test-'));

  try {
    createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'root',
      modelInstance,
      completeSimple,
      logsRoot: tempDir,
      sendMessage: (payload) => {
        sends.push(payload);
        return Promise.resolve();
      },
    });

    // Send initial message
    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Hello' }));
    await flush();

    // Send /new command
    client.emit('messageCreate', makeMessage({ channelId: 'root', content: '/new' }));
    await flush();

    // Send another message after /new
    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'After reset' }));
    await flush();

    // Check confirmation message was sent
    const newConfirmation = sends.find(s => s.content.includes('Context window reset'));
    assert.ok(newConfirmation, 'Should send confirmation for /new command');

    // Model should only be called twice (not for /new)
    assert.equal(modelCalls, 2, 'Model should not be called for /new command');

    // Check that two log files were created (one before reset, one after)
    const logsDir = path.join(tempDir, 'logs', 'discord-channel', 'root');
    const files = fs.readdirSync(logsDir).sort();
    assert.equal(files.length, 2, 'Should create two log files after /new');
    assert.ok(files[0].includes('_0000.md'), 'First file should have seq 0000');
    assert.ok(files[1].includes('_0001.md'), 'Second file should have seq 0001');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('createDiscordRuntime /new command works in threads', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const modelInstance = { id: 'model-test' };
  const completeSimple = async () => ({ content: [{ type: 'text', text: 'reply' }] });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-runtime-test-'));

  try {
    createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'root',
      modelInstance,
      completeSimple,
      logsRoot: tempDir,
      sendMessage: (payload) => {
        sends.push(payload);
        return Promise.resolve();
      },
    });

    // Send message in thread, then /new
    client.emit('messageCreate', makeMessage({
      channelId: 'thread-1',
      parentId: 'root',
      isThread: true,
      content: 'Thread message',
    }));
    await flush();

    client.emit('messageCreate', makeMessage({
      channelId: 'thread-1',
      parentId: 'root',
      isThread: true,
      content: '/new',
    }));
    await flush();

    // Check confirmation was sent to thread
    const confirmation = sends.find(s => s.content.includes('Context window reset'));
    assert.ok(confirmation, 'Should send confirmation in thread');
    assert.equal(confirmation.threadId, 'thread-1');

    // Check thread has its own log files
    const threadLogsDir = path.join(tempDir, 'logs', 'discord-thread', 'thread-1');
    const files = fs.readdirSync(threadLogsDir);
    assert.equal(files.length, 2, 'Thread should have two log files');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('createDiscordRuntime /new works without logsRoot', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const modelInstance = { id: 'model-test' };
  let modelCalls = 0;
  const completeSimple = async () => {
    modelCalls += 1;
    return { content: [{ type: 'text', text: 'reply' }] };
  };

  createDiscordRuntime({
    client,
    token: 'token-123',
    channelId: 'root',
    modelInstance,
    completeSimple,
    // logsRoot not provided
    sendMessage: (payload) => {
      sends.push(payload);
      return Promise.resolve();
    },
  });

  client.emit('messageCreate', makeMessage({ channelId: 'root', content: '/new' }));
  await flush();

  // Should not crash and should send confirmation
  const confirmation = sends.find(s => s.content.includes('Context window reset'));
  assert.ok(confirmation, 'Should send confirmation even without logging');
  assert.equal(modelCalls, 0, 'Model should not be called for /new');
});

test('createDiscordRuntime /new with whitespace is still recognized', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const modelInstance = { id: 'model-test' };
  const completeSimple = async () => ({ content: [{ type: 'text', text: 'reply' }] });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-runtime-test-'));

  try {
    createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'root',
      modelInstance,
      completeSimple,
      logsRoot: tempDir,
      sendMessage: (payload) => {
        sends.push(payload);
        return Promise.resolve();
      },
    });

    // /new with leading/trailing whitespace
    client.emit('messageCreate', makeMessage({ channelId: 'root', content: '  /new  ' }));
    await flush();

    const confirmation = sends.find(s => s.content.includes('Context window reset'));
    assert.ok(confirmation, 'Should recognize /new with whitespace');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('createDiscordRuntime passes chat history to model', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const modelInstance = { id: 'model-test' };
  const calls = [];
  const completeSimple = async (model, request) => {
    calls.push(request.messages);
    return { content: [{ type: 'text', text: 'reply' }] };
  };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-runtime-test-'));

  try {
    createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'root',
      modelInstance,
      completeSimple,
      logsRoot: tempDir,
      sendMessage: (payload) => {
        sends.push(payload);
        return Promise.resolve();
      },
    });

    // Send first message
    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'First message', messageId: 'msg-1' }));
    await flush();

    // Send second message - should include history
    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Second message', messageId: 'msg-2' }));
    await flush();

    // Should have 2 calls
    assert.equal(calls.length, 2);
    
    // First call should have 1 message (no history yet)
    assert.equal(calls[0].length, 1);
    assert.equal(calls[0][0].role, 'user');
    assert.equal(calls[0][0].content, 'First message');
    
    // Second call should have 3 messages: user1, assistant1, user2
    assert.equal(calls[1].length, 3);
    assert.equal(calls[1][0].role, 'user');
    assert.equal(calls[1][0].content, 'First message');
    assert.equal(calls[1][1].role, 'assistant');
    assert.equal(calls[1][1].content, 'reply');
    assert.equal(calls[1][2].role, 'user');
    assert.equal(calls[1][2].content, 'Second message');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('createDiscordRuntime chat history respects /new reset', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const modelInstance = { id: 'model-test' };
  const calls = [];
  const completeSimple = async (model, request) => {
    calls.push(request.messages);
    return { content: [{ type: 'text', text: 'reply' }] };
  };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-runtime-test-'));

  try {
    createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'root',
      modelInstance,
      completeSimple,
      logsRoot: tempDir,
      sendMessage: (payload) => {
        sends.push(payload);
        return Promise.resolve();
      },
    });

    // Send first message
    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Before reset' }));
    await flush();

    // Send /new command (doesn't call model)
    client.emit('messageCreate', makeMessage({ channelId: 'root', content: '/new' }));
    await flush();

    // Send message after reset
    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'After reset' }));
    await flush();

    // Should have 2 model calls (not counting /new)
    assert.equal(calls.length, 2);
    
    // First call: 1 message
    assert.equal(calls[0].length, 1);
    assert.equal(calls[0][0].content, 'Before reset');
    
    // Second call (after reset): should have only 1 message (no history from before)
    assert.equal(calls[1].length, 1);
    assert.equal(calls[1][0].role, 'user');
    assert.equal(calls[1][0].content, 'After reset');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('createDiscordRuntime chat history works in threads', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const modelInstance = { id: 'model-test' };
  const calls = [];
  const completeSimple = async (model, request) => {
    calls.push(request.messages);
    return { content: [{ type: 'text', text: 'reply' }] };
  };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-runtime-test-'));

  try {
    createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'root',
      modelInstance,
      completeSimple,
      logsRoot: tempDir,
      sendMessage: (payload) => {
        sends.push(payload);
        return Promise.resolve();
      },
    });

    // Send messages in thread
    client.emit('messageCreate', makeMessage({
      channelId: 'thread-1',
      parentId: 'root',
      isThread: true,
      content: 'Thread message 1',
    }));
    await flush();

    client.emit('messageCreate', makeMessage({
      channelId: 'thread-1',
      parentId: 'root',
      isThread: true,
      content: 'Thread message 2',
    }));
    await flush();

    // Should have 2 calls
    assert.equal(calls.length, 2);
    
    // First thread call should have 1 message
    assert.equal(calls[0].length, 1);
    assert.equal(calls[0][0].content, 'Thread message 1');
    
    // Second thread call should have 3 messages (user1, assistant1, user2)
    assert.equal(calls[1].length, 3);
    assert.equal(calls[1][0].content, 'Thread message 1');
    assert.equal(calls[1][1].role, 'assistant');
    assert.equal(calls[1][2].content, 'Thread message 2');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('createDiscordRuntime chat history is isolated per context', async () => {
  const client = new MockDiscordClient();
  const sends = [];
  const modelInstance = { id: 'model-test' };
  const calls = [];
  const completeSimple = async (model, request) => {
    calls.push({ context: 'thread', messages: request.messages.length });
    return { content: [{ type: 'text', text: 'reply' }] };
  };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-runtime-test-'));

  try {
    createDiscordRuntime({
      client,
      token: 'token-123',
      channelId: 'root',
      modelInstance,
      completeSimple,
      logsRoot: tempDir,
      sendMessage: (payload) => {
        sends.push(payload);
        return Promise.resolve();
      },
    });

    // Send message in main channel
    client.emit('messageCreate', makeMessage({ channelId: 'root', content: 'Main channel message' }));
    await flush();

    // Send message in thread
    client.emit('messageCreate', makeMessage({
      channelId: 'thread-1',
      parentId: 'root',
      isThread: true,
      content: 'Thread message',
    }));
    await flush();

    // Should have 2 calls
    assert.equal(calls.length, 2);
    
    // Second call (thread) should have only 1 message (no history from main channel)
    assert.equal(calls[1].messages, 1, 'Thread should have no history from main channel');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
