import type { FastifyInstance } from 'fastify';
import { webhookRoutes } from '@/routes/webhook.route';
import { chatRoutes } from '@/routes/chat.route';
import { eventsRoutes } from '@/routes/events.route';
import { configRoutes } from '@/routes/config.route';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // ── Health check ────────────────────────────────────────────────────────────
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  // ── Feature routes ───────────────────────────────────────────────────────────
  await Promise.all([
    app.register(webhookRoutes),
    app.register(chatRoutes),
    app.register(eventsRoutes),
    app.register(configRoutes),
  ]);
}
