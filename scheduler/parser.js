/**
 * Reminders file parser
 * 
 * Parses reminder lines according to the grammar:
 * - [ ] date=YYYY-MM-DD time=HH:MM recur=none|daily|weekly|monthly msg="..." id=RID
 * 
 * Invalid lines are ignored and return null.
 */

const VALID_RECURRENCE = ['none', 'daily', 'weekly', 'monthly'];
const ID_PATTERN = /^rid_[A-Z2-7]{12}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(0\d|1\d|2[0-3]):[0-5]\d$/;

/**
 * Parse a single reminder line
 * @param {string} line - The line to parse
 * @returns {object|null} Parsed reminder or null if invalid
 */
function parseReminderLine(line) {
  if (!line || typeof line !== 'string') {
    return null;
  }

  const trimmed = line.trim();

  // Must start with "- [ ]" (task list format)
  if (!trimmed.startsWith('- [ ]')) {
    return null;
  }

  // Extract content after "- [ ]"
  const content = trimmed.slice(5).trim();
  if (!content) {
    return null;
  }

  // Parse key=value pairs
  const result = {
    date: null,
    time: null,
    recur: null,
    msg: null,
    id: null,
  };

  // Track which fields we've seen to detect duplicates
  const seenFields = new Set();

  // Parse fields using a state machine
  let pos = 0;
  while (pos < content.length) {
    // Skip whitespace
    while (pos < content.length && /\s/.test(content[pos])) {
      pos++;
    }

    if (pos >= content.length) {
      break;
    }

    // Find the key
    const keyStart = pos;
    while (pos < content.length && content[pos] !== '=' && !/\s/.test(content[pos])) {
      pos++;
    }

    if (pos >= content.length || content[pos] !== '=') {
      // No equals sign found - invalid line
      return null;
    }

    const key = content.slice(keyStart, pos);
    pos++; // Skip '='

    // Check for duplicate fields
    if (seenFields.has(key)) {
      return null;
    }
    seenFields.add(key);

    // Parse value based on key
    let value;
    if (key === 'msg') {
      // msg value is quoted or unquoted
      if (content[pos] === '"' || content[pos] === "'") {
        const quoteChar = content[pos];
        pos++; // Skip opening quote
        let valueStr = '';
        while (pos < content.length) {
          if (content[pos] === '\\' && pos + 1 < content.length && content[pos + 1] === quoteChar) {
            // Escaped quote
            valueStr += quoteChar;
            pos += 2;
          } else if (content[pos] === quoteChar) {
            // Closing quote
            pos++;
            break;
          } else {
            valueStr += content[pos];
            pos++;
          }
        }
        value = valueStr;
      } else {
        // Unquoted message - take everything until the end or the next field (key=)
        // This is tricky because the message can contain spaces.
        // The spec says "Fields may appear in any order ... Humans may omit id".
        // If msg is unquoted, we assume it's the last field or followed by id=...
        // Actually, the simplest is to take until the next " key=" pattern if it exists, or the end.
        const remaining = content.slice(pos);
        const nextFieldMatch = remaining.match(/\s+(id|date|time|recur)=/);
        if (nextFieldMatch) {
          value = remaining.slice(0, nextFieldMatch.index);
          pos += nextFieldMatch.index;
        } else {
          value = remaining;
          pos = content.length;
        }
      }
    } else {
      // Other values are unquoted, terminated by space or end of string
      const valueStart = pos;
      while (pos < content.length && !/\s/.test(content[pos])) {
        pos++;
      }
      value = content.slice(valueStart, pos);
    }

    // Store the value
    switch (key) {
      case 'date':
        result.date = value;
        break;
      case 'time':
        result.time = value;
        break;
      case 'recur':
        result.recur = value;
        break;
      case 'msg':
        result.msg = value;
        break;
      case 'id':
        result.id = value;
        break;
      default:
        // Unknown field - invalid line
        return null;
    }
  }

  // Validate required fields (msg can be empty string)
  if (!result.date || !result.time || !result.recur || result.msg === null) {
    return null;
  }

  // Validate date format (YYYY-MM-DD)
  if (!DATE_PATTERN.test(result.date)) {
    return null;
  }

  // Validate time format (HH:MM)
  if (!TIME_PATTERN.test(result.time)) {
    return null;
  }

  // Validate recurrence value
  if (!VALID_RECURRENCE.includes(result.recur)) {
    return null;
  }

  // Validate id format if present
  if (result.id !== null && !ID_PATTERN.test(result.id)) {
    return null;
  }

  return result;
}

/**
 * Parse an entire reminders file content
 * @param {string} content - The file content to parse
 * @returns {object[]} Array of parsed reminders (nulls filtered out)
 */
function parseRemindersFile(content) {
  if (!content || typeof content !== 'string') {
    return [];
  }

  const lines = content.split('\n');
  const reminders = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip empty lines and comments
    if (!line.trim() || line.trim().startsWith('#')) {
      continue;
    }

    const reminder = parseReminderLine(line);
    if (reminder) {
      reminder._lineNumber = i + 1; // 1-based line number for reference
      reminder._raw = line;
      reminders.push(reminder);
    }
    // Invalid lines are silently ignored per spec
  }

  return reminders;
}

/**
 * Generate a reminder ID in rid_<base32> format
 * @returns {string} A new reminder ID
 */
function generateReminderId() {
  const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let id = 'rid_';
  for (let i = 0; i < 12; i++) {
    id += BASE32_CHARS[Math.floor(Math.random() * BASE32_CHARS.length)];
  }
  return id;
}

/**
 * Format a reminder object back to line format
 * @param {object} reminder - The reminder to format
 * @returns {string} The formatted line
 */
function formatReminderLine(reminder) {
  const { date, time, recur, msg, id } = reminder;

  // Escape quotes in message
  const escapedMsg = msg.replace(/"/g, '\\"');

  let line = `- [ ] date=${date} time=${time} recur=${recur} msg="${escapedMsg}"`;

  if (id) {
    line += ` id=${id}`;
  }

  return line;
}

/**
 * Assign IDs to reminder lines that don't have them
 * Safely appends generated IDs to valid reminder lines without modifying invalid lines
 *
 * @param {string} content - The file content to process
 * @returns {object} Object with:
 *   - content: The modified content with IDs appended
 *   - assigned: Array of {lineNumber, oldLine, newLine, id} for each ID assigned
 *   - unchanged: Count of lines that already had IDs or were invalid/empty/comments
 */
function assignMissingIds(content) {
  if (!content || typeof content !== 'string') {
    return {
      content: content || '',
      assigned: [],
      unchanged: 0,
    };
  }

  const lines = content.split('\n');
  const assigned = [];
  let unchanged = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      unchanged++;
      continue;
    }

    // Try to parse the line
    const parsed = parseReminderLine(line);

    if (!parsed) {
      // Invalid line - leave unchanged
      unchanged++;
      continue;
    }

    if (parsed.id) {
      // Already has an ID - leave unchanged
      unchanged++;
      continue;
    }

    // Valid line without ID - generate and append
    const newId = generateReminderId();

    // Append ID to the end of the line, preserving original whitespace/structure
    // Find the end of the msg field to append after it
    const msgEndMatch = line.match(/msg="(?:[^"\\]|\\.)*"/);
    if (msgEndMatch) {
      const msgEndIndex = line.indexOf(msgEndMatch[0]) + msgEndMatch[0].length;
      const before = line.slice(0, msgEndIndex);
      const after = line.slice(msgEndIndex);
      lines[i] = `${before} id=${newId}${after}`;
    } else {
      // Fallback: just append to the end
      lines[i] = `${line} id=${newId}`;
    }

    assigned.push({
      lineNumber: i + 1,
      oldLine: line,
      newLine: lines[i],
      id: newId,
    });
  }

  return {
    content: lines.join('\n'),
    assigned,
    unchanged,
  };
}

module.exports = {
  parseReminderLine,
  parseRemindersFile,
  generateReminderId,
  formatReminderLine,
  assignMissingIds,
  VALID_RECURRENCE,
  ID_PATTERN,
  DATE_PATTERN,
  TIME_PATTERN,
};
