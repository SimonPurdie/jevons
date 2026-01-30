
const assert = require('node:assert');
const { test, describe } = require('node:test');
const { isReminderDue, scanDueReminders } = require('../../scheduler/scanner');

describe('Scheduler Scanner', () => {
  // Helper to create a reminder object
  const createReminder = (date, time, recur = 'none', msg = 'test', id = 'rid_123') => ({
    date, time, recur, msg, id
  });

  // Helper to create a UTC Date from ISO string
  const date = (iso) => new Date(iso);

  describe('scanDueReminders', () => {
    test('returns only due reminders', () => {
      const now = date('2026-03-20T14:30:05Z');
      const reminders = [
        createReminder('2026-03-20', '14:30', 'none', 'Due'),
        createReminder('2026-03-20', '14:31', 'none', 'Not Due'),
        createReminder('2026-03-21', '14:30', 'none', 'Not Due Date'),
      ];
      
      const due = scanDueReminders(reminders, now);
      assert.strictEqual(due.length, 1);
      assert.strictEqual(due[0].msg, 'Due');
    });
  });

  describe('isReminderDue', () => {
    describe('One-off reminders', () => {
      test('triggers when exact time matches', () => {
        const reminder = createReminder('2026-03-20', '14:30', 'none');
        // London is UTC+0 in March (before last Sunday)
        // 14:30 London = 14:30 UTC
        const now = date('2026-03-20T14:30:05Z');
        assert.strictEqual(isReminderDue(reminder, now), true);
      });

      test('triggers when time matches in BST', () => {
        const reminder = createReminder('2026-06-20', '14:30', 'none');
        // London is UTC+1 (BST) in June
        // 14:30 London = 13:30 UTC
        const now = date('2026-06-20T13:30:05Z');
        assert.strictEqual(isReminderDue(reminder, now), true);
      });

      test('does not trigger if date does not match', () => {
        const reminder = createReminder('2026-03-21', '14:30', 'none');
        const now = date('2026-03-20T14:30:05Z');
        assert.strictEqual(isReminderDue(reminder, now), false);
      });

      test('does not trigger if time does not match', () => {
        const reminder = createReminder('2026-03-20', '14:30', 'none');
        const now = date('2026-03-20T14:31:05Z'); // 1 minute late (assuming scan logic checks exact minute)
        // Wait, if scan runs every minute, 14:31 should NOT trigger 14:30
        assert.strictEqual(isReminderDue(reminder, now), false);
      });
    });

    describe('Recurrence: Daily', () => {
      test('triggers every day at the time', () => {
        const reminder = createReminder('2026-01-01', '10:00', 'daily'); // Date part ignored for daily
        const now = date('2026-03-20T10:00:05Z'); // 10:00 UTC (GMT)
        assert.strictEqual(isReminderDue(reminder, now), true);
      });
      
      test('handles BST transition for daily', () => {
         const reminder = createReminder('2026-01-01', '10:00', 'daily');
         const now = date('2026-06-20T09:00:05Z'); // 10:00 London (BST) is 09:00 UTC
         assert.strictEqual(isReminderDue(reminder, now), true);
      });
    });

    describe('Recurrence: Weekly', () => {
      test('triggers on the same day of week', () => {
        // 2026-03-20 is a Friday
        const reminder = createReminder('2026-03-20', '10:00', 'weekly');
        const nextWeek = date('2026-03-27T10:00:05Z'); // Next Friday
        assert.strictEqual(isReminderDue(reminder, nextWeek), true);
      });

      test('does not trigger on different day of week', () => {
        const reminder = createReminder('2026-03-20', '10:00', 'weekly'); // Friday
        const nextDay = date('2026-03-21T10:00:05Z'); // Saturday
        assert.strictEqual(isReminderDue(reminder, nextDay), false);
      });
    });

    describe('Recurrence: Monthly', () => {
      test('triggers on same day of month', () => {
        const reminder = createReminder('2026-01-15', '10:00', 'monthly');
        const nextMonth = date('2026-02-15T10:00:05Z');
        assert.strictEqual(isReminderDue(reminder, nextMonth), true);
      });

      test('triggers on last day if day does not exist (Feb 28)', () => {
        const reminder = createReminder('2026-01-31', '10:00', 'monthly');
        // Feb 2026 has 28 days
        const febEnd = date('2026-02-28T10:00:05Z');
        assert.strictEqual(isReminderDue(reminder, febEnd), true);
      });

      test('triggers on last day if day does not exist (Feb 29 leap year)', () => {
        const reminder = createReminder('2024-01-31', '10:00', 'monthly'); // 2024 is leap
        const febEnd = date('2024-02-29T10:00:05Z');
        assert.strictEqual(isReminderDue(reminder, febEnd), true);
      });
      
      test('triggers on normal day even if end of month', () => {
         const reminder = createReminder('2026-01-28', '10:00', 'monthly');
         const feb28 = date('2026-02-28T10:00:05Z');
         assert.strictEqual(isReminderDue(reminder, feb28), true);
      });
    });

    describe('DST Edge Cases (Europe/London)', () => {
      // Spring Forward: Last Sunday in March. 01:00 GMT -> 02:00 BST.
      // 2026: March 29.
      // 00:59 GMT (00:59 UTC) -> 02:00 BST (01:00 UTC)
      // Gap: 01:00 Local .. 01:59 Local do not exist.
      // Rule: Schedule at next valid local minute (02:00 BST / 01:00 UTC).

      test('Spring Forward: Reminders in gap fire at 02:00 BST', () => {
        const reminder = createReminder('2026-03-29', '01:30', 'none');
        // Should fire at 02:00 BST -> 01:00 UTC
        const now = date('2026-03-29T01:00:05Z');
        assert.strictEqual(isReminderDue(reminder, now), true);
      });
      
      test('Spring Forward: Reminders at 02:00 BST also fire at 02:00 BST', () => {
        const reminder = createReminder('2026-03-29', '02:00', 'none');
        // Should fire at 02:00 BST -> 01:00 UTC
        const now = date('2026-03-29T01:00:05Z');
        assert.strictEqual(isReminderDue(reminder, now), true);
      });

      // Fall Back: Last Sunday in October. 02:00 BST -> 01:00 GMT.
      // 2026: Oct 25.
      // 01:59 BST (+1) -> 01:00 GMT (+0).
      // 01:30 occurs twice.
      // Rule: Schedule at earlier occurrence (BST).

      test('Fall Back: Overlap reminder fires at earlier occurrence (BST)', () => {
        const reminder = createReminder('2026-10-25', '01:30', 'none');
        
        // Earlier: 01:30 BST -> 00:30 UTC
        const first = date('2026-10-25T00:30:05Z');
        assert.strictEqual(isReminderDue(reminder, first), true, 'Should fire at BST occurrence');
        
        // Later: 01:30 GMT -> 01:30 UTC
        const second = date('2026-10-25T01:30:05Z');
        assert.strictEqual(isReminderDue(reminder, second), false, 'Should NOT fire at GMT occurrence');
      });
    });
  });
});
