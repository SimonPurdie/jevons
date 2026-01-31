const fs = require('fs');

/**
 * Parse a log entry line in the new simplified format.
 * Format: "<role>: [Discord Guild #<guild> <surface> id:<id> +<offset>m <time> GMT] <author>:"
 */
function parseLogLine(line) {
  if (!line || typeof line !== 'string') {
    return null;
  }

  // Match the header line: "<role>: [Discord Guild #<guild> <surface> id:<id> +<offset>m <YYYY-MM-DD> <HH:MM> GMT] <author>:"
  // Example: "user: [Discord Guild #TestGuild channel id:123 +0m 2026-01-30 14:24 GMT] author:"
  const headerMatch = line.match(/^(user|assistant): \[Discord Guild #([^\]]+)\]\s*(.+):\s*$/);
  if (!headerMatch) {
    return null;
  }

  const role = headerMatch[1];
  const contextStr = headerMatch[2];
  const authorName = headerMatch[3];
  
  // Parse context parts from within the brackets
  // Format: <guildName> <surface> id:<contextId> <offset> <date> <time> GMT
  const contextMatch = contextStr.match(/^(.+?)\s+(\w+)\s+id:(\S+)\s+([\+\-]?\d+m)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+GMT$/);
  if (!contextMatch) {
    return { role, authorName, content: '' };
  }

  const [, guildName, surface, contextId, offset, localDate, localTime] = contextMatch;

  return {
    role,
    guildName,
    surface,
    contextId,
    offset,
    localTime: `${localDate} ${localTime}`,
    authorName,
    content: '',
  };
}

/**
 * Read and parse all log entries from a file.
 * Returns array of entries with role, content, and metadata.
 */
function readAllLogEntries(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const entries = [];
  let currentEntry = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check if this is a header line (starts with "user:" or "assistant:")
    const headerMatch = line.match(/^(user|assistant): \[Discord Guild #/);
    if (headerMatch) {
      // Save previous entry if exists
      if (currentEntry) {
        // Trim trailing newline from content before saving
        currentEntry.content = currentEntry.content.replace(/\n$/, '');
        entries.push(currentEntry);
      }
      
      // Parse the header
      const parsed = parseLogLine(line);
      if (parsed) {
        currentEntry = {
          ...parsed,
          line: i + 1,
          path: filePath,
        };
      }
    } else if (currentEntry) {
      // This is content or metadata for the current entry
      const messageIdMatch = line.match(/^\[message_id: ([^\]]+)\]$/);
      if (messageIdMatch) {
        currentEntry.messageId = messageIdMatch[1];
      } else if (line.trim() || currentEntry.content) {
        // Append to content (even empty lines if we've started collecting content)
        currentEntry.content += (currentEntry.content ? '\n' : '') + line;
      }
    }
  }

  // Don't forget the last entry
  if (currentEntry) {
    // Trim trailing newline from content
    currentEntry.content = currentEntry.content.replace(/\n$/, '');
    entries.push(currentEntry);
  }

  return entries;
}

/**
 * Read a specific log entry by line number.
 */
function readLogEntry(filePath, lineNumber) {
  if (!filePath || typeof lineNumber !== 'number') {
    return null;
  }
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const entries = readAllLogEntries(filePath);
  return entries.find(e => e.line === lineNumber) || null;
}

module.exports = {
  parseLogLine,
  readLogEntry,
  readAllLogEntries,
};
