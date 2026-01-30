const { createEmbeddingsIndex } = require('./sqlite');

/**
 * Memory retrieval with MMR (Maximal Marginal Relevance) ranking.
 * 
 * Ranking formula (from SPEC.md 6.4.1):
 * - Score: 0.7 * sim + 0.2 * recency - 0.1 * diversity_penalty
 * - where diversity_penalty = max(sim(c, s)) for s in S (selected set)
 * - where recency = exp(-age_days / 14)
 * 
 * Pinned memories always take precedence and are selected first.
 */

const DEFAULT_CONFIG = {
  maxMemories: 5,
  pinnedBoost: 1.5,
  similarityWeight: 0.7,
  recencyWeight: 0.2,
  diversityWeight: 0.1,
  recencyDecayDays: 14,
};

class MemoryRetriever {
  constructor(options = {}) {
    this.index = options.index || null;
    this.dbPath = options.dbPath;
    this.config = { ...DEFAULT_CONFIG, ...options };
  }

  async initialize() {
    if (!this.index) {
      this.index = createEmbeddingsIndex(this.dbPath);
      await this.index.open();
      await this.index.migrate();
    }
  }

  async close() {
    if (this.index && this.dbPath) {
      await this.index.close();
    }
  }

  /**
   * Calculate recency score using exponential decay.
   * recency = exp(-age_days / 14)
   * 
   * @param {string} timestamp - ISO timestamp of the memory
   * @param {Date} referenceTime - Reference time for age calculation (defaults to now)
   * @returns {number} Recency score in [0, 1]
   */
  calculateRecency(timestamp, referenceTime = new Date()) {
    const memoryTime = new Date(timestamp);
    const ageMs = referenceTime - memoryTime;
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    return Math.exp(-ageDays / this.config.recencyDecayDays);
  }

  /**
   * Calculate diversity penalty for a candidate relative to already selected items.
   * diversity_penalty = max(sim(c, s)) for s in S
   * 
   * @param {Object} candidate - Candidate memory with embedding
   * @param {Array} selected - Array of already selected memories
   * @returns {number} Maximum similarity to selected items
   */
  calculateDiversityPenalty(candidate, selected) {
    if (selected.length === 0) {
      return 0;
    }

    let maxSimilarity = 0;
    for (const s of selected) {
      const similarity = this.index.cosineSimilarity(candidate.embedding, s.embedding);
      maxSimilarity = Math.max(maxSimilarity, similarity);
    }

    return maxSimilarity;
  }

  /**
   * Calculate the composite MMR score for a candidate.
   * Score: 0.7 * sim + 0.2 * recency - 0.1 * diversity_penalty
   * 
   * @param {Object} candidate - Candidate memory with similarity score
   * @param {Array} selected - Array of already selected memories
   * @param {Date} referenceTime - Reference time for recency calculation
   * @returns {number} Composite score
   */
  calculateScore(candidate, selected, referenceTime) {
    const similarity = candidate.similarity;
    const recency = this.calculateRecency(candidate.timestamp, referenceTime);
    const diversityPenalty = this.calculateDiversityPenalty(candidate, selected);

    return (
      this.config.similarityWeight * similarity +
      this.config.recencyWeight * recency -
      this.config.diversityWeight * diversityPenalty
    );
  }

  /**
   * Retrieve relevant memories using MMR ranking.
   * 
   * Process:
   * 1. Get all pinned memories (they take precedence)
   * 2. Search for similar memories using query embedding
   * 3. If no pinned memories, start with highest similarity item
   * 4. Use MMR to select remaining memories
   * 5. Return combined list with ranking metadata
   * 
   * @param {Array} queryEmbedding - Embedding vector of the query
   * @param {Object} options - Retrieval options
   * @param {number} options.limit - Maximum number of memories to retrieve (default: config.maxMemories)
   * @param {string} options.excludeContextId - Context ID to exclude from results
   * @param {Date} options.referenceTime - Reference time for recency calculation
   * @returns {Array} Ranked array of memories with scores and metadata
   */
  async retrieve(queryEmbedding, options = {}) {
    await this.initialize();

    const limit = options.limit || this.config.maxMemories;
    const referenceTime = options.referenceTime || new Date();
    const excludeContextId = options.excludeContextId || null;

    // Get all pinned memories first (they take precedence)
    const pinnedMemories = await this.index.getPinned();
    
    // Calculate similarity for pinned memories
    const pinnedWithSimilarity = pinnedMemories.map(memory => ({
      ...memory,
      similarity: this.index.cosineSimilarity(queryEmbedding, memory.embedding),
      isPinned: true,
    }));

    // Sort pinned by similarity descending
    pinnedWithSimilarity.sort((a, b) => b.similarity - a.similarity);

    // Search for similar memories (excluding pinned if we want to avoid duplicates)
    // Note: In the current schema, pinned items are in the same table, so they'll appear
    // in similarity search. We filter them out to avoid duplicates.
    const similarResults = await this.index.searchSimilar(queryEmbedding, {
      limit: Math.max(limit * 3, 50), // Get more candidates for MMR selection
      excludeContextId,
    });

    // Filter out pinned memories from similarity results (they're already in pinned list)
    const candidatePool = similarResults.filter(
      memory => !memory.pinned
    );

    // Calculate scores for all candidates
    const candidatesWithScores = candidatePool.map(memory => ({
      ...memory,
      isPinned: false,
      recency: this.calculateRecency(memory.timestamp, referenceTime),
    }));

    // If no pinned memories, start MMR with the highest similarity candidate
    const selected = [];

    // First, add pinned memories (up to limit)
    for (const pinned of pinnedWithSimilarity) {
      if (selected.length >= limit) {
        break;
      }
      
      const score = this.calculateScore(pinned, selected, referenceTime);
      selected.push({
        ...pinned,
        score,
        diversityPenalty: this.calculateDiversityPenalty(pinned, selected),
      });
    }

    // Use MMR to fill remaining slots
    const remainingSlots = limit - selected.length;
    const usedIds = new Set(selected.map(s => s.id));

    for (let i = 0; i < remainingSlots; i++) {
      // Filter out already selected candidates
      const availableCandidates = candidatesWithScores.filter(c => !usedIds.has(c.id));

      if (availableCandidates.length === 0) {
        break;
      }

      // Calculate MMR scores for available candidates
      let bestCandidate = null;
      let bestScore = -Infinity;

      for (const candidate of availableCandidates) {
        const score = this.calculateScore(candidate, selected, referenceTime);
        
        if (score > bestScore) {
          bestScore = score;
          bestCandidate = candidate;
        }
      }

      if (bestCandidate) {
        selected.push({
          ...bestCandidate,
          score: bestScore,
          diversityPenalty: this.calculateDiversityPenalty(bestCandidate, selected),
        });
        usedIds.add(bestCandidate.id);
      }
    }

    return selected;
  }

  /**
   * Get detailed ranking info for debugging/analysis.
   * Returns all candidates with their component scores.
   * 
   * @param {Array} queryEmbedding - Embedding vector of the query
   * @param {Object} options - Retrieval options
   * @returns {Object} Detailed ranking results
   */
  async retrieveWithDetails(queryEmbedding, options = {}) {
    await this.initialize();

    const referenceTime = options.referenceTime || new Date();
    const excludeContextId = options.excludeContextId || null;

    // Get pinned memories
    const pinnedMemories = await this.index.getPinned();
    
    // Get all memories for analysis
    let allMemories;
    if (excludeContextId) {
      const all = await this.index.getAll();
      allMemories = all.filter(m => m.context_id !== excludeContextId);
    } else {
      allMemories = await this.index.getAll();
    }

    // Calculate scores for all memories
    const analyzedMemories = allMemories.map(memory => {
      const similarity = this.index.cosineSimilarity(queryEmbedding, memory.embedding);
      const recency = this.calculateRecency(memory.timestamp, referenceTime);
      
      return {
        ...memory,
        similarity,
        recency,
        isPinned: memory.pinned,
      };
    });

    // Sort by similarity for initial ranking
    analyzedMemories.sort((a, b) => b.similarity - a.similarity);

    const selected = await this.retrieve(queryEmbedding, options);

    return {
      selected,
      allCandidates: analyzedMemories,
      pinnedCount: pinnedMemories.length,
      config: this.config,
    };
  }
}

/**
 * Factory function to create a memory retriever.
 */
function createMemoryRetriever(options = {}) {
  return new MemoryRetriever(options);
}

/**
 * Convenience function to retrieve memories with automatic initialization.
 */
async function retrieveMemories(queryEmbedding, options = {}) {
  const retriever = createMemoryRetriever(options);
  
  try {
    const results = await retriever.retrieve(queryEmbedding, options);
    await retriever.close();
    return results;
  } catch (error) {
    await retriever.close();
    throw error;
  }
}

module.exports = {
  MemoryRetriever,
  createMemoryRetriever,
  retrieveMemories,
  DEFAULT_CONFIG,
};
