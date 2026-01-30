const { createEmbeddingsIndex } = require('../index/sqlite');
const { readAllLogEntries, readLogEntry } = require('../logs/logReader');
const path = require('path');
const fs = require('fs');

/**
 * Pins module for managing pinned memories.
 * 
 * A pinned memory is a message that the user has explicitly marked as important
 * using the /remember command. Pinned memories:
 * - Are always eligible for retrieval
 * - Take precedence over unpinned memories in ranking
 * - Are stored in the embeddings index with pinned=1
 * 
 * The /remember command can reference a message by:
 * - Discord message URL (https://discord.com/channels/...)
 * - Message ID (if the message is in the current context)
 */

class PinsManager {
  constructor(options = {}) {
    this.indexPath = options.indexPath;
    this.logsRoot = options.logsRoot;
    this.index = options.index || null;
  }

  async initialize() {
    if (!this.index && this.indexPath) {
      this.index = createEmbeddingsIndex(this.indexPath);
      await this.index.open();
      await this.index.migrate();
    }
  }

  async close() {
    if (this.index && this.indexPath) {
      await this.index.close();
      this.index = null;
    }
  }

  /**
   * Parse a Discord message reference from a /remember command.
   * 
   * Supported formats:
   * - Discord URL: https://discord.com/channels/{guild}/{channel}/{messageId}
   * - Raw message ID: 1234567890123456789
   * - Reply reference: (when the /remember is a reply to another message)
   * 
   * @param {string} content - The /remember command content
   * @param {string} repliedMessageId - Optional message ID if this is a reply
   * @returns {Object|null} { messageId: string, source: 'url'|'id'|'reply' } or null
   */
  parseMessageReference(content, repliedMessageId = null) {
    if (!content || typeof content !== 'string') {
      return null;
    }

    const trimmed = content.trim();

    // Check for Discord message URL
    const discordUrlPattern = /https:\/\/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/;
    const urlMatch = trimmed.match(discordUrlPattern);
    if (urlMatch) {
      return {
        messageId: urlMatch[3],
        channelId: urlMatch[2],
        guildId: urlMatch[1],
        source: 'url',
      };
    }

    // Check for raw message ID (18-20 digit number)
    const idPattern = /^\/?remember\s+(\d{18,20})$/;
    const idMatch = trimmed.match(idPattern);
    if (idMatch) {
      return {
        messageId: idMatch[1],
        source: 'id',
      };
    }

    // Check if this is a reply to another message
    if (repliedMessageId) {
      return {
        messageId: repliedMessageId,
        source: 'reply',
      };
    }

    // Just /remember with no argument - invalid
    return null;
  }

  /**
   * Parse metadata from a log line.
   * Metadata is in the format: (key="value" key2="value2")
   * 
   * @param {string} line - Raw log line
   * @returns {Object|null} Parsed metadata or null
   */
  _parseMetadata(line) {
    if (!line || typeof line !== 'string') {
      return null;
    }

    const metaMatch = line.match(/\(([^)]+)\)$/);
    if (!metaMatch) {
      return null;
    }

    const metadata = {};
    const metaStr = metaMatch[1];
    
    // Parse key=value pairs where value is JSON-encoded
    const pairRegex = /(\w+)=([\w\-\.]+|"(?:[^"\\]|\\.)*")/g;
    let match;
    while ((match = pairRegex.exec(metaStr)) !== null) {
      const key = match[1];
      let value = match[2];
      
      // Try to parse as JSON (handles quoted strings, numbers, booleans)
      try {
        value = JSON.parse(value);
      } catch (e) {
        // If not valid JSON, use as-is
      }
      
      metadata[key] = value;
    }

    return metadata;
  }

  /**
   * Find a message in the logs by message ID.
   * Searches through all log files in the logs root.
   * 
   * @param {string} messageId - Discord message ID
   * @param {string} contextId - Optional context ID to narrow search
   * @returns {Object|null} Log entry with path and line, or null if not found
   */
  async findMessageInLogs(messageId, contextId = null) {
    if (!this.logsRoot || !fs.existsSync(this.logsRoot)) {
      return null;
    }

    const logsDir = path.join(this.logsRoot, 'logs');
    if (!fs.existsSync(logsDir)) {
      return null;
    }

    // Build list of log files to search
    const filesToSearch = [];

    const surfaces = fs.readdirSync(logsDir);
    for (const surface of surfaces) {
      const surfacePath = path.join(logsDir, surface);
      if (!fs.statSync(surfacePath).isDirectory()) {
        continue;
      }

      const contexts = fs.readdirSync(surfacePath);
      for (const ctx of contexts) {
        // If contextId is specified, only search that context
        if (contextId && ctx !== contextId) {
          continue;
        }

        const contextPath = path.join(surfacePath, ctx);
        if (!fs.statSync(contextPath).isDirectory()) {
          continue;
        }

        const files = fs.readdirSync(contextPath).filter(f => f.endsWith('.md'));
        for (const file of files) {
          filesToSearch.push(path.join(contextPath, file));
        }
      }
    }

    // Search through files for the message
    for (const filePath of filesToSearch) {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Parse metadata from the raw line
        const metadata = this._parseMetadata(line);
        
        // Check if this entry has the messageId in its metadata
        if (metadata && metadata.messageId === messageId) {
          // Also parse the main log entry to get timestamp, role, content
          const baseEntry = readLogEntry(filePath, i + 1);
          if (baseEntry) {
            return {
              ...baseEntry,
              metadata,
              messageId,
            };
          }
        }
      }
    }

    return null;
  }

  /**
   * Find an embedding entry by message ID.
   * This searches for entries where the content matches the log entry.
   * 
   * @param {string} messageId - Discord message ID
   * @param {string} contextId - Optional context ID to narrow search
   * @returns {Object|null} Embedding entry or null
   */
  async findEmbeddingByMessageId(messageId, contextId = null) {
    await this.initialize();

    // First find in logs to get the content/timestamp
    const logEntry = await this.findMessageInLogs(messageId, contextId);
    if (!logEntry) {
      return null;
    }

    // Find embedding by path and approximate line number
    // The line number in the embedding should match the log entry line
    const embedding = await this.index.getByPathAndLine(logEntry.path, logEntry.line);
    if (embedding) {
      return embedding;
    }

    // If not found by path/line, search by context and timestamp
    const contextIdToUse = contextId || logEntry.contextId;
    if (contextIdToUse) {
      const contextEntries = await this.index.getByContextId(contextIdToUse);
      // Find by timestamp match (within a few seconds)
      const logTime = new Date(logEntry.timestamp).getTime();
      for (const entry of contextEntries) {
        const entryTime = new Date(entry.timestamp).getTime();
        if (Math.abs(entryTime - logTime) < 5000) { // Within 5 seconds
          return entry;
        }
      }
    }

    return null;
  }

  /**
   * Pin a message by its Discord message ID.
   * 
   * @param {string} messageId - Discord message ID
   * @param {string} contextId - Optional context ID
   * @returns {Object} { success: boolean, message: string, entry: Object|null }
   */
  async pinMessage(messageId, contextId = null) {
    await this.initialize();

    // Find the embedding entry for this message
    const embedding = await this.findEmbeddingByMessageId(messageId, contextId);
    if (!embedding) {
      return {
        success: false,
        message: `Message ${messageId} not found in memory index.`,
        entry: null,
      };
    }

    // If already pinned, return success
    if (embedding.pinned) {
      return {
        success: true,
        message: `Message ${messageId} is already pinned.`,
        entry: embedding,
      };
    }

    // Update the pinned status
    const updated = await this.index.updatePinned(embedding.id, true);
    if (!updated) {
      return {
        success: false,
        message: `Failed to pin message ${messageId}.`,
        entry: null,
      };
    }

    // Return the updated entry
    const updatedEntry = await this.index.getById(embedding.id);
    return {
      success: true,
      message: `Message ${messageId} has been pinned.`,
      entry: updatedEntry,
    };
  }

  /**
   * Unpin a message by its Discord message ID.
   * 
   * @param {string} messageId - Discord message ID
   * @param {string} contextId - Optional context ID
   * @returns {Object} { success: boolean, message: string, entry: Object|null }
   */
  async unpinMessage(messageId, contextId = null) {
    await this.initialize();

    // Find the embedding entry for this message
    const embedding = await this.findEmbeddingByMessageId(messageId, contextId);
    if (!embedding) {
      return {
        success: false,
        message: `Message ${messageId} not found in memory index.`,
        entry: null,
      };
    }

    // If not pinned, return success
    if (!embedding.pinned) {
      return {
        success: true,
        message: `Message ${messageId} is not pinned.`,
        entry: embedding,
      };
    }

    // Update the pinned status
    const updated = await this.index.updatePinned(embedding.id, false);
    if (!updated) {
      return {
        success: false,
        message: `Failed to unpin message ${messageId}.`,
        entry: null,
      };
    }

    // Return the updated entry
    const updatedEntry = await this.index.getById(embedding.id);
    return {
      success: true,
      message: `Message ${messageId} has been unpinned.`,
      entry: updatedEntry,
    };
  }

  /**
   * Handle a /remember command.
   * Parses the command and pins the referenced message.
   * 
   * @param {string} content - The command content
   * @param {string} repliedMessageId - Optional message ID if this is a reply
   * @param {string} contextId - Optional context ID
   * @returns {Object} { success: boolean, message: string, entry: Object|null }
   */
  async handleRememberCommand(content, repliedMessageId = null, contextId = null) {
    const reference = this.parseMessageReference(content, repliedMessageId);
    if (!reference) {
      return {
        success: false,
        message: 'Invalid /remember command. Use `/remember <message-url>` or reply to a message with `/remember`.',
        entry: null,
      };
    }

    return await this.pinMessage(reference.messageId, contextId);
  }

  /**
   * Get all pinned memories.
   * 
   * @returns {Array} Array of pinned embedding entries
   */
  async getPinnedMemories() {
    await this.initialize();
    return await this.index.getPinned();
  }

  /**
   * Check if a message is pinned.
   * 
   * @param {string} messageId - Discord message ID
   * @param {string} contextId - Optional context ID
   * @returns {boolean}
   */
  async isPinned(messageId, contextId = null) {
    const embedding = await this.findEmbeddingByMessageId(messageId, contextId);
    return embedding ? embedding.pinned : false;
  }
}

/**
 * Factory function to create a PinsManager instance.
 */
function createPinsManager(options = {}) {
  return new PinsManager(options);
}

/**
 * Convenience function to handle a /remember command.
 */
async function handleRemember(content, options = {}) {
  const manager = createPinsManager(options);
  try {
    const result = await manager.handleRememberCommand(
      content,
      options.repliedMessageId,
      options.contextId
    );
    await manager.close();
    return result;
  } catch (error) {
    await manager.close();
    throw error;
  }
}

/**
 * Convenience function to pin a message.
 */
async function pinMessage(messageId, options = {}) {
  const manager = createPinsManager(options);
  try {
    const result = await manager.pinMessage(messageId, options.contextId);
    await manager.close();
    return result;
  } catch (error) {
    await manager.close();
    throw error;
  }
}

module.exports = {
  PinsManager,
  createPinsManager,
  handleRemember,
  pinMessage,
};
