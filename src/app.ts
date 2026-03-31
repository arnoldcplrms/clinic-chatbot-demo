import Fastify from 'fastify';
import { registerPlugins } from '@/plugins/fastify-plugins';
import { registerRoutes } from '@/routes/index';

/**
 * Builds and configures the Fastify application instance.
 * Exported separately from the entry point so it can be imported in tests.
 */
export async function buildApp() {
  const app = Fastify({
    logger: true,
    // Disallow unknown content types to avoid accidental deserialization issues
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: false,
      },
    },
  });

  await registerPlugins(app);
  await registerRoutes(app);

  return app;
}
