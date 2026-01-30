#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { 
  generateReminderId, 
  formatReminderLine, 
  DATE_PATTERN, 
  TIME_PATTERN, 
  VALID_RECURRENCE 
} = require('../../scheduler/parser');

const { loadConfig } = require('../../app/config');

const config = loadConfig({ cwd: path.join(__dirname, '../../') });
const filePath = config.reminders?.file_path;

const [,, date, time, recur, msg] = process.argv;

if (!filePath) {
  console.error('Error: reminders.file_path not found in config.');
  process.exit(1);
}

if (!date || !time || !recur || msg === undefined) {
  console.error('Usage: node add.js <date> <time> <recur> <msg>');
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

const id = generateReminderId();
const line = formatReminderLine({ date, time, recur, msg, id });

try {
  // Read existing content to ensure we add a newline if needed
  let existing = '';
  if (fs.existsSync(filePath)) {
    existing = fs.readFileSync(filePath, 'utf8');
  }
  
  const separator = (existing && !existing.endsWith('\n')) ? '\n' : '';
  fs.appendFileSync(filePath, separator + line + '\n');
  
  const recurPart = recur !== 'none' ? ` (recurring: ${recur})` : '';
  process.stdout.write(`Set reminder: ${msg} at ${time} on ${date}${recurPart}\n`);
  process.stderr.write(`ID: ${id}\n`);
} catch (err) {
  console.error(`Error writing to file: ${err.message}`);
  process.exit(1);
}
