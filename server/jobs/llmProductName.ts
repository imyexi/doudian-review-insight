import { z } from "zod";
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

interface ProductNamePromptInput {
  doudianProductId: string;
  rawTitle: string;
}

const llmBatchResponseSchema = z.record(z.string().trim().min(1), z.string().trim().min(1).max(60));

function parseBatchResponse(rawText: string): Record<string, string> {
  const normalizedText = normalizeJsonText(rawText);

  try {
    const parsed = JSON.parse(normalizedText);
    return llmBatchResponseSchema.parse(parsed);
  } catch (error) {
    throw new InvalidLlmResponseError(error instanceof Error ? error.message : "Invalid LLM product-name response");
  }
}

async function extractBatch(
  settings: AnalysisRuntimeSettings,
  batch: ProductNamePromptInput[],
): Promise<Record<string, string>> {
  const client = createClient(settings);
  const completion = await client.chat.completions.create(
    {
      model: settings.openaiModel,
      stream: true,
      messages: [
        {
          role: "system",
          content: [
            "你是商品名称提取助手。",
            "请从电商商品标题中提取核心商品名（不超过 15 字）。",
            "去掉营销词、规格参数（重量/数量/尺寸）、产地、品牌修饰、促销信息等无关内容。",
            "只保留能识别商品本质类别和关键特征（如口味、款式）的最短名称。",
            "输出严格 JSON 对象，键为商品ID，值为提取出的核心商品名字符串。",
            "不要输出 markdown，不要输出代码块，只返回 JSON。",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify(batch),
        },
      ],
    },
    { timeout: LLM_REQUEST_TIMEOUT_MS },
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
        productIds: batch.map(item => item.doudianProductId),
      },
      "ignored invalid llm product-name response",
    );
    return {};
  }
}

export async function extractProductNamesWithLlm(
  items: ProductNamePromptInput[],
  settings: AnalysisRuntimeSettings,
): Promise<Record<string, string>> {
  if (items.length === 0) {
    return {};
  }

  const batches = chunkItems(items, settings.llmBatchSize);
  const workerCount = Math.min(settings.llmMaxConcurrency, batches.length);

  const workerResults = await Promise.all(
    Array.from({ length: workerCount }, async (_value, workerIndex) => {
      const results: Record<string, string>[] = [];

      for (let batchIndex = workerIndex; batchIndex < batches.length; batchIndex += workerCount) {
        results.push(await extractBatch(settings, batches[batchIndex]));
      }

      return results;
    }),
  );

  return Object.assign({}, ...workerResults.flat());
}
