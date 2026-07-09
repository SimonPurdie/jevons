import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

import { selectOAuthOption } from '../../app/oauthLogin.js';

const openAICodexPrompt = {
  message: 'Select OpenAI Codex login method:',
  options: [
    { id: 'browser', label: 'Browser login (default)' },
    { id: 'device_code', label: 'Device code login (headless)' }
  ]
};

describe('oauthLogin', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    delete process.env.JEVONS_OPENAI_CODEX_LOGIN_METHOD;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('uses device-code login for OpenAI Codex by default', async () => {
    const messages = [];
    const selected = await selectOAuthOption(openAICodexPrompt, {
      providerId: 'openai-codex',
      prompt: async () => '1',
      logger: { log: (message) => messages.push(message) }
    });

    assert.strictEqual(selected, 'device_code');
    assert.ok(messages.some((message) => message.includes('Callback route not found')));
  });

  it('allows forcing browser callback login for OpenAI Codex', async () => {
    process.env.JEVONS_OPENAI_CODEX_LOGIN_METHOD = 'browser';

    const selected = await selectOAuthOption(openAICodexPrompt, {
      providerId: 'openai-codex',
      prompt: async () => '2',
      logger: { log: () => {} }
    });

    assert.strictEqual(selected, 'browser');
  });

  it('prompts normally for non-OpenAI-Codex selections', async () => {
    let askedQuestion;
    const selected = await selectOAuthOption({
      message: 'Pick one',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' }
      ]
    }, {
      providerId: 'github-copilot',
      prompt: async (question) => {
        askedQuestion = question;
        return '2';
      },
      logger: { log: () => {} }
    });

    assert.strictEqual(selected, 'b');
    assert.strictEqual(askedQuestion, 'Select an option (blank to cancel): ');
  });
});
