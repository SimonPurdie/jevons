const LEVELS = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
};

// Map levels to numeric values for comparison
const LEVEL_VALUES = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

function getLevelValue(level) {
  return LEVEL_VALUES[level] !== undefined ? LEVEL_VALUES[level] : LEVEL_VALUES.INFO;
}

function shouldLog(level, currentLevel = process.env.LOG_LEVEL) {
  const normalizedCurrent = (currentLevel || 'INFO').toUpperCase();
  const threshold = getLevelValue(normalizedCurrent);
  const value = getLevelValue(level);
  return value >= threshold;
}

function formatLog(level, message, context = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };

  // Merge context, but avoid overwriting core fields if possible, or decide precedence
  if (context) {
    if (context instanceof Error) {
      entry.error = {
        message: context.message,
        stack: context.stack,
        name: context.name,
      };
    } else {
      Object.assign(entry, context);
    }
  }

  return JSON.stringify(entry);
}

function log(level, message, context) {
  if (shouldLog(level)) {
    const output = formatLog(level, message, context);
    // eslint-disable-next-line no-console
    if (level === LEVELS.ERROR) {
      console.error(output);
    } else {
      // eslint-disable-next-line no-console
      console.log(output);
    }
  }
}

module.exports = {
  LEVELS,
  debug: (msg, ctx) => log(LEVELS.DEBUG, msg, ctx),
  info: (msg, ctx) => log(LEVELS.INFO, msg, ctx),
  warn: (msg, ctx) => log(LEVELS.WARN, msg, ctx),
  error: (msg, ctx) => log(LEVELS.ERROR, msg, ctx),
  // For testing
  formatLog,
  shouldLog,
};
