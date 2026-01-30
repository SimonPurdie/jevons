const { GoogleGenAI } = require('@google/genai');

const DEFAULT_CONFIG = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
  embeddingModel: 'text-embedding-004',
};

function generateId() {
  return `emb_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

function calculateBackoff(attempt, baseDelayMs, maxDelayMs, multiplier) {
  const delay = baseDelayMs * Math.pow(multiplier, attempt);
  return Math.min(delay, maxDelayMs);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function generateEmbedding(text, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  if (!config.apiKey) {
    throw new Error('Google GenAI apiKey is required for embedding generation.');
  }
  const genAI = new GoogleGenAI({ apiKey: config.apiKey });
  let attempt = 0;

  while (attempt < config.maxRetries) {
    try {
      const result = await genAI.models.embedContent({
        model: config.embeddingModel,
        contents: text,
      });

      if (!result || !result.embeddings || !result.embeddings.length) {
        throw new Error('No embedding returned from API');
      }

      return result.embeddings[0].values;
    } catch (error) {
      attempt += 1;
      if (attempt >= config.maxRetries) {
        throw error;
      }
      const delay = calculateBackoff(
        attempt - 1,
        config.baseDelayMs,
        config.maxDelayMs,
        config.backoffMultiplier
      );
      await sleep(delay);
    }
  }

  throw new Error('Failed to generate embedding.');
}

class EmbeddingQueue {
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.queue = [];
    this.processing = false;
    this.paused = false;
    this.onStatusChange = options.onStatusChange || null;
    this.onComplete = options.onComplete || null;
    this.onError = options.onError || null;
    this.genAI = null;
    
    if (options.apiKey) {
      this.initializeClient(options.apiKey);
    }
  }

  initializeClient(apiKey) {
    this.genAI = new GoogleGenAI({ apiKey });
  }

  enqueue(entry) {
    const job = {
      id: entry.id || generateId(),
      text: entry.text,
      metadata: {
        path: entry.path,
        line: entry.line,
        timestamp: entry.timestamp || new Date().toISOString(),
        role: entry.role,
        contextId: entry.contextId,
        pinned: entry.pinned || false,
      },
      status: 'pending',
      attempts: 0,
      error: null,
      embedding: null,
      createdAt: Date.now(),
    };

    this.queue.push(job);
    this._notifyStatusChange(job);
    
    if (!this.processing && !this.paused) {
      this._processQueue();
    }

    return job.id;
  }

  getStatus(jobId) {
    const job = this.queue.find(j => j.id === jobId);
    return job ? job.status : null;
  }

  getJob(jobId) {
    return this.queue.find(j => j.id === jobId) || null;
  }

  getPendingCount() {
    return this.queue.filter(j => j.status === 'pending').length;
  }

  getFailedJobs() {
    return this.queue.filter(j => j.status === 'failed');
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
    if (!this.processing) {
      this._processQueue();
    }
  }

  clear() {
    this.queue = [];
  }

  async _generateEmbedding(text) {
    if (!this.genAI) {
      throw new Error('Google GenAI client not initialized. Call initializeClient(apiKey) first.');
    }

    const result = await this.genAI.models.embedContent({
      model: this.config.embeddingModel,
      contents: text,
    });

    if (!result || !result.embeddings || !result.embeddings.length) {
      throw new Error('No embedding returned from API');
    }

    return result.embeddings[0].values;
  }

  async _processJob(job) {
    job.status = 'processing';
    job.attempts += 1;
    this._notifyStatusChange(job);

    try {
      const embedding = await this._generateEmbedding(job.text);
      job.embedding = embedding;
      job.status = 'ok';
      this._notifyStatusChange(job);
      
      if (this.onComplete) {
        this.onComplete(job);
      }
      
      return true;
    } catch (error) {
      job.error = error.message;
      
      if (job.attempts >= this.config.maxRetries) {
        job.status = 'failed';
        this._notifyStatusChange(job);
        
        if (this.onError) {
          this.onError(job, error);
        }
        
        return false;
      }

      const delay = calculateBackoff(
        job.attempts - 1,
        this.config.baseDelayMs,
        this.config.maxDelayMs,
        this.config.backoffMultiplier
      );

      job.status = 'pending';
      this._notifyStatusChange(job);
      
      await sleep(delay);
      return this._processJob(job);
    }
  }

  async _processQueue() {
    if (this.processing || this.paused) {
      return;
    }

    this.processing = true;

    while (!this.paused && this.queue.some(j => j.status === 'pending')) {
      const job = this.queue.find(j => j.status === 'pending');
      
      if (!job) {
        break;
      }

      await this._processJob(job);
    }

    this.processing = false;
  }

  _notifyStatusChange(job) {
    if (this.onStatusChange) {
      this.onStatusChange(job.id, job.status, job);
    }
  }
}

function createEmbeddingQueue(options = {}) {
  return new EmbeddingQueue(options);
}

module.exports = {
  EmbeddingQueue,
  createEmbeddingQueue,
  calculateBackoff,
  generateId,
  generateEmbedding,
  DEFAULT_CONFIG,
};
