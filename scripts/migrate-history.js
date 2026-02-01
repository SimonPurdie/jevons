import fs from 'fs';
import path from 'path';
import { DiscordSessionManager } from '../app/sessionManager.js';
import { getSessionDir } from '../app/session.js';
import { loadConfig } from '../app/config.js';

/**
 * Parse a log entry line in the new simplified format.
 * Format: "<role>: [Discord Guild #<guild> <surface> id:<id> +<offset>m <time> GMT] <author>:"
 */
function parseLogLine(line) {
  if (!line || typeof line !== 'string') {
    return null;
  }

  const headerMatch = line.match(/^(user|assistant): \[Discord Guild #([^\]]+)\]\s*(.+):\s*$/);
  if (!headerMatch) {
    return null;
  }

  const role = headerMatch[1];
  const contextStr = headerMatch[2];
  const authorName = headerMatch[3];
  
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
    
    const headerMatch = line.match(/^(user|assistant): \[Discord Guild #/);
    if (headerMatch) {
      if (currentEntry) {
        currentEntry.content = currentEntry.content.replace(/\n$/, '');
        entries.push(currentEntry);
      }
      
      const parsed = parseLogLine(line);
      if (parsed) {
        currentEntry = {
          ...parsed,
          line: i + 1,
          path: filePath,
        };
      }
    } else if (currentEntry) {
      const messageIdMatch = line.match(/^\[message_id: ([^\]]+)\]$/);
      if (messageIdMatch) {
        currentEntry.messageId = messageIdMatch[1];
      } else if (line.trim() || currentEntry.content) {
        currentEntry.content += (currentEntry.content ? '\n' : '') + line;
      }
    }
  }

  if (currentEntry) {
    currentEntry.content = currentEntry.content.replace(/\n$/, '');
    entries.push(currentEntry);
  }

  return entries;
}

async function migrate() {
  const args = process.argv.slice(2);
  const historyDir = args[0] || path.join(process.cwd(), 'history');
  
  if (!fs.existsSync(historyDir)) {
    console.error(`History directory not found: ${historyDir}`);
    process.exit(1);
  }

  const config = loadConfig();
  const sessionDir = getSessionDir(config);
  
  const discordSessionManager = new DiscordSessionManager({
    sessionDir,
    cwd: process.cwd()
  });

  const files = fs.readdirSync(historyDir)
    .filter(f => f.endsWith('.md'))
    .sort();

  console.log(`Found ${files.length} history files to migrate.`);

  let totalMigrated = 0;
  let errorCount = 0;

  for (const file of files) {
    const filePath = path.join(historyDir, file);
    console.log(`Migrating ${file}...`);
    
    try {
      const entries = readAllLogEntries(filePath);
      
      for (const entry of entries) {
        if (!entry.contextId) {
          console.warn(`  Skipping entry on line ${entry.line} in ${file}: No contextId found.`);
          continue;
        }

        const session = discordSessionManager.getOrCreate(entry.contextId);
        const timestamp = new Date(entry.localTime + ' GMT').getTime();
        
        session.sessionManager.appendMessage({
          role: entry.role,
          content: entry.content,
          timestamp: isNaN(timestamp) ? Date.now() : timestamp,
          name: entry.authorName
        });
        
        totalMigrated++;
      }
    } catch (err) {
      console.error(`  Error migrating ${file}: ${err.message}`);
      errorCount++;
    }
  }

  console.log('\nMigration complete.');
  console.log(`Total messages migrated: ${totalMigrated}`);
  console.log(`Files with errors: ${errorCount}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
