/**
 * Scheduler Lifecycle Management
 * 
 * Handles updates to the reminders file based on fired reminders.
 */

const { parseReminderLine } = require('./parser');

/**
 * Update the reminders file content after reminders have fired.
 * Removes one-off reminders that have fired. Keeps recurring reminders.
 * 
 * @param {string} content - The current content of the reminders file
 * @param {Array} firedReminders - Array of reminder objects that have fired (must have 'id' and 'recur')
 * @returns {string} The updated file content
 */
function updateRemindersFile(content, firedReminders) {
  if (!content || typeof content !== 'string') {
    return '';
  }

  if (!firedReminders || !Array.isArray(firedReminders) || firedReminders.length === 0) {
    return content;
  }

  // Identify IDs of one-off reminders to delete
  const idsToDelete = new Set();
  for (const reminder of firedReminders) {
    if (reminder.recur === 'none' && reminder.id) {
      idsToDelete.add(reminder.id);
    }
  }

  if (idsToDelete.size === 0) {
    return content;
  }

  const lines = content.split('\n');
  const keptLines = [];

  for (const line of lines) {
    // Attempt to parse the line to extract ID safely
    // We only care if it's a valid reminder line that matches an ID to delete
    const parsed = parseReminderLine(line);

    if (parsed && parsed.id && idsToDelete.has(parsed.id)) {
      // This is a one-off reminder that fired -> Drop it
      continue;
    }

    // Otherwise keep the line (including comments, empty lines, recurring reminders, invalid lines)
    keptLines.push(line);
  }

  return keptLines.join('\n');
}

module.exports = {
  updateRemindersFile
};
