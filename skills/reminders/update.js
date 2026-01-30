#!/usr/bin/env node
const fs = require('fs');
const { 
  parseReminderLine, 
  formatReminderLine, 
  DATE_PATTERN, 
  TIME_PATTERN, 
  VALID_RECURRENCE 
} = require('../../scheduler/parser');

const [,, filePath, id, date, time, recur, msg] = process.argv;

if (!filePath || !id || !date || !time || !recur || msg === undefined) {
  console.error('Usage: node update.js <filePath> <id> <date> <time> <recur> <msg>');
  process.exit(1);
}

// Validation
if (!DATE_PATTERN.test(date)) {
  console.error(`Error: Invalid date format: ${date}. Use YYYY-MM-DD`);
  process.exit(1);
}

const [y, m, d] = date.split('-').map(Number);
const dateObj = new Date(y, m - 1, d);
if (dateObj.getFullYear() !== y || dateObj.getMonth() !== m - 1 || dateObj.getDate() !== d) {
  console.error(`Error: Semantically invalid date: ${date}`);
  process.exit(1);
}

if (!TIME_PATTERN.test(time)) {
  console.error(`Error: Invalid time format: ${time}. Use HH:MM`);
  process.exit(1);
}
if (!VALID_RECURRENCE.includes(recur)) {
  console.error(`Error: Invalid recurrence: ${recur}. Use ${VALID_RECURRENCE.join(', ')}`);
  process.exit(1);
}

if (!fs.existsSync(filePath)) {
  console.error('Error: Reminders file not found.');
  process.exit(1);
}

try {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  let found = false;
  
  const updatedLines = lines.map(line => {
    const reminder = parseReminderLine(line);
    if (reminder && reminder.id === id) {
      found = true;
      return formatReminderLine({ date, time, recur, msg, id });
    }
    return line;
  });

  if (!found) {
    console.error(`Error: Reminder with ID ${id} not found.`);
    process.exit(1);
  }

  fs.writeFileSync(filePath, updatedLines.join('\n'), 'utf8');
  
  const recurSuffix = recur !== 'none' ? ` (${recur})` : '';
  console.log(`Confirmed: Updated reminder ${id} to ${date} at ${time}${recurSuffix}: ${msg}`);
} catch (err) {
  console.error(`Error processing file: ${err.message}`);
  process.exit(1);
}
