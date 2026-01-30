const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseReminderLine,
  parseRemindersFile,
  generateReminderId,
  formatReminderLine,
  assignMissingIds,
  VALID_RECURRENCE,
  ID_PATTERN,
  DATE_PATTERN,
  TIME_PATTERN,
} = require('../../scheduler/parser');

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

test('parseReminderLine returns null for unquoted msg', () => {
  const line = '- [ ] date=2026-01-30 time=14:23 recur=none msg=Test';
  assert.equal(parseReminderLine(line), null);
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

// ==================== parseRemindersFile tests ====================

test('parseRemindersFile returns empty array for null input', () => {
  assert.deepEqual(parseRemindersFile(null), []);
});

test('parseRemindersFile returns empty array for undefined input', () => {
  assert.deepEqual(parseRemindersFile(undefined), []);
});

test('parseRemindersFile returns empty array for empty string', () => {
  assert.deepEqual(parseRemindersFile(''), []);
});

test('parseRemindersFile parses single valid reminder', () => {
  const content = '- [ ] date=2026-01-30 time=14:23 recur=none msg="Test reminder" id=rid_K5V4M2J3Q2ZL';
  const results = parseRemindersFile(content);

  assert.equal(results.length, 1);
  assert.equal(results[0].date, '2026-01-30');
  assert.equal(results[0]._lineNumber, 1);
  assert.equal(results[0]._raw, content);
});

test('parseRemindersFile parses multiple valid reminders', () => {
  const content = `- [ ] date=2026-01-30 time=09:00 recur=none msg="First reminder" id=rid_AAAAAAAAAAAA
- [ ] date=2026-01-31 time=10:00 recur=daily msg="Second reminder" id=rid_BBBBBBBBBBBB
- [ ] date=2026-02-01 time=11:00 recur=weekly msg="Third reminder" id=rid_CCCCCCCCCCCC`;
  
  const results = parseRemindersFile(content);
  
  assert.equal(results.length, 3);
  assert.equal(results[0].msg, 'First reminder');
  assert.equal(results[0]._lineNumber, 1);
  assert.equal(results[1].msg, 'Second reminder');
  assert.equal(results[1]._lineNumber, 2);
  assert.equal(results[2].msg, 'Third reminder');
  assert.equal(results[2]._lineNumber, 3);
});

test('parseRemindersFile skips empty lines', () => {
  const content = `
- [ ] date=2026-01-30 time=14:23 recur=none msg="Test"

- [ ] date=2026-01-31 time=15:23 recur=none msg="Test 2"

`;
  const results = parseRemindersFile(content);
  
  assert.equal(results.length, 2);
  assert.equal(results[0]._lineNumber, 2);
  assert.equal(results[1]._lineNumber, 4);
});

test('parseRemindersFile skips comment lines', () => {
  const content = `# This is a comment
- [ ] date=2026-01-30 time=14:23 recur=none msg="Test"
# Another comment
- [ ] date=2026-01-31 time=15:23 recur=none msg="Test 2"
  # Indented comment`;
  
  const results = parseRemindersFile(content);
  
  assert.equal(results.length, 2);
  assert.equal(results[0]._lineNumber, 2);
  assert.equal(results[1]._lineNumber, 4);
});

test('parseRemindersFile skips invalid lines silently', () => {
  const content = `- [ ] date=2026-01-30 time=14:23 recur=none msg="Valid"
Invalid line without task marker
- [ ] missing=fields
- [ ] date=2026-01-31 time=15:23 recur=none msg="Also valid"`;
  
  const results = parseRemindersFile(content);
  
  assert.equal(results.length, 2);
  assert.equal(results[0].msg, 'Valid');
  assert.equal(results[0]._lineNumber, 1);
  assert.equal(results[1].msg, 'Also valid');
  assert.equal(results[1]._lineNumber, 4);
});

test('parseRemindersFile handles mixed valid and invalid reminders', () => {
  const content = `# Reminders file
- [ ] date=2026-01-30 time=09:00 recur=daily msg="Daily standup" id=rid_AAAAAAAAAAAA

- [ ] date=2026-01-31 time=14:00 recur=none msg="One-off meeting"
Invalid line here
- [ ] bad recurrence
- [ ] date=2026-02-01 time=10:00 recur=weekly msg="Weekly review" id=rid_BBBBBBBBBBBB

# End of file`;
  
  const results = parseRemindersFile(content);
  
  assert.equal(results.length, 3);
  assert.equal(results[0].msg, 'Daily standup');
  assert.equal(results[1].msg, 'One-off meeting');
  assert.equal(results[2].msg, 'Weekly review');
});

test('parseRemindersFile preserves raw line content', () => {
  const line = '- [ ] date=2026-01-30 time=14:23 recur=none msg="Test" id=rid_K5V4M2J3Q2ZL';
  const results = parseRemindersFile(line);
  
  assert.equal(results.length, 1);
  assert.equal(results[0]._raw, line);
});

// ==================== generateReminderId tests ====================

test('generateReminderId returns string starting with rid_', () => {
  const id = generateReminderId();
  assert.ok(typeof id === 'string');
  assert.ok(id.startsWith('rid_'));
});

test('generateReminderId returns valid format', () => {
  const id = generateReminderId();
  assert.ok(ID_PATTERN.test(id), `ID ${id} should match pattern`);
});

test('generateReminderId returns different values on multiple calls', () => {
  const id1 = generateReminderId();
  const id2 = generateReminderId();
  const id3 = generateReminderId();
  
  assert.notEqual(id1, id2);
  assert.notEqual(id2, id3);
  assert.notEqual(id1, id3);
});

test('generateReminderId generates 12 base32 characters', () => {
  const id = generateReminderId();
  const base32Part = id.slice(4); // Remove 'rid_'
  assert.equal(base32Part.length, 12);
  
  // All characters should be in base32 alphabet
  const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  for (const char of base32Part) {
    assert.ok(BASE32_CHARS.includes(char), `Char ${char} should be valid base32`);
  }
});

// ==================== formatReminderLine tests ====================

test('formatReminderLine formats basic reminder', () => {
  const reminder = {
    date: '2026-01-30',
    time: '14:23',
    recur: 'none',
    msg: 'Test reminder',
    id: 'rid_K5V4M2J3Q2ZL',
  };
  
  const line = formatReminderLine(reminder);
  assert.equal(line, '- [ ] date=2026-01-30 time=14:23 recur=none msg="Test reminder" id=rid_K5V4M2J3Q2ZL');
});

test('formatReminderLine omits id when null', () => {
  const reminder = {
    date: '2026-01-30',
    time: '14:23',
    recur: 'none',
    msg: 'Test reminder',
    id: null,
  };
  
  const line = formatReminderLine(reminder);
  assert.equal(line, '- [ ] date=2026-01-30 time=14:23 recur=none msg="Test reminder"');
});

test('formatReminderLine escapes quotes in msg', () => {
  const reminder = {
    date: '2026-01-30',
    time: '14:23',
    recur: 'none',
    msg: 'Say "hello" to everyone',
    id: null,
  };
  
  const line = formatReminderLine(reminder);
  assert.equal(line, '- [ ] date=2026-01-30 time=14:23 recur=none msg="Say \\"hello\\" to everyone"');
});

test('formatReminderLine handles all recurrence types', () => {
  for (const recur of VALID_RECURRENCE) {
    const reminder = {
      date: '2026-01-30',
      time: '14:23',
      recur,
      msg: 'Test',
      id: null,
    };
    
    const line = formatReminderLine(reminder);
    assert.ok(line.includes(`recur=${recur}`), `Should include recurrence: ${recur}`);
  }
});

test('formatReminderLine roundtrips with parseReminderLine', () => {
  const original = {
    date: '2026-01-30',
    time: '14:23',
    recur: 'weekly',
    msg: 'Weekly meeting with "quotes" and spaces',
    id: 'rid_K5V4M2J3Q2ZL',
  };
  
  const line = formatReminderLine(original);
  const parsed = parseReminderLine(line);
  
  assert.ok(parsed);
  assert.equal(parsed.date, original.date);
  assert.equal(parsed.time, original.time);
  assert.equal(parsed.recur, original.recur);
  assert.equal(parsed.msg, original.msg);
  assert.equal(parsed.id, original.id);
});

// ==================== Pattern validation tests ====================

test('ID_PATTERN validates correct IDs', () => {
  assert.ok(ID_PATTERN.test('rid_AAAAAAAAAAAA'));
  assert.ok(ID_PATTERN.test('rid_ZZZZZZZZZZZZ'));
  assert.ok(ID_PATTERN.test('rid_234567234567'));
  assert.ok(ID_PATTERN.test('rid_K5V4M2J3Q2ZL'));
});

test('ID_PATTERN rejects incorrect IDs', () => {
  assert.ok(!ID_PATTERN.test('id_K5V4M2J9Q2ZP')); // Wrong prefix
  assert.ok(!ID_PATTERN.test('rid_K5V4M2J9Q2Z')); // Too short
  assert.ok(!ID_PATTERN.test('rid_K5V4M2J3Q2ZLP')); // Too long
  assert.ok(!ID_PATTERN.test('rid_k5v4m2j9q2zp')); // Lowercase
  assert.ok(!ID_PATTERN.test('rid_K5V4M2J9Q2Z1')); // Invalid char 1
  assert.ok(!ID_PATTERN.test('rid_K5V4M2J9Q2Z8')); // Invalid char 8
  assert.ok(!ID_PATTERN.test('rid_K5V4M2J9Q2Z0')); // Invalid char 0
  assert.ok(!ID_PATTERN.test('rid_K5V4M2J9Q2Z!')); // Invalid char !
});

test('DATE_PATTERN validates correct dates', () => {
  assert.ok(DATE_PATTERN.test('2026-01-30'));
  assert.ok(DATE_PATTERN.test('2024-02-29')); // Leap year
  assert.ok(DATE_PATTERN.test('1999-12-31'));
  assert.ok(DATE_PATTERN.test('0000-00-00')); // Edge case (still matches pattern)
});

test('DATE_PATTERN rejects incorrect dates', () => {
  assert.ok(!DATE_PATTERN.test('2026/01/30')); // Wrong separator
  assert.ok(!DATE_PATTERN.test('30-01-2026')); // Wrong order
  assert.ok(!DATE_PATTERN.test('2026-1-30')); // Missing leading zero
  assert.ok(!DATE_PATTERN.test('2026-01-5')); // Missing leading zero
  assert.ok(!DATE_PATTERN.test('2026-01')); // Missing day
  assert.ok(!DATE_PATTERN.test('01-30-2026')); // US format
});

test('TIME_PATTERN validates correct times', () => {
  assert.ok(TIME_PATTERN.test('00:00'));
  assert.ok(TIME_PATTERN.test('23:59'));
  assert.ok(TIME_PATTERN.test('14:30'));
  assert.ok(TIME_PATTERN.test('09:05'));
});

test('TIME_PATTERN rejects incorrect times', () => {
  assert.ok(!TIME_PATTERN.test('24:00')); // Hour too high
  assert.ok(!TIME_PATTERN.test('14:60')); // Minute too high
  assert.ok(!TIME_PATTERN.test('2:30')); // Missing leading zero
  assert.ok(!TIME_PATTERN.test('14:5')); // Missing leading zero
  assert.ok(!TIME_PATTERN.test('14.30')); // Wrong separator
  assert.ok(!TIME_PATTERN.test('14:30:00')); // With seconds
  assert.ok(!TIME_PATTERN.test('1430')); // No separator
});

// ==================== assignMissingIds tests ====================

test('assignMissingIds returns empty result for null input', () => {
  const result = assignMissingIds(null);
  assert.equal(result.content, '');
  assert.deepEqual(result.assigned, []);
  assert.equal(result.unchanged, 0);
});

test('assignMissingIds returns empty result for undefined input', () => {
  const result = assignMissingIds(undefined);
  assert.equal(result.content, '');
  assert.deepEqual(result.assigned, []);
  assert.equal(result.unchanged, 0);
});

test('assignMissingIds returns unchanged for empty string', () => {
  const result = assignMissingIds('');
  assert.equal(result.content, '');
  assert.deepEqual(result.assigned, []);
  assert.equal(result.unchanged, 0);
});

test('assignMissingIds assigns ID to valid line without ID', () => {
  const content = '- [ ] date=2026-01-30 time=14:23 recur=none msg="Test reminder"';
  const result = assignMissingIds(content);
  
  assert.equal(result.assigned.length, 1);
  assert.ok(result.assigned[0].id.startsWith('rid_'));
  assert.ok(ID_PATTERN.test(result.assigned[0].id));
  assert.equal(result.assigned[0].lineNumber, 1);
  assert.equal(result.assigned[0].oldLine, content);
  assert.ok(result.content.includes(`id=${result.assigned[0].id}`));
  assert.equal(result.unchanged, 0);
});

test('assignMissingIds does not modify line with existing ID', () => {
  const content = '- [ ] date=2026-01-30 time=14:23 recur=none msg="Test reminder" id=rid_K5V4M2J3Q2ZL';
  const result = assignMissingIds(content);
  
  assert.equal(result.assigned.length, 0);
  assert.equal(result.content, content);
  assert.equal(result.unchanged, 1);
});

test('assignMissingIds does not modify invalid lines', () => {
  const content = 'Invalid line without task marker';
  const result = assignMissingIds(content);
  
  assert.equal(result.assigned.length, 0);
  assert.equal(result.content, content);
  assert.equal(result.unchanged, 1);
});

test('assignMissingIds does not modify empty lines', () => {
  const content = '\n\n';
  const result = assignMissingIds(content);
  
  assert.equal(result.assigned.length, 0);
  assert.equal(result.content, content);
  assert.equal(result.unchanged, 3); // 3 empty lines (including trailing)
});

test('assignMissingIds does not modify comment lines', () => {
  const content = '# This is a comment\n  # Indented comment';
  const result = assignMissingIds(content);
  
  assert.equal(result.assigned.length, 0);
  assert.equal(result.content, content);
  assert.equal(result.unchanged, 2);
});

test('assignMissingIds handles mixed content correctly', () => {
  const content = `# Reminders file
- [ ] date=2026-01-30 time=09:00 recur=daily msg="Daily standup" id=rid_AAAAAAAAAAAA

- [ ] date=2026-01-31 time=14:00 recur=none msg="One-off meeting"
Invalid line here
- [ ] date=2026-02-01 time=10:00 recur=weekly msg="Weekly review"

# End of file`;
  
  const result = assignMissingIds(content);
  
  // Should assign IDs to 2 lines that don't have them
  assert.equal(result.assigned.length, 2);
  assert.equal(result.unchanged, 6); // 2 comments, 1 empty, 1 with existing ID, 1 invalid, 1 empty
  
  // Verify the lines that got IDs
  const linesWithoutId = result.assigned.map(a => a.lineNumber);
  assert.ok(linesWithoutId.includes(4)); // One-off meeting
  assert.ok(linesWithoutId.includes(6)); // Weekly review
  
  // Verify assigned IDs are valid
  for (const assignment of result.assigned) {
    assert.ok(ID_PATTERN.test(assignment.id));
    assert.ok(assignment.newLine.includes(`id=${assignment.id}`));
  }
  
  // Verify the content with existing ID is unchanged
  assert.ok(result.content.includes('id=rid_AAAAAAAAAAAA'));
});

test('assignMissingIds preserves original line structure', () => {
  const content = '- [ ] date=2026-01-30 time=14:23 recur=none msg="Test reminder"';
  const result = assignMissingIds(content);
  
  // The ID should be appended after the msg field
  const parsed = parseReminderLine(result.content);
  assert.ok(parsed);
  assert.equal(parsed.date, '2026-01-30');
  assert.equal(parsed.time, '14:23');
  assert.equal(parsed.recur, 'none');
  assert.equal(parsed.msg, 'Test reminder');
  assert.ok(parsed.id);
});

test('assignMissingIds assigns unique IDs to multiple lines', () => {
  const content = `- [ ] date=2026-01-30 time=09:00 recur=none msg="First"
- [ ] date=2026-01-31 time=10:00 recur=none msg="Second"
- [ ] date=2026-02-01 time=11:00 recur=none msg="Third"`;
  
  const result = assignMissingIds(content);
  
  assert.equal(result.assigned.length, 3);
  
  // All IDs should be unique
  const ids = result.assigned.map(a => a.id);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, 3);
});

test('assignMissingIds preserves whitespace after msg field', () => {
  const content = '- [ ] date=2026-01-30 time=14:23 recur=none msg="Test reminder"    ';
  const result = assignMissingIds(content);
  
  // The ID should be inserted before the trailing whitespace
  assert.ok(result.content.includes('msg="Test reminder" id='));
});

test('assignMissingIds handles msg with escaped quotes', () => {
  const content = '- [ ] date=2026-01-30 time=14:23 recur=none msg="Say \\"hello\\" to everyone"';
  const result = assignMissingIds(content);
  
  assert.equal(result.assigned.length, 1);
  const parsed = parseReminderLine(result.content);
  assert.ok(parsed);
  assert.equal(parsed.msg, 'Say "hello" to everyone');
  assert.ok(parsed.id);
});

test('assignMissingIds roundtrips correctly', () => {
  const original = {
    date: '2026-01-30',
    time: '14:23',
    recur: 'weekly',
    msg: 'Weekly meeting',
    id: null,
  };
  
  const line = formatReminderLine(original);
  const result = assignMissingIds(line);
  
  assert.equal(result.assigned.length, 1);
  
  // The resulting line should be parseable and have the same data
  const parsed = parseReminderLine(result.content);
  assert.ok(parsed);
  assert.equal(parsed.date, original.date);
  assert.equal(parsed.time, original.time);
  assert.equal(parsed.recur, original.recur);
  assert.equal(parsed.msg, original.msg);
  assert.ok(parsed.id);
});

test('assignMissingIds generates valid IDs that pass pattern validation', () => {
  const content = `- [ ] date=2026-01-30 time=09:00 recur=none msg="First"
- [ ] date=2026-01-31 time=10:00 recur=none msg="Second"`;
  
  const result = assignMissingIds(content);
  
  for (const assignment of result.assigned) {
    assert.ok(ID_PATTERN.test(assignment.id), `ID ${assignment.id} should match pattern`);
  }
});

test('assigned entries track correct line numbers', () => {
  const content = `# Comment
- [ ] date=2026-01-30 time=09:00 recur=none msg="Line 2"

- [ ] date=2026-01-31 time=10:00 recur=none msg="Line 4"
Invalid line
- [ ] date=2026-02-01 time=11:00 recur=none msg="Line 6"`;
  
  const result = assignMissingIds(content);
  
  assert.equal(result.assigned.length, 3);
  assert.equal(result.assigned[0].lineNumber, 2);
  assert.equal(result.assigned[1].lineNumber, 4);
  assert.equal(result.assigned[2].lineNumber, 6);
});

test('assignMissingIds does not modify content when all lines have IDs', () => {
  const content = `- [ ] date=2026-01-30 time=09:00 recur=none msg="First" id=rid_AAAAAAAAAAAA
- [ ] date=2026-01-31 time=10:00 recur=none msg="Second" id=rid_BBBBBBBBBBBB`;
  
  const result = assignMissingIds(content);
  
  assert.equal(result.assigned.length, 0);
  assert.equal(result.content, content);
  assert.equal(result.unchanged, 2);
});
