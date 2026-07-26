import { rateLimit } from "express-rate-limit";

import { AppError } from "./errors.js";

function limiter(limit: number) {
  return rateLimit({
    windowMs: 60_000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (request) => request.method === "OPTIONS",
    handler: (_request, _response, next) => {
      next(new AppError("rate_limited", 429, true));
    },
  });
}

// Cloud Functions runs multiple isolated instances, so these per-instance IP
// limits are a first line of defense. Production deployments should pair them
// with Google Cloud Armor/API Gateway quotas when abuse resistance is required.
export const apiRateLimit = limiter(120);
export const billingRateLimit = limiter(20);
export const dictationRateLimit = limiter(10);
