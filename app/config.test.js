const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { loadConfig } = require('./config');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jevons-config-'));
}

function writeConfig(dir, data) {
  const configDir = path.join(dir, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, 'jevons.config.json');
  fs.writeFileSync(configPath, JSON.stringify(data, null, 2));
  return configPath;
}

test('loadConfig returns empty object when config file missing', () => {
  const dir = makeTempDir();
  const config = loadConfig({ cwd: dir, env: {} });
  assert.deepEqual(config, {});
});

test('loadConfig reads config file when present', () => {
  const dir = makeTempDir();
  const data = {
    discord: { token: 'file-token', channel_id: '123' },
    model: { provider: 'openai', model: 'gpt-4.1-mini' },
  };
  writeConfig(dir, data);
  const config = loadConfig({ cwd: dir, env: {} });
  assert.deepEqual(config, data);
});

test('loadConfig applies environment overrides', () => {
  const dir = makeTempDir();
  const data = {
    discord: { token: 'file-token', channel_id: '123' },
    reminders: { timezone: 'Europe/London' },
  };
  writeConfig(dir, data);
  const env = {
    JEVONS_DISCORD_TOKEN: 'env-token',
    JEVONS_REMINDERS_TIMEZONE: 'Europe/London',
  };
  const config = loadConfig({ cwd: dir, env });
  assert.equal(config.discord.token, 'env-token');
  assert.equal(config.discord.channel_id, '123');
  assert.equal(config.reminders.timezone, 'Europe/London');
});
