import { eq } from "drizzle-orm";
import type { AnalysisMode, AnalysisSettings, AnalysisSettingsUpdate } from "@shared/types";
import { db } from "../db/client";
import { analysisSettings } from "../db/schema";
import { env } from "../env";

const ANALYSIS_SETTINGS_ID = 1;

interface AnalysisSettingsRecord {
  analysisMode: AnalysisMode;
  openaiBaseUrl: string;
  openaiApiKey: string | null;
  openaiModel: string;
  llmBatchSize: number;
  llmMaxConcurrency: number;
  llmProductNameEnabled: boolean;
  updatedAt: number;
}

function normalizeOptional(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function maskApiKey(value: string | null): string | null {
  if (!value) {
    return null;
  }

  if (value.length <= 8) {
    return `${value.slice(0, 2)}***`;
  }

  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function getDefaultSettingsRecord(): AnalysisSettingsRecord {
  return {
    analysisMode: env.OPENAI_API_KEY ? "hybrid" : "rules_only",
    openaiBaseUrl: env.OPENAI_BASE_URL,
    openaiApiKey: normalizeOptional(env.OPENAI_API_KEY),
    openaiModel: env.OPENAI_MODEL,
    llmBatchSize: env.LLM_BATCH_SIZE,
    llmMaxConcurrency: env.LLM_MAX_CONCURRENCY,
    llmProductNameEnabled: true,
    updatedAt: 0,
  };
}

function coalesceRecord(row: typeof analysisSettings.$inferSelect | undefined): AnalysisSettingsRecord {
  const defaults = getDefaultSettingsRecord();

  return {
    analysisMode: (row?.analysisMode as AnalysisMode | null) ?? defaults.analysisMode,
    openaiBaseUrl: row?.openaiBaseUrl ?? defaults.openaiBaseUrl,
    openaiApiKey: row?.openaiApiKey ?? defaults.openaiApiKey,
    openaiModel: row?.openaiModel ?? defaults.openaiModel,
    llmBatchSize: row?.llmBatchSize ?? defaults.llmBatchSize,
    llmMaxConcurrency: row?.llmMaxConcurrency ?? defaults.llmMaxConcurrency,
    llmProductNameEnabled: row?.llmProductNameEnabled ?? defaults.llmProductNameEnabled,
    updatedAt: row?.updatedAt ?? defaults.updatedAt,
  };
}

function toPublicSettings(record: AnalysisSettingsRecord): AnalysisSettings {
  return {
    analysisMode: record.analysisMode,
    openaiBaseUrl: record.openaiBaseUrl,
    openaiModel: record.openaiModel,
    llmBatchSize: record.llmBatchSize,
    llmMaxConcurrency: record.llmMaxConcurrency,
    llmProductNameEnabled: record.llmProductNameEnabled,
    hasApiKey: Boolean(record.openaiApiKey),
    maskedApiKey: maskApiKey(record.openaiApiKey),
    updatedAt: record.updatedAt,
  };
}

function validateLlmRequirements(record: AnalysisSettingsRecord): void {
  if (record.analysisMode === "rules_only") {
    return;
  }

  if (!record.openaiBaseUrl) {
    throw new Error("启用 LLM 分析时必须填写 API Base URL。");
  }

  if (!record.openaiModel) {
    throw new Error("启用 LLM 分析时必须填写模型名称。");
  }

  if (!record.openaiApiKey) {
    throw new Error("启用 LLM 分析时必须填写 API Key。");
  }
}

export async function getAnalysisSettingsRecord(): Promise<AnalysisSettingsRecord> {
  const [row] = await db
    .select()
    .from(analysisSettings)
    .where(eq(analysisSettings.id, ANALYSIS_SETTINGS_ID))
    .limit(1);

  return coalesceRecord(row);
}

export async function getAnalysisSettings(): Promise<AnalysisSettings> {
  const record = await getAnalysisSettingsRecord();
  return toPublicSettings(record);
}

export async function updateAnalysisSettings(input: AnalysisSettingsUpdate): Promise<AnalysisSettings> {
  const current = await getAnalysisSettingsRecord();
  const nextRecord: AnalysisSettingsRecord = {
    analysisMode: input.analysisMode,
    openaiBaseUrl: input.openaiBaseUrl.trim(),
    openaiApiKey: input.openaiApiKey !== undefined ? normalizeOptional(input.openaiApiKey) : current.openaiApiKey,
    openaiModel: input.openaiModel.trim(),
    llmBatchSize: input.llmBatchSize,
    llmMaxConcurrency: input.llmMaxConcurrency,
    llmProductNameEnabled: input.llmProductNameEnabled,
    updatedAt: Math.floor(Date.now() / 1000),
  };

  validateLlmRequirements(nextRecord);

  await db
    .insert(analysisSettings)
    .values({
      id: ANALYSIS_SETTINGS_ID,
      analysisMode: nextRecord.analysisMode,
      openaiBaseUrl: nextRecord.openaiBaseUrl,
      openaiApiKey: nextRecord.openaiApiKey,
      openaiModel: nextRecord.openaiModel,
      llmBatchSize: nextRecord.llmBatchSize,
      llmMaxConcurrency: nextRecord.llmMaxConcurrency,
      llmProductNameEnabled: nextRecord.llmProductNameEnabled,
      updatedAt: nextRecord.updatedAt,
    })
    .onConflictDoUpdate({
      target: analysisSettings.id,
      set: {
        analysisMode: nextRecord.analysisMode,
        openaiBaseUrl: nextRecord.openaiBaseUrl,
        openaiApiKey: nextRecord.openaiApiKey,
        openaiModel: nextRecord.openaiModel,
        llmBatchSize: nextRecord.llmBatchSize,
        llmMaxConcurrency: nextRecord.llmMaxConcurrency,
        llmProductNameEnabled: nextRecord.llmProductNameEnabled,
        updatedAt: nextRecord.updatedAt,
      },
    });

  return toPublicSettings(nextRecord);
}

export async function getAnalysisRuntimeSettings(): Promise<AnalysisSettingsRecord> {
  const record = await getAnalysisSettingsRecord();
  validateLlmRequirements(record);
  return record;
}
