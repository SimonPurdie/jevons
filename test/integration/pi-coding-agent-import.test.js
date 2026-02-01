const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('pi-coding-agent package import', () => {
  it('should dynamically import SessionManager without errors', async () => {
    const { SessionManager } = await import('@mariozechner/pi-coding-agent');
    assert.ok(SessionManager, 'SessionManager should be defined');
    assert.strictEqual(typeof SessionManager, 'function', 'SessionManager should be a constructor/function');
  });

  it('should dynamically import createAgentSession without errors', async () => {
    const { createAgentSession } = await import('@mariozechner/pi-coding-agent');
    assert.ok(createAgentSession, 'createAgentSession should be defined');
    assert.strictEqual(typeof createAgentSession, 'function', 'createAgentSession should be a function');
  });

  it('should dynamically import AuthStorage without errors', async () => {
    const { AuthStorage } = await import('@mariozechner/pi-coding-agent');
    assert.ok(AuthStorage, 'AuthStorage should be defined');
    assert.strictEqual(typeof AuthStorage, 'function', 'AuthStorage should be a constructor/function');
  });

  it('should dynamically import ModelRegistry without errors', async () => {
    const { ModelRegistry } = await import('@mariozechner/pi-coding-agent');
    assert.ok(ModelRegistry, 'ModelRegistry should be defined');
    assert.strictEqual(typeof ModelRegistry, 'function', 'ModelRegistry should be a constructor/function');
  });

  it('should have accessible package version', async () => {
    const piCodingAgent = await import('@mariozechner/pi-coding-agent');
    assert.ok(piCodingAgent, 'pi-coding-agent module should be defined');
    if (piCodingAgent.VERSION) {
      assert.strictEqual(typeof piCodingAgent.VERSION, 'string', 'VERSION should be a string');
      assert.ok(piCodingAgent.VERSION.length > 0, 'VERSION should not be empty');
    }
  });
});
