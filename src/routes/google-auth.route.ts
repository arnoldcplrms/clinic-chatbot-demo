import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '@/config/env';
import { CalendarService } from '@/services/calendar.service';

const calendarService = new CalendarService();

const authStartQuerySchema = z
  .object({
    state: z.string().min(1).optional(),
  })
  .strict();

const authCallbackQuerySchema = z
  .object({
    code: z.string().min(1, 'code is required').optional(),
    state: z.string().optional(),
    error: z.string().optional(),
    error_description: z.string().optional(),
  })
  .strict();

export async function googleAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/auth/google',
    async (
      request: FastifyRequest<{ Querystring: { state?: string } }>,
      reply: FastifyReply
    ): Promise<void> => {
      const parseResult = authStartQuerySchema.safeParse(request.query);

      if (!parseResult.success) {
        reply.status(400).send({
          statusCode: 400,
          error: 'Validation Error',
          issues: parseResult.error.issues,
        });
        return;
      }

      const authorizationUrl = calendarService.createAuthorizationUrl(
        parseResult.data.state
      );

      reply.send({
        authorizationUrl,
        redirectUri: env.GOOGLE_REDIRECT_URI,
      });
    }
  );

  app.get(
    '/api/auth/google/callback',
    async (
      request: FastifyRequest<{
        Querystring: {
          code?: string;
          state?: string;
          error?: string;
          error_description?: string;
        };
      }>,
      reply: FastifyReply
    ): Promise<void> => {
      const parseResult = authCallbackQuerySchema.safeParse(request.query);

      if (!parseResult.success) {
        reply.status(400).send({
          statusCode: 400,
          error: 'Validation Error',
          issues: parseResult.error.issues,
        });
        return;
      }

      const { code, error, error_description, state } = parseResult.data;

      if (error) {
        reply.status(400).type('text/html; charset=utf-8').send(`
          <html>
            <body style="font-family: sans-serif; padding: 24px;">
              <h1>Google authorization failed</h1>
              <p><strong>Error:</strong> ${escapeHtml(error)}</p>
              <p><strong>Description:</strong> ${escapeHtml(
                error_description ?? 'No description provided.'
              )}</p>
            </body>
          </html>
        `);
        return;
      }

      if (!code) {
        reply.status(400).send({
          statusCode: 400,
          error: 'Validation Error',
          message: 'Missing OAuth code in callback query parameters.',
        });
        return;
      }

      const tokens = await calendarService.exchangeCodeForTokens(code);

      reply.type('text/html; charset=utf-8').send(`
        <html>
          <body style="font-family: sans-serif; padding: 24px; line-height: 1.5;">
            <h1>Google authorization completed</h1>
            <p>Set the following value in your <code>.env</code> file:</p>
            <pre style="background: #f5f5f5; padding: 16px; border-radius: 8px; overflow-x: auto;">GOOGLE_REFRESH_TOKEN=${escapeHtml(
              tokens.refresh_token ?? 'NO_REFRESH_TOKEN_RETURNED'
            )}</pre>
            <p><strong>Redirect URI:</strong> ${escapeHtml(
              env.GOOGLE_REDIRECT_URI
            )}</p>
            <p><strong>State:</strong> ${escapeHtml(state ?? 'N/A')}</p>
            <p><strong>Scopes:</strong> ${escapeHtml(tokens.scope ?? 'N/A')}</p>
            <p>If the refresh token says <code>NO_REFRESH_TOKEN_RETURNED</code>, revoke the app grant or repeat the flow with a fresh consent screen.</p>
          </body>
        </html>
      `);
    }
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
