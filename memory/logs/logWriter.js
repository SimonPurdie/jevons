const fs = require('fs');
const path = require('path');

function formatTimestamp(date = new Date()) {
  return date.toISOString();
}

function formatWindowTimestamp(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

function getSequenceNumber(logsDir, contextId, windowTimestamp) {
  if (!fs.existsSync(logsDir)) {
    return 0;
  }
  const files = fs.readdirSync(logsDir);
  let maxSeq = -1;
  const prefix = `${windowTimestamp}_`;
  for (const file of files) {
    if (file.startsWith(prefix) && file.endsWith('.md')) {
      const seqPart = file.slice(prefix.length, -3);
      const seq = parseInt(seqPart, 10);
      if (!isNaN(seq) && seq > maxSeq) {
        maxSeq = seq;
      }
    }
  }
  return maxSeq + 1;
}

function resolveLogPath(logsRoot, surface, contextId, windowTimestamp, seq) {
  const logsDir = path.join(logsRoot, 'logs', surface, contextId);
  const seqStr = String(seq).padStart(4, '0');
  return {
    dir: logsDir,
    path: path.join(logsDir, `${windowTimestamp}_${seqStr}.md`),
  };
}

function createLogWriter(options) {
  const {
    logsRoot,
    surface,
    contextId,
    windowTimestamp,
    seq,
  } = options || {};

  if (!logsRoot) {
    throw new Error('logsRoot is required');
  }
  if (!surface) {
    throw new Error('surface is required');
  }
  if (!contextId) {
    throw new Error('contextId is required');
  }
  if (!windowTimestamp) {
    throw new Error('windowTimestamp is required');
  }
  if (typeof seq !== 'number') {
    throw new Error('seq is required');
  }

  const { dir: logsDir, path: logPath } = resolveLogPath(
    logsRoot,
    surface,
    contextId,
    windowTimestamp,
    seq
  );

  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  // Write header to claim the file/sequence number
  if (!fs.existsSync(logPath)) {
    fs.writeFileSync(logPath, `# Context Window: ${surface}/${contextId}\n` +
      `# Started: ${windowTimestamp}\n` +
      `# Sequence: ${seq}\n\n`, 'utf8');
  }

  function append(entry) {
    const timestamp = entry.timestamp || formatTimestamp();
    const role = entry.role;
    const content = entry.content || '';
    const metadata = entry.metadata;

    let line = `- **${timestamp}** [${role}] ${content}`;
    if (metadata) {
      const metaStr = Object.entries(metadata)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(' ');
      line += ` (${metaStr})`;
    }
    line += '\n';

    fs.appendFileSync(logPath, line, 'utf8');
    return {
      path: logPath,
      line: fs.readFileSync(logPath, 'utf8').split('\n').length - 1,
    };
  }

  return {
    path: logPath,
    append,
  };
}

function createContextWindowResolver(options) {
  const { logsRoot } = options || {};
  if (!logsRoot) {
    throw new Error('logsRoot is required');
  }

  const activeWindows = new Map();

  function getOrCreateContextWindow(surface, contextId, timestamp = new Date()) {
    const key = `${surface}:${contextId}`;
    if (activeWindows.has(key)) {
      return activeWindows.get(key);
    }

    const windowTimestamp = formatWindowTimestamp(timestamp);
    const logsDir = path.join(logsRoot, 'logs', surface, contextId);
    const seq = getSequenceNumber(logsDir, contextId, windowTimestamp);

    const writer = createLogWriter({
      logsRoot,
      surface,
      contextId,
      windowTimestamp,
      seq,
    });

    activeWindows.set(key, writer);
    return writer;
  }

  function endContextWindow(surface, contextId) {
    const key = `${surface}:${contextId}`;
    activeWindows.delete(key);
  }

  function resetContextWindow(surface, contextId, timestamp = new Date()) {
    endContextWindow(surface, contextId);
    return getOrCreateContextWindow(surface, contextId, timestamp);
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
  getSequenceNumber,
  resolveLogPath,
};
