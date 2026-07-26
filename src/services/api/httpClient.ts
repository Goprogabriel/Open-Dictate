import { z } from "zod";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export interface ApiRequestOptions<T> {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  idToken?: string;
  idempotencyKey?: string;
  schema: z.ZodType<T>;
}

export class HttpClient {
  constructor(private readonly baseUrl: string) {}

  async request<T>(path: string, options: ApiRequestOptions<T>): Promise<T> {
    const headers = new Headers({ Accept: "application/json" });
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    if (options.idToken) headers.set("Authorization", `Bearer ${options.idToken}`);
    if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsedError = errorSchema.safeParse(payload);
      throw new ApiError(
        response.status,
        parsedError.success ? parsedError.data.error.code : "request_failed",
        parsedError.success ? parsedError.data.error.message : "The request failed.",
      );
    }

    return options.schema.parse(payload);
  }
}
