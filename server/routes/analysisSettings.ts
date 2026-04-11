import { Router } from "express";
import { analysisSettingsUpdateSchema } from "@shared/types";
import { getAnalysisSettings, updateAnalysisSettings } from "../utils/analysisSettings";
import { sendError, sendSuccess } from "../utils/http";

export const analysisSettingsRouter = Router();

analysisSettingsRouter.get("/analysis", async (_request, response) => {
  const settings = await getAnalysisSettings();
  sendSuccess(response, settings);
});

analysisSettingsRouter.patch("/analysis", async (request, response) => {
  const parsed = analysisSettingsUpdateSchema.safeParse(request.body);
  if (!parsed.success) {
    sendError(response, "INVALID_INPUT", parsed.error.issues[0]?.message ?? "分析设置无效", 400);
    return;
  }

  try {
    const updated = await updateAnalysisSettings(parsed.data);
    sendSuccess(response, updated);
  } catch (error) {
    sendError(response, "INVALID_ANALYSIS_SETTINGS", error instanceof Error ? error.message : "分析设置无效", 400);
  }
});
