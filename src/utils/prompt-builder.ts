import type { BusinessRules } from '@/config/business-rules.config';
import { promptConfig } from '@/config/prompt.config';
import { getCurrentDateTimeString } from '@/utils/date.utils';

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Builds the full system prompt that is prepended to every conversation.
 * Called fresh on each chat turn so runtime rule updates are immediately
 * reflected without restarting the server.
 */

export function buildSystemPrompt(rules: BusinessRules): string {
  const now = getCurrentDateTimeString(rules.timezone);

  // Group consecutive days that share the same hours into a single line,
  // e.g. "Monday–Friday: 09:00–17:00" instead of repeating each day.
  const DAY_ORDER = [
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
  ];
  type HoursGroup = {
    days: string[];
    range: { start: string; end: string } | null;
  };
  const groups: HoursGroup[] = [];
  for (const day of DAY_ORDER) {
    const range = rules.businessHours[day] ?? null;
    const last = groups[groups.length - 1];
    const sameAsLast =
      last &&
      (range === null
        ? last.range === null
        : last.range !== null &&
          last.range.start === range.start &&
          last.range.end === range.end);
    if (sameAsLast) {
      last.days.push(day);
    } else {
      groups.push({ days: [day], range });
    }
  }
  const formatRange = (r: { start: string; end: string }) => {
    const fmt = (t: string) => {
      const [hStr, mStr] = t.split(':');
      const h = parseInt(hStr, 10);
      const m = parseInt(mStr, 10);
      const suffix = h >= 12 ? 'pm' : 'am';
      const h12 = h % 12 === 0 ? 12 : h % 12;
      return m === 0 ? `${h12}${suffix}` : `${h12}:${mStr}${suffix}`;
    };
    return `${fmt(r.start)}–${fmt(r.end)}`;
  };
  const hoursText = groups
    .filter((g) => g.range !== null)
    .map((g) => {
      const label =
        g.days.length === 1
          ? capitalize(g.days[0])
          : `${capitalize(g.days[0])}–${capitalize(g.days[g.days.length - 1])}`;
      return `  - ${label}: ${formatRange(g.range!)}`;
    })
    .concat(
      groups.some((g) => g.range === null)
        ? [
            `  - Closed: ${groups
              .filter((g) => g.range === null)
              .flatMap((g) => g.days.map(capitalize))
              .join(', ')} & Public Holidays`,
          ]
        : []
    )
    .join('\n');

  const servicesText =
    rules.services.length > 0
      ? rules.services
          .map((s) => `  - ${s.name} (${s.duration} min): ${s.description}`)
          .join('\n')
      : '  - No services configured yet.';

  const blackoutText =
    rules.blackoutDates.length > 0
      ? `Blackout / holiday dates (no bookings): ${rules.blackoutDates.join(
          ', '
        )}`
      : 'No blackout dates are currently scheduled.';

  const hmosText =
    rules.acceptedHMOs && rules.acceptedHMOs.length > 0
      ? rules.acceptedHMOs.map((hmo) => `  - ${hmo}`).join('\n')
      : '  - No HMO providers configured yet.';

  const responseStyleText = promptConfig.responseStyle
    .map((item, index) => `${index + 1}. ${item}`)
    .join('\n');

  const operatingInstructionsText = promptConfig.operatingInstructions
    .map((item, index) => `${index + 1}. ${item}`)
    .join('\n');

  return `${promptConfig.assistantPersona}

## Business Context
${promptConfig.businessDescription}

## Current Date & Time
${now} (${rules.timezone})

## Business Hours
${hoursText}

## Services Offered
${servicesText}

## Accepted HMO Providers
${hmosText}

## Booking Policies
- Default appointment duration: ${rules.defaultBookingDuration} minutes
- Buffer time between consecutive appointments: ${rules.bufferMinutes} minutes
- Maximum bookings per day: ${rules.maxBookingsPerDay}
- All appointment times are in the business timezone: ${rules.timezone}
- ${blackoutText}

## Response Style
${responseStyleText}

## Operating Instructions
${operatingInstructionsText}`;
}
