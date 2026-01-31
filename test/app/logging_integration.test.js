const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert');
const { startDiscordRuntime } = require('../../app/index.js');

describe('Logging Integration', () => {
  let consoleLogMock;
  let consoleErrorMock;
  let originalConsoleLog;
  let originalConsoleError;

  before(() => {
    originalConsoleLog = console.log;
    originalConsoleError = console.error;
    consoleLogMock = mock.fn();
    consoleErrorMock = mock.fn();
    console.log = consoleLogMock;
    console.error = consoleErrorMock;
  });

  after(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  });

  it('should log structured events via logger', async () => {
    let capturedOnLog, capturedOnError;
    const mockRuntime = {
      start: mock.fn(async () => {}),
    };
    const mockScheduler = {
      start: mock.fn(),
      stop: mock.fn(),
    };
    const mockClient = {
        channels: { fetch: async () => ({}) }
    };

    const deps = {
      loadConfig: () => ({
        discord: { token: 'token', channel_id: 'channel' },
        model: { provider: 'test', model: 'test' },
        reminders: { file_path: 'reminders.md' },
      }),
      createDiscordClient: () => mockClient,
      createDiscordRuntime: mock.fn((options) => {
        options.onReady();
        options.onError(new Error('Test runtime error'));
        return mockRuntime;
      }),
      createSchedulerService: mock.fn((options) => {
        capturedOnLog = options.onLog;
        capturedOnError = options.onError;
        return mockScheduler;
      }),
      createIpcServer: mock.fn(() => ({
        start: async () => 12345,
        stop: async () => {},
      })),
    };

    const runtime = await startDiscordRuntime(deps);

    capturedOnLog('Test scheduler log');
    capturedOnError(new Error('Test scheduler error'));

    await runtime.stop();

    const logs = consoleLogMock.mock.calls.map(c => c.arguments[0]);
    const errors = consoleErrorMock.mock.calls.map(c => c.arguments[0]);

    // Verify runtime ready log
    const readyLog = logs.find(l => l.includes('Discord runtime ready'));
    assert.ok(readyLog, 'Should log runtime ready');
    const readyJson = JSON.parse(readyLog);
    assert.strictEqual(readyJson.level, 'INFO');
    assert.strictEqual(readyJson.message, 'Discord runtime ready');

    // Verify runtime error log
    const runtimeErr = errors.find(l => l.includes('Discord runtime error'));
    assert.ok(runtimeErr, 'Should log runtime error');
    const runtimeErrJson = JSON.parse(runtimeErr);
    assert.strictEqual(runtimeErrJson.level, 'ERROR');
    assert.ok(runtimeErrJson.error);
    assert.strictEqual(runtimeErrJson.error.message, 'Test runtime error');

    // Verify scheduler log
    const schedLog = logs.find(l => l.includes('Test scheduler log'));
    assert.ok(schedLog, 'Should log scheduler message');
    const schedJson = JSON.parse(schedLog);
    assert.strictEqual(schedJson.level, 'INFO');
    assert.strictEqual(schedJson.source, 'scheduler');

    // Verify scheduler error
    const schedErr = errors.find(l => l.includes('Scheduler error'));
    assert.ok(schedErr, 'Should log scheduler error');
    const schedErrJson = JSON.parse(schedErr);
    assert.strictEqual(schedErrJson.level, 'ERROR');
    assert.strictEqual(schedErrJson.error.message, 'Test scheduler error');
  });
});
