const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EmbeddingQueue,
  createEmbeddingQueue,
  calculateBackoff,
  generateId,
  DEFAULT_CONFIG,
} = require('../../memory/index/embeddings');

test('calculateBackoff returns base delay on first attempt', () => {
  const delay = calculateBackoff(0, 1000, 60000, 2);
  assert.equal(delay, 1000);
});

test('calculateBackoff doubles delay each attempt', () => {
  assert.equal(calculateBackoff(0, 1000, 60000, 2), 1000);
  assert.equal(calculateBackoff(1, 1000, 60000, 2), 2000);
  assert.equal(calculateBackoff(2, 1000, 60000, 2), 4000);
  assert.equal(calculateBackoff(3, 1000, 60000, 2), 8000);
});

test('calculateBackoff respects max delay cap', () => {
  const delay = calculateBackoff(10, 1000, 5000, 2);
  assert.equal(delay, 5000);
});

test('generateId creates unique ids', () => {
  const id1 = generateId();
  const id2 = generateId();
  assert.notEqual(id1, id2);
  assert.ok(id1.startsWith('emb_'));
  assert.ok(id2.startsWith('emb_'));
});

test('EmbeddingQueue initializes with default config', () => {
  const queue = new EmbeddingQueue();
  assert.equal(queue.config.maxRetries, DEFAULT_CONFIG.maxRetries);
  assert.equal(queue.config.baseDelayMs, DEFAULT_CONFIG.baseDelayMs);
  assert.equal(queue.config.maxDelayMs, DEFAULT_CONFIG.maxDelayMs);
  assert.equal(queue.processing, false);
  assert.equal(queue.paused, false);
});

test('EmbeddingQueue initializes with custom config', () => {
  const queue = new EmbeddingQueue({
    maxRetries: 3,
    baseDelayMs: 500,
    embeddingModel: 'custom-model',
  });
  assert.equal(queue.config.maxRetries, 3);
  assert.equal(queue.config.baseDelayMs, 500);
  assert.equal(queue.config.embeddingModel, 'custom-model');
});

test('EmbeddingQueue enqueue creates job with pending status', () => {
  const queue = new EmbeddingQueue();
  queue.pause(); // Pause so job stays pending
  
  const jobId = queue.enqueue({
    text: 'test message',
    path: 'logs/test.md',
    line: 5,
    role: 'user',
    contextId: '123',
  });

  assert.ok(jobId);
  assert.ok(jobId.startsWith('emb_'));
  assert.equal(queue.getStatus(jobId), 'pending');
  assert.equal(queue.getPendingCount(), 1);
});

test('EmbeddingQueue enqueue includes all metadata', () => {
  const queue = new EmbeddingQueue();
  const jobId = queue.enqueue({
    text: 'test message',
    path: 'logs/test.md',
    line: 42,
    timestamp: '2026-01-30T14:23:55.000Z',
    role: 'agent',
    contextId: '456',
    pinned: true,
  });

  const job = queue.getJob(jobId);
  assert.equal(job.metadata.path, 'logs/test.md');
  assert.equal(job.metadata.line, 42);
  assert.equal(job.metadata.timestamp, '2026-01-30T14:23:55.000Z');
  assert.equal(job.metadata.role, 'agent');
  assert.equal(job.metadata.contextId, '456');
  assert.equal(job.metadata.pinned, true);
});

test('EmbeddingQueue status transitions through processing to ok', async () => {
  const statusChanges = [];
  const mockEmbedding = new Array(768).fill(0.1);
  
  const queue = new EmbeddingQueue({
    onStatusChange: (id, status, job) => {
      statusChanges.push({ id, status, attempts: job.attempts });
    },
  });

  // Mock the embedding generation
  queue._generateEmbedding = async () => mockEmbedding;

  const jobId = queue.enqueue({
    text: 'success test',
    path: 'logs/test.md',
    line: 1,
    role: 'user',
    contextId: 'test',
  });

  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 50));

  assert.ok(statusChanges.some(s => s.status === 'pending'));
  assert.ok(statusChanges.some(s => s.status === 'processing'));
  assert.ok(statusChanges.some(s => s.status === 'ok'));
  assert.equal(queue.getStatus(jobId), 'ok');
});

test('EmbeddingQueue completes job with embedding', async () => {
  const completedJobs = [];
  const mockEmbedding = new Array(768).fill(0.5);
  
  const queue = new EmbeddingQueue({
    onComplete: (job) => {
      completedJobs.push(job);
    },
  });

  queue._generateEmbedding = async () => mockEmbedding;

  const jobId = queue.enqueue({
    text: 'embed this',
    path: 'logs/test.md',
    line: 10,
    role: 'user',
    contextId: 'ctx',
  });

  await new Promise(resolve => setTimeout(resolve, 50));

  const job = queue.getJob(jobId);
  assert.equal(job.status, 'ok');
  assert.ok(Array.isArray(job.embedding));
  assert.equal(job.embedding.length, 768);
  assert.equal(completedJobs.length, 1);
  assert.equal(completedJobs[0].id, jobId);
});

test('EmbeddingQueue retries on failure and eventually fails', async () => {
  const statusChanges = [];
  const errors = [];
  let attemptCount = 0;
  
  const queue = new EmbeddingQueue({
    maxRetries: 3,
    baseDelayMs: 10, // Short delay for testing
    onStatusChange: (id, status) => {
      statusChanges.push({ id, status });
    },
    onError: (job, error) => {
      errors.push({ job, error });
    },
  });

  // Always fail
  queue._generateEmbedding = async () => {
    attemptCount += 1;
    throw new Error('API Error');
  };

  const jobId = queue.enqueue({
    text: 'fail test',
    path: 'logs/test.md',
    line: 1,
    role: 'user',
    contextId: 'test',
  });

  // Wait for retries (3 retries * 10ms minimum)
  await new Promise(resolve => setTimeout(resolve, 200));

  const job = queue.getJob(jobId);
  assert.equal(job.status, 'failed');
  assert.equal(job.attempts, 3);
  assert.ok(job.error.includes('API Error'));
  assert.equal(attemptCount, 3);
  assert.equal(errors.length, 1);
});

test('EmbeddingQueue succeeds after retry', async () => {
  let attemptCount = 0;
  const mockEmbedding = new Array(768).fill(0.1);
  
  const queue = new EmbeddingQueue({
    maxRetries: 3,
    baseDelayMs: 10,
  });

  // Fail first, then succeed
  queue._generateEmbedding = async () => {
    attemptCount += 1;
    if (attemptCount < 2) {
      throw new Error('Temporary Error');
    }
    return mockEmbedding;
  };

  const jobId = queue.enqueue({
    text: 'retry success test',
    path: 'logs/test.md',
    line: 1,
    role: 'user',
    contextId: 'test',
  });

  await new Promise(resolve => setTimeout(resolve, 100));

  const job = queue.getJob(jobId);
  assert.equal(job.status, 'ok');
  assert.equal(job.attempts, 2);
  assert.equal(attemptCount, 2);
});

test('EmbeddingQueue pause and resume', async () => {
  const queue = new EmbeddingQueue();
  let processedCount = 0;

  queue._generateEmbedding = async () => {
    processedCount += 1;
    return new Array(768).fill(0.1);
  };

  queue.pause();

  const jobId = queue.enqueue({
    text: 'paused job',
    path: 'logs/test.md',
    line: 1,
    role: 'user',
    contextId: 'test',
  });

  // Should not process while paused
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(queue.getStatus(jobId), 'pending');
  assert.equal(processedCount, 0);

  // Resume and process
  queue.resume();
  await new Promise(resolve => setTimeout(resolve, 50));
  
  assert.equal(queue.getStatus(jobId), 'ok');
  assert.equal(processedCount, 1);
});

test('EmbeddingQueue clear removes all jobs', () => {
  const queue = new EmbeddingQueue();

  queue.enqueue({ text: 'job 1', path: 'a.md', line: 1, role: 'user', contextId: '1' });
  queue.enqueue({ text: 'job 2', path: 'b.md', line: 2, role: 'agent', contextId: '2' });

  assert.equal(queue.queue.length, 2);

  queue.clear();

  assert.equal(queue.queue.length, 0);
});

test('EmbeddingQueue getFailedJobs returns only failed jobs', async () => {
  const queue = new EmbeddingQueue({
    maxRetries: 1,
    baseDelayMs: 10,
  });

  queue._generateEmbedding = async () => {
    throw new Error('Always fails');
  };

  const jobId1 = queue.enqueue({
    text: 'will fail',
    path: 'logs/test.md',
    line: 1,
    role: 'user',
    contextId: 'test',
  });

  await new Promise(resolve => setTimeout(resolve, 100));

  const failedJobs = queue.getFailedJobs();
  assert.equal(failedJobs.length, 1);
  assert.equal(failedJobs[0].id, jobId1);
  assert.equal(failedJobs[0].status, 'failed');
});

test('EmbeddingQueue processes multiple jobs sequentially', async () => {
  const processed = [];
  
  const queue = new EmbeddingQueue();
  queue._generateEmbedding = async (text) => {
    processed.push(text);
    return new Array(768).fill(0.1);
  };

  queue.enqueue({ text: 'first', path: 'a.md', line: 1, role: 'user', contextId: '1' });
  queue.enqueue({ text: 'second', path: 'b.md', line: 2, role: 'user', contextId: '2' });
  queue.enqueue({ text: 'third', path: 'c.md', line: 3, role: 'user', contextId: '3' });

  await new Promise(resolve => setTimeout(resolve, 100));

  assert.equal(processed.length, 3);
  assert.equal(processed[0], 'first');
  assert.equal(processed[1], 'second');
  assert.equal(processed[2], 'third');
});

test('createEmbeddingQueue factory returns EmbeddingQueue instance', () => {
  const queue = createEmbeddingQueue({ apiKey: 'test-key' });
  assert.ok(queue instanceof EmbeddingQueue);
  assert.equal(queue.config.apiKey, 'test-key');
});

test('EmbeddingQueue initializeClient sets up GoogleGenAI', () => {
  const queue = new EmbeddingQueue();
  assert.equal(queue.genAI, null);
  
  // We can't fully test without a real API key, but we can verify the method exists
  assert.equal(typeof queue.initializeClient, 'function');
});

test('EmbeddingQueue throws error when generating without initialization', async () => {
  const queue = new EmbeddingQueue();

  // Replace processQueue to directly test _generateEmbedding
  try {
    await queue._generateEmbedding('test');
    assert.fail('Should have thrown error');
  } catch (error) {
    assert.ok(error.message.includes('not initialized'));
  }
});

test('EmbeddingQueue job tracks creation time', () => {
  const queue = new EmbeddingQueue();
  const before = Date.now();
  
  const jobId = queue.enqueue({
    text: 'time test',
    path: 'logs/test.md',
    line: 1,
    role: 'user',
    contextId: 'test',
  });
  
  const after = Date.now();
  const job = queue.getJob(jobId);
  
  assert.ok(job.createdAt >= before);
  assert.ok(job.createdAt <= after);
});

test('EmbeddingQueue getStatus returns null for unknown job', () => {
  const queue = new EmbeddingQueue();
  assert.equal(queue.getStatus('unknown-id'), null);
});

test('EmbeddingQueue getJob returns null for unknown job', () => {
  const queue = new EmbeddingQueue();
  assert.equal(queue.getJob('unknown-id'), null);
});
