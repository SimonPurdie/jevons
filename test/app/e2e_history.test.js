import test from 'node:test';
import { strict as assert } from 'node:assert';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { EventEmitter } from 'events';
import { startDiscordRuntime } from '../../app/index.js';

/**
 * A mock Discord client that allows us to trigger message events 
 * and capture outgoing messages.
 */
class MockDiscordClient extends EventEmitter {
    constructor() {
        super();
        this.login = () => Promise.resolve('ok');
        this.sentMessages = [];
        this.channels = {
            fetch: async (channelId) => ({
                id: channelId,
                sendTyping: async () => { },
                send: async (payload) => {
                    this.sentMessages.push(payload);
                    return { id: 'msg-' + Date.now() };
                }
            })
        };
    }
}

/**
 * A mock Agent that captures the messages it was initialized with.
 */
global.capturedHistories = [];
class MockAgent {
    constructor(options) {
        this.initialMessages = options.initialState.messages || [];
        global.capturedHistories.push(this.initialMessages);

        this.state = {
            messages: [...this.initialMessages]
        };
        this.model = options.initialState.model;
    }

    async prompt(msg) {
        this.state.messages.push(msg);
        const replyText = `Response to: ${msg.content}`;
        this.state.messages.push({
            role: 'assistant',
            content: [{ type: 'text', text: replyText }]
        });
    }
}

test('End-to-End: Chat history persists and is provided to the agent in subsequent messages', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-e2e-test-'));
    const sessionDir = path.join(tempDir, 'sessions');
    fs.mkdirSync(sessionDir);

    const client = new MockDiscordClient();
    global.capturedHistories = [];

    // Mock configuration
    const config = {
        sessionDir: sessionDir,
        discord: {
            channel_id: 'test-channel',
            token: 'test-token'
        },
        activeModel: 'test-provider/test-model',
        models: [
            { provider: 'test-provider', model: 'test-model' }
        ]
    };

    const deps = {
        loadConfig: () => config,
        createDiscordClient: () => client,
        createSchedulerService: () => ({ start: () => { }, stop: () => { } }),
        resolvePiAi: () => ({
            getModel: (provider, model) => ({
                id: model,
                provider: provider,
            }),
            getModels: () => []
        }),
        resolvePiAgentCore: () => ({ Agent: MockAgent })
    };

    const app = await startDiscordRuntime(deps);

    try {
        // First message
        client.emit('messageCreate', {
            id: 'm1',
            content: 'Hello Jevons, this is my first message.',
            author: { id: 'user-1', bot: false },
            channel: { id: 'test-channel', isThread: () => false },
            guild: { name: 'Test Guild' },
            type: 0
        });

        await new Promise(r => setTimeout(r, 400));

        assert.equal(global.capturedHistories.length, 1, 'Agent should have been created once');
        assert.equal(global.capturedHistories[0].length, 0, 'First message should have no history');

        // Second message in the same channel
        client.emit('messageCreate', {
            id: 'm2',
            content: 'What was my first message?',
            author: { id: 'user-1', bot: false },
            channel: { id: 'test-channel', isThread: () => false },
            guild: { name: 'Test Guild' },
            type: 0
        });

        await new Promise(r => setTimeout(r, 400));

        assert.equal(global.capturedHistories.length, 2, 'Agent should have been created twice');

        const secondHistory = global.capturedHistories[1];
        // Expected history: [User Message 1, Assistant Reply 1]
        assert.ok(secondHistory.length >= 2, `Second message should have history. Found: ${secondHistory.length} messages`);

        const userMsg1 = secondHistory.find(m => m.role === 'user' && m.content.includes('first message'));
        const assistantMsg1 = secondHistory.find(m => m.role === 'assistant');

        assert.ok(userMsg1, 'History should contain the first user message');
        assert.ok(assistantMsg1, 'History should contain the first assistant reply');

    } finally {
        await app.stop();
        fs.rmSync(tempDir, { recursive: true, force: true });
        delete global.capturedHistories;
    }
});
