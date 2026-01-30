const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MemoryInjector,
  createMemoryInjector,
  formatMemoryInjection,
  DEFAULT_CONFIG,
} = require('../../memory/index/injection');

test('MemoryInjector initializes with default config', () => {
  const injector = new MemoryInjector();
  assert.equal(injector.config.totalTokenBudget, DEFAULT_CONFIG.totalTokenBudget);
  assert.equal(injector.config.maxTokensPerMemory, DEFAULT_CONFIG.maxTokensPerMemory);
  assert.equal(injector.config.charsPerToken, DEFAULT_CONFIG.charsPerToken);
  assert.equal(injector.config.prefix, DEFAULT_CONFIG.prefix);
});

test('MemoryInjector accepts custom config options', () => {
  const injector = new MemoryInjector({
    totalTokenBudget: 500,
    maxTokensPerMemory: 100,
    charsPerToken: 3,
    prefix: 'CUSTOM_PREFIX',
  });
  assert.equal(injector.config.totalTokenBudget, 500);
  assert.equal(injector.config.maxTokensPerMemory, 100);
  assert.equal(injector.config.charsPerToken, 3);
  assert.equal(injector.config.prefix, 'CUSTOM_PREFIX');
});

test('createMemoryInjector factory returns MemoryInjector instance', () => {
  const injector = createMemoryInjector({ totalTokenBudget: 800 });
  assert.ok(injector instanceof MemoryInjector);
  assert.equal(injector.config.totalTokenBudget, 800);
});

test('estimateTokens uses 4 chars per token heuristic', () => {
  const injector = createMemoryInjector();
  
  // Empty string
  assert.equal(injector.estimateTokens(''), 0);
  
  // 4 characters = 1 token
  assert.equal(injector.estimateTokens('abcd'), 1);
  
  // 8 characters = 2 tokens
  assert.equal(injector.estimateTokens('abcdefgh'), 2);
  
  // 10 characters = 3 tokens (ceil)
  assert.equal(injector.estimateTokens('abcdefghij'), 3);
  
  // 1000 characters = 250 tokens
  assert.equal(injector.estimateTokens('a'.repeat(1000)), 250);
});

test('estimateTokens handles invalid input', () => {
  const injector = createMemoryInjector();
  assert.equal(injector.estimateTokens(null), 0);
  assert.equal(injector.estimateTokens(undefined), 0);
  assert.equal(injector.estimateTokens(123), 0);
});

test('truncateToBudget returns full text when under budget', () => {
  const injector = createMemoryInjector({ maxTokensPerMemory: 10 });
  const text = 'Short text';
  const result = injector.truncateToBudget(text, 10);
  
  assert.equal(result.excerpt, text);
  assert.equal(result.truncated, false);
});

test('truncateToBudget truncates text when over budget', () => {
  const injector = createMemoryInjector({ maxTokensPerMemory: 5, charsPerToken: 4 });
  // Text is 44 chars, budget is 5 tokens = 20 chars
  const text = 'This is a very long text that needs truncation';
  const result = injector.truncateToBudget(text, 5);

  assert.equal(result.truncated, true);
  assert.ok(result.excerpt.endsWith('...'));
  // 5 tokens = 20 chars total, minus 3 for "..." = 17 chars of content
  assert.equal(result.excerpt.length, 20);
});

test('truncateToBudget handles empty input', () => {
  const injector = createMemoryInjector();
  const result1 = injector.truncateToBudget('', 10);
  assert.equal(result1.excerpt, '');
  assert.equal(result1.truncated, false);
  
  const result2 = injector.truncateToBudget(null, 10);
  assert.equal(result2.excerpt, '');
  assert.equal(result2.truncated, false);
});

test('formatMemory includes path, line, excerpt, and truncated fields', () => {
  const injector = createMemoryInjector();
  const memory = {
    path: 'logs/discord-channel/123/20260130T142355Z_0001.md',
    line: 42,
    content: 'User asked about project status',
  };
  
  const result = injector.formatMemory(memory);
  
  assert.equal(result.path, memory.path);
  assert.equal(result.line, memory.line);
  assert.equal(result.excerpt, memory.content);
  assert.equal(result.truncated, false);
});

test('formatMemory truncates long content', () => {
  const injector = createMemoryInjector({ maxTokensPerMemory: 5, charsPerToken: 4 });
  const memory = {
    path: 'logs/test.md',
    line: 1,
    content: 'a'.repeat(100), // 100 chars = 25 tokens, exceeds 5 token limit
  };
  
  const result = injector.formatMemory(memory);
  
  assert.equal(result.truncated, true);
  assert.ok(result.excerpt.endsWith('...'));
  assert.ok(result.excerpt.length < 100);
});

test('formatMemory handles missing content', () => {
  const injector = createMemoryInjector();
  const memory = {
    path: 'logs/test.md',
    line: 1,
  };
  
  const result = injector.formatMemory(memory);
  
  assert.equal(result.path, memory.path);
  assert.equal(result.line, memory.line);
  assert.equal(result.excerpt, '');
  assert.equal(result.truncated, false);
});

test('selectMemoriesWithinBudget respects 1000 token total budget', () => {
  const injector = createMemoryInjector({ totalTokenBudget: 1000 });
  
  // Create memories with ~300 tokens each (1200 chars)
  const memories = [];
  for (let i = 0; i < 5; i++) {
    memories.push({
      id: `mem-${i}`,
      path: `logs/test${i}.md`,
      line: i,
      content: 'a'.repeat(1200),
    });
  }
  
  const selected = injector.selectMemoriesWithinBudget(memories);
  
  // Should select at most 3 memories (3 * 320 ≈ 960 tokens with overhead)
  assert.ok(selected.length <= 3);
  assert.ok(selected.length >= 2); // At least 2 should fit
  
  // First memories should be selected (preserving order)
  if (selected.length > 0) assert.equal(selected[0].id, 'mem-0');
  if (selected.length > 1) assert.equal(selected[1].id, 'mem-1');
});

test('selectMemoriesWithinBudget respects 250 token per-memory limit', () => {
  const injector = createMemoryInjector({ 
    totalTokenBudget: 1000,
    maxTokensPerMemory: 250,
    charsPerToken: 4,
  });
  
  // Create a memory with 1200 chars (300 tokens without limit)
  const memories = [{
    id: 'long-mem',
    path: 'logs/test.md',
    line: 1,
    content: 'a'.repeat(1200),
  }];
  
  const selected = injector.selectMemoriesWithinBudget(memories);
  
  // Should still select it, but it will be truncated later
  assert.equal(selected.length, 1);
  assert.equal(selected[0].id, 'long-mem');
});

test('selectMemoriesWithinBudget handles empty array', () => {
  const injector = createMemoryInjector();
  const selected = injector.selectMemoriesWithinBudget([]);
  assert.equal(selected.length, 0);
});

test('createInjectionPayload creates valid structure', () => {
  const injector = createMemoryInjector();
  const memories = [
    {
      path: 'logs/discord-thread/123/20260130T142355Z_0001.md',
      line: 42,
      content: 'User asked about project status',
    },
    {
      path: 'logs/discord-thread/123/20260130T142355Z_0001.md',
      line: 44,
      content: 'Agent replied with update',
    },
  ];
  
  const payload = injector.createInjectionPayload(memories);
  
  assert.ok(typeof payload.budget_tokens_est === 'number');
  assert.ok(Array.isArray(payload.memories));
  assert.equal(payload.memories.length, 2);
  
  // Check memory structure
  const mem = payload.memories[0];
  assert.ok(typeof mem.path === 'string');
  assert.ok(typeof mem.line === 'number');
  assert.ok(typeof mem.excerpt === 'string');
  assert.ok(typeof mem.truncated === 'boolean');
});

test('createInjectionPayload truncates long memories', () => {
  const injector = createMemoryInjector({ maxTokensPerMemory: 10 });
  const memories = [{
    path: 'logs/test.md',
    line: 1,
    content: 'a'.repeat(100), // 100 chars = 25 tokens
  }];

  const payload = injector.createInjectionPayload(memories);

  assert.equal(payload.memories.length, 1);
  assert.equal(payload.memories[0].truncated, true);
  // 10 tokens = 40 chars total (37 content + 3 for "...")
  assert.equal(payload.memories[0].excerpt.length, 40);
});

test('formatInjection returns string with prefix and JSON', () => {
  const injector = createMemoryInjector();
  const memories = [{
    path: 'logs/test.md',
    line: 1,
    content: 'Hello world',
  }];
  
  const result = injector.formatInjection(memories);
  
  // Should start with prefix
  assert.ok(result.startsWith('INJECTED_CONTEXT_RELEVANT_MEMORIES\n'));
  
  // Should contain valid JSON after prefix
  const jsonPart = result.split('\n')[1];
  const parsed = JSON.parse(jsonPart);
  
  assert.ok(typeof parsed.budget_tokens_est === 'number');
  assert.ok(Array.isArray(parsed.memories));
  assert.equal(parsed.memories.length, 1);
});

test('formatInjection uses custom prefix when configured', () => {
  const injector = createMemoryInjector({ prefix: 'CUSTOM_PREFIX' });
  const memories = [{
    path: 'logs/test.md',
    line: 1,
    content: 'Hello',
  }];
  
  const result = injector.formatInjection(memories);
  
  assert.ok(result.startsWith('CUSTOM_PREFIX\n'));
});

test('formatMemoryInjection convenience function works', () => {
  const memories = [
    {
      path: 'logs/test1.md',
      line: 10,
      content: 'First memory',
    },
    {
      path: 'logs/test2.md',
      line: 20,
      content: 'Second memory',
    },
  ];
  
  const result = formatMemoryInjection(memories);
  
  assert.ok(result.startsWith('INJECTED_CONTEXT_RELEVANT_MEMORIES\n'));
  const jsonPart = result.split('\n')[1];
  const parsed = JSON.parse(jsonPart);
  assert.equal(parsed.memories.length, 2);
});

test('formatMemoryInjection passes options to injector', () => {
  const memories = [{
    path: 'logs/test.md',
    line: 1,
    content: 'a'.repeat(100),
  }];
  
  const result = formatMemoryInjection(memories, { 
    maxTokensPerMemory: 5,
    prefix: 'TEST_PREFIX',
  });
  
  assert.ok(result.startsWith('TEST_PREFIX\n'));
  const jsonPart = result.split('\n')[1];
  const parsed = JSON.parse(jsonPart);
  assert.equal(parsed.memories[0].truncated, true);
});

test('MemoryInjector respects total budget with many memories', () => {
  const injector = createMemoryInjector({ 
    totalTokenBudget: 1000,
    maxTokensPerMemory: 250,
    charsPerToken: 4,
  });
  
  // Create 10 memories with 100 chars each (~25 tokens each + overhead)
  const memories = [];
  for (let i = 0; i < 10; i++) {
    memories.push({
      id: `mem-${i}`,
      path: `logs/test${i}.md`,
      line: i,
      content: 'a'.repeat(100),
    });
  }
  
  const payload = injector.createInjectionPayload(memories);
  
  // Should not exceed budget significantly
  assert.ok(payload.memories.length < 10);
  assert.ok(payload.budget_tokens_est <= 1000 + 50); // Allow small margin for estimation error
});

test('MemoryInjector includes path and line for lookup reference', () => {
  const injector = createMemoryInjector();
  const memories = [{
    path: 'logs/discord-channel/456/20260130T142355Z_0001.md',
    line: 42,
    content: 'Test content',
  }];
  
  const payload = injector.createInjectionPayload(memories);
  
  assert.equal(payload.memories[0].path, 'logs/discord-channel/456/20260130T142355Z_0001.md');
  assert.equal(payload.memories[0].line, 42);
});

test('estimateInjectionTokens accounts for JSON overhead', () => {
  const injector = createMemoryInjector();
  
  // Empty array should have base overhead
  const emptyTokens = injector.estimateInjectionTokens([]);
  assert.ok(emptyTokens >= 50);
  
  // Each memory adds overhead
  const singleMemTokens = injector.estimateInjectionTokens([{
    path: 'test.md',
    line: 1,
    excerpt: 'short',
    truncated: false,
  }]);
  assert.ok(singleMemTokens > emptyTokens);
});

test('formatInjection creates parseable JSON', () => {
  const injector = createMemoryInjector();
  const memories = [
    { path: 'a.md', line: 1, content: 'First' },
    { path: 'b.md', line: 2, content: 'Second' },
    { path: 'c.md', line: 3, content: 'Third' },
  ];
  
  const result = injector.formatInjection(memories);
  const lines = result.split('\n');
  
  // First line is prefix
  assert.equal(lines[0], 'INJECTED_CONTEXT_RELEVANT_MEMORIES');
  
  // Second line is JSON
  const parsed = JSON.parse(lines[1]);
  assert.ok(parsed.budget_tokens_est > 0);
  assert.equal(parsed.memories.length, 3);
});

test('MemoryInjector handles special characters in content', () => {
  const injector = createMemoryInjector();
  const memories = [{
    path: 'logs/test.md',
    line: 1,
    content: 'Special chars: "quotes" \n newlines \t tabs',
  }];
  
  const result = injector.formatInjection(memories);
  
  // Should be valid JSON even with special characters
  const jsonPart = result.split('\n')[1];
  const parsed = JSON.parse(jsonPart);
  
  // JSON serialization should handle escaping
  assert.equal(parsed.memories[0].excerpt, 'Special chars: "quotes" \n newlines \t tabs');
});

test('truncation adds ellipsis indicator', () => {
  const injector = createMemoryInjector({ maxTokensPerMemory: 2 });
  const memory = {
    path: 'logs/test.md',
    line: 1,
    content: 'This is definitely more than eight characters',
  };
  
  const formatted = injector.formatMemory(memory);
  
  assert.equal(formatted.truncated, true);
  assert.ok(formatted.excerpt.endsWith('...'));
});
