import type { BusinessRules } from '@/config/business-rules.config';

/**
 * Formats a Date to a human-readable string in the specified IANA timezone.
 */
export function formatInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(date);
}

/**
 * Returns the current date and time as a human-readable string in the given timezone.
 */
export function getCurrentDateTimeString(timezone: string): string {
  return formatInTimezone(new Date(), timezone);
}

/**
 * Returns an ISO date string ("YYYY-MM-DD") for a Date in the specified timezone.
 * Uses the "en-CA" locale because it produces YYYY-MM-DD format natively.
 */
function toLocalDateString(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date);
}

/**
 * Returns true if the given ISO 8601 datetime falls within the configured
 * business hours for its day of the week (evaluated in the business timezone).
 */
export function isWithinBusinessHours(
  isoDateTime: string,
  rules: BusinessRules
): boolean {
  const date = new Date(isoDateTime);

  // Resolve the full lowercase day name ("monday", "tuesday", …) in the business timezone
  const dayName = new Intl.DateTimeFormat('en-US', {
    timeZone: rules.timezone,
    weekday: 'long',
  })
    .format(date)
    .toLowerCase();

  const hours = rules.businessHours[dayName];
  if (!hours) return false; // Day is closed

  // Extract hour and minute parts via formatToParts for unambiguous parsing
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: rules.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  const minutesSinceMidnight = h * 60 + m;

  const [startH, startM] = hours.start.split(':').map(Number);
  const [endH, endM] = hours.end.split(':').map(Number);
  const startMinutes = (startH ?? 0) * 60 + (startM ?? 0);
  const endMinutes = (endH ?? 0) * 60 + (endM ?? 0);

  return (
    minutesSinceMidnight >= startMinutes && minutesSinceMidnight < endMinutes
  );
}

/**
 * Returns true if the given ISO 8601 datetime falls on a blackout date
 * (evaluated in the business timezone).
 */
export function hasBlackoutDate(
  isoDateTime: string,
  rules: BusinessRules
): boolean {
  const date = new Date(isoDateTime);
  const localDate = toLocalDateString(date, rules.timezone);
  return rules.blackoutDates.includes(localDate);
}
