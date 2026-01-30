const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createSchedulerService } = require('../../scheduler/service');

const TMP_DIR = path.join(__dirname, 'tmp');

describe('Scheduler Service', () => {
  const remindersPath = path.join(TMP_DIR, 'reminders.md');
  
  afterEach(() => {
    if (fs.existsSync(remindersPath)) {
      fs.unlinkSync(remindersPath);
    }
  });

  test('assigns IDs to new reminders and sends confirmation', async () => {
    const content = `- [ ] date=2026-03-29 time=14:00 recur=none msg="Test"`;
    fs.writeFileSync(remindersPath, content);

    const messages = [];
    const sendMessage = async (msg) => messages.push(msg);

    const service = createSchedulerService({
      remindersFilePath: remindersPath,
      sendMessage,
      channelId: '123',
    });

    await service.scan();

    const newContent = fs.readFileSync(remindersPath, 'utf8');
    assert.match(newContent, /id=rid_[A-Z2-7]{12}/);
    assert.strictEqual(messages.length, 1);
    assert.match(messages[0].content, /Confirmed: Assigned ID/);
  });

  test('sends notification for due reminder and deletes one-off', async () => {
    const now = new Date();
    // Format to London time parts
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
    const parts = fmt.formatToParts(now);
    const p = {};
    parts.forEach(part => p[part.type] = part.value);
    
    const dateStr = `${p.year}-${p.month}-${p.day}`;
    const timeStr = `${p.hour}:${p.minute}`;
    
    const content = `- [ ] date=${dateStr} time=${timeStr} recur=none msg="Due Now" id=rid_ABCDEFGHIJKL`;
    fs.writeFileSync(remindersPath, content);

    const messages = [];
    const sendMessage = async (msg) => messages.push(msg);

    const service = createSchedulerService({
      remindersFilePath: remindersPath,
      sendMessage,
      channelId: '123',
    });

    await service.scan();

    assert.strictEqual(messages.length, 1);
    assert.match(messages[0].content, /Reminder: Due Now/);
    
    // Check it was deleted (only empty lines remain or empty string)
    const newContent = fs.readFileSync(remindersPath, 'utf8');
    assert.strictEqual(newContent.trim(), '');
  });
});
