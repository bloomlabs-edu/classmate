/**
 * utils/dateHelpers.js
 *
 * Small, dependency-free date formatting and parsing helpers used across
 * services and the UI layer.
 */

export function getCurrentIsoDate() {
  return new Date().toISOString();
}

export function formatDate(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function isSameDay(dateA, dateB) {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return a.toDateString() === b.toDateString();
}

/**
 * A compact, human-readable timestamp for a moment that already
 * happened — built for the notification bells (see
 * ui/student-portal/components/StudentNotificationBell.js,
 * ui/components/UserBar.js) but generic: takes the same ISO string
 * every `createdAt` field in this app already stores (see
 * getCurrentIsoDate() above) and returns one of, in order:
 *
 *   - "Just now"           — under a minute old
 *   - "N min ago"           — under an hour old
 *   - "N hr ago"            — under 6 hours old AND still today
 *   - "Today · h:mm AM/PM"  — today, but past the "hr ago" window
 *   - "Yesterday · h:mm AM/PM"
 *   - "Mon D · h:mm AM/PM"  — anything older
 *
 * The 6-hour cutoff between "N hr ago" and "Today · ..." is a
 * judgment call, not a further-specified product rule — same-day
 * alone can't distinguish them (anything today is under 24h old by
 * definition), so *some* cutoff has to exist; 6 hours keeps "2 hr
 * ago" reading naturally while still leaving "Today · ..." doing real
 * work for the rest of the day. Easy to retune later — it's the one
 * number in this function, not spread across branches.
 *
 * All of this is computed in the CALLER's own local time zone
 * (`new Date()`/`toLocaleTimeString()` with no explicit `timeZone`
 * option) — never UTC — matching "use the user's local time" exactly.
 * Never stores or reads anything beyond the one ISO string passed in;
 * no new field, no change to how createdAt itself is written or
 * shaped anywhere.
 */
export function formatRelativeTimestamp(isoString) {
  const then = new Date(isoString);
  if (Number.isNaN(then.getTime())) return '';

  const now = new Date();
  const diffMs = now - then;
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes} min ago`;

  const sameDayAsNow = isSameDay(then, now);
  if (diffHours < 6 && sameDayAsNow) return `${diffHours} hr ago`;

  // en-US specifically here (not this file's own usual en-IN, see
  // formatDate() above) — the requested format is explicitly
  // "Aug 24 · 3:45 PM" (month before day, uppercase AM/PM), which is
  // en-US's own convention, not en-IN's ("24 Aug", lowercase "pm").
  const time = then.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (sameDayAsNow) return `Today · ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(then, yesterday)) return `Yesterday · ${time}`;

  const datePart = then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${datePart} · ${time}`;
}

/**
 * A plain "YYYY-MM-DD" string in local time — the date-key format
 * Notebook Tracker uses (see services/notebookService.js). Deliberately
 * not a full ISO timestamp: the notebook register only ever needs a
 * day's granularity, and a plain date string sorts correctly with
 * ordinary string comparison.
 */
export function getTodayDateKey() {
  return toDateKey(new Date());
}

export function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Adds (or subtracts, with a negative number) whole days to a "YYYY-MM-DD" key. */
export function shiftDateKey(dateKey, deltaDays) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + deltaDays);
  return toDateKey(date);
}

/** A friendly display string for a "YYYY-MM-DD" key, e.g. "22 Jul 2026". */
export function formatDateKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** The current "YYYY-MM" key — the Timeline View's default month. */
export function getCurrentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Adds (or subtracts) whole months to a "YYYY-MM" key. */
export function shiftYearMonth(yearMonth, deltaMonths) {
  const [year, month] = yearMonth.split('-').map(Number);
  const date = new Date(year, month - 1 + deltaMonths, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** A friendly label for a "YYYY-MM" key, e.g. "July 2026". */
export function formatYearMonth(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

/** How many days are in a "YYYY-MM" key's month. */
export function getDaysInYearMonth(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

// ---------------------------------------------------------------------
// Week/month ranges — used by services/studentProgressService.js's
// weekly/monthly calculations. Weeks are Monday-start, matching the
// product decision that "every Monday starts a new opportunity."
// ---------------------------------------------------------------------

/** The "YYYY-MM-DD" key of the Monday on or before the given date. */
export function getMondayStartOfWeek(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, ...
  const deltaToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  date.setDate(date.getDate() + deltaToMonday);
  return toDateKey(date);
}

/**
 * The {start, end} "YYYY-MM-DD" keys (inclusive) of the Monday-start week
 * containing dateKey. Defaults to today's week when no dateKey is given.
 */
export function getWeekRange(dateKey = getTodayDateKey()) {
  const start = getMondayStartOfWeek(dateKey);
  const end = shiftDateKey(start, 6);
  return { start, end };
}

/** The {start, end} "YYYY-MM-DD" keys (inclusive) of the Monday-start week immediately before dateKey's week. */
export function getPreviousWeekRange(dateKey = getTodayDateKey()) {
  const currentStart = getMondayStartOfWeek(dateKey);
  const previousStart = shiftDateKey(currentStart, -7);
  return { start: previousStart, end: shiftDateKey(previousStart, 6) };
}

/** The {start, end} "YYYY-MM-DD" keys (inclusive) of the calendar month containing dateKey. Defaults to the current month. */
export function getMonthRange(dateKey = getTodayDateKey()) {
  const [year, month] = dateKey.split('-').map(Number);
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

/** Whether a "YYYY-MM-DD" key falls within an inclusive {start, end} range — plain string comparison, since date keys sort lexicographically. */
export function isDateKeyInRange(dateKey, { start, end }) {
  return dateKey >= start && dateKey <= end;
}
