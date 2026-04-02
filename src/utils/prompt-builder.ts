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

  const hoursText = Object.entries(rules.businessHours)
    .map(([day, range]) =>
      range
        ? `  - ${capitalize(day)}: ${range.start}–${range.end}`
        : `  - ${capitalize(day)}: Closed`
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
