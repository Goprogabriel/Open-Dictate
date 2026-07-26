import type { ErrorRequestHandler, RequestHandler } from "express";
import { logger } from "firebase-functions";
import { ZodError } from "zod";

export type PublicErrorCode =
  | "authentication_required"
  | "email_verification_required"
  | "app_check_required"
  | "forbidden_origin"
  | "invalid_request"
  | "invalid_idempotency_key"
  | "not_found"
  | "method_not_allowed"
  | "subscription_required"
  | "insufficient_credits"
  | "request_in_progress"
  | "request_already_failed"
  | "rate_limited"
  | "audio_too_large"
  | "unsupported_audio"
  | "provider_unavailable"
  | "billing_unavailable"
  | "internal_error";

const publicMessages: Record<PublicErrorCode, string> = {
  authentication_required: "Sign in to continue.",
  email_verification_required: "Verify your email address to continue.",
  app_check_required: "This app installation could not be verified.",
  forbidden_origin: "This request origin is not allowed.",
  invalid_request: "The request is invalid.",
  invalid_idempotency_key: "A valid idempotency key is required.",
  not_found: "The requested resource was not found.",
  method_not_allowed: "The request method is not allowed.",
  subscription_required: "An active Open Dictate Pro subscription is required.",
  insufficient_credits: "Your remaining credits are not sufficient for this dictation.",
  request_in_progress: "This dictation is already being processed.",
  request_already_failed: "This idempotency key belongs to a failed dictation.",
  rate_limited: "Too many requests. Wait a moment and try again.",
  audio_too_large: "The recording is too large.",
  unsupported_audio: "The recording format is not supported.",
  provider_unavailable: "Dictation is temporarily unavailable. Please try again.",
  billing_unavailable: "Billing is temporarily unavailable. Please try again.",
  internal_error: "Something went wrong. Please try again.",
};

export class AppError extends Error {
  constructor(
    public readonly code: PublicErrorCode,
    public readonly status: number,
    public readonly retryable = false,
  ) {
    super(code);
    this.name = "AppError";
  }
}

export function assertApp(
  condition: unknown,
  code: PublicErrorCode,
  status: number,
): asserts condition {
  if (!condition) throw new AppError(code, status);
}

export function asyncHandler(handler: RequestHandler): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

export const notFoundHandler: RequestHandler = (_request, _response, next) => {
  next(new AppError("not_found", 404));
};

export const errorHandler: ErrorRequestHandler = (error: unknown, request, response, _next) => {
  void _next;
  const appError =
    error instanceof AppError
      ? error
      : error instanceof ZodError || error instanceof SyntaxError
        ? new AppError("invalid_request", 400)
        : new AppError("internal_error", 500);
  const requestId = String(response.getHeader("X-Request-Id") ?? "unknown");

  logger.error("HTTP request failed", {
    requestId,
    method: request.method,
    path: request.path,
    code: appError.code,
    status: appError.status,
    retryable: appError.retryable,
    errorType: error instanceof Error ? error.name : typeof error,
  });

  if (response.headersSent) return;
  response.status(appError.status).json({
    error: {
      code: appError.code,
      message: publicMessages[appError.code],
      requestId,
      retryable: appError.retryable,
    },
  });
};
