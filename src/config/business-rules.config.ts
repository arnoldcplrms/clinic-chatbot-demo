/**
 * Business rules configuration.
 *
 * Edit this file to define your scheduling policies. Rules are injected into
 * the AI system prompt automatically on every chat turn, so the AI enforces
 * them during conversations.
 *
 * Rules can also be updated at runtime (without restarting the server) via
 * POST /api/config/business-rules.
 */

export interface TimeRange {
  /** 24-hour "HH:MM" format, e.g. "09:00" */
  start: string;
  /** 24-hour "HH:MM" format, e.g. "17:00" */
  end: string;
}

/** Keyed by lowercase day name ("monday" … "sunday"). null means closed. */
export type BusinessHours = Record<string, TimeRange | null>;

export interface Service {
  id: string;
  name: string;
  /** Duration in minutes */
  duration: number;
  description: string;
}

export interface BusinessRules {
  /** IANA timezone string, e.g. "America/New_York" */
  timezone: string;
  /** Per-day business hours. Set a day to null to mark it as closed. */
  businessHours: BusinessHours;
  /** Default appointment length in minutes */
  defaultBookingDuration: number;
  /** Gap to leave between bookings in minutes */
  bufferMinutes: number;
  /** ISO date strings ("YYYY-MM-DD") on which no bookings can be made */
  blackoutDates: string[];
  /** Hard cap on the number of bookings per calendar day */
  maxBookingsPerDay: number;
  /** Services that can be booked */
  services: Service[];
  /** HMO providers accepted by the clinic */
  acceptedHMOs: string[];
}

// ─── Mutable singleton — updated in-place by updateBusinessRules() ──────────

export let businessRules: BusinessRules = {
  // PH timezone
  timezone: 'Asia/Manila',

  businessHours: {
    monday: { start: '09:00', end: '17:00' },
    tuesday: { start: '09:00', end: '17:00' },
    wednesday: { start: '09:00', end: '17:00' },
    thursday: { start: '09:00', end: '17:00' },
    friday: { start: '09:00', end: '17:00' },
    saturday: null, // Closed
    sunday: null, // Closed
  },

  defaultBookingDuration: 60,
  bufferMinutes: 15,
  blackoutDates: [],
  maxBookingsPerDay: 8,

  services: [
    {
      id: 'consultation',
      name: 'Consultation',
      duration: 60,
      description: 'One-hour general consultation session',
    },
    {
      id: 'follow-up',
      name: 'Follow-up',
      duration: 30,
      description: '30-minute follow-up appointment',
    },
    {
      id: 'laboratory-tests',
      name: 'Laboratory Tests',
      duration: 45,
      description:
        '45-minute session for laboratory tests and results discussion',
    },
  ],

  acceptedHMOs: ['Maxicare', 'Intellicare', 'PhilCare'],
};

/**
 * Merges a partial update into the current business rules.
 * Called by POST /api/config/business-rules at runtime.
 */
export function updateBusinessRules(patch: Partial<BusinessRules>): void {
  businessRules = { ...businessRules, ...patch };
}
