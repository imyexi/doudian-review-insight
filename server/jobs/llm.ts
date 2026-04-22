import { z } from "zod";
import { painPointCategorySchema, sentimentSchema, type PainPointCategory, type Sentiment } from "@shared/types";
import {
  type AnalysisRuntimeSettings,
  chunkItems,
  createClient,
  extractStreamText,
  InvalidLlmResponseError,
  LLM_REQUEST_TIMEOUT_MS,
  normalizeJsonText,
} from "./llmClient";
import { logger } from "../utils/logger";

export interface LlmPainPointCandidate {
  canonicalLabel: string;
  category: PainPointCategory;
  sentiment: Sentiment;
  specificityScore: number;
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
  sentiment: Sentiment;
  specificityScore: number;
  excerpt: string;
}

type LlmBatchResponse = Record<number, LlmPainPointCandidate[]>;

const rawLlmCandidateSchema = z.object({
  canonicalLabel: z.string().trim().min(1),
  category: painPointCategorySchema,
  sentiment: sentimentSchema,
  specificityScore: z.number().int().min(1).max(5),
  excerpt: z.string().trim().min(1),
});

const llmBatchResponseSchema = z.record(z.string(), z.array(rawLlmCandidateSchema));

function normalizeBatchResult(parsed: Record<string, RawLlmCandidate[]>): LlmBatchResponse {
  return Object.fromEntries(
    Object.entries(parsed).flatMap(([key, value]) => {
      const reviewId = Number(key);
      if (!Number.isInteger(reviewId) || reviewId <= 0) {
        return [];
      }

      return [[reviewId, value.map(item => ({ ...item, source: "llm" as const }))]];
    }),
  );
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
  settings: AnalysisRuntimeSettings,
  batch: ReviewPromptInput[],
): Promise<LlmBatchResponse> {
  const client = createClient(settings);
  const completion = await client.chat.completions.create(
    {
      model: settings.openaiModel,
      stream: true,
      messages: [
        {
          role: "system",
          content: [
            "你是用户评论意见抽取助手。",
            "请从评论中识别用户的具体意见，以负面问题为主，但如果有非常具体的正面反馈也请提取。",
            "分类只允许：质量、物流、款式外观、客服、价格、使用体验、其他。",
            "情感只允许：positive、negative、neutral。",
            "对每条意见评估其具体程度（specificity），用 1-5 打分。1=非常模糊，2=略有方向但无细节，3=中等具体，4=比较具体，5=非常具体且可执行。",
            "对于非常模糊的评论，如果无法提取出具体意见就返回空数组，不要勉强归类。",
            "输出严格 JSON 对象，键为 reviewId，值为数组。每个数组项包含 canonicalLabel、category、sentiment、specificityScore、excerpt。",
            "不要输出 markdown，不要输出代码块，只返回 JSON。",
            "label 必须是 15 字以内的通用名词短语。",
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

  const batches = chunkItems(items, settings.llmBatchSize);
  const workerCount = Math.min(settings.llmMaxConcurrency, batches.length);

  const workerResults = await Promise.all(
    Array.from({ length: workerCount }, async (_value, workerIndex) => {
      const results: LlmBatchResponse[] = [];

      for (let batchIndex = workerIndex; batchIndex < batches.length; batchIndex += workerCount) {
        results.push(await extractBatch(settings, batches[batchIndex]));
      }

      return results;
    }),
  );

  return Object.assign({}, ...workerResults.flat());
}
