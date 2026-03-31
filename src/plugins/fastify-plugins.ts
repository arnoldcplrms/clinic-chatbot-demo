import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';

export async function registerPlugins(app: FastifyInstance): Promise<void> {
  // CORS — reflect the request origin in development; tighten in production
  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  // Security headers via Helmet (CSP disabled to avoid conflicts in dev)
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  // Adds convenient reply helpers: reply.notFound(), reply.badRequest(), etc.
  await app.register(sensible);

  // ── Centralised error handler ───────────────────────────────────────────────
  // All unhandled errors (thrown in route handlers or plugins) end up here.
  // We normalise them into a consistent JSON shape before sending to the client.
  app.setErrorHandler((error, _request, reply) => {
    app.log.error(
      { err: error, code: error.code },
      'Unhandled error in request pipeline'
    );

    const statusCode = error.statusCode ?? 500;

    reply.status(statusCode).send({
      statusCode,
      error: error.name ?? 'InternalServerError',
      message:
        statusCode < 500
          ? error.message
          : 'An unexpected error occurred. Please try again later.',
    });
  });
}
