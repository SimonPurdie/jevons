/**
 * Scheduler Scanner
 * 
 * Determines which reminders are due based on the current time and Europe/London rules.
 */

const TIME_ZONE = 'Europe/London';

/**
 * Check if a reminder is due at the given UTC time
 * @param {object} reminder - The parsed reminder object
 * @param {Date} nowUtc - The current time in UTC
 * @param {Date} [lastRunUtc] - The time of the last scan in UTC (optional)
 * @returns {boolean} True if the reminder should fire
 */
export function isReminderDue(reminder, nowUtc, lastRunUtc = null) {
  const { date, time, recur } = reminder;
  const londonParts = getLondonDateParts(nowUtc);
  
  // 1. Determine the candidate target date in London time
  let targetDateStr = null;

  if (recur === 'none') {
    // Exact date match required
    targetDateStr = date;
  } else if (recur === 'daily') {
    // Fires every day. Target date is today (London).
    targetDateStr = `${londonParts.year}-${londonParts.month}-${londonParts.day}`;
  } else if (recur === 'weekly') {
    // Fires if today is the same day of week
    const reminderDayOfWeek = getDayOfWeek(date);
    const currentDayOfWeek = getDayOfWeek(`${londonParts.year}-${londonParts.month}-${londonParts.day}`);
    
    if (reminderDayOfWeek === currentDayOfWeek) {
      targetDateStr = `${londonParts.year}-${londonParts.month}-${londonParts.day}`;
    } else {
      return false;
    }
  } else if (recur === 'monthly') {
    // Fires if day of month matches.
    const reminderDay = parseInt(date.split('-')[2], 10);
    const currentDay = parseInt(londonParts.day, 10);
    const currentYear = parseInt(londonParts.year, 10);
    const currentMonth = parseInt(londonParts.month, 10);
    
    const daysInCurrentMonth = getDaysInMonth(currentYear, currentMonth);
    
    // Target day is reminderDay, clamped to daysInCurrentMonth
    let targetDay = reminderDay;
    if (targetDay > daysInCurrentMonth) {
      targetDay = daysInCurrentMonth;
    }
    
    if (currentDay === targetDay) {
      targetDateStr = `${londonParts.year}-${londonParts.month}-${londonParts.day}`;
    } else {
      return false;
    }
  }

  if (!targetDateStr) {
    return false;
  }

  // 2. Convert Target Local Time (London) to UTC Timestamp(s)
  const dueTimestamp = localToUtc(targetDateStr, time);

  // 3. Compare with nowUtc
  const nowMs = nowUtc.getTime();
  const dueMs = dueTimestamp.getTime();
  
  if (lastRunUtc) {
    const lastRunMs = lastRunUtc.getTime();
    // Fire if the due time fell between the last scan and now
    return dueMs > lastRunMs && dueMs <= nowMs;
  }

  // Legacy/Default: Exact minute match
  // Floor to minutes
  const nowMin = Math.floor(nowMs / 60000);
  const dueMin = Math.floor(dueMs / 60000);
  
  return nowMin === dueMin;
}

/**
 * Convert a Local London Date+Time to a UTC Date object
 * Handles DST Gaps (maps to next valid minute) and Overlaps (maps to earlier occurrence)
 * @param {string} dateStr - YYYY-MM-DD
 * @param {string} timeStr - HH:MM
 * @returns {Date} The UTC Date
 */
function localToUtc(dateStr, timeStr) {
  const isoNaive = `${dateStr}T${timeStr}:00.000Z`;
  const candidate = new Date(isoNaive);
  const oneHour = 60 * 60 * 1000;
  
  const probeBst = new Date(candidate.getTime() - oneHour);
  if (isLondonTime(probeBst, dateStr, timeStr)) {
    return probeBst;
  }
  
  const probeGmt = candidate;
  if (isLondonTime(probeGmt, dateStr, timeStr)) {
    return probeGmt;
  }
  
  return findGapTransitionRefined(probeBst, probeGmt, dateStr, timeStr);
}

/**
 * Check if a UTC date formats to the expected London Date+Time
 */
function isLondonTime(utcDate, expectedDate, expectedTime) {
  const parts = getLondonDateParts(utcDate);
  // Reconstruct parts to strings
  // parts.year, parts.month, parts.day are strings like "2026", "03", "29"
  const d = `${parts.year}-${parts.month}-${parts.day}`;
  const t = `${parts.hour}:${parts.minute}`;
  return d === expectedDate && t === expectedTime;
}

/**
 * Binary search to find the transition point in a gap
 */
function findGapTransitionRefined(low, high, targetDateStr, targetTimeStr) {
  let lowTime = low.getTime();
  let highTime = high.getTime();
  const targetStr = `${targetDateStr} ${targetTimeStr}`;
  
  while (highTime - lowTime > 60000) { // 1 minute precision
    const midTime = Math.floor((lowTime + highTime) / 2);
    const midDate = new Date(midTime);
    const parts = getLondonDateParts(midDate);
    const midLocalStr = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
    
    if (midLocalStr < targetStr) {
      lowTime = midTime;
    } else {
      highTime = midTime;
    }
  }
  // High is the first minute where Local >= Target
  // In a gap (Target doesn't exist), this will be the first valid time after gap.
  return new Date(highTime);
}

/**
 * Get date parts in Europe/London
 */
function getLondonDateParts(date) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  
  const parts = fmt.formatToParts(date);
  const obj = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      obj[part.type] = part.value;
    }
  }
  return obj;
}

/**
 * Get day of week (0-6, Sun-Sat) for a date string YYYY-MM-DD
 */
function getDayOfWeek(dateStr) {
  return new Date(dateStr).getDay();
}

/**
 * Get number of days in a month (1-based month 1-12)
 */
function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/**
 * Find all reminders that are due at the given time
 * @param {Array} reminders - Array of parsed reminder objects
 * @param {Date} [nowUtc] - Current time (defaults to now)
 * @param {Date} [lastRunUtc] - Time of last scan (optional)
 * @returns {Array} Array of due reminder objects
 */
export function scanDueReminders(reminders, nowUtc = new Date(), lastRunUtc = null) {
  return reminders.filter(reminder => isReminderDue(reminder, nowUtc, lastRunUtc));
}
