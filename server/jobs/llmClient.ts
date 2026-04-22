import OpenAI from "openai";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import type { getAnalysisRuntimeSettings } from "../utils/analysisSettings";

export type AnalysisRuntimeSettings = Awaited<ReturnType<typeof getAnalysisRuntimeSettings>>;

export const LLM_REQUEST_TIMEOUT_MS = 30_000;
export const MAX_STREAM_TEXT_LENGTH = 200_000;

export class InvalidLlmResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLlmResponseError";
  }
}

export function createClient(settings: AnalysisRuntimeSettings): OpenAI {
  return new OpenAI({
    apiKey: settings.openaiApiKey ?? undefined,
    baseURL: settings.openaiBaseUrl,
  });
}

export function chunkItems<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

export function readDeltaContent(chunk: ChatCompletionChunk): string {
  const firstChoice = chunk.choices[0];
  return typeof firstChoice?.delta?.content === "string" ? firstChoice.delta.content : "";
}

export async function extractStreamText(stream: AsyncIterable<ChatCompletionChunk>): Promise<string> {
  const contentParts: string[] = [];
  let totalLength = 0;

  for await (const chunk of stream) {
    const content = readDeltaContent(chunk);
    if (!content) {
      continue;
    }

    totalLength += content.length;
    if (totalLength > MAX_STREAM_TEXT_LENGTH) {
      throw new InvalidLlmResponseError("LLM stream response exceeded maximum size");
    }

    contentParts.push(content);
  }

  return contentParts.join("");
}

export function normalizeJsonText(rawText: string): string {
  const trimmed = rawText.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fencedMatch ? fencedMatch[1].trim() : trimmed;
}
