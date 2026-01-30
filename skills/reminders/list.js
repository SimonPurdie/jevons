#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../../app/config');
const { parseRemindersFile } = require('../../scheduler/parser');

const config = loadConfig({ cwd: path.join(__dirname, '../../') });
const filePath = config.reminders?.file_path;

if (!filePath) {
  console.error('Error: reminders.file_path not found in config.');
  process.exit(1);
}

if (!fs.existsSync(filePath)) {
  console.log('No reminders file found.');
  process.exit(0);
}

try {
  const content = fs.readFileSync(filePath, 'utf8');
  const reminders = parseRemindersFile(content);

  if (reminders.length === 0) {
    console.log('No valid reminders found.');
  } else {
    reminders.forEach(r => {
      const recurPart = r.recur !== 'none' ? ` [${r.recur}]` : '';
      console.log(`${r.id}: ${r.date} ${r.time}${recurPart} - ${r.msg}`);
    });
  }
} catch (err) {
  console.error(`Error reading file: ${err.message}`);
  process.exit(1);
}
