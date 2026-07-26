import { describe, expect, it } from "vitest";
import type { Request as ExpressRequest } from "express";

import { parseManagedAudio, wavDurationMs } from "../src/dictation/multipart.js";

process.env.MAX_AUDIO_BYTES ??= String(24 * 1024 * 1024);
process.env.MAX_AUDIO_DURATION_MS ??= String(10 * 60 * 1_000);

function pcmWave(durationMs: number): Buffer {
  const sampleRate = 16_000;
  const channels = 1;
  const bytesPerSample = 2;
  const dataBytes = Math.round((sampleRate * channels * bytesPerSample * durationMs) / 1_000);
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bytesPerSample * 8, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataBytes, 40);
  return buffer;
}

async function managedRequest(overrides: Record<string, string> = {}): Promise<ExpressRequest> {
  const fields = {
    language: "en",
    durationMs: "2500",
    speakingMs: "2400",
    application: "Mail",
    saveHistory: "true",
    retentionDays: "90",
    outputLanguage: "da",
    customPrompt: "Keep it concise.",
    removeFillers: "true",
    correctPunctuation: "true",
    formatLists: "false",
    dictionary: JSON.stringify([{ spoken: "supabace", replacement: "Supabase" }]),
    ...overrides,
  };
  const form = new FormData();
  form.append(
    "audio",
    new Blob([new Uint8Array(pcmWave(2_500))], { type: "audio/wav" }),
    "dictation.wav",
  );
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  const request = new Request("https://api.example.test/v1/dictations/transcribe", {
    method: "POST",
    body: form,
  });
  const rawBody = Buffer.from(await request.arrayBuffer());
  return {
    headers: Object.fromEntries(request.headers.entries()),
    rawBody,
    header: (name: string) => request.headers.get(name) ?? undefined,
  } as unknown as ExpressRequest;
}

describe("WAV duration validation", () => {
  it("derives duration from PCM byte rate rather than client metadata", () => {
    expect(wavDurationMs(pcmWave(2_500))).toBe(2_500);
  });

  it("rejects malformed and truncated payloads", () => {
    expect(wavDurationMs(Buffer.from("not a wave"))).toBeNull();
    expect(wavDurationMs(pcmWave(1_000).subarray(0, 50))).toBeNull();
  });

  it("accepts the native managed-request contract and authoritative transform settings", async () => {
    const upload = await parseManagedAudio(await managedRequest());

    expect(upload).toMatchObject({
      durationMs: 2_500,
      speakingMs: 2_400,
      retentionDays: 90,
      preferences: {
        prompt: "Keep it concise.",
        outputLanguage: "da",
        removeFillers: true,
        correctPunctuation: true,
        formatLists: false,
      },
      dictionary: [{ spoken: "supabace", replacement: "Supabase" }],
    });
  });

  it("rejects unsupported retention metadata", async () => {
    await expect(
      parseManagedAudio(await managedRequest({ retentionDays: "0" })),
    ).rejects.toMatchObject({
      code: "invalid_request",
    });
  });
});
