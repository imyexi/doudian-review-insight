import { describe, expect, it } from "vitest";
import { analysisSettingsSchema, analysisSettingsUpdateSchema } from "@shared/types";

describe("analysis settings schemas", () => {
  it("accepts public settings payload without exposing raw api key", () => {
    const parsed = analysisSettingsSchema.parse({
      analysisMode: "hybrid",
      openaiBaseUrl: "https://api.openai.com/v1",
      openaiModel: "gpt-4o-mini",
      llmBatchSize: 20,
      llmMaxConcurrency: 3,
      llmProductNameEnabled: true,
      hasApiKey: true,
      maskedApiKey: "sk-p***1234",
      updatedAt: 1775880000,
    });

    expect(parsed.hasApiKey).toBe(true);
    expect(parsed.maskedApiKey).toBe("sk-p***1234");
  });

  it("allows blank llm endpoint fields in rules-only mode", () => {
    const parsed = analysisSettingsUpdateSchema.parse({
      analysisMode: "rules_only",
      openaiBaseUrl: "",
      openaiModel: "",
      llmBatchSize: "12",
      llmMaxConcurrency: "4",
      llmProductNameEnabled: false,
    });

    expect(parsed.openaiBaseUrl).toBe("");
    expect(parsed.openaiModel).toBe("");
  });

  it("coerces numeric form fields in update payload", () => {
    const parsed = analysisSettingsUpdateSchema.parse({
      analysisMode: "llm_only",
      openaiBaseUrl: "https://openrouter.ai/api/v1",
      openaiModel: "gpt-4.1-mini",
      openaiApiKey: "sk-test",
      llmBatchSize: "12",
      llmMaxConcurrency: "4",
      llmProductNameEnabled: true,
    });

    expect(parsed.llmBatchSize).toBe(12);
    expect(parsed.llmMaxConcurrency).toBe(4);
  });

  it("requires llm endpoint fields when llm mode is enabled", () => {
    const parsed = analysisSettingsUpdateSchema.safeParse({
      analysisMode: "hybrid",
      openaiBaseUrl: "",
      openaiModel: "",
      llmBatchSize: 20,
      llmMaxConcurrency: 3,
      llmProductNameEnabled: true,
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects invalid mode and out-of-range values", () => {
    const parsed = analysisSettingsUpdateSchema.safeParse({
      analysisMode: "custom_mode",
      openaiBaseUrl: "https://api.openai.com/v1",
      openaiModel: "gpt-4o-mini",
      llmBatchSize: 0,
      llmMaxConcurrency: 99,
      llmProductNameEnabled: true,
    });

    expect(parsed.success).toBe(false);
  });
});
