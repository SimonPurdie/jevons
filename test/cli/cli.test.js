const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, readStdin, printUsage } = require('../../cli/index');

test('parseArgs returns help flag', () => {
  const result = parseArgs(['--help']);
  assert.equal(result.help, true);
  assert.equal(result.message, null);
  assert.equal(result.useStdin, false);
});

test('parseArgs returns help flag with -h shorthand', () => {
  const result = parseArgs(['-h']);
  assert.equal(result.help, true);
});

test('parseArgs returns stdin flag', () => {
  const result = parseArgs(['--prompt']);
  assert.equal(result.useStdin, true);
  assert.equal(result.message, null);
});

test('parseArgs returns stdin flag with -p shorthand', () => {
  const result = parseArgs(['-p']);
  assert.equal(result.useStdin, true);
});

test('parseArgs extracts message from arguments', () => {
  const result = parseArgs(['Hello, world']);
  assert.equal(result.message, 'Hello, world');
  assert.equal(result.useStdin, false);
  assert.equal(result.help, false);
});

test('parseArgs concatenates multiple arguments', () => {
  const result = parseArgs(['Hello', 'world', 'test']);
  assert.equal(result.message, 'Hello world test');
});

test('parseArgs ignores flags after first non-flag argument', () => {
  const result = parseArgs(['Hello', '--help']);
  assert.equal(result.message, 'Hello --help');
  assert.equal(result.help, false);
});

test('parseArgs with empty args has no message', () => {
  const result = parseArgs([]);
  assert.equal(result.message, null);
  assert.equal(result.useStdin, false);
  assert.equal(result.help, false);
});

test('printUsage outputs help text to console', () => {
  // Capture console.log output
  const originalLog = console.log;
  let output = '';
  console.log = (msg) => {
    output += msg + '\n';
  };

  printUsage();

  console.log = originalLog;

  assert.ok(output.includes('Usage:'));
  assert.ok(output.includes('jevons'));
  assert.ok(output.includes('--help'));
  assert.ok(output.includes('--prompt'));
  assert.ok(output.includes('Environment:'));
});
