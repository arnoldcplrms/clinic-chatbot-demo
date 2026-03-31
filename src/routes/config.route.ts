import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  businessRules,
  updateBusinessRules,
} from '@/config/business-rules.config';
import type { BusinessRules } from '@/config/business-rules.config';

// ─── Validation Schemas ───────────────────────────────────────────────────────

const timeRangeSchema = z
  .object({
    start: z.string().regex(/^\d{2}:\d{2}$/, 'start must be in HH:MM format'),
    end: z.string().regex(/^\d{2}:\d{2}$/, 'end must be in HH:MM format'),
  })
  .nullable();

const serviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  duration: z.number().int().positive('Duration must be a positive integer'),
  description: z.string(),
});

// Accepts a partial update — only the keys you send will be changed
const patchRulesSchema = z
  .object({
    timezone: z.string().optional(),
    businessHours: z.record(z.string(), timeRangeSchema).optional(),
    defaultBookingDuration: z.number().int().positive().optional(),
    bufferMinutes: z.number().int().nonnegative().optional(),
    blackoutDates: z
      .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'))
      .optional(),
    maxBookingsPerDay: z.number().int().positive().optional(),
    services: z.array(serviceSchema).optional(),
  })
  .strict();

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function configRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/config/business-rules
   * Returns the current (possibly runtime-updated) business rules object.
   */
  app.get(
    '/api/config/business-rules',
    async (_request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      reply.send(businessRules);
    }
  );

  /**
   * POST /api/config/business-rules
   * Merges the provided partial object into the live business rules.
   * Changes are reflected in the AI system prompt on the very next chat turn.
   */
  app.post(
    '/api/config/business-rules',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const parseResult = patchRulesSchema.safeParse(request.body);

      if (!parseResult.success) {
        reply.status(400).send({
          statusCode: 400,
          error: 'Validation Error',
          issues: parseResult.error.issues,
        });
        return;
      }

      updateBusinessRules(parseResult.data as Partial<BusinessRules>);

      app.log.info('Business rules updated at runtime');
      reply.send(businessRules);
    }
  );
}
