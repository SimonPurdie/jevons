#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../../app/config.js';
import { sendIpcMessage } from '../../lib/ipc-client.js';
import {
  parseReminderLine,
  formatReminderLine,
  DATE_PATTERN,
  TIME_PATTERN,
  VALID_RECURRENCE,
} from '../../scheduler/parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const config = loadConfig({ cwd: path.join(__dirname, '../../') });
const filePath = config.reminders?.file_path;
const [, , id, date, time, recur, msg] = process.argv;

if (!filePath) {
  console.error('Error: reminders.file_path not found in config.');
  process.exit(1);
}

if (!id || !date || !time || !recur || msg === undefined) {
  console.error('Usage: node update.js <id> <date> <time> <recur> <msg>');
  process.exit(1);
}

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

async function run() {
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

    const recurPart = recur !== 'none' ? ` (recurring: ${recur})` : '';
    const confirmation = `Updated reminder: ${msg} at ${time} on ${date}${recurPart}`;

    const sent = await sendIpcMessage(confirmation);
    if (sent) {
      process.stdout.write(`SUCCESS: Message sent to Discord: ${confirmation}\n`);
    } else {
      process.stdout.write(`${confirmation}\n`);
    }

    process.stderr.write(`ID: ${id}\n`);
  } catch (err) {
    console.error(`Error processing file: ${err.message}`);
    process.exit(1);
  }
}

run();
