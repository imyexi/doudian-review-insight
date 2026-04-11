import OpenAI from "openai";
import type { PainPointCategory } from "@shared/types";
import type { getAnalysisRuntimeSettings } from "../utils/analysisSettings";

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
    Object.entries(parsed).map(([key, value]) => [
      Number(key),
      value.map(item => ({
        canonicalLabel: item.canonicalLabel,
        category: item.category,
        excerpt: item.excerpt,
        source: "llm" as const,
      })),
    ]),
  );
}

async function extractBatch(
  client: OpenAI,
  batch: ReviewPromptInput[],
  settings: AnalysisRuntimeSettings,
): Promise<LlmBatchResponse> {
  const completion = await client.responses.create({
    model: settings.openaiModel,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: [
              "你是评论痛点抽取助手。",
              "请从评论中识别负面问题，只允许使用以下分类：质量、物流、款式外观、客服、价格、使用体验、其他。",
              "输出 JSON 对象，键为 reviewId，值为数组。每个数组项包含 canonicalLabel、category、excerpt。",
              "label 必须是 15 字以内的通用名词短语，不要引入任何行业词。",
            ].join("\n"),
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify(batch),
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_object",
      },
    },
  });

  const rawText = completion.output_text;
  if (!rawText) {
    return {};
  }

  const parsed = JSON.parse(rawText) as Record<string, RawLlmCandidate[]>;
  return normalizeBatchResult(parsed);
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
  const workerGroups = Array.from({ length: workerCount }, (_value, workerIndex) =>
    batches.filter((_batch, batchIndex) => batchIndex % workerCount === workerIndex),
  );

  const workerResults = await Promise.all(
    workerGroups.map(async group => {
      const results: LlmBatchResponse[] = [];

      for (const batch of group) {
        results.push(await extractBatch(client, batch, settings));
      }

      return results;
    }),
  );

  return workerResults.flat().reduce<Record<number, LlmPainPointCandidate[]>>((accumulator, batchResult) => {
    return Object.entries(batchResult).reduce<Record<number, LlmPainPointCandidate[]>>((nextAccumulator, [reviewId, candidates]) => {
      const reviewKey = Number(reviewId);
      return {
        ...nextAccumulator,
        [reviewKey]: [...(nextAccumulator[reviewKey] ?? []), ...candidates],
      };
    }, accumulator);
  }, {});
}
