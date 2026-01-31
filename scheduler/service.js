/**
 * Scheduler Service
 * 
 * Orchestrates the reminder system:
 * 1. Scans the reminders file
 * 2. Assigns IDs to new reminders
 * 3. Checks for due reminders
 * 4. Sends notifications
 * 5. Updates file (removes one-offs)
 */
const fs = require('fs');
const { 
  parseRemindersFile, 
  assignMissingIds, 
  formatReminderLine 
} = require('./parser');
const { scanDueReminders } = require('./scanner');
const { updateRemindersFile } = require('./lifecycle');

function createSchedulerService(options) {
  const {
    remindersFilePath,
    stateFilePath,
    sendMessage,
    channelId,
    userId,
    interval = 60000,
    onError,
    onLog
  } = options || {};

  if (!remindersFilePath) throw new Error('remindersFilePath is required');
  if (typeof sendMessage !== 'function') throw new Error('sendMessage is required');
  if (!channelId) throw new Error('channelId is required');

  let timer = null;
  let isRunning = false;
  let lastScanTime = null;

  // Load lastScanTime from state file if it exists
  if (stateFilePath && fs.existsSync(stateFilePath)) {
    try {
      const state = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
      if (state.lastScanTime) {
        lastScanTime = new Date(state.lastScanTime);
      }
    } catch (err) {
      // ignore parse errors
    }
  }

  function log(msg) {
    if (typeof onLog === 'function') onLog(msg);
  }

  function error(err) {
    if (typeof onError === 'function') onError(err);
  }

  function saveState() {
    if (!stateFilePath || !lastScanTime) return;
    try {
      const state = { lastScanTime: lastScanTime.toISOString() };
      fs.writeFileSync(stateFilePath, JSON.stringify(state), 'utf8');
    } catch (err) {
      error(err);
    }
  }

  async function scan() {
    if (isRunning) return;
    isRunning = true;

    const now = new Date();

    try {
      if (!fs.existsSync(remindersFilePath)) {
        // file doesn't exist, nothing to do
        isRunning = false;
        return;
      }

      let content = fs.readFileSync(remindersFilePath, 'utf8');

      // 1. Assign missing IDs
      const idResult = assignMissingIds(content);
      if (idResult.assigned.length > 0) {
        // Write updated content back to file
        fs.writeFileSync(remindersFilePath, idResult.content, 'utf8');
        content = idResult.content;

        // Send confirmations for assigned IDs
        for (const assigned of idResult.assigned) {
           const confirmationMsg = userId 
             ? `<@${userId}> Confirmed: Assigned ID to reminder.\n\`${assigned.newLine.trim()}\``
             : `Confirmed: Assigned ID to reminder.\n\`${assigned.newLine.trim()}\``;
           await sendMessage({
             content: confirmationMsg,
             channelId: channelId
           });
        }
      }

      // 2. Parse reminders
      const reminders = parseRemindersFile(content);

      // 3. Scan for due reminders
      const due = scanDueReminders(reminders, now, lastScanTime);
      
      if (due.length > 0) {
        // 4. Send notifications
        for (const reminder of due) {
          const reminderMsg = userId
            ? `<@${userId}> Reminder: ${reminder.msg}`
            : `⏰ Reminder: ${reminder.msg}`;
          await sendMessage({
            content: reminderMsg,
            channelId: channelId
          });
        }

        // 5. Update lifecycle (remove one-offs)
        const updatedContent = updateRemindersFile(content, due);
        if (updatedContent !== content) {
          fs.writeFileSync(remindersFilePath, updatedContent, 'utf8');
        }
      }

      lastScanTime = now;
      saveState();

    } catch (err) {
      error(err);
    } finally {
      isRunning = false;
    }
  }

  function start() {
    if (timer) return;
    log('Scheduler service started');

    const now = new Date();
    const msUntilNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 200;

    timer = setTimeout(() => {
      scan();
      timer = setInterval(scan, interval);
    }, msUntilNextMinute);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
      log('Scheduler service stopped');
    }
  }

  return {
    start,
    stop,
    scan // exposed for testing
  };
}

module.exports = {
  createSchedulerService
};
