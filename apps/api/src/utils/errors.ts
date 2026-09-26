import type { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import type { ApiErrorBody, ApiErrorCode } from '@ccovert/shared';
import { config } from '../config';
import { logger } from '../logger';

export class AppError extends Error {
  public readonly status: number;
  public readonly code: ApiErrorCode;
  public readonly details: string | null;
  public readonly expose: boolean;

  constructor(status: number, code: ApiErrorCode, message: string, options: { details?: string | null; expose?: boolean } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = options.details ?? null;
    this.expose = options.expose ?? true;
  }
}

export const badRequest = (message: string, code: ApiErrorCode = 'VALIDATION_ERROR', details?: string): AppError =>
  new AppError(400, code, message, { details });

export const unauthorized = (message = 'Authentication required'): AppError =>
  new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message: string): AppError => new AppError(403, 'FORBIDDEN', message);

export const notFound = (message: string, code: ApiErrorCode = 'NOT_FOUND'): AppError =>
  new AppError(404, code, message);

export const conflict = (message: string, code: ApiErrorCode = 'CONFLICT'): AppError =>
  new AppError(409, code, message);

export const payloadTooLarge = (message: string): AppError => new AppError(413, 'PAYLOAD_TOO_LARGE', message);

export const unsupportedMedia = (message: string): AppError => new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', message);

export const unprocessable = (message: string, code: ApiErrorCode = 'VALIDATION_ERROR', details?: string): AppError =>
  new AppError(422, code, message, { details });

export const tooManyRequests = (message: string): AppError => new AppError(429, 'RATE_LIMITED', message);

export const notConfigured = (code: ApiErrorCode, message: string, details?: string): AppError =>
  new AppError(503, code, message, { details: details ?? null, expose: true });

export const internal = (message = 'Internal server error'): AppError =>
  new AppError(500, 'INTERNAL_ERROR', message, { expose: false });

export const unavailable = (code: ApiErrorCode, message: string): AppError =>
  new AppError(502, code, message);

/** Never leak internal failures to browsers in production. */
export const errorMessage = (error: AppError): string =>
  error.expose || !config.isProduction ? error.message : 'Internal server error';

/* -------------------------------------------------------------------------- */
/* express plumbing                                                            */
/* -------------------------------------------------------------------------- */

type AsyncHandler = (request: Request, response: Response, next: NextFunction) => Promise<unknown>;

export const asyncHandler = (handler: AsyncHandler) =>
  (request: Request, response: Response, next: NextFunction): void => {
    handler(request, response, next).catch(next);
  };

export const notFoundHandler = (request: Request, _response: Response, next: NextFunction): void => {
  next(new AppError(404, 'NOT_FOUND', `No route matches ${request.method} ${request.path}`));
};

const zodDetails = (error: ZodError): string =>
  error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ');

const toAppError = (error: unknown): AppError => {
  if (error instanceof AppError) return error;
  if (error instanceof ZodError) {
    return new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', {
      details: zodDetails(error),
      expose: true
    });
  }
  if (error instanceof MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    const code: ApiErrorCode = error.code === 'LIMIT_FILE_SIZE' ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_ERROR';
    return new AppError(status, code, error.message, { details: error.message, expose: true });
  }
  return new AppError(statusFor(error), codeFor(error), 'Internal server error', { expose: false });
};

const statusFor = (error: unknown): number => {
  if (error instanceof AppError) return error.status;
  if (error instanceof ZodError) return 400;
  if (error instanceof MulterError) return error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === 'number' && status >= 400 && status <= 599) return status;
  }
  return 500;
};

const codeFor = (error: unknown): ApiErrorCode => {
  if (error instanceof AppError) return error.code;
  if (error instanceof ZodError) return 'VALIDATION_ERROR';
  if (error instanceof MulterError) {
    return error.code === 'LIMIT_FILE_SIZE' ? 'PAYLOAD_TOO_LARGE' : 'VALIDATION_ERROR';
  }
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && !/^1\d{4}$/.test(code)) return code;
  }
  return 'INTERNAL_ERROR';
};

const detailsFor = (error: AppError, original: unknown): string | null => {
  if (error.details) return error.details;
  if (original instanceof ZodError) return zodDetails(original);
  if (original instanceof MulterError) return original.message;
  return null;
};

export const errorHandler = (
  error: unknown,
  request: Request,
  response: Response,
  next: NextFunction
): void => {
  if (response.headersSent) {
    next(error);
    return;
  }
  const appError = toAppError(error);
  const details = detailsFor(appError, error);
  const requestId = request.requestId;
  if (appError.status >= 500) {
    logger.error(appError.message, {
      requestId,
      method: request.method,
      path: request.path,
      userId: request.user?.id ?? null,
      error: error instanceof Error ? error.message : 'unknown',
      stack: error instanceof Error ? error.stack?.split('\n').slice(0, 4).join(' | ') : null
    });
  } else {
    logger.info(appError.message, { requestId, method: request.method, path: request.path, userId: request.user?.id ?? null, status: appError.status });
  }
  const body: ApiErrorBody = {
    error: {
      code: appError.code,
      message: errorMessage(appError),
      requestId,
      ...(details ? { details } : {})
    }
  };
  response.status(appError.status).json(body);
};
