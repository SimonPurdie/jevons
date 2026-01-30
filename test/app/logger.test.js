const { describe, it } = require('node:test');
const assert = require('node:assert');
const logger = require('../../app/logger');

describe('Logger', () => {
  it('should format logs correctly', () => {
    const message = 'test message';
    const context = { foo: 'bar' };
    const json = logger.formatLog(logger.LEVELS.INFO, message, context);
    const parsed = JSON.parse(json);

    assert.strictEqual(parsed.level, 'INFO');
    assert.strictEqual(parsed.message, message);
    assert.strictEqual(parsed.foo, 'bar');
    assert.ok(parsed.timestamp);
  });

  it('should handle Error objects in context', () => {
    const error = new Error('oops');
    const json = logger.formatLog(logger.LEVELS.ERROR, 'Something went wrong', error);
    const parsed = JSON.parse(json);

    assert.strictEqual(parsed.level, 'ERROR');
    assert.strictEqual(parsed.message, 'Something went wrong');
    assert.ok(parsed.error);
    assert.strictEqual(parsed.error.message, 'oops');
    assert.ok(parsed.error.stack);
  });

  it('should determine whether to log based on levels', () => {
    assert.strictEqual(logger.shouldLog('DEBUG', 'INFO'), false);
    assert.strictEqual(logger.shouldLog('INFO', 'INFO'), true);
    assert.strictEqual(logger.shouldLog('WARN', 'INFO'), true);
    assert.strictEqual(logger.shouldLog('ERROR', 'INFO'), true);

    assert.strictEqual(logger.shouldLog('DEBUG', 'DEBUG'), true);
    assert.strictEqual(logger.shouldLog('DEBUG', 'WARN'), false);
  });

  it('should default to INFO if invalid level provided', () => {
    assert.strictEqual(logger.shouldLog('DEBUG', 'INVALID'), false); // INVALID -> INFO
    assert.strictEqual(logger.shouldLog('INFO', 'INVALID'), true);
  });
});
