import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '@/config/env';
import { aiService } from '@/services/ai.service';

const chatPageFile = Bun.file(new URL('../public/chat.html', import.meta.url));

const chatBodySchema = z.object({
  sessionId: z.string().min(1, 'sessionId must be a non-empty string'),
  message: z.string().min(1, 'message must be a non-empty string'),
});

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.get('/chat', async (_request: FastifyRequest, reply: FastifyReply) => {
    if (env.NODE_ENV !== 'development') {
      throw app.httpErrors.notFound('Page not available in this environment');
    }

    try {
      const html = await chatPageFile.text();
      reply.type('text/html; charset=utf-8').send(html);
    } catch (error) {
      app.log.error({ error }, 'Failed to load chat page');
      reply.status(500).send('Unable to load chat page');
    }
  });

  /**
   * POST /api/chat
   *
   * Send a message to the AI chatbot and receive a reply.
   * Useful for testing the chatbot outside of Facebook Messenger.
   *
   * Body: { sessionId: string, message: string }
   * Response: { reply: string }
   */
  app.post(
    '/api/chat',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const parseResult = chatBodySchema.safeParse(request.body);

      if (!parseResult.success) {
        reply.status(400).send({
          statusCode: 400,
          error: 'Validation Error',
          issues: parseResult.error.issues,
        });
        return;
      }

      const { sessionId, message } = parseResult.data;
      const aiReply = await aiService.chat(sessionId, message);

      reply.send({ reply: aiReply });
    }
  );
}
