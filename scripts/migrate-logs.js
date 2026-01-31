#!/usr/bin/env node

/**
 * Migration script to convert old format logs to new format.
 * 
 * Old format: data/logs/discord-channel/<channel-id>/YYYYMMDDThhmmssZ_XXXX.md
 * New format: ~/jevons/history/YYYY-MM-DD-hhmm.md
 * 
 * Usage: node scripts/migrate-logs.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const OLD_LOGS_ROOT = path.join(process.cwd(), 'data', 'logs');
const NEW_HISTORY_ROOT = path.join(os.homedir(), 'jevons', 'history');

/**
 * Parse old format window timestamp (YYYYMMDDThhmmssZ) to local time
 */
function parseOldTimestamp(oldTimestamp) {
  // Format: 20260130T213157Z
  const year = parseInt(oldTimestamp.slice(0, 4));
  const month = parseInt(oldTimestamp.slice(4, 6)) - 1; // 0-indexed
  const day = parseInt(oldTimestamp.slice(6, 8));
  const hours = parseInt(oldTimestamp.slice(9, 11));
  const minutes = parseInt(oldTimestamp.slice(11, 13));
  const seconds = parseInt(oldTimestamp.slice(13, 15));
  
  const date = new Date(Date.UTC(year, month, day, hours, minutes, seconds));
  return date;
}

/**
 * Convert old timestamp to new format (YYYY-MM-DD-hhmm)
 */
function convertToNewFormat(oldTimestamp) {
  const date = parseOldTimestamp(oldTimestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}-${hours}${minutes}`;
}

/**
 * Parse old format log line and convert to new format
 */
function convertLogLine(line, surface, contextId, guildName) {
  // Old format: - **2026-01-30T21:31:57.759Z** [user] Hello (authorId="..." messageId="...")
  const match = line.match(/^-\s+\*\*([^*]+)\*\*\s+\[([^\]]+)\]\s+(.+)$/);
  if (!match) {
    return null;
  }
  
  const timestamp = match[1];
  const role = match[2];
  let contentAndMetadata = match[3];
  
  // Extract metadata if present
  const metadataMatch = contentAndMetadata.match(/(.+)\s+\(([^)]+)\)$/);
  let content = contentAndMetadata;
  let metadata = {};
  
  if (metadataMatch) {
    content = metadataMatch[1];
    const metaStr = metadataMatch[2];
    // Parse key=value pairs
    const pairs = metaStr.match(/(\w+)="([^"]+)"/g);
    if (pairs) {
      for (const pair of pairs) {
        const [key, value] = pair.split('=');
        metadata[key] = value.replace(/"/g, '');
      }
    }
  }
  
  // Convert escaped newlines back
  content = content.replace(/\\n/g, '\n');
  
  // Parse timestamp to get local time
  const date = new Date(timestamp);
  const localTime = date.toISOString().slice(0, 16).replace('T', ' ');
  const timeStr = localTime.slice(0, 10) + ' ' + localTime.slice(11, 16);
  
  // Calculate offset from session start
  // For simplicity, we'll use +0m for all migrated entries
  const offset = '+0m';
  
  // Build new format
  const newRole = role === 'user' ? 'user' : 'assistant';
  const authorName = metadata.authorId ? 'user' : (role === 'user' ? 'user' : 'assistant');
  
  let newLine = `${newRole}: [Discord Guild #${guildName} ${surface} id:${contextId} ${offset} ${timeStr} GMT] ${authorName}:\n`;
  newLine += `${content}\n`;
  
  if (metadata.messageId) {
    newLine += `[message_id: ${metadata.messageId}]\n`;
  }
  
  return newLine;
}

/**
 * Migrate a single old log file to new format
 */
function migrateLogFile(oldPath, surface, contextId, guildName) {
  const content = fs.readFileSync(oldPath, 'utf8');
  const lines = content.split('\n');
  
  // Extract timestamp from filename
  const filename = path.basename(oldPath);
  const timestampMatch = filename.match(/^(\d{8}T\d{6}Z)/);
  if (!timestampMatch) {
    console.warn(`Skipping ${oldPath}: cannot parse timestamp`);
    return;
  }
  
  const oldTimestamp = timestampMatch[1];
  const newTimestamp = convertToNewFormat(oldTimestamp);
  const newPath = path.join(NEW_HISTORY_ROOT, `${newTimestamp}.md`);
  
  // Check if target already exists (avoid duplicates)
  if (fs.existsSync(newPath)) {
    console.warn(`Skipping ${oldPath}: ${newPath} already exists`);
    return;
  }
  
  // Convert lines
  let newContent = `# Session: ${newTimestamp.slice(0, 10)} ${newTimestamp.slice(11, 13)}:${newTimestamp.slice(13, 15)} GMT\n\n`;
  
  for (const line of lines) {
    const converted = convertLogLine(line, surface, contextId, guildName);
    if (converted) {
      newContent += converted;
    }
  }
  
  // Write new file
  fs.writeFileSync(newPath, newContent, 'utf8');
  console.log(`Migrated: ${oldPath} -> ${newPath}`);
}

/**
 * Recursively find and migrate all old log files
 */
function migrateAllLogs() {
  if (!fs.existsSync(OLD_LOGS_ROOT)) {
    console.log('No old logs to migrate');
    return;
  }
  
  // Ensure new history directory exists
  if (!fs.existsSync(NEW_HISTORY_ROOT)) {
    fs.mkdirSync(NEW_HISTORY_ROOT, { recursive: true });
    console.log(`Created: ${NEW_HISTORY_ROOT}`);
  }
  
  // Find all old log files
  const surfaces = fs.readdirSync(OLD_LOGS_ROOT);
  
  for (const surface of surfaces) {
    const surfacePath = path.join(OLD_LOGS_ROOT, surface);
    if (!fs.statSync(surfacePath).isDirectory()) {
      continue;
    }
    
    const contextIds = fs.readdirSync(surfacePath);
    for (const contextId of contextIds) {
      const contextPath = path.join(surfacePath, contextId);
      if (!fs.statSync(contextPath).isDirectory()) {
        continue;
      }
      
      const files = fs.readdirSync(contextPath);
      for (const file of files) {
        if (!file.endsWith('.md')) {
          continue;
        }
        
        const oldPath = path.join(contextPath, file);
        // Try to extract guild name from first entry or use contextId as fallback
        const guildName = 'jevons'; // Default guild name - you may want to customize this
        
        migrateLogFile(oldPath, surface, contextId, guildName);
      }
    }
  }
}

// Run migration
console.log('Starting log migration...');
console.log(`From: ${OLD_LOGS_ROOT}`);
console.log(`To: ${NEW_HISTORY_ROOT}`);
console.log('');

migrateAllLogs();

console.log('');
console.log('Migration complete!');
console.log(`\nNext steps:`);
console.log(`1. Review the migrated files in ${NEW_HISTORY_ROOT}`);
console.log(`2. Once satisfied, you can remove the old logs: rm -rf ${OLD_LOGS_ROOT}`);
