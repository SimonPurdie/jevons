#!/usr/bin/env node
const fs = require('fs');
const { parseReminderLine } = require('../../scheduler/parser');

const [,, filePath, id] = process.argv;

if (!filePath || !id) {
  console.error('Usage: node delete.js <filePath> <id>');
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
  
  const updatedLines = lines.filter(line => {
    const reminder = parseReminderLine(line);
    if (reminder && reminder.id === id) {
      found = true;
      return false;
    }
    return true;
  });

  if (!found) {
    console.error(`Error: Reminder with ID ${id} not found.`);
    process.exit(1);
  }

  fs.writeFileSync(filePath, updatedLines.join('\n'), 'utf8');
  console.log(`Confirmed: Deleted reminder ${id}`);
} catch (err) {
  console.error(`Error processing file: ${err.message}`);
  process.exit(1);
}
