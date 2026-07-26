import { randomUUID } from "node:crypto";

import type { DecodedIdToken } from "firebase-admin/auth";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";

import { allowedOrigins } from "../config.js";
import { adminAuth } from "../firebase.js";
import { AppError } from "./errors.js";

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

function headerValue(request: Request, name: string): string | undefined {
  const value = request.header(name);
  return value?.trim() || undefined;
}

export const requestContext: RequestHandler = (request, response, next) => {
  const candidate = headerValue(request, "X-Request-Id");
  const requestId =
    candidate && idempotencyKeySchema.safeParse(candidate).success ? candidate : randomUUID();
  response.setHeader("X-Request-Id", requestId);
  next();
};

export const secureHeaders: RequestHandler = (_request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  next();
};

export function corsGuard(request: Request, response: Response, next: NextFunction): void {
  const origin = headerValue(request, "Origin");
  response.setHeader("Vary", "Origin");

  if (origin && !allowedOrigins().has(origin)) {
    next(new AppError("forbidden_origin", 403));
    return;
  }

  if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Idempotency-Key, X-Request-Id",
  );
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");

  if (request.method === "OPTIONS") {
    response.status(204).send();
    return;
  }

  next();
}

export interface AuthenticatedUser {
  uid: string;
  email: string | null;
  name: string | null;
  token: DecodedIdToken;
}

export async function authenticate(
  request: Request,
  options: { requireVerifiedEmail?: boolean } = {},
): Promise<AuthenticatedUser> {
  const authorization = headerValue(request, "Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new AppError("authentication_required", 401);
  }

  const tokenValue = authorization.slice("Bearer ".length).trim();
  if (!tokenValue) throw new AppError("authentication_required", 401);

  let decoded: DecodedIdToken;
  try {
    decoded = await adminAuth.verifyIdToken(tokenValue);
  } catch {
    throw new AppError("authentication_required", 401);
  }

  if (options.requireVerifiedEmail && decoded.email_verified !== true) {
    throw new AppError("email_verification_required", 403);
  }

  return {
    uid: decoded.uid,
    email: typeof decoded.email === "string" ? decoded.email : null,
    name: typeof decoded.name === "string" ? decoded.name : null,
    token: decoded,
  };
}

export function requireIdempotencyKey(request: Request): string {
  const parsed = idempotencyKeySchema.safeParse(headerValue(request, "Idempotency-Key"));
  if (!parsed.success) throw new AppError("invalid_idempotency_key", 400);
  return parsed.data;
}

export function requestId(response: Response): string {
  return String(response.getHeader("X-Request-Id") ?? randomUUID());
}
