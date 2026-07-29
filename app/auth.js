import fs from 'fs';
import path from 'path';

const AUTH_FILE_WRITE_OPTIONS = { encoding: 'utf8', mode: 0o600 };

const ENV_KEYS_BY_PROVIDER = {
  anthropic: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
  openai: ['OPENAI_API_KEY'],
  google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  'google-vertex': ['GOOGLE_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  opencode: ['OPENCODE_API_KEY'],
  brave: ['BRAVE_API_KEY'],
  discord: ['JEVONS_DISCORD_TOKEN', 'DISCORD_TOKEN'],
  mistral: ['MISTRAL_API_KEY'],
  deepseek: ['DEEPSEEK_API_KEY'],
  groq: ['GROQ_API_KEY'],
  xai: ['XAI_API_KEY'],
  together: ['TOGETHER_API_KEY'],
};

function getDefaultAuthPath() {
  return path.join(process.cwd(), 'config', 'auth.json');
}

function providerEnvKeys(provider) {
  const normalized = String(provider || '').toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return [...(ENV_KEYS_BY_PROVIDER[provider] || []), `${normalized}_API_KEY`];
}

function firstEnv(provider) {
  for (const key of providerEnvKeys(provider)) {
    const value = process.env[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function normalizeCredential(credential) {
  if (!credential || typeof credential !== 'object') return credential;
  if (credential.type === 'oauth') {
    return {
      ...credential,
      access: credential.access ?? credential.accessToken,
      refresh: credential.refresh ?? credential.refreshToken,
    };
  }
  return credential;
}

/**
 * AuthStorage with Jevons' path convention.
 * Default: ./config/auth.json (project-local, not ~/.pi/agent/).
 *
 * This intentionally implements the small CredentialStore surface expected by
 * pi 0.82+, plus Jevons' older convenience methods used throughout the harness.
 */
export class AuthStorage {
  constructor(authPath) {
    this.authPath = authPath || getDefaultAuthPath();
    this.data = {};
    this.runtimeApiKeys = new Map();
    this.reload();
  }

  ensureParentDir() {
    fs.mkdirSync(path.dirname(this.authPath), { recursive: true, mode: 0o700 });
  }

  loadFromDisk() {
    try {
      if (!fs.existsSync(this.authPath)) return {};
      const text = fs.readFileSync(this.authPath, 'utf8');
      if (!text.trim()) return {};
      return JSON.parse(text);
    } catch {
      return this.data || {};
    }
  }

  saveToDisk(data) {
    this.ensureParentDir();
    fs.writeFileSync(this.authPath, JSON.stringify(data, null, 2), AUTH_FILE_WRITE_OPTIONS);
    try { fs.chmodSync(this.authPath, 0o600); } catch { /* best effort */ }
  }

  reload() {
    this.data = this.loadFromDisk();
  }

  set(provider, credential) {
    const data = this.loadFromDisk();
    data[provider] = normalizeCredential(credential);
    this.data = data;
    this.saveToDisk(data);
  }

  setRuntimeApiKey(provider, apiKey) {
    if (apiKey === undefined || apiKey === null || apiKey === '') {
      this.runtimeApiKeys.delete(provider);
    } else {
      this.runtimeApiKeys.set(provider, apiKey);
    }
  }

  async getApiKey(provider) {
    if (this.runtimeApiKeys.has(provider)) return this.runtimeApiKeys.get(provider);

    const credential = normalizeCredential(await this.read(provider));
    if (credential?.type === 'api_key' && credential.key) return credential.key;

    if (credential?.type === 'oauth') {
      try {
        const auth = await this.resolvePiAuth(provider);
        if (auth?.apiKey) return auth.apiKey;
      } catch {
        // Fall back to the stored token below; a stale token is better than no token for legacy callers.
      }
      return credential.access ?? credential.accessToken;
    }

    return firstEnv(provider);
  }

  async hasAuth(provider) {
    if (this.runtimeApiKeys.has(provider)) return true;
    if (await this.read(provider)) return true;
    return firstEnv(provider) !== undefined;
  }

  async read(provider) {
    const credential = this.data[provider] ?? this.loadFromDisk()[provider];
    return normalizeCredential(credential);
  }

  async list() {
    const data = this.loadFromDisk();
    return Object.entries(data)
      .filter(([, credential]) => credential?.type)
      .map(([providerId, credential]) => ({ providerId, type: credential.type }));
  }

  async modify(provider, fn) {
    const data = this.loadFromDisk();
    const current = normalizeCredential(data[provider]);
    const next = await fn(current);
    if (next !== undefined) {
      data[provider] = normalizeCredential(next);
      this.data = data;
      this.saveToDisk(data);
      return data[provider];
    }
    this.data = data;
    return current;
  }

  async delete(provider) {
    const data = this.loadFromDisk();
    delete data[provider];
    this.data = data;
    this.saveToDisk(data);
  }

  async createModelRuntime() {
    const { ModelRuntime } = await import('@earendil-works/pi-coding-agent');
    return ModelRuntime.create({
      credentials: this,
      modelsPath: null,
      allowModelNetwork: false,
    });
  }

  async resolvePiAuth(provider) {
    const runtime = await this.createModelRuntime();
    const result = await runtime.getAuth(provider);
    return result?.auth;
  }

  async login(provider, callbacks = {}) {
    const runtime = await this.createModelRuntime();
    const piProvider = runtime.getProvider(provider);
    if (!piProvider?.auth?.oauth) {
      throw new Error(`Provider "${provider}" does not support OAuth login.`);
    }

    return runtime.login(provider, 'oauth', {
      signal: callbacks.signal,
      notify: (event) => {
        if (event.type === 'auth_url') {
          callbacks.onAuth?.({ url: event.url, instructions: event.instructions });
        } else if (event.type === 'device_code') {
          callbacks.onDeviceCode?.({
            userCode: event.userCode,
            verificationUri: event.verificationUri,
            intervalSeconds: event.intervalSeconds,
            expiresInSeconds: event.expiresInSeconds,
          });
        } else if (event.type === 'progress' || event.type === 'info') {
          callbacks.onProgress?.(event.message);
        }
      },
      prompt: async (promptConfig) => {
        if (promptConfig.type === 'select' && callbacks.onSelect) {
          return await callbacks.onSelect({
            message: promptConfig.message,
            options: promptConfig.options,
          });
        }
        if (promptConfig.type === 'manual_code' && callbacks.onManualCodeInput) {
          return await callbacks.onManualCodeInput();
        }
        if (callbacks.onPrompt) {
          return await callbacks.onPrompt({
            message: promptConfig.message,
            placeholder: promptConfig.placeholder,
            allowEmpty: promptConfig.type !== 'secret',
            signal: promptConfig.signal,
          });
        }
        throw new Error(`No prompt handler available for ${promptConfig.type} prompt.`);
      },
    });
  }
}

/**
 * Create AuthStorage with Jevons' path convention.
 * @param {string} [customPath] - Optional custom auth file path
 * @returns {AuthStorage} Configured AuthStorage instance
 */
export function createAuthStorage(customPath) {
  return new AuthStorage(customPath);
}
