import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import type { CalendarService } from '@/services/calendar.service';
import { businessRules } from '@/config/business-rules.config';
import { logger } from '@/utils/logger';

const log = logger.child({ service: 'CalendarTools' });

// ─── Tool Definitions (JSON Schema) ──────────────────────────────────────────

export const calendarToolDefinitions: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'create_event',
      description:
        'Create a new appointment / event on the Google Calendar. Call this after confirming all details with the user.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description:
              "Event title / summary (e.g. 'Consultation with Jane')",
          },
          startDateTime: {
            type: 'string',
            description:
              "Start date-time in ISO 8601 format including timezone offset, e.g. '2026-06-01T09:00:00-05:00'",
          },
          endDateTime: {
            type: 'string',
            description:
              'End date-time in ISO 8601 format including timezone offset',
          },
          description: {
            type: 'string',
            description: 'Optional notes or description for the event',
          },
          attendees: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of attendee email addresses',
          },
          location: {
            type: 'string',
            description: 'Optional physical address or video call link',
          },
        },
        required: ['title', 'startDateTime', 'endDateTime'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'list_events',
      description:
        'List upcoming appointments on the Google Calendar within a time range.',
      parameters: {
        type: 'object',
        properties: {
          timeMin: {
            type: 'string',
            description: 'Start of the time range in ISO 8601 format',
          },
          timeMax: {
            type: 'string',
            description: 'End of the time range in ISO 8601 format',
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of events to return (default: 10)',
          },
        },
        required: ['timeMin', 'timeMax'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'get_event',
      description:
        'Retrieve full details for a single calendar event by its ID.',
      parameters: {
        type: 'object',
        properties: {
          eventId: {
            type: 'string',
            description: 'The Google Calendar event ID',
          },
        },
        required: ['eventId'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'update_event',
      description:
        'Update an existing calendar event. Only the fields you provide will be changed; omitted fields are left as-is.',
      parameters: {
        type: 'object',
        properties: {
          eventId: {
            type: 'string',
            description: 'The Google Calendar event ID to update',
          },
          title: { type: 'string', description: 'New event title' },
          startDateTime: {
            type: 'string',
            description: 'New start date-time in ISO 8601 format',
          },
          endDateTime: {
            type: 'string',
            description: 'New end date-time in ISO 8601 format',
          },
          description: { type: 'string', description: 'New description' },
          attendees: {
            type: 'array',
            items: { type: 'string' },
            description: 'Replacement list of attendee emails',
          },
          location: { type: 'string', description: 'New location' },
        },
        required: ['eventId'],
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'delete_event',
      description:
        'Permanently delete a calendar event by its ID. Confirm with the user before calling this.',
      parameters: {
        type: 'object',
        properties: {
          eventId: {
            type: 'string',
            description: 'The Google Calendar event ID to delete',
          },
        },
        required: ['eventId'],
      },
    },
  },
];

// ─── Tool Dispatcher ──────────────────────────────────────────────────────────

/**
 * Executes a calendar tool call by name and returns a JSON string result.
 * Errors are caught and returned as a JSON error object so the AI can
 * relay the failure to the user gracefully.
 */
export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  calendarService: CalendarService
): Promise<string> {
  try {
    switch (toolName) {
      case 'create_event': {
        const startDateTime = args['startDateTime'] as string;
        const endDateTime = args['endDateTime'] as string;

        // Check for events that overlap with the requested time window.
        // This includes whole-day events, which the clinic owner uses to
        // mark a day as closed (no bookings accepted).
        const overlapping = await calendarService.listEvents({
          timeMin: startDateTime,
          timeMax: endDateTime,
          maxResults: 5,
        });

        // Whole-day events always block bookings regardless of the
        // allowBookingConflicts toggle — they signal a closed day.
        const allDayBlock = overlapping.find((e) => e.isAllDay);
        if (allDayBlock) {
          return JSON.stringify({
            success: false,
            error: 'DAY_CLOSED',
            message:
              `The clinic is closed on this day ("${allDayBlock.summary}"). ` +
              'No bookings can be made. Please suggest the next available business day.',
          });
        }

        // Regular time-overlap check — only enforced when conflicts are not allowed.
        if (!businessRules.allowBookingConflicts && overlapping.length > 0) {
          const conflictTitles = overlapping
            .map(
              (e) => `"${e.summary}" (${e.start.dateTime} – ${e.end.dateTime})`
            )
            .join(', ');
          return JSON.stringify({
            success: false,
            error: 'SCHEDULE_CONFLICT',
            message:
              `The requested time slot is already booked: ${conflictTitles}. ` +
              'Inform the user that the schedule is unavailable and suggest the next available slot ' +
              'within the same day (after the conflicting event ends) or the same time on the next business day.',
          });
        }

        const event = await calendarService.createEvent({
          title: args['title'] as string,
          startDateTime,
          endDateTime,
          description: args['description'] as string | undefined,
          attendees: args['attendees'] as string[] | undefined,
          location: args['location'] as string | undefined,
        });
        return JSON.stringify({ success: true, event });
      }

      case 'list_events': {
        const events = await calendarService.listEvents({
          timeMin: args['timeMin'] as string,
          timeMax: args['timeMax'] as string,
          maxResults: args['maxResults'] as number | undefined,
        });
        return JSON.stringify({ success: true, events });
      }

      case 'get_event': {
        const event = await calendarService.getEvent(args['eventId'] as string);
        return JSON.stringify({ success: true, event });
      }

      case 'update_event': {
        const event = await calendarService.updateEvent({
          eventId: args['eventId'] as string,
          title: args['title'] as string | undefined,
          startDateTime: args['startDateTime'] as string | undefined,
          endDateTime: args['endDateTime'] as string | undefined,
          description: args['description'] as string | undefined,
          attendees: args['attendees'] as string[] | undefined,
          location: args['location'] as string | undefined,
        });
        return JSON.stringify({ success: true, event });
      }

      case 'delete_event': {
        await calendarService.deleteEvent(args['eventId'] as string);
        return JSON.stringify({
          success: true,
          message: 'Event deleted successfully.',
        });
      }

      default:
        return JSON.stringify({
          success: false,
          error: `Unknown tool: "${toolName}"`,
        });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = (err as Record<string, unknown>)?.['response']
      ? (
          (err as Record<string, unknown>)['response'] as Record<
            string,
            unknown
          >
        )?.['status']
      : undefined;
    const responseData = (err as Record<string, unknown>)?.['response']
      ? (
          (err as Record<string, unknown>)['response'] as Record<
            string,
            unknown
          >
        )?.['data']
      : undefined;
    log.error(
      {
        tool: toolName,
        status,
        responseData,
        err: err instanceof Error ? err : new Error(message),
      },
      'calendar tool call failed'
    );
    return JSON.stringify({ success: false, error: message });
  }
}
