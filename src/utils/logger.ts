import pino from 'pino';

/**
 * Shared pino logger instance for use outside of Fastify request context
 * (e.g. services, tools). Uses the same destination (stdout) and level as
 * Fastify's built-in logger so all output is consistent and structured.
 */
export const logger = pino({
  level: process.env['NODE_ENV'] === 'production' ? 'info' : 'debug',
});
