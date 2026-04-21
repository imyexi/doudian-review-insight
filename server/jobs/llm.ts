import OpenAI from "openai";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import { z } from "zod";
import { painPointCategorySchema, type PainPointCategory } from "@shared/types";
import type { getAnalysisRuntimeSettings } from "../utils/analysisSettings";
import { logger } from "../utils/logger";

export interface LlmPainPointCandidate {
  canonicalLabel: string;
  category: PainPointCategory;
  excerpt: string;
  source: "llm";
}

interface ReviewPromptInput {
  reviewId: number;
  content: string;
}

interface RawLlmCandidate {
  canonicalLabel: string;
  category: PainPointCategory;
  excerpt: string;
}

type AnalysisRuntimeSettings = Awaited<ReturnType<typeof getAnalysisRuntimeSettings>>;

type LlmBatchResponse = Record<number, LlmPainPointCandidate[]>;

const LLM_REQUEST_TIMEOUT_MS = 30_000;
const MAX_STREAM_TEXT_LENGTH = 200_000;

const rawLlmCandidateSchema = z.object({
  canonicalLabel: z.string().trim().min(1),
  category: painPointCategorySchema,
  excerpt: z.string().trim().min(1),
});

const llmBatchResponseSchema = z.record(z.string(), z.array(rawLlmCandidateSchema));

class InvalidLlmResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLlmResponseError";
  }
}

function createClient(settings: AnalysisRuntimeSettings): OpenAI {
  return new OpenAI({
    apiKey: settings.openaiApiKey ?? undefined,
    baseURL: settings.openaiBaseUrl,
  });
}

function chunkItems<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function normalizeBatchResult(parsed: Record<string, RawLlmCandidate[]>): LlmBatchResponse {
  return Object.fromEntries(
    Object.entries(parsed).flatMap(([key, value]) => {
      const reviewId = Number(key);
      if (!Number.isInteger(reviewId) || reviewId <= 0) {
        return [];
      }

      return [
        [
          reviewId,
          value.map(item => ({
            canonicalLabel: item.canonicalLabel,
            category: item.category,
            excerpt: item.excerpt,
            source: "llm" as const,
          })),
        ],
      ];
    }),
  );
}

function readDeltaContent(chunk: ChatCompletionChunk): string {
  const firstChoice = chunk.choices[0];
  return typeof firstChoice?.delta?.content === "string" ? firstChoice.delta.content : "";
}

async function extractStreamText(stream: AsyncIterable<ChatCompletionChunk>): Promise<string> {
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

function normalizeJsonText(rawText: string): string {
  const trimmed = rawText.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fencedMatch ? fencedMatch[1].trim() : trimmed;
}

function parseBatchResponse(rawText: string): LlmBatchResponse {
  const normalizedText = normalizeJsonText(rawText);

  try {
    const parsed = JSON.parse(normalizedText);
    const validated = llmBatchResponseSchema.parse(parsed);
    return normalizeBatchResult(validated);
  } catch (error) {
    throw new InvalidLlmResponseError(error instanceof Error ? error.message : "Invalid LLM batch response");
  }
}

async function extractBatch(
  client: OpenAI,
  batch: ReviewPromptInput[],
  settings: AnalysisRuntimeSettings,
): Promise<LlmBatchResponse> {
  const completion = await client.chat.completions.create(
    {
      model: settings.openaiModel,
      stream: true,
      messages: [
        {
          role: "system",
          content: [
            "你是评论痛点抽取助手。",
            "请从评论中识别负面问题，只允许使用以下分类：质量、物流、款式外观、客服、价格、使用体验、其他。",
            "输出严格 JSON 对象，键为 reviewId，值为数组。每个数组项包含 canonicalLabel、category、excerpt。",
            "不要输出 markdown，不要输出代码块，只返回 JSON。",
            "label 必须是 15 字以内的通用名词短语，不要引入任何行业词。",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify(batch),
        },
      ],
    },
    {
      timeout: LLM_REQUEST_TIMEOUT_MS,
    },
  );

  const rawText = await extractStreamText(completion);
  if (!rawText) {
    return {};
  }

  try {
    return parseBatchResponse(rawText);
  } catch (error) {
    if (!(error instanceof InvalidLlmResponseError)) {
      throw error;
    }

    logger.warn(
      {
        error: error.message,
        responseLength: rawText.length,
        reviewIds: batch.map(item => item.reviewId),
      },
      "ignored invalid llm batch response",
    );
    return {};
  }
}

export async function extractPainPointsWithLlm(
  items: ReviewPromptInput[],
  settings: AnalysisRuntimeSettings,
): Promise<Record<number, LlmPainPointCandidate[]>> {
  if (items.length === 0) {
    return {};
  }

  const client = createClient(settings);
  const batches = chunkItems(items, settings.llmBatchSize);
  const workerCount = Math.min(settings.llmMaxConcurrency, batches.length);

  const workerResults = await Promise.all(
    Array.from({ length: workerCount }, async (_value, workerIndex) => {
      const results: LlmBatchResponse[] = [];

      for (let batchIndex = workerIndex; batchIndex < batches.length; batchIndex += workerCount) {
        results.push(await extractBatch(client, batches[batchIndex], settings));
      }

      return results;
    }),
  );

  return Object.assign({}, ...workerResults.flat());
}
