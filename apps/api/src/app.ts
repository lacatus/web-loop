import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Db } from './db/client';
import { registerErrorHandler } from './lib/errors';
import { todoRoutes } from './routes/todos';

export interface AppOptions {
  db: Db;
  logger?: FastifyServerOptions['logger'];
}

/** Builds the Fastify app without listening, so tests can use `app.inject()`. */
export async function buildApp({ db, logger = false }: AppOptions) {
  const app = Fastify({ logger });
  registerErrorHandler(app);

  app.get('/api/health', async () => ({ status: 'ok' }));
  await app.register(todoRoutes, { prefix: '/api', db });

  return app;
}
