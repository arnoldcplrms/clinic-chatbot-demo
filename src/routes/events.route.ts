import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CalendarService } from '@/services/calendar.service';

// Module-level singleton — one OAuth client reused across all requests
const calendarService = new CalendarService();

// ─── Validation Schemas ───────────────────────────────────────────────────────

const listQuerySchema = z.object({
  from: z.string().min(1, 'from (ISO datetime) is required'),
  to: z.string().min(1, 'to (ISO datetime) is required'),
});

const createBodySchema = z.object({
  title: z.string().min(1),
  startDateTime: z.string().min(1, 'startDateTime is required'),
  endDateTime: z.string().min(1, 'endDateTime is required'),
  description: z.string().optional(),
  attendees: z
    .array(z.string().email('Each attendee must be a valid email'))
    .optional(),
  location: z.string().optional(),
});

const updateBodySchema = z
  .object({
    title: z.string().optional(),
    startDateTime: z.string().optional(),
    endDateTime: z.string().optional(),
    description: z.string().optional(),
    attendees: z.array(z.string().email()).optional(),
    location: z.string().optional(),
  })
  .strict();

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function eventsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/events?from=ISO&to=ISO
   * List calendar events within a time range.
   */
  app.get(
    '/api/events',
    async (
      request: FastifyRequest<{
        Querystring: { from?: string; to?: string };
      }>,
      reply: FastifyReply
    ): Promise<void> => {
      const parseResult = listQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        reply.status(400).send({
          statusCode: 400,
          error: 'Validation Error',
          issues: parseResult.error.issues,
        });
        return;
      }

      const events = await calendarService.listEvents({
        timeMin: parseResult.data.from,
        timeMax: parseResult.data.to,
      });

      reply.send(events);
    }
  );

  /**
   * POST /api/events
   * Create a new calendar event directly (bypassing the AI).
   */
  app.post(
    '/api/events',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const parseResult = createBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        reply.status(400).send({
          statusCode: 400,
          error: 'Validation Error',
          issues: parseResult.error.issues,
        });
        return;
      }

      const event = await calendarService.createEvent(parseResult.data);
      reply.status(201).send(event);
    }
  );

  /**
   * PATCH /api/events/:id
   * Partially update an existing calendar event.
   */
  app.patch(
    '/api/events/:id',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ): Promise<void> => {
      const parseResult = updateBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        reply.status(400).send({
          statusCode: 400,
          error: 'Validation Error',
          issues: parseResult.error.issues,
        });
        return;
      }

      const event = await calendarService.updateEvent({
        eventId: request.params.id,
        ...parseResult.data,
      });

      reply.send(event);
    }
  );

  /**
   * DELETE /api/events/:id
   * Permanently delete a calendar event.
   */
  app.delete(
    '/api/events/:id',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply
    ): Promise<void> => {
      await calendarService.deleteEvent(request.params.id);
      reply.status(204).send();
    }
  );
}
