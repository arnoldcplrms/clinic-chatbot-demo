import { google } from 'googleapis';
import type { calendar_v3 } from 'googleapis';
import { env } from '@/config/env';
import type {
  CalendarEvent,
  CalendarEventAttendee,
  CreateEventInput,
  ListEventsInput,
  UpdateEventInput,
} from '@/types/calendar.types';

export class CalendarService {
  private readonly calendar: calendar_v3.Calendar;

  constructor() {
    const auth = new google.auth.OAuth2(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      env.GOOGLE_REDIRECT_URI
    );

    // Use the stored refresh token — googleapis will auto-refresh the access token
    auth.setCredentials({ refresh_token: env.GOOGLE_REFRESH_TOKEN });

    this.calendar = google.calendar({ version: 'v3', auth });
  }

  async listEvents(input: ListEventsInput): Promise<CalendarEvent[]> {
    const response = await this.calendar.events.list({
      calendarId: env.GOOGLE_CALENDAR_ID,
      timeMin: input.timeMin,
      timeMax: input.timeMax,
      maxResults: input.maxResults ?? 10,
      singleEvents: true,
      orderBy: 'startTime',
    });

    return (response.data.items ?? []).map(mapGoogleEvent);
  }

  async createEvent(input: CreateEventInput): Promise<CalendarEvent> {
    const response = await this.calendar.events.insert({
      calendarId: env.GOOGLE_CALENDAR_ID,
      requestBody: {
        summary: input.title,
        description: input.description,
        location: input.location,
        start: { dateTime: input.startDateTime, timeZone: 'UTC' },
        end: { dateTime: input.endDateTime, timeZone: 'UTC' },
        attendees: input.attendees?.map((email) => ({ email })),
      },
    });

    return mapGoogleEvent(response.data);
  }

  async getEvent(eventId: string): Promise<CalendarEvent> {
    const response = await this.calendar.events.get({
      calendarId: env.GOOGLE_CALENDAR_ID,
      eventId,
    });

    return mapGoogleEvent(response.data);
  }

  async updateEvent(input: UpdateEventInput): Promise<CalendarEvent> {
    const patch: calendar_v3.Schema$Event = {};

    if (input.title !== undefined) patch.summary = input.title;
    if (input.description !== undefined) patch.description = input.description;
    if (input.location !== undefined) patch.location = input.location;
    if (input.startDateTime !== undefined)
      patch.start = { dateTime: input.startDateTime };
    if (input.endDateTime !== undefined)
      patch.end = { dateTime: input.endDateTime };
    if (input.attendees !== undefined)
      patch.attendees = input.attendees.map((email) => ({ email }));

    const response = await this.calendar.events.patch({
      calendarId: env.GOOGLE_CALENDAR_ID,
      eventId: input.eventId,
      requestBody: patch,
    });

    return mapGoogleEvent(response.data);
  }

  async deleteEvent(eventId: string): Promise<void> {
    await this.calendar.events.delete({
      calendarId: env.GOOGLE_CALENDAR_ID,
      eventId,
    });
  }
}

// ─── Private Helpers ──────────────────────────────────────────────────────────

function mapGoogleEvent(raw: calendar_v3.Schema$Event): CalendarEvent {
  if (!raw.id)
    throw new Error('Google Calendar returned an event without an ID');

  const attendees: CalendarEventAttendee[] | undefined = raw.attendees?.map(
    (a) => ({
      email: a.email ?? '',
      displayName: a.displayName ?? undefined,
      responseStatus:
        a.responseStatus as CalendarEventAttendee['responseStatus'],
    })
  );

  return {
    id: raw.id,
    summary: raw.summary ?? '(No title)',
    description: raw.description ?? undefined,
    location: raw.location ?? undefined,
    start: {
      dateTime: raw.start?.dateTime ?? raw.start?.date ?? '',
      timeZone: raw.start?.timeZone ?? undefined,
    },
    end: {
      dateTime: raw.end?.dateTime ?? raw.end?.date ?? '',
      timeZone: raw.end?.timeZone ?? undefined,
    },
    attendees,
    status: raw.status ?? undefined,
    htmlLink: raw.htmlLink ?? undefined,
  };
}
