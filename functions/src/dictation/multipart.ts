import Busboy from "busboy";
import type { Request } from "express";
import { z } from "zod";

import { MAX_AUDIO_BYTES, MAX_AUDIO_DURATION_MS } from "../config.js";
import { AppError } from "../http/errors.js";

const booleanField = z.enum(["true", "false"]).transform((value) => value === "true");

const dictionarySchema = z
  .array(
    z.object({
      spoken: z.string().trim().min(1).max(100),
      replacement: z.string().trim().min(1).max(100),
    }),
  )
  .max(100);

const metadataSchema = z
  .object({
    language: z.enum(["en", "da", "no", "sv"]),
    durationMs: z.coerce.number().int().positive(),
    speakingMs: z.coerce.number().int().nonnegative().optional(),
    application: z.string().trim().max(200).default(""),
    saveHistory: booleanField,
    retentionDays: z.coerce
      .number()
      .int()
      .refine((value) => value === 7 || value === 30 || value === 90 || value === 365),
    outputLanguage: z.enum(["en", "da", "no", "sv"]),
    customPrompt: z.string().max(4_000),
    removeFillers: booleanField,
    correctPunctuation: booleanField,
    formatLists: booleanField,
    dictionary: z.string().max(32_768),
  })
  .strict();

const supportedAudio: Readonly<Record<string, string>> = {
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

export interface ManagedAudioUpload {
  audio: Buffer;
  mimeType: string;
  filename: string;
  language: "en" | "da" | "no" | "sv";
  durationMs: number;
  speakingMs: number;
  application: string;
  saveHistory: boolean;
  retentionDays: 7 | 30 | 90 | 365;
  preferences: {
    prompt: string;
    outputLanguage: "en" | "da" | "no" | "sv";
    removeFillers: boolean;
    correctPunctuation: boolean;
    formatLists: boolean;
  };
  dictionary: Array<{ spoken: string; replacement: string }>;
}

function rawRequestBody(request: Request): Buffer {
  const body = (request as Request & { rawBody?: Buffer }).rawBody;
  if (!body || !Buffer.isBuffer(body)) throw new AppError("invalid_request", 400);
  return body;
}

export function wavDurationMs(audio: Buffer): number | null {
  if (
    audio.length < 44 ||
    audio.toString("ascii", 0, 4) !== "RIFF" ||
    audio.toString("ascii", 8, 12) !== "WAVE"
  ) {
    return null;
  }

  let byteRate = 0;
  let dataBytes = 0;
  let offset = 12;
  while (offset + 8 <= audio.length) {
    const chunkId = audio.toString("ascii", offset, offset + 4);
    const chunkSize = audio.readUInt32LE(offset + 4);
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + chunkSize;
    if (payloadEnd > audio.length) return null;

    if (chunkId === "fmt " && chunkSize >= 16) {
      const audioFormat = audio.readUInt16LE(payloadStart);
      byteRate = audio.readUInt32LE(payloadStart + 8);
      if (audioFormat !== 1 && audioFormat !== 3) return null;
    } else if (chunkId === "data") {
      dataBytes = chunkSize;
    }
    offset = payloadEnd + (chunkSize % 2);
  }

  if (byteRate <= 0 || dataBytes <= 0) return null;
  const duration = Math.round((dataBytes / byteRate) * 1_000);
  return Number.isSafeInteger(duration) && duration > 0 ? duration : null;
}

export async function parseManagedAudio(request: Request): Promise<ManagedAudioUpload> {
  const contentType = request.header("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new AppError("invalid_request", 415);
  }

  const maximumBytes = MAX_AUDIO_BYTES.value();
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0 || maximumBytes > 24 * 1024 * 1024) {
    throw new Error("MAX_AUDIO_BYTES must be between 1 and 25165824.");
  }

  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {};
    const chunks: Buffer[] = [];
    let audioBytes = 0;
    let mimeType = "";
    let extension = "";
    let foundAudio = false;
    let exceededLimit = false;
    let exceededParts = false;
    let duplicateField = false;

    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({
        headers: request.headers,
        limits: {
          fileSize: maximumBytes,
          files: 1,
          fields: 12,
          // Busboy emits partsLimit when the counter reaches the configured
          // value, so use one above the 12 fields + 1 audio file contract.
          parts: 14,
          fieldSize: 32_768,
        },
      });
    } catch {
      reject(new AppError("invalid_request", 400));
      return;
    }

    parser.on("field", (name, value) => {
      if (Object.hasOwn(fields, name)) duplicateField = true;
      fields[name] = value;
    });

    parser.on("file", (name, stream, info) => {
      if (name !== "audio" || foundAudio) {
        stream.resume();
        return;
      }

      foundAudio = true;
      mimeType = info.mimeType.toLowerCase();
      extension = supportedAudio[mimeType] ?? "";
      if (!extension) {
        stream.resume();
        return;
      }

      stream.on("limit", () => {
        exceededLimit = true;
      });
      stream.on("data", (chunk: Buffer) => {
        audioBytes += chunk.length;
        chunks.push(chunk);
      });
    });

    parser.on("error", () => reject(new AppError("invalid_request", 400)));
    parser.on("fieldsLimit", () => {
      exceededParts = true;
    });
    parser.on("filesLimit", () => {
      exceededParts = true;
    });
    parser.on("partsLimit", () => {
      exceededParts = true;
    });
    parser.on("close", () => {
      if (exceededLimit) {
        reject(new AppError("audio_too_large", 413));
        return;
      }
      if (exceededParts) {
        reject(new AppError("invalid_request", 400));
        return;
      }
      if (!foundAudio || !extension || audioBytes === 0) {
        reject(new AppError("unsupported_audio", 415));
        return;
      }

      const parsed = metadataSchema.safeParse(fields);
      let dictionaryPayload: unknown = null;
      try {
        dictionaryPayload = JSON.parse(fields.dictionary ?? "null");
      } catch {
        // The schema check below produces the public invalid-request response.
      }
      const dictionary = dictionarySchema.safeParse(dictionaryPayload);
      const audio = Buffer.concat(chunks, audioBytes);
      const measuredDurationMs = wavDurationMs(audio);
      if (
        duplicateField ||
        !parsed.success ||
        !dictionary.success ||
        measuredDurationMs === null ||
        measuredDurationMs > MAX_AUDIO_DURATION_MS.value()
      ) {
        reject(new AppError("invalid_request", 400));
        return;
      }

      const durationTolerance = Math.max(500, measuredDurationMs * 0.05);
      if (Math.abs(parsed.data.durationMs - measuredDurationMs) > durationTolerance) {
        reject(new AppError("invalid_request", 400));
        return;
      }

      resolve({
        audio,
        mimeType,
        filename: `recording.${extension}`,
        language: parsed.data.language,
        durationMs: measuredDurationMs,
        speakingMs: Math.min(parsed.data.speakingMs ?? measuredDurationMs, measuredDurationMs),
        application: parsed.data.application,
        saveHistory: parsed.data.saveHistory,
        retentionDays: parsed.data.retentionDays,
        preferences: {
          prompt: parsed.data.customPrompt,
          outputLanguage: parsed.data.outputLanguage,
          removeFillers: parsed.data.removeFillers,
          correctPunctuation: parsed.data.correctPunctuation,
          formatLists: parsed.data.formatLists,
        },
        dictionary: dictionary.data,
      });
    });

    parser.end(rawRequestBody(request));
  });
}
