const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Format a date for entry timestamp (ISO format)
 */
function formatTimestamp(date = new Date()) {
  return date.toISOString();
}

/**
 * Format a date for filename using local time: YYYY-MM-DD-hhmm
 */
function formatWindowTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}-${hours}${minutes}`;
}

/**
 * Get default memory root directory: ~/jevons/memory/
 */
function getDefaultMemoryRoot() {
  const homeDir = os.homedir();
  return path.join(homeDir, 'jevons', 'memory');
}

/**
 * Resolve log file path in flat structure: ~/jevons/memory/YYYY-MM-DD-hhmm.md
 */
function resolveLogPath(memoryRoot, windowTimestamp) {
  const logPath = path.join(memoryRoot, `${windowTimestamp}.md`);
  return {
    dir: memoryRoot,
    path: logPath,
  };
}

/**
 * Format a local timestamp for Discord context: YYYY-MM-DD hh:mm GMT
 */
function formatLocalDiscordTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * Calculate time offset in minutes from window start
 */
function getTimeOffset(windowStart, entryTime) {
  const diffMs = entryTime.getTime() - windowStart.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  return diffMins > 0 ? `+${diffMins}m` : `${diffMins}m`;
}

function createLogWriter(options) {
  const {
    memoryRoot,
    windowTimestamp,
    context,
  } = options || {};

  if (!memoryRoot) {
    throw new Error('memoryRoot is required');
  }
  if (!windowTimestamp) {
    throw new Error('windowTimestamp is required');
  }
  if (!context) {
    throw new Error('context is required (must include surface, contextId, guildName)');
  }

  const { dir: logsDir, path: logPath } = resolveLogPath(memoryRoot, windowTimestamp);

  // Ensure memory directory exists
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const windowStartDate = new Date();
  // Parse window timestamp to get start date
  const [year, month, day, hourMin] = windowTimestamp.split('-');
  const hours = hourMin.slice(0, 2);
  const mins = hourMin.slice(2);
  windowStartDate.setFullYear(parseInt(year));
  windowStartDate.setMonth(parseInt(month) - 1);
  windowStartDate.setDate(parseInt(day));
  windowStartDate.setHours(parseInt(hours));
  windowStartDate.setMinutes(parseInt(mins));
  windowStartDate.setSeconds(0);
  windowStartDate.setMilliseconds(0);

  // Write simple header if file doesn't exist
  if (!fs.existsSync(logPath)) {
    fs.writeFileSync(logPath, `# Session: ${formatLocalDiscordTimestamp(windowStartDate)} GMT\n\n`, 'utf8');
  }

  function append(entry) {
    const entryTime = entry.timestamp ? new Date(entry.timestamp) : new Date();
    const role = entry.role === 'user' ? 'user' : 'assistant';
    const content = (entry.content || '');
    
    // Format Discord context line similar to clawd examples
    // [Discord Guild #<guild> channel id:<channel-id> +<offset>m <local-time> GMT] <author>:
    const offset = getTimeOffset(windowStartDate, entryTime);
    const localTime = formatLocalDiscordTimestamp(entryTime);
    const authorName = entry.authorName || (role === 'user' ? 'user' : 'assistant');
    const guildName = context.guildName || 'Unknown';
    const contextId = context.contextId || 'unknown';
    
    let line = `${role}: [Discord Guild #${guildName} ${context.surface} id:${contextId} ${offset} ${localTime} GMT] ${authorName}:\n`;
    
    // Add content with proper indentation for multi-line
    const contentLines = content.split('\n');
    for (const contentLine of contentLines) {
      line += `${contentLine}\n`;
    }
    
    // Add message_id if available (minimal metadata)
    if (entry.messageId) {
      line += `[message_id: ${entry.messageId}]\n`;
    }
    
    fs.appendFileSync(logPath, line, 'utf8');
    
    // Count lines for return value
    const fileContent = fs.readFileSync(logPath, 'utf8');
    const lineCount = fileContent.split('\n').length;
    
    return {
      path: logPath,
      line: lineCount,
    };
  }

  return {
    path: logPath,
    append,
  };
}

function createContextWindowResolver(options) {
  const { memoryRoot } = options || {};
  if (!memoryRoot) {
    throw new Error('memoryRoot is required');
  }

  const activeWindows = new Map();

  function getOrCreateContextWindow(surface, contextId, context, timestamp = new Date()) {
    const key = `${surface}:${contextId}`;
    if (activeWindows.has(key)) {
      return activeWindows.get(key);
    }

    const windowTimestamp = formatWindowTimestamp(timestamp);

    const writer = createLogWriter({
      memoryRoot,
      windowTimestamp,
      context: {
        surface,
        contextId,
        guildName: context?.guildName || 'Unknown',
      },
    });

    activeWindows.set(key, writer);
    return writer;
  }

  function endContextWindow(surface, contextId) {
    const key = `${surface}:${contextId}`;
    activeWindows.delete(key);
  }

  function resetContextWindow(surface, contextId, context, timestamp = new Date()) {
    endContextWindow(surface, contextId);
    return getOrCreateContextWindow(surface, contextId, context, timestamp);
  }

  return {
    getOrCreateContextWindow,
    endContextWindow,
    resetContextWindow,
    _activeWindows: activeWindows,
  };
}

module.exports = {
  createLogWriter,
  createContextWindowResolver,
  formatTimestamp,
  formatWindowTimestamp,
  formatLocalDiscordTimestamp,
  getDefaultMemoryRoot,
  resolveLogPath,
};
