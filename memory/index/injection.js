/**
 * Memory injection module.
 * 
 * Formats retrieved memories into a JSON structure for injection into the context window.
 * Follows SPEC.md section 6.4.2 for schema and token budgeting.
 */

const DEFAULT_CONFIG = {
  totalTokenBudget: 1000,
  maxTokensPerMemory: 250,
  charsPerToken: 4,
  prefix: 'INJECTED_CONTEXT_RELEVANT_MEMORIES',
};

class MemoryInjector {
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
   * Adds "..." suffix to indicate truncation.
   * 
   * @param {string} text - Text to truncate
   * @param {number} maxTokens - Maximum tokens allowed
   * @returns {Object} { excerpt: string, truncated: boolean }
   */
  truncateToBudget(text, maxTokens) {
    if (!text || typeof text !== 'string') {
      return { excerpt: '', truncated: false };
    }

    const maxChars = maxTokens * this.config.charsPerToken;
    
    if (text.length <= maxChars) {
      return { excerpt: text, truncated: false };
    }

    // Reserve space for "..." (3 chars)
    const availableChars = maxChars - 3;
    const truncated = text.substring(0, availableChars) + '...';
    
    return { excerpt: truncated, truncated: true };
  }

  /**
   * Format a single memory for injection.
   * 
   * @param {Object} memory - Memory from retrieval system
   * @param {string} memory.path - Path to log file
   * @param {number} memory.line - Line number in log file
   * @param {string} memory.content - Full content of the memory (from log)
   * @returns {Object} Formatted memory object
   */
  formatMemory(memory) {
    const maxTokensPerMemory = this.config.maxTokensPerMemory;
    
    // Extract content from memory - may come from log or be provided directly
    const content = memory.content || '';
    
    // Truncate excerpt to fit budget
    const { excerpt, truncated } = this.truncateToBudget(content, maxTokensPerMemory);

    return {
      path: memory.path,
      line: memory.line,
      excerpt,
      truncated,
    };
  }

  /**
   * Calculate the token budget used by the injection JSON structure.
   * This is a rough estimate including JSON syntax overhead.
   * 
   * @param {Array} formattedMemories - Array of formatted memory objects
   * @returns {number} Estimated token count
   */
  estimateInjectionTokens(formattedMemories) {
    // Base structure overhead (schema wrapper, field names, etc.)
    const baseOverhead = 50;
    
    let contentTokens = 0;
    for (const mem of formattedMemories) {
      // Each memory has path, line, excerpt, truncated fields with JSON syntax
      const memOverhead = 20; // Field names, quotes, commas, braces
      contentTokens += memOverhead + this.estimateTokens(mem.excerpt);
    }
    
    return baseOverhead + contentTokens;
  }

  /**
   * Select memories to fit within token budget.
   * Prioritizes earlier memories (already ranked by retrieval).
   * 
   * @param {Array} memories - Array of retrieved memories
   * @returns {Array} Memories that fit within budget
   */
  selectMemoriesWithinBudget(memories) {
    const selected = [];
    let usedTokens = 50; // Base JSON overhead
    const maxPerMemory = this.config.maxTokensPerMemory;
    
    for (const memory of memories) {
      // Estimate tokens conservatively using the per-memory cap plus JSON overhead.
      const memTokens = 20 + maxPerMemory;
      
      if (usedTokens + memTokens > this.config.totalTokenBudget) {
        break;
      }
      
      selected.push(memory);
      usedTokens += memTokens;
    }
    
    return selected;
  }

  /**
   * Create injection payload from retrieved memories.
   * 
   * Format per SPEC.md 6.4.2:
   * {
   *   "budget_tokens_est": 1000,
   *   "memories": [
   *     {
   *       "path": "logs/discord-thread/123/20260130T142355Z_0001.md",
   *       "line": 42,
   *       "excerpt": "short snippet...",
   *       "truncated": true
   *     }
   *   ]
   * }
   * 
   * @param {Array} memories - Array of memories from retrieval system
   * @returns {Object} Injection payload
   */
  createInjectionPayload(memories) {
    // Select memories that fit within budget
    const selectedMemories = this.selectMemoriesWithinBudget(memories);
    
    // Format each memory
    const formattedMemories = selectedMemories.map(memory => this.formatMemory(memory));
    
    // Calculate estimated tokens
    const estimatedTokens = this.estimateInjectionTokens(formattedMemories);
    
    return {
      budget_tokens_est: estimatedTokens,
      memories: formattedMemories,
    };
  }

  /**
   * Format injection as string for inclusion in prompt.
   * Adds the required prefix line before the JSON.
   * 
   * @param {Array} memories - Array of memories from retrieval system
   * @returns {string} Formatted injection string
   */
  formatInjection(memories) {
    const payload = this.createInjectionPayload(memories);
    
    // Serialize to compact JSON (no extra whitespace)
    const jsonString = JSON.stringify(payload);
    
    // Add prefix line as specified in SPEC.md
    return `${this.config.prefix}\n${jsonString}`;
  }
}

/**
 * Factory function to create a memory injector.
 */
function createMemoryInjector(options = {}) {
  return new MemoryInjector(options);
}

/**
 * Convenience function to format memories for injection.
 */
function formatMemoryInjection(memories, options = {}) {
  const injector = createMemoryInjector(options);
  return injector.formatInjection(memories);
}

module.exports = {
  MemoryInjector,
  createMemoryInjector,
  formatMemoryInjection,
  DEFAULT_CONFIG,
};
