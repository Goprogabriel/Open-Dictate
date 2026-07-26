import { z } from "zod";

import {
  OPENAI_API_KEY,
  OPENAI_POLISH_MODEL,
  OPENAI_TRANSCRIBE_MODEL,
  polishRequestPolicy,
} from "../config.js";
import { AppError } from "../http/errors.js";
import {
  resolveCommercialPolishUsage,
  type CommercialPolishUsage,
  type PolishUsageFailureKind,
} from "../ledger/polish-usage.js";

const transcriptionSchema = z
  .object({
    text: z.string().trim().min(1).max(100_000),
    usage: z.unknown().optional(),
  })
  .passthrough();

const responseSchema = z
  .object({
    output: z.array(z.unknown()).optional(),
    usage: z.unknown().optional(),
  })
  .passthrough();

type UnknownRecord = Record<string, unknown>;

export class ProviderRequestError extends AppError {
  constructor(
    public readonly definitive: boolean,
    public readonly requestMayHaveBeenProcessed = false,
    public readonly failureKind: PolishUsageFailureKind = "unexpected_error",
  ) {
    super("provider_unavailable", definitive ? 422 : 503, !definitive);
    this.name = "ProviderRequestError";
  }
}

class PolishAttemptError extends Error {
  constructor(public readonly commercialUsage: CommercialPolishUsage) {
    super("polish_attempt_failed");
    this.name = "PolishAttemptError";
  }
}

export interface DictionaryTerm {
  spoken: string;
  replacement: string;
}

export interface TransformationPreferences {
  prompt: string;
  outputLanguage: "en" | "da" | "no" | "sv";
  removeFillers: boolean;
  correctPunctuation: boolean;
  formatLists: boolean;
}

export interface OpenAiDictationInput {
  audio: Buffer;
  mimeType: string;
  filename: string;
  language: string;
  dictionary: DictionaryTerm[];
  preferences: TransformationPreferences;
}

export interface OpenAiDictationResult {
  text: string;
  transcriptionTokens: number;
  polishInputTokens: number;
  polishOutputTokens: number;
  providerRequestId?: string;
  transcriptionModel: string;
  polishModel: string;
  polishApplied: boolean;
  commercialPolishUsage: CommercialPolishUsage;
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function integerValue(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function transcriptionTokenCount(usage: unknown): number {
  const record = asRecord(usage);
  return (
    integerValue(record.total_tokens) ||
    integerValue(record.input_tokens) + integerValue(record.output_tokens)
  );
}

function responseUsage(usage: unknown): { input: number; output: number } {
  const record = asRecord(usage);
  return {
    input: integerValue(record.input_tokens),
    output: integerValue(record.output_tokens),
  };
}

function reportedResponseUsage(
  usage: unknown,
): { inputTokens: number; outputTokens: number } | undefined {
  const record = asRecord(usage);
  if (
    !Number.isSafeInteger(record.input_tokens) ||
    Number(record.input_tokens) < 0 ||
    !Number.isSafeInteger(record.output_tokens) ||
    Number(record.output_tokens) < 0
  ) {
    return undefined;
  }
  return {
    inputTokens: Number(record.input_tokens),
    outputTokens: Number(record.output_tokens),
  };
}

function extractOutputText(output: unknown[]): string | null {
  for (const item of output) {
    const content = asRecord(item).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const record = asRecord(part);
      if (record.type === "output_text" && typeof record.text === "string" && record.text.trim()) {
        return record.text.trim();
      }
    }
  }
  return null;
}

function dictionaryPrompt(dictionary: DictionaryTerm[]): string {
  if (dictionary.length === 0) return "";
  const terms = dictionary
    .slice(0, 200)
    .map(({ spoken, replacement }) => `${spoken} → ${replacement}`)
    .join("; ");
  return `Use these spellings when relevant: ${terms}`.slice(0, 2_000);
}

function polishInstructions(
  preferences: TransformationPreferences,
  dictionary: DictionaryTerm[],
): string {
  const outputLanguageNames = {
    en: "English",
    da: "Danish",
    no: "Norwegian",
    sv: "Swedish",
  } as const;
  const requirements = [
    "Return only the final text, with no quotation marks or commentary.",
    "Preserve the speaker's intended meaning and corrections. Do not invent facts.",
    `Write the final text in ${outputLanguageNames[preferences.outputLanguage]} (${preferences.outputLanguage}).`,
    preferences.correctPunctuation
      ? "Correct punctuation and capitalization."
      : "Preserve punctuation style.",
    preferences.removeFillers
      ? "Remove filler words and false starts unless they change meaning."
      : "Keep filler words.",
    preferences.formatLists
      ? "Format clear enumerations as readable lists when appropriate."
      : "Keep prose formatting.",
  ];

  if (dictionary.length > 0) {
    requirements.push(
      `Apply these vocabulary corrections when relevant: ${dictionaryPrompt(dictionary)}`,
    );
  }
  if (preferences.prompt.trim()) {
    requirements.push(
      `The user supplied these additional style instructions:\n<user_instructions>\n${preferences.prompt.trim()}\n</user_instructions>`,
    );
  }
  return requirements.join("\n").slice(0, 8_000);
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ProviderRequestError(
      response.status >= 400 && response.status < 500,
      response.ok,
      "malformed_json",
    );
  }
}

async function openAiRequest(path: string, init: RequestInit): Promise<Response> {
  const key = OPENAI_API_KEY.value();
  if (!key) throw new ProviderRequestError(true, false, "missing_credentials");

  let response: Response;
  try {
    response = await fetch(`https://api.openai.com/v1${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${key}`,
        ...init.headers,
      },
      signal: AbortSignal.timeout(135_000),
    });
  } catch {
    // A timeout or broken connection does not prove the provider did not
    // process the request, so commercial reporting treats it as ambiguous.
    throw new ProviderRequestError(false, true, "network_or_timeout");
  }

  if (!response.ok) {
    const definitive =
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 408 &&
      response.status !== 429;
    const requestMayHaveBeenProcessed = response.status === 408 || response.status >= 500;
    throw new ProviderRequestError(definitive, requestMayHaveBeenProcessed, "http_error");
  }
  return response;
}

async function transcribe(input: OpenAiDictationInput): Promise<{
  text: string;
  tokens: number;
  requestId?: string;
  model: string;
}> {
  const model = OPENAI_TRANSCRIBE_MODEL.value().trim();
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(input.audio)], { type: input.mimeType }),
    input.filename,
  );
  form.append("model", model);
  form.append("response_format", "json");
  form.append("language", input.language);
  const prompt = dictionaryPrompt(input.dictionary);
  if (prompt) form.append("prompt", prompt);

  const response = await openAiRequest("/audio/transcriptions", { method: "POST", body: form });
  const payload = transcriptionSchema.safeParse(await parseJson(response));
  if (!payload.success) throw new ProviderRequestError(false, true, "invalid_response");

  return {
    text: payload.data.text,
    tokens: transcriptionTokenCount(payload.data.usage),
    requestId: response.headers.get("x-request-id") ?? undefined,
    model,
  };
}

async function polish(
  transcript: string,
  preferences: TransformationPreferences,
  dictionary: DictionaryTerm[],
): Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  commercialUsage: CommercialPolishUsage;
}> {
  const model = OPENAI_POLISH_MODEL.value().trim();
  const policy = polishRequestPolicy();
  const body = JSON.stringify({
    model,
    instructions: polishInstructions(preferences, dictionary),
    input: transcript,
    max_output_tokens: policy.maxOutputTokens,
  });
  const requestBodyBytes = Buffer.byteLength(body, "utf8");
  const accountingContext = {
    requestBodyBytes,
    inputOverheadTokens: policy.failedAttemptInputOverheadTokens,
    outputTokenCeiling: policy.maxOutputTokens,
  } as const;

  try {
    const response = await openAiRequest("/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const rawPayload = await parseJson(response);
    const reportedUsage = reportedResponseUsage(asRecord(rawPayload).usage);
    const payload = responseSchema.safeParse(rawPayload);
    if (!payload.success) {
      throw new PolishAttemptError(
        resolveCommercialPolishUsage({
          ...accountingContext,
          reportedUsage,
          attemptOutcome: "fallback",
          failureKind: "invalid_response",
          potentiallyBillable: true,
        }),
      );
    }
    const text = extractOutputText(payload.data.output ?? []);
    if (!text) {
      throw new PolishAttemptError(
        resolveCommercialPolishUsage({
          ...accountingContext,
          reportedUsage,
          attemptOutcome: "fallback",
          failureKind: "missing_output",
          potentiallyBillable: true,
        }),
      );
    }
    const usage = responseUsage(payload.data.usage);
    const commercialUsage = resolveCommercialPolishUsage({
      ...accountingContext,
      reportedUsage,
      attemptOutcome: "applied",
      failureKind: reportedUsage ? "none" : "missing_usage",
      potentiallyBillable: true,
    });
    return {
      text,
      inputTokens: usage.input,
      outputTokens: usage.output,
      model,
      commercialUsage,
    };
  } catch (error) {
    if (error instanceof PolishAttemptError) throw error;
    const providerError = error instanceof ProviderRequestError ? error : null;
    throw new PolishAttemptError(
      resolveCommercialPolishUsage({
        ...accountingContext,
        attemptOutcome: "fallback",
        failureKind: providerError?.failureKind ?? "unexpected_error",
        potentiallyBillable: providerError?.requestMayHaveBeenProcessed ?? true,
      }),
    );
  }
}

export async function transcribeAndPolish(
  input: OpenAiDictationInput,
): Promise<OpenAiDictationResult> {
  const transcription = await transcribe(input);
  try {
    const polished = await polish(transcription.text, input.preferences, input.dictionary);
    return {
      text: polished.text,
      transcriptionTokens: transcription.tokens,
      polishInputTokens: polished.inputTokens,
      polishOutputTokens: polished.outputTokens,
      providerRequestId: transcription.requestId,
      transcriptionModel: transcription.model,
      polishModel: polished.model,
      polishApplied: true,
      commercialPolishUsage: polished.commercialUsage,
    };
  } catch (error) {
    const commercialPolishUsage =
      error instanceof PolishAttemptError
        ? error.commercialUsage
        : resolveCommercialPolishUsage({
            requestBodyBytes: 0,
            inputOverheadTokens: 0,
            outputTokenCeiling: 0,
            attemptOutcome: "fallback",
            failureKind: "unexpected_error",
            potentiallyBillable: false,
          });
    return {
      text: transcription.text,
      transcriptionTokens: transcription.tokens,
      polishInputTokens: 0,
      polishOutputTokens: 0,
      providerRequestId: transcription.requestId,
      transcriptionModel: transcription.model,
      polishModel: OPENAI_POLISH_MODEL.value().trim(),
      polishApplied: false,
      commercialPolishUsage,
    };
  }
}
