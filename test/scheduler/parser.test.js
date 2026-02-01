import test from 'node:test';
import { strict as assert } from 'node:assert';
import {
  parseReminderLine,
  parseRemindersFile,
  generateReminderId,
  formatReminderLine,
  assignMissingIds,
  VALID_RECURRENCE,
  ID_PATTERN,
  DATE_PATTERN,
  TIME_PATTERN,
} from '../../scheduler/parser.js';

// ==================== parseReminderLine tests ====================

test('parseReminderLine returns null for null input', () => {
  assert.equal(parseReminderLine(null), null);
});

test('parseReminderLine returns null for undefined input', () => {
  assert.equal(parseReminderLine(undefined), null);
});

test('parseReminderLine returns null for empty string', () => {
  assert.equal(parseReminderLine(''), null);
});

test('parseReminderLine returns null for whitespace-only string', () => {
  assert.equal(parseReminderLine('   '), null);
});

test('parseReminderLine returns null for non-string input', () => {
  assert.equal(parseReminderLine(123), null);
  assert.equal(parseReminderLine({}), null);
  assert.equal(parseReminderLine([]), null);
});

test('parseReminderLine parses valid line with all fields', () => {
  const line = '- [ ] date=2026-01-30 time=14:23 recur=none msg="Test reminder" id=rid_K5V4M2J3Q2ZL';
  const result = parseReminderLine(line);

  assert.ok(result);
  assert.equal(result.date, '2026-01-30');
  assert.equal(result.time, '14:23');
  assert.equal(result.recur, 'none');
  assert.equal(result.msg, 'Test reminder');
  assert.equal(result.id, 'rid_K5V4M2J3Q2ZL');
});

test('parseReminderLine parses valid line without id', () => {
  const line = '- [ ] date=2026-01-30 time=14:23 recur=none msg="Test reminder"';
  const result = parseReminderLine(line);

  assert.ok(result);
  assert.equal(result.date, '2026-01-30');
  assert.equal(result.time, '14:23');
  assert.equal(result.recur, 'none');
  assert.equal(result.msg, 'Test reminder');
  assert.equal(result.id, null);
});

test('parseReminderLine parses fields in any order', () => {
  const line = '- [ ] msg="Test" date=2026-01-30 recur=weekly time=09:00 id=rid_ABCDEFGHIJKL';
  const result = parseReminderLine(line);

  assert.ok(result);
  assert.equal(result.date, '2026-01-30');
  assert.equal(result.time, '09:00');
  assert.equal(result.recur, 'weekly');
  assert.equal(result.msg, 'Test');
  assert.equal(result.id, 'rid_ABCDEFGHIJKL');
});

test('parseReminderLine handles all valid recurrence values', () => {
  for (const recur of VALID_RECURRENCE) {
    const line = `- [ ] date=2026-01-30 time=14:23 recur=${recur} msg="Test"`;
    const result = parseReminderLine(line);
    assert.ok(result, `Should parse recurrence: ${recur}`);
    assert.equal(result.recur, recur);
  }
});

test('parseReminderLine returns null for invalid recurrence', () => {
  const line = '- [ ] date=2026-01-30 time=14:23 recur=yearly msg="Test"';
  assert.equal(parseReminderLine(line), null);
});

test('parseReminderLine returns null for missing date', () => {
  const line = '- [ ] time=14:23 recur=none msg="Test"';
  assert.equal(parseReminderLine(line), null);
});

test('parseReminderLine returns null for missing time', () => {
  const line = '- [ ] date=2026-01-30 recur=none msg="Test"';
  assert.equal(parseReminderLine(line), null);
});

test('parseReminderLine returns null for missing recur', () => {
  const line = '- [ ] date=2026-01-30 time=14:23 msg="Test"';
  assert.equal(parseReminderLine(line), null);
});

test('parseReminderLine returns null for missing msg', () => {
  const line = '- [ ] date=2026-01-30 time=14:23 recur=none';
  assert.equal(parseReminderLine(line), null);
});

test('parseReminderLine returns null for invalid date format', () => {
  assert.equal(parseReminderLine('- [ ] date=2026/01/30 time=14:23 recur=none msg="Test"'), null);
  assert.equal(parseReminderLine('- [ ] date=30-01-2026 time=14:23 recur=none msg="Test"'), null);
  assert.equal(parseReminderLine('- [ ] date=2026-1-30 time=14:23 recur=none msg="Test"'), null);
  assert.equal(parseReminderLine('- [ ] date=2026-01-5 time=14:23 recur=none msg="Test"'), null);
});

test('parseReminderLine returns null for invalid time format', () => {
  assert.equal(parseReminderLine('- [ ] date=2026-01-30 time=2:23 recur=none msg="Test"'), null);
  assert.equal(parseReminderLine('- [ ] date=2026-01-30 time=14:5 recur=none msg="Test"'), null);
  assert.equal(parseReminderLine('- [ ] date=2026-01-30 time=14.23 recur=none msg="Test"'), null);
  assert.equal(parseReminderLine('- [ ] date=2026-01-30 time=14:23:00 recur=none msg="Test"'), null);
});

test('parseReminderLine returns null for invalid id format', () => {
  // Wrong prefix
  assert.equal(parseReminderLine('- [ ] date=2026-01-30 time=14:23 recur=none msg="Test" id=xid_K5V4M2J9Q2ZP'), null);
  // Wrong length
  assert.equal(parseReminderLine('- [ ] date=2026-01-30 time=14:23 recur=none msg="Test" id=rid_K5V4M2J9Q2Z'), null);
  // Invalid characters (lowercase)
  assert.equal(parseReminderLine('- [ ] date=2026-01-30 time=14:23 recur=none msg="Test" id=rid_k5v4m2j9q2zp'), null);
  // Invalid characters (1, 8, 9, 0)
  assert.equal(parseReminderLine('- [ ] date=2026-01-30 time=14:23 recur=none msg="Test" id=rid_K5V4M2J9Q2Z1'), null);
  assert.equal(parseReminderLine('- [ ] date=2026-01-30 time=14:23 recur=none msg="Test" id=rid_K5V4M2J9Q2Z8'), null);
  assert.equal(parseReminderLine('- [ ] date=2026-01-30 time=14:23 recur=none msg="Test" id=rid_K5V4M2J9Q2Z0'), null);
});

test('parseReminderLine handles escaped quotes in msg', () => {
  const line = '- [ ] date=2026-01-30 time=14:23 recur=none msg="Say \\"hello\\" to everyone"';
  const result = parseReminderLine(line);

  assert.ok(result);
  assert.equal(result.msg, 'Say "hello" to everyone');
});

test('parseReminderLine handles multiple escaped quotes', () => {
  const line = '- [ ] date=2026-01-30 time=14:23 recur=none msg="\\"First\\" and \\"second\\" quote"';
  const result = parseReminderLine(line);

  assert.ok(result);
  assert.equal(result.msg, '"First" and "second" quote');
});

test('parseReminderLine handles msg with spaces', () => {
  const line = '- [ ] date=2026-01-30 time=14:23 recur=none msg="This is a longer message with spaces"';
  const result = parseReminderLine(line);

  assert.ok(result);
  assert.equal(result.msg, 'This is a longer message with spaces');
});

test('parseReminderLine handles empty msg', () => {
  const line = '- [ ] date=2026-01-30 time=14:23 recur=none msg=""';
  const result = parseReminderLine(line);

  assert.ok(result);
  assert.equal(result.msg, '');
});

test('parseReminderLine parses unquoted msg', () => {
  const line = '- [ ] date=2026-01-30 time=14:23 recur=none msg=Test';
  const result = parseReminderLine(line);

  assert.ok(result);
  assert.equal(result.msg, 'Test');
});

test('parseReminderLine returns null for msg with unescaped quote', () => {
  const line = '- [ ] date=2026-01-30 time=14:23 recur=none msg="Say "hello" to everyone"';
  assert.equal(parseReminderLine(line), null);
});

test('parseReminderLine returns null for line without task marker', () => {
  assert.equal(parseReminderLine('date=2026-01-30 time=14:23 recur=none msg="Test"'), null);
  assert.equal(parseReminderLine('[ ] date=2026-01-30 time=14:23 recur=none msg="Test"'), null);
  assert.equal(parseReminderLine('- date=2026-01-30 time=14:23 recur=none msg="Test"'), null);
  assert.equal(parseReminderLine('- [x] date=2026-01-30 time=14:23 recur=none msg="Test"'), null);
});

test('parseReminderLine returns null for duplicate fields', () => {
  assert.equal(parseReminderLine('- [ ] date=2026-01-30 date=2026-02-01 time=14:23 recur=none msg="Test"'), null);
  assert.equal(parseReminderLine('- [ ] date=2026-01-30 time=14:23 time=15:00 recur=none msg="Test"'), null);
  assert.equal(parseReminderLine('- [ ] date=2026-01-30 time=14:23 recur=none recur=daily msg="Test"'), null);
});

test('parseReminderLine returns null for unknown fields', () => {
  assert.equal(parseReminderLine('- [ ] date=2026-01-30 time=14:23 recur=none msg="Test" foo=bar'), null);
  assert.equal(parseReminderLine('- [ ] unknown=field date=2026-01-30 time=14:23 recur=none msg="Test"'), null);
});

test('parseReminderLine returns null for missing equals sign', () => {
  assert.equal(parseReminderLine('- [ ] date 2026-01-30 time=14:23 recur=none msg="Test"'), null);
});

test('parseReminderLine returns null for line with only task marker', () => {
  assert.equal(parseReminderLine('- [ ]'), null);
  assert.equal(parseReminderLine('- [ ]   '), null);
});

test('parseReminderLine handles extra whitespace', () => {
  const line = '  - [ ]   date=2026-01-30   time=14:23   recur=none   msg="Test"   id=rid_K5V4M2J3Q2ZL  ';
  const result = parseReminderLine(line);

  assert.ok(result);
  assert.equal(result.date, '2026-01-30');
  assert.equal(result.time, '14:23');
  assert.equal(result.recur, 'none');
  assert.equal(result.msg, 'Test');
  assert.equal(result.id, 'rid_K5V4M2J3Q2ZL');
});

test('parseReminderLine handles msg at end without trailing content', () => {
  const line = '- [ ] date=2026-01-30 time=14:23 recur=none msg="Test"';
  const result = parseReminderLine(line);

  assert.ok(result);
  assert.equal(result.msg, 'Test');
  assert.equal(result.id, null);
});

test('parseReminderLine handles msg with special characters', () => {
  const line = '- [ ] date=2026-01-30 time=14:23 recur=none msg="Test @#$%^&*()_+-=[]{}|;:,.<>?"';
  const result = parseReminderLine(line);

  assert.ok(result);
  assert.equal(result.msg, 'Test @#$%^&*()_+-=[]{}|;:,.<>?');
});

test('parseReminderLine handles msg with unicode characters', () => {
  const line = '- [ ] date=2026-01-30 time=14:23 recur=none msg="Hello 世界 🌍"';
  const result = parseReminderLine(line);

  assert.ok(result);
  assert.equal(result.msg, 'Hello 世界 🌍');
});

test('parseReminderLine handles valid leap year date', () => {
  const line = '- [ ] date=2024-02-29 time=14:23 recur=none msg="Leap year"';
  const result = parseReminderLine(line);

  assert.ok(result);
  assert.equal(result.date, '2024-02-29');
});

test('parseReminderLine handles edge time values', () => {
  const line1 = '- [ ] date=2026-01-30 time=00:00 recur=none msg="Midnight"';
  const result1 = parseReminderLine(line1);
  assert.ok(result1);
  assert.equal(result1.time, '00:00');

  const line2 = '- [ ] date=2026-01-30 time=23:59 recur=none msg="Almost midnight"';
  const result2 = parseReminderLine(line2);
  assert.ok(result2);
  assert.equal(result2.time, '23:59');
});
