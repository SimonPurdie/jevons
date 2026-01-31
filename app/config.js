const fs = require('fs');
const path = require('path');

// Only map non-secret env vars if needed. 
// Secrets (API keys) are handled by AuthStorage or specific ENV vars loaded by the runtime/SDK.
const ENV_MAP = {
  JEVONS_DISCORD_TOKEN: ['discord', 'token'],
  JEVONS_DISCORD_CHANNEL_ID: ['discord', 'channel_id'],
  JEVONS_REMINDERS_FILE_PATH: ['reminders', 'file_path'],
  JEVONS_REMINDERS_TIMEZONE: ['reminders', 'timezone'],
  JEVONS_ACTIVE_MODEL: ['activeModel'],
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

function stripQuotes(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
}

function readEnvFile(envPath) {
  if (!fs.existsSync(envPath)) {
    return {};
  }
  const raw = fs.readFileSync(envPath, 'utf8');
  if (!raw.trim()) {
    return {};
  }
  const result = {};
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    const value = stripQuotes(trimmed.slice(eqIndex + 1).trim());
    if (key) {
      result[key] = value;
    }
  }
  return result;
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
  let configPath = options.configPath || path.join(cwd, 'config', 'config.json');

  // Fallback to jevons.config.json if config.json logic was inverted in previous version, 
  // but standardizing on config/config.json or config/jevons.config.json.
  // Prioritizing config.json based on current usage.

  const envPath = options.envPath || path.join(cwd, 'config', '.env');
  const baseConfig = readConfigFile(configPath);
  const fileEnv = readEnvFile(envPath);
  const shouldApplyEnvFile = options.applyEnvFile !== false && options.env === undefined;
  if (shouldApplyEnvFile && fileEnv && typeof fileEnv === 'object') {
    for (const [key, value] of Object.entries(fileEnv)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
  const mergedEnv = { ...fileEnv, ...env };

  // Basic validation/normalization of models structure
  const config = applyEnvOverrides(baseConfig, mergedEnv);

  if (!config.models && !config.model) {
    // If no models defined, create empty structure
    config.models = {};
  } else if (!config.models && config.model) {
    // Migration compatibility: if user has old 'model' block but no 'models', 
    // strictly they should update, but we can treat 'model' as 'default' for now 
    // OR strictly ignore it as per "Remove legacy configuration support".
    // I will ignore it to be strict as requested.
    config.models = {};
  }

  return config;
}

module.exports = {
  loadConfig,
  readConfigFile,
  applyEnvOverrides,
  readEnvFile,
  saveConfig,
};

function saveConfig(config, options = {}) {
  const cwd = options.cwd || process.cwd();
  const configPath = options.configPath || path.join(cwd, 'config', 'config.json');

  // Ensure directory exists
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}
