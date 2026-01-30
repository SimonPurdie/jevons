const fs = require('fs');
const path = require('path');

const ENV_MAP = {
  JEVONS_DISCORD_TOKEN: ['discord', 'token'],
  JEVONS_DISCORD_CHANNEL_ID: ['discord', 'channel_id'],
  JEVONS_MODEL_PROVIDER: ['model', 'provider'],
  JEVONS_MODEL_NAME: ['model', 'model'],
  JEVONS_MEMORY_LOGS_ROOT: ['memory', 'logs_root'],
  JEVONS_MEMORY_INDEX_PATH: ['memory', 'index_path'],
  JEVONS_MEMORY_PINS_PATH: ['memory', 'pins_path'],
  JEVONS_REMINDERS_FILE_PATH: ['reminders', 'file_path'],
  JEVONS_REMINDERS_TIMEZONE: ['reminders', 'timezone'],
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeDeep(target, source) {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = mergeDeep(result[key], value);
      continue;
    }
    result[key] = value;
  }
  return result;
}

function setDeep(target, pathParts, value) {
  let cursor = target;
  for (let i = 0; i < pathParts.length - 1; i += 1) {
    const part = pathParts[i];
    if (!isPlainObject(cursor[part])) {
      cursor[part] = {};
    }
    cursor = cursor[part];
  }
  cursor[pathParts[pathParts.length - 1]] = value;
}

function readConfigFile(configPath) {
  if (!fs.existsSync(configPath)) {
    return {};
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  if (!raw.trim()) {
    return {};
  }
  return JSON.parse(raw);
}

function applyEnvOverrides(config, env) {
  const result = mergeDeep({}, config);
  for (const [envKey, pathParts] of Object.entries(ENV_MAP)) {
    const value = env[envKey];
    if (value === undefined || value === '') {
      continue;
    }
    setDeep(result, pathParts, value);
  }
  return result;
}

function loadConfig(options = {}) {
  const cwd = options.cwd || process.cwd();
  const env = options.env || process.env;
  const configPath = options.configPath || path.join(cwd, 'config', 'jevons.config.json');
  const baseConfig = readConfigFile(configPath);
  return applyEnvOverrides(baseConfig, env);
}

module.exports = {
  loadConfig,
  readConfigFile,
  applyEnvOverrides,
};
