/**
 * Chat history windowing module.
 *
 * Reads conversation history from log files and formats it for model context.
 * Follows SPEC.md for prompt-side chat history injection.
 */

const { readAllLogEntries } = require('./logs/logReader');

const DEFAULT_CONFIG = {
  maxHistoryMessages: 20,
  maxTokensPerMessage: 500,
  charsPerToken: 4,
  totalTokenBudget: 3000,
};

class ChatHistoryWindow {
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };
  }

  /**
   * Estimate token count from character count using simple heuristic.
   * 4 characters ≈ 1 token (per SPEC.md)
   *
   * @param {string} text - Text to estimate
   * @returns {number} Estimated token count
   */
  estimateTokens(text) {
    if (!text || typeof text !== 'string') {
      return 0;
    }
    return Math.ceil(text.length / this.config.charsPerToken);
  }

  /**
   * Truncate text to fit within a token budget.
   *
   * @param {string} text - Text to truncate
   * @param {number} maxTokens - Maximum tokens allowed
   * @returns {string} Truncated text
   */
  truncateToBudget(text, maxTokens) {
    if (!text || typeof text !== 'string') {
      return '';
    }

    const maxChars = maxTokens * this.config.charsPerToken;

    if (text.length <= maxChars) {
      return text;
    }

    // Reserve space for "..." (3 chars)
    const availableChars = maxChars - 3;
    return text.substring(0, availableChars) + '...';
  }

  /**
   * Format a log entry as a chat message.
   *
   * @param {Object} entry - Log entry from readAllLogEntries
   * @param {string} entry.role - 'user' or 'agent'
   * @param {string} entry.content - Message content
   * @returns {Object} Formatted message { role: string, content: string }
   */
  formatMessage(entry) {
    const role = entry.role === 'user' ? 'user' : 'assistant';
    const content = this.truncateToBudget(
      entry.content || '',
      this.config.maxTokensPerMessage
    );

    return { role, content };
  }

  /**
   * Select recent messages that fit within token budget.
   * Prioritizes most recent messages (from end of array).
   *
   * @param {Array} messages - Array of formatted messages
   * @returns {Array} Messages that fit within budget
   */
  selectMessagesWithinBudget(messages) {
    // Start from the end (most recent) and work backwards
    const selected = [];
    let usedTokens = 0;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const msgTokens = this.estimateTokens(msg.content);

      if (usedTokens + msgTokens > this.config.totalTokenBudget) {
        break;
      }

      selected.unshift(msg);
      usedTokens += msgTokens;
    }

    return selected;
  }

  /**
   * Build chat history from log entries.
   *
   * @param {Array} entries - Log entries from readAllLogEntries
   * @returns {Array} Array of formatted messages { role, content }
   */
  buildHistory(entries) {
    if (!entries || entries.length === 0) {
      return [];
    }

    // Filter to only user and agent roles (exclude system/tool messages)
    const relevantEntries = entries.filter(
      (entry) => entry.role === 'user' || entry.role === 'agent'
    );

    // Take most recent messages up to maxHistoryMessages
    const recentEntries = relevantEntries.slice(-this.config.maxHistoryMessages);

    // Format each entry
    const formattedMessages = recentEntries.map((entry) => this.formatMessage(entry));

    // Apply token budget
    return this.selectMessagesWithinBudget(formattedMessages);
  }

  /**
   * Read and build chat history from a log file.
   *
   * @param {string} logPath - Path to the log file
   * @returns {Array} Array of formatted messages { role, content }
   */
  readHistoryFromLog(logPath) {
    const entries = readAllLogEntries(logPath);
    return this.buildHistory(entries);
  }
}

/**
 * Factory function to create a chat history window manager.
 */
function createChatHistoryWindow(options = {}) {
  return new ChatHistoryWindow(options);
}

/**
 * Read chat history from a log file with default settings.
 */
function readChatHistory(logPath, options = {}) {
  const window = createChatHistoryWindow(options);
  return window.readHistoryFromLog(logPath);
}

module.exports = {
  ChatHistoryWindow,
  createChatHistoryWindow,
  readChatHistory,
  DEFAULT_CONFIG,
};
