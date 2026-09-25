import { z } from 'zod';

/** Shape of every non-2xx JSON response returned by the API. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.enum(['VALIDATION_ERROR', 'NOT_FOUND', 'INTERNAL_ERROR']),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type ApiErrorCode = ApiError['error']['code'];
