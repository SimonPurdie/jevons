import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { AuthStorage, createAuthStorage } from '../../app/auth.js';

describe('auth', () => {
  let tempDir;
  let authPath;
  let originalEnv;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), 'jevons-auth-test-' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
    authPath = path.join(tempDir, 'auth.json');
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('AuthStorage', () => {
    it('can be instantiated with custom path', () => {
      const auth = new AuthStorage(authPath);
      assert.ok(auth);
      assert.ok(auth instanceof AuthStorage);
    });

    it('defaults to ./config/auth.json when no path provided', () => {
      const auth = new AuthStorage();
      assert.ok(auth);
    });

    it('has required methods', () => {
      const auth = new AuthStorage(authPath);
      assert.strictEqual(typeof auth.getApiKey, 'function');
      assert.strictEqual(typeof auth.set, 'function');
      assert.strictEqual(typeof auth.hasAuth, 'function');
      assert.strictEqual(typeof auth.setRuntimeApiKey, 'function');
      assert.strictEqual(typeof auth.reload, 'function');
    });

    describe('API key from file (api_key type)', () => {
      it('retrieves API key from auth.json file', async () => {
        fs.writeFileSync(authPath, JSON.stringify({
          testprovider: { type: 'api_key', key: 'test-key-123' }
        }));

        const auth = new AuthStorage(authPath);
        const key = await auth.getApiKey('testprovider');
        assert.strictEqual(key, 'test-key-123');
      });

      it('returns undefined for non-existent provider', async () => {
        fs.writeFileSync(authPath, JSON.stringify({}));

        const auth = new AuthStorage(authPath);
        const key = await auth.getApiKey('nonexistent');
        assert.strictEqual(key, undefined);
      });

      it('returns undefined when auth file does not exist', async () => {
        const auth = new AuthStorage(authPath);
        const key = await auth.getApiKey('anyprovider');
        assert.strictEqual(key, undefined);
      });
    });

    describe('API key from environment variables', () => {
      it('retrieves API key from environment variable', async () => {
        process.env.ANTHROPIC_API_KEY = 'env-anthropic-key';

        const auth = new AuthStorage(authPath);
        const key = await auth.getApiKey('anthropic');
        assert.strictEqual(key, 'env-anthropic-key');
      });

      it('retrieves OpenAI API key from environment', async () => {
        process.env.OPENAI_API_KEY = 'env-openai-key';

        const auth = new AuthStorage(authPath);
        const key = await auth.getApiKey('openai');
        assert.strictEqual(key, 'env-openai-key');
      });

      it('retrieves Google API key from environment', async () => {
        process.env.GEMINI_API_KEY = 'env-google-key';

        const auth = new AuthStorage(authPath);
        const key = await auth.getApiKey('google');
        assert.strictEqual(key, 'env-google-key');
      });
    });

    describe('Runtime API key override', () => {
      it('runtime override takes precedence over file', async () => {
        fs.writeFileSync(authPath, JSON.stringify({
          testprovider: { type: 'api_key', key: 'file-key' }
        }));

        const auth = new AuthStorage(authPath);
        auth.setRuntimeApiKey('testprovider', 'runtime-key');

        const key = await auth.getApiKey('testprovider');
        assert.strictEqual(key, 'runtime-key');
      });

      it('runtime override takes precedence over environment', async () => {
        process.env.ANTHROPIC_API_KEY = 'env-key';

        const auth = new AuthStorage(authPath);
        auth.setRuntimeApiKey('anthropic', 'runtime-key');

        const key = await auth.getApiKey('anthropic');
        assert.strictEqual(key, 'runtime-key');
      });
    });

    describe('set() and persistence', () => {
      it('saves credentials to file', () => {
        const auth = new AuthStorage(authPath);
        auth.set('myprovider', { type: 'api_key', key: 'my-key' });

        const saved = JSON.parse(fs.readFileSync(authPath, 'utf8'));
        assert.strictEqual(saved.myprovider.type, 'api_key');
        assert.strictEqual(saved.myprovider.key, 'my-key');
      });

      it('creates directory if needed', () => {
        const nestedDir = path.join(tempDir, 'nested', 'deep');
        const nestedPath = path.join(nestedDir, 'auth.json');

        const auth = new AuthStorage(nestedPath);
        auth.set('provider', { type: 'api_key', key: 'key' });

        assert.strictEqual(fs.existsSync(nestedDir), true);
      });
    });

    describe('hasAuth()', () => {
      it('returns true when provider has auth in file', async () => {
        fs.writeFileSync(authPath, JSON.stringify({
          testprovider: { type: 'api_key', key: 'test-key' }
        }));

        const auth = new AuthStorage(authPath);
        assert.strictEqual(await auth.hasAuth('testprovider'), true);
      });

      it('returns true when provider has runtime override', async () => {
        const auth = new AuthStorage(authPath);
        auth.setRuntimeApiKey('runtimeprovider', 'key');
        assert.strictEqual(await auth.hasAuth('runtimeprovider'), true);
      });

      it('returns true when provider has env variable', async () => {
        process.env.ANTHROPIC_API_KEY = 'key';

        const auth = new AuthStorage(authPath);
        assert.strictEqual(await auth.hasAuth('anthropic'), true);
      });

      it('returns false when provider has no auth', async () => {
        const auth = new AuthStorage(authPath);
        assert.strictEqual(await auth.hasAuth('unknown'), false);
      });
    });

    describe('reload()', () => {
      it('reloads credentials from disk', async () => {
        fs.writeFileSync(authPath, JSON.stringify({
          testprovider: { type: 'api_key', key: 'original-key' }
        }));

        const auth = new AuthStorage(authPath);
        assert.strictEqual(await auth.getApiKey('testprovider'), 'original-key');

        // Modify file externally
        fs.writeFileSync(authPath, JSON.stringify({
          testprovider: { type: 'api_key', key: 'updated-key' }
        }));

        auth.reload();
        assert.strictEqual(await auth.getApiKey('testprovider'), 'updated-key');
      });
    });

    describe('OAuth support', () => {
      it('stores and recognizes OAuth credentials', async () => {
        const auth = new AuthStorage(authPath);
        auth.set('oauthprovider', {
          type: 'oauth',
          accessToken: 'token123',
          refreshToken: 'refresh456',
          expires: Date.now() + 3600000
        });

        assert.strictEqual(await auth.hasAuth('oauthprovider'), true);
      });
    });
  });

  describe('createAuthStorage()', () => {
    it('creates AuthStorage with custom path', () => {
      const auth = createAuthStorage(authPath);
      assert.ok(auth instanceof AuthStorage);
    });

    it('creates AuthStorage with default path when no argument', () => {
      const auth = createAuthStorage();
      assert.ok(auth instanceof AuthStorage);
    });
  });
});
