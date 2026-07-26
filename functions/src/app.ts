import express from "express";
import { z } from "zod";

import {
  createCheckoutSession,
  createPortalSession,
  createTopupSession,
  ensureUserProfile,
  getEntitlements,
  listInvoices,
} from "./billing/service.js";
import { createManagedDictation, getManagedDictationStatus } from "./dictation/service.js";
import { asyncHandler, errorHandler, notFoundHandler } from "./http/errors.js";
import { apiRateLimit, billingRateLimit, dictationRateLimit } from "./http/rate-limit.js";
import {
  authenticate,
  corsGuard,
  requestContext,
  requireIdempotencyKey,
  secureHeaders,
} from "./http/security.js";

const emptyBodySchema = z.object({}).strict();
const topupBodySchema = z.object({ tier: z.enum(["usd_5", "usd_10", "usd_20"]) }).strict();
const requestIdSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(requestContext);
app.use(secureHeaders);
app.use(corsGuard);
app.use(express.json({ limit: "32kb", strict: true }));

app.get("/healthz", (_request, response) => {
  response.status(200).json({ status: "ok" });
});

function billingReturnPage(title: string, message: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #f7f7f4;
        color: #171714;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        max-width: 34rem;
        padding: 2rem;
        text-align: center;
      }
      h1 {
        margin: 0 0 0.75rem;
        font-size: 1.75rem;
        line-height: 1.2;
      }
      p {
        margin: 0;
        color: #56564f;
        line-height: 1.6;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${message}</p>
    </main>
  </body>
</html>`;
}

app.get("/billing/success", (_request, response) => {
  response
    .status(200)
    .type("html")
    .send(billingReturnPage("Payment complete", "Return to Open Dictate to continue."));
});

app.get("/billing/cancel", (_request, response) => {
  response
    .status(200)
    .type("html")
    .send(billingReturnPage("Checkout canceled", "Return to Open Dictate when you are ready."));
});

app.get("/account", (_request, response) => {
  response
    .status(200)
    .type("html")
    .send(billingReturnPage("Billing updated", "Return to Open Dictate to continue."));
});

app.use("/v1", apiRateLimit);

app.post(
  "/v1/billing/checkout-session",
  billingRateLimit,
  asyncHandler(async (request, response) => {
    emptyBodySchema.parse(request.body ?? {});
    const user = await authenticate(request, { requireVerifiedEmail: true });
    const idempotencyKey = requireIdempotencyKey(request);
    const url = await createCheckoutSession(user, idempotencyKey);
    response.status(200).json({ url });
  }),
);

app.post(
  "/v1/billing/portal-session",
  billingRateLimit,
  asyncHandler(async (request, response) => {
    emptyBodySchema.parse(request.body ?? {});
    const user = await authenticate(request, { requireVerifiedEmail: true });
    const url = await createPortalSession(user);
    response.status(200).json({ url });
  }),
);

app.post(
  "/v1/billing/topup-session",
  billingRateLimit,
  asyncHandler(async (request, response) => {
    const { tier } = topupBodySchema.parse(request.body ?? {});
    const user = await authenticate(request, { requireVerifiedEmail: true });
    const idempotencyKey = requireIdempotencyKey(request);
    const url = await createTopupSession(user, idempotencyKey, tier);
    response.status(200).json({ url });
  }),
);

app.get(
  "/v1/billing/invoices",
  asyncHandler(async (request, response) => {
    const user = await authenticate(request, { requireVerifiedEmail: true });
    const invoices = await listInvoices(user.uid);
    response.status(200).json({ invoices });
  }),
);

app.get(
  "/v1/me/entitlements",
  asyncHandler(async (request, response) => {
    const user = await authenticate(request);
    await ensureUserProfile(user);
    response.status(200).json(await getEntitlements(user.uid));
  }),
);

app.post(
  "/v1/dictations/transcribe",
  dictationRateLimit,
  asyncHandler(async (request, response) => {
    const user = await authenticate(request, { requireVerifiedEmail: true });
    const idempotencyKey = requireIdempotencyKey(request);
    const result = await createManagedDictation(user.uid, idempotencyKey, request);
    response.status(201).json(result);
  }),
);

app.get(
  "/v1/dictation-requests/:requestId",
  asyncHandler(async (request, response) => {
    const user = await authenticate(request, { requireVerifiedEmail: true });
    const requestId = requestIdSchema.parse(request.params.requestId);
    response.status(200).json(await getManagedDictationStatus(user.uid, requestId));
  }),
);

app.use(notFoundHandler);
app.use(errorHandler);
