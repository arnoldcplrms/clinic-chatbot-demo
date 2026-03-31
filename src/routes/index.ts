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
  await app.register(webhookRoutes);
  await app.register(chatRoutes);
  await app.register(eventsRoutes);
  await app.register(configRoutes);
}
