const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadConfig } = require('../../app/config');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-config-'));
}

function writeConfig(dir, data) {
  const configDir = path.join(dir, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2));
  return configPath;
}

test('loadConfig returns default structure when config file missing', () => {
  const dir = makeTempDir();
  const config = loadConfig({ cwd: dir, env: {} });
  // Expect models: {} by default now
  assert.deepEqual(config, { models: {} });
});

test('loadConfig reads config/config.json when present', () => {
  const dir = makeTempDir();
  const data = {
    discord: { token: 'file-token', channel_id: '123' },
    activeModel: 'primary',
    models: {
      primary: { provider: 'google', model: 'gemini-1.5-flash' }
    }
  };
  writeConfig(dir, data);
  const config = loadConfig({ cwd: dir, env: {} });
  assert.deepEqual(config, data);
});

test('loadConfig applies environment overrides', () => {
  const dir = makeTempDir();
  const data = {
    discord: { token: 'file-token', channel_id: '123' },
    activeModel: 'primary',
  };
  writeConfig(dir, data);
  const env = {
    JEVONS_DISCORD_TOKEN: 'env-token',
    JEVONS_ACTIVE_MODEL: 'coding',
  };
  const config = loadConfig({ cwd: dir, env });
  assert.equal(config.discord.token, 'env-token');
  assert.equal(config.activeModel, 'coding');
});

test('loadConfig ignores legacy env vars for models', () => {
  const dir = makeTempDir();
  writeConfig(dir, {});
  // JEVONS_MODEL_PROVIDER was removed from ENV_MAP
  const env = {
    JEVONS_MODEL_PROVIDER: 'openai',
  };
  const config = loadConfig({ cwd: dir, env });
  assert.equal(config.model, undefined);
  assert.equal(config.models.provider, undefined);
});

test('loadConfig normalizes empty config to have models object', () => {
  const dir = makeTempDir();
  writeConfig(dir, {});
  const config = loadConfig({ cwd: dir, env: {} });
  assert.deepEqual(config, { models: {} });
});
