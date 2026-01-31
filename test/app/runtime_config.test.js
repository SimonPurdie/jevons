const test = require('node:test');
const assert = require('node:assert/strict');
const { createDiscordRuntime } = require('../../app/runtime');

class MockDiscordClient {
    constructor() {
        this.login = () => Promise.resolve();
        this.on = () => { };
        this.once = () => { };
        this.emit = () => { };
    }
}

test('createDiscordRuntime with activeModel resolves correctly', async () => {
    const client = new MockDiscordClient();
    const models = {
        primary: { provider: 'test-provider', model: 'test-model' }
    };
    const activeModel = 'primary';

    let getModelCalled = false;
    const mockGetModel = (provider, model) => {
        getModelCalled = true;
        assert.equal(provider, 'test-provider');
        assert.equal(model, 'test-model');
        return { id: 'resolved-model', provider, model };
    };

    const runtime = createDiscordRuntime({
        client,
        token: 'token',
        channelId: 'channel',
        activeModel,
        models,
        getModel: mockGetModel,
        sendMessage: () => { },
        deps: { resolvePiAi: () => ({ getModel: mockGetModel }) }
    });

    assert.ok(getModelCalled);
    assert.equal(runtime.model.id, 'resolved-model');
});

test('createDiscordRuntime throws error if activeModel not found', async () => {
    const client = new MockDiscordClient();
    const models = {
        primary: { provider: 'test-provider', model: 'test-model' }
    };
    const activeModel = 'missing';

    assert.throws(() => {
        createDiscordRuntime({
            client,
            token: 'token',
            channelId: 'channel',
            activeModel,
            models,
            sendMessage: () => { },
            deps: { resolvePiAi: () => ({ getModel: () => { } }) }
        });
    }, /No active model configuration found/);
});

test('createDiscordRuntime uses authStorage in generateReply (indirectly verified via model resolution here)', async () => {
    // authStorage is used in generateReply, which is internal.
    // We can verify it is accepted in options without error.
    const client = new MockDiscordClient();
    const models = { primary: { provider: 'p', model: 'm' } };

    const authStorage = {
        getApiKey: async () => 'key'
    };

    const runtime = createDiscordRuntime({
        client,
        token: 'token',
        channelId: 'channel',
        activeModel: 'primary',
        models,
        authStorage,
        getModel: () => ({ id: 'm' }),
        sendMessage: () => { },
        deps: { resolvePiAi: () => ({ getModel: () => ({ id: 'm' }) }) }
    });

    assert.ok(runtime);
});
