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
    sendMessage,
    channelId,
    interval = 60000,
    onError,
    onLog
  } = options || {};

  if (!remindersFilePath) throw new Error('remindersFilePath is required');
  if (typeof sendMessage !== 'function') throw new Error('sendMessage is required');
  if (!channelId) throw new Error('channelId is required');

  let timer = null;
  let isRunning = false;

  function log(msg) {
    if (typeof onLog === 'function') onLog(msg);
  }

  function error(err) {
    if (typeof onError === 'function') onError(err);
  }

  async function scan() {
    if (isRunning) return;
    isRunning = true;

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
           await sendMessage({
             content: `Confirmed: Assigned ID to reminder.\n\`${assigned.newLine.trim()}\``,
             channelId: channelId
           });
        }
      }

      // 2. Parse reminders
      const reminders = parseRemindersFile(content);

      // 3. Scan for due reminders
      const due = scanDueReminders(reminders);
      
      if (due.length > 0) {
        // 4. Send notifications
        for (const reminder of due) {
          await sendMessage({
            content: `⏰ Reminder: ${reminder.msg}`,
            channelId: channelId
          });
        }

        // 5. Update lifecycle (remove one-offs)
        const updatedContent = updateRemindersFile(content, due);
        if (updatedContent !== content) {
          fs.writeFileSync(remindersFilePath, updatedContent, 'utf8');
        }
      }

    } catch (err) {
      error(err);
    } finally {
      isRunning = false;
    }
  }

  function start() {
    if (timer) return;
    log('Scheduler service started');
    // Run immediately
    scan();
    timer = setInterval(scan, interval);
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
