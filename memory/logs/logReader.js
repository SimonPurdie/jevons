const fs = require('fs');

function parseLogLine(line) {
  if (!line || typeof line !== 'string') {
    return null;
  }

  const match = line.match(/^-\s+\*\*([^*]+)\*\*\s+\[([^\]]+)\]\s+(.+)$/);
  if (!match) {
    return null;
  }

  const timestamp = match[1];
  const role = match[2];
  const messageContent = match[3];

  return {
    timestamp,
    role,
    content: messageContent.replace(/\s*\([^)]*\)$/, ''),
  };
}

function readLogEntry(filePath, lineNumber) {
  if (!filePath || typeof lineNumber !== 'number') {
    return null;
  }
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const line = lines[lineNumber - 1];
  if (!line) {
    return null;
  }

  const parsed = parseLogLine(line);
  if (!parsed) {
    return null;
  }

  return {
    ...parsed,
    path: filePath,
    line: lineNumber,
  };
}

module.exports = {
  parseLogLine,
  readLogEntry,
};
