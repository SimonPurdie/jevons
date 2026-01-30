#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../../app/config');
const { sendIpcMessage } = require('../../lib/ipc-client');

const config = loadConfig({ cwd: path.join(__dirname, '../../') });
const filePath = config.reminders?.file_path;

const [,, id] = process.argv;

if (!filePath) {
  console.error('Error: reminders.file_path not found in config.');
  process.exit(1);
}

if (!id) {
  console.error('Usage: node delete.js <id>');
  process.exit(1);
}

if (!fs.existsSync(filePath)) {
  console.error('Error: Reminders file not found.');
  process.exit(1);
}

async function run() {
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
    
    const confirmation = `Deleted reminder: ${id}`;

    // Try to send via IPC
    const sent = await sendIpcMessage(confirmation);
    
    if (sent) {
      process.stdout.write(`SUCCESS: Message sent to Discord: ${confirmation}\n`);
    } else {
      process.stdout.write(`${confirmation}\n`);
    }
  } catch (err) {
    console.error(`Error processing file: ${err.message}`);
    process.exit(1);
  }
}

run();


if (!id) {
  console.error('Usage: node delete.js <id>');
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
  process.stdout.write(`Deleted reminder: ${id}\n`);
} catch (err) {
  console.error(`Error processing file: ${err.message}`);
  process.exit(1);
}
