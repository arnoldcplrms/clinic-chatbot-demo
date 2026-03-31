// ─── Google Calendar Event Types ─────────────────────────────────────────────

export interface CalendarEventAttendee {
  email: string;
  displayName?: string;
  responseStatus?: 'needsAction' | 'declined' | 'tentative' | 'accepted';
}

export interface CalendarEventDateTime {
  dateTime: string; // ISO 8601
  timeZone?: string;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: CalendarEventDateTime;
  end: CalendarEventDateTime;
  attendees?: CalendarEventAttendee[];
  status?: string;
  htmlLink?: string;
}

// ─── Input Types for CRUD Operations ─────────────────────────────────────────

export interface CreateEventInput {
  title: string;
  /** ISO 8601, e.g. "2026-06-01T09:00:00-05:00" */
  startDateTime: string;
  endDateTime: string;
  description?: string;
  /** Array of attendee email addresses */
  attendees?: string[];
  location?: string;
}

export interface UpdateEventInput {
  eventId: string;
  title?: string;
  startDateTime?: string;
  endDateTime?: string;
  description?: string;
  attendees?: string[];
  location?: string;
}

export interface ListEventsInput {
  /** ISO 8601 lower bound */
  timeMin: string;
  /** ISO 8601 upper bound */
  timeMax: string;
  maxResults?: number;
}
