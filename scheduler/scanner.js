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
 * @returns {boolean} True if the reminder should fire
 */
function isReminderDue(reminder, nowUtc) {
  const { date, time, recur } = reminder;
  const londonParts = getLondonDateParts(nowUtc);
  
  // 1. Determine the candidate target date in London time
  let targetDateStr = null;

  if (recur === 'none') {
    // Exact date match required
    // We only care if the reminder's target UTC execution time matches nowUtc.
    // The target UTC execution time is determined by date+time in London.
    // We can just set targetDateStr = date.
    targetDateStr = date;
  } else if (recur === 'daily') {
    // Fires every day. Target date is today (London).
    targetDateStr = `${londonParts.year}-${londonParts.month}-${londonParts.day}`;
  } else if (recur === 'weekly') {
    // Fires if today is the same day of week
    // We can't easily check day of week from YYYY-MM-DD string without parsing
    // But we can check if `nowUtc` roughly matches the cycle.
    // Better: Check if `reminder.date` day of week matches `londonParts` day of week.
    // We need a helper to get day of week for `reminder.date`.
    const reminderDate = new Date(date); // This parses as UTC usually, but day of week is relative.
    // Let's rely on the fact that `date` is YYYY-MM-DD.
    const reminderDayOfWeek = getDayOfWeek(date);
    const currentDayOfWeek = getDayOfWeek(`${londonParts.year}-${londonParts.month}-${londonParts.day}`);
    
    if (reminderDayOfWeek === currentDayOfWeek) {
      targetDateStr = `${londonParts.year}-${londonParts.month}-${londonParts.day}`;
    } else {
      return false;
    }
  } else if (recur === 'monthly') {
    // Fires if day of month matches.
    // Handle "last day of month" logic.
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
  // This handles Gap and Overlap logic
  const dueTimestamp = localToUtc(targetDateStr, time);

  // 3. Compare with nowUtc
  // Check if they are in the same minute
  const nowMs = nowUtc.getTime();
  const dueMs = dueTimestamp.getTime();
  
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
  // Construct a naive UTC date from the components
  // Note: Date.parse might behave differently depending on environment, assume ISO format works as UTC
  const isoNaive = `${dateStr}T${timeStr}:00.000Z`;
  const candidate = new Date(isoNaive);
  
  // Offset probes
  // BST is UTC+1. GMT is UTC+0.
  // So Local Time T corresponds to UTC T-1h (if BST) or UTC T-0h (if GMT).
  // We prefer BST (Earlier Occurrence in Overlap means smaller UTC timestamp? No.)
  // Wait.
  // Overlap: 01:30 happens at T1 (BST) and T2 (GMT).
  // T1 (BST) -> Local 01:30. T1 = Local - 1h.
  // T2 (GMT) -> Local 01:30. T2 = Local.
  // T1 < T2.
  // Spec: "Schedule at earlier occurrence". So we want T1.
  // So we check BST first.
  
  const oneHour = 60 * 60 * 1000;
  
  // Probe 1: Assume BST (UTC = Local - 1h)
  const probeBst = new Date(candidate.getTime() - oneHour);
  if (isLondonTime(probeBst, dateStr, timeStr)) {
    return probeBst;
  }
  
  // Probe 2: Assume GMT (UTC = Local)
  const probeGmt = candidate;
  if (isLondonTime(probeGmt, dateStr, timeStr)) {
    return probeGmt;
  }
  
  // If neither, we are in a Gap.
  // Map to the start of the next valid period.
  // In Spring Forward (01:00 UTC -> 02:00 BST), the gap is 01:00 Local .. 01:59 Local.
  // The transition happens at 01:00 UTC.
  // probeBst (01:xx - 1h) -> 00:xx UTC. (Before transition)
  // probeGmt (01:xx) -> 01:xx UTC. (After transition)
  // We need to find the transition point between probeBst and probeGmt.
  // The transition point is where the offset changes.
  
  return findGapTransition(probeBst, probeGmt);
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
function findGapTransition(low, high) {
  let lowTime = low.getTime();
  let highTime = high.getTime();
  
  // We want the smallest T in [low, high] such that London(T) > Target?
  // Actually, we want the T where the offset jump happens.
  // London time jumps forward.
  // At T_jump, London Time becomes T_jump + NewOffset.
  // We just want to return T_jump.
  // T_jump corresponds to the "Next Valid Local Minute".
  
  // Binary search for the point where local time "jumps" past the gap?
  // No, we want the point where London(T) >= Target? No.
  // We want T such that London(T) is the earliest valid time >= Target.
  // Since Target is in the gap, the earliest valid time is the moment after the gap.
  // This corresponds to T_jump (01:00 UTC in the example).
  // London(T_jump) = 02:00. Target was 01:30.
  // So yes, we want T_jump.
  
  // How to find T_jump?
  // It's the point where offset changes?
  // Or simply the point where London Time >= Expected Target?
  // Wait, London Time > Expected Target is true for High (01:30 UTC -> 02:30 BST > 01:30).
  // London Time < Expected Target is true for Low (00:30 UTC -> 00:30 GMT < 01:30).
  // So we search for the boundary where it flips.
  
  // We compare formatted strings? lexicographically?
  // Date+Time strings: "2026-03-29 02:30" > "2026-03-29 01:30".
  // Yes.
  
  const targetStr = `${low.toISOString().split('T')[0]} ${high.toISOString().split('T')[0]}...`; // Hacky
  // Better: compare epoch values of the "London Time".
  // But we can't easily get London Epoch.
  // Lexicographical comparison of YYYY-MM-DD HH:MM works.
  
  // Since we assume the gap is less than a day, and we passed in dateStr/timeStr implicitly via low/high context?
  // Actually, localToUtc context has dateStr/timeStr.
  // Let's pass the target string into this helper or use a comparator.
  
  // We iterate until 1 minute precision
  while (highTime - lowTime > 60000) {
    const midTime = Math.floor((lowTime + highTime) / 2);
    const midDate = new Date(midTime);
    const parts = getLondonDateParts(midDate);
    const midLocalStr = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
    
    // Construct target string from parts to ensure format matches
    // But we don't have parts for target.
    // We can infer target from `high`'s date components?
    // Gap usually happens on the same day.
    
    // Comparison:
    // If midLocalStr < targetLocalStr -> Low = Mid
    // Else -> High = Mid
    
    // We need targetLocalStr available here.
    // Let's refactor.
  }
  
  return new Date(highTime);
}

// Helper to handle the gap search with closure
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

// Redefine localToUtc to use the refined helper
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
 * @returns {Array} Array of due reminder objects
 */
function scanDueReminders(reminders, nowUtc = new Date()) {
  return reminders.filter(reminder => isReminderDue(reminder, nowUtc));
}

module.exports = {
  isReminderDue,
  scanDueReminders
};
