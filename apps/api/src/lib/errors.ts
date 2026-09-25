import type { ApiError, ApiErrorCode } from '@web-loop/shared';
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, 'NOT_FOUND', `${what} not found`);

/** Maps every thrown error to the shared ApiError response shape. */
export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      const body: ApiError = {
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.issues },
      };
      return reply.status(400).send(body);
    }
    if (err instanceof HttpError) {
      const body: ApiError = { error: { code: err.code, message: err.message } };
      return reply.status(err.statusCode).send(body);
    }
    // Fastify's own client errors (e.g. malformed JSON body).
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      const body: ApiError = {
        error: { code: 'VALIDATION_ERROR', message: (err as Error).message },
      };
      return reply.status(status).send(body);
    }
    req.log.error(err);
    const body: ApiError = { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
    return reply.status(500).send(body);
  });

  app.setNotFoundHandler((req, reply) => {
    const body: ApiError = {
      error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.url} not found` },
    };
    return reply.status(404).send(body);
  });
}
