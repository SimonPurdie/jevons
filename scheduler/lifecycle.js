/**
 * Scheduler Lifecycle Management
 * 
 * Handles updates to the reminders file based on fired reminders.
 */

import { parseReminderLine } from './parser.js';

const DATE_FIELD_REGEX = /date=\d{4}-\d{2}-\d{2}/;

/**
 * Update the reminders file content after reminders have fired.
 * Removes one-off reminders that have fired. Advances the date of recurring reminders.
 * 
 * @param {string} content - The current content of the reminders file
 * @param {Array} firedReminders - Array of reminder objects that have fired (must have 'id', 'recur', and optionally '_targetDateStr')
 * @returns {string} The updated file content
 */
export function updateRemindersFile(content, firedReminders) {
  if (!content || typeof content !== 'string') {
    return '';
  }

  if (!firedReminders || !Array.isArray(firedReminders) || firedReminders.length === 0) {
    return content;
  }

  const idsToDelete = new Set();
  const recurringUpdates = new Map();

  for (const reminder of firedReminders) {
    if (!reminder || !reminder.id || !reminder.recur) {
      continue;
    }

    if (reminder.recur === 'none') {
      idsToDelete.add(reminder.id);
      continue;
    }

    const baseDate = reminder._targetDateStr || reminder.date;
    const nextDate = getNextRecurrenceDate(baseDate, reminder.recur);

    if (nextDate) {
      recurringUpdates.set(reminder.id, nextDate);
    }
  }

  if (idsToDelete.size === 0 && recurringUpdates.size === 0) {
    return content;
  }

  const lines = content.split('\n');
  const updatedLines = [];
  let changed = idsToDelete.size > 0;

  for (const line of lines) {
    const parsed = parseReminderLine(line);

    if (parsed && parsed.id) {
      if (idsToDelete.has(parsed.id)) {
        changed = true;
        continue;
      }

      if (recurringUpdates.has(parsed.id)) {
        const nextDate = recurringUpdates.get(parsed.id);
        const newLine = replaceDateInLine(line, nextDate);
        if (newLine !== line) {
          changed = true;
        }
        updatedLines.push(newLine);
        continue;
      }
    }

    updatedLines.push(line);
  }

  return changed ? updatedLines.join('\n') : content;
}

function replaceDateInLine(line, newDate) {
  if (!newDate || !DATE_FIELD_REGEX.test(line)) {
    return line;
  }

  return line.replace(DATE_FIELD_REGEX, `date=${newDate}`);
}

function getNextRecurrenceDate(baseDate, recur) {
  if (!baseDate || typeof baseDate !== 'string') {
    return null;
  }

  switch (recur) {
    case 'daily':
      return addDaysToDate(baseDate, 1);
    case 'weekly':
      return addDaysToDate(baseDate, 7);
    case 'monthly':
      return addMonthsToDate(baseDate, 1);
    default:
      return null;
  }
}

function addDaysToDate(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map((value) => Number(value));

  if ([year, month, day].some((value) => Number.isNaN(value))) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function addMonthsToDate(dateStr, months) {
  const [year, month, day] = dateStr.split('-').map((value) => Number(value));

  if ([year, month, day].some((value) => Number.isNaN(value))) {
    return null;
  }

  const totalMonths = (month - 1) + months;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonthIndex = ((totalMonths % 12) + 12) % 12;
  const daysInTargetMonth = getDaysInMonth(targetYear, targetMonthIndex + 1);
  const targetDay = Math.min(day, daysInTargetMonth);

  return formatDateFromParts(targetYear, targetMonthIndex + 1, targetDay);
}

function formatDateFromParts(year, month, day) {
  const paddedMonth = String(month).padStart(2, '0');
  const paddedDay = String(day).padStart(2, '0');
  return `${year}-${paddedMonth}-${paddedDay}`;
}

function getDaysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
