const { test } = require('node:test');
const assert = require('node:assert');
const { updateRemindersFile } = require('../../scheduler/lifecycle');

test('lifecycle: updates reminders file correctly', async (t) => {
  await t.test('removes fired one-off reminders', () => {
    const content = `
- [ ] date=2026-03-01 time=10:00 recur=none msg="One off" id=rid_AAAAAAAAAAAA
- [ ] date=2026-03-01 time=10:00 recur=daily msg="Recurring" id=rid_BBBBBBBBBBBB
    `.trim();

    const fired = [
      { id: 'rid_AAAAAAAAAAAA', recur: 'none' },
      { id: 'rid_BBBBBBBBBBBB', recur: 'daily' }
    ];

    const updated = updateRemindersFile(content, fired);
    
    // Should contain the recurring one
    assert.match(updated, /id=rid_BBBBBBBBBBBB/);
    // Should NOT contain the one-off one
    assert.doesNotMatch(updated, /id=rid_AAAAAAAAAAAA/);
  });

  await t.test('keeps recurring reminders', () => {
    const content = `- [ ] date=2026-03-01 time=10:00 recur=daily msg="Recurring" id=rid_BBBBBBBBBBBB`;
    const fired = [{ id: 'rid_BBBBBBBBBBBB', recur: 'daily' }];
    
    const updated = updateRemindersFile(content, fired);
    assert.strictEqual(updated, content);
  });

  await t.test('preserves comments and structure', () => {
    const content = `
# My reminders
- [ ] date=2026-03-01 time=10:00 recur=none msg="Delete me" id=rid_DELETE222222

# Keep this
- [ ] date=2026-03-01 time=12:00 recur=daily msg="Keep me" id=rid_KEEP22222222
    `.trim();

    const fired = [
      { id: 'rid_DELETE222222', recur: 'none' }
    ];

    const updated = updateRemindersFile(content, fired);

    assert.match(updated, /# My reminders/);
    assert.match(updated, /# Keep this/);
    assert.match(updated, /id=rid_KEEP22222222/);
    assert.doesNotMatch(updated, /id=rid_DELETE222222/);
  });

  await t.test('handles multiple deletions', () => {
    const content = `
- [ ] date=2026-03-01 time=10:00 recur=none msg="1" id=rid_222222222222
- [ ] date=2026-03-01 time=10:00 recur=none msg="2" id=rid_333333333333
- [ ] date=2026-03-01 time=10:00 recur=none msg="3" id=rid_444444444444
    `.trim();

    const fired = [
      { id: 'rid_222222222222', recur: 'none' },
      { id: 'rid_444444444444', recur: 'none' }
    ];

    const updated = updateRemindersFile(content, fired);

    assert.doesNotMatch(updated, /id=rid_222222222222/);
    assert.match(updated, /id=rid_333333333333/);
    assert.doesNotMatch(updated, /id=rid_444444444444/);
  });
  
  await t.test('ignores fired reminders that are not in file', () => {
    const content = `- [ ] date=2026-03-01 time=10:00 recur=daily msg="Keep" id=rid_KEEP22222222`;
    const fired = [{ id: 'rid_MISSING22222', recur: 'none' }];
    
    const updated = updateRemindersFile(content, fired);
    assert.strictEqual(updated, content);
  });

  await t.test('handles empty inputs', () => {
    assert.strictEqual(updateRemindersFile('', []), '');
    assert.strictEqual(updateRemindersFile(null, []), '');
    assert.strictEqual(updateRemindersFile('foo', null), 'foo');
  });
});
