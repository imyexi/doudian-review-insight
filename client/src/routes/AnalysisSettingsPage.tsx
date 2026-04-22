import { useEffect, useState, type ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AnalysisMode, AnalysisSettings, AnalysisSettingsUpdate } from "@shared/types";
import { apiGet, apiPatch, getRequestErrorMessage } from "@/api/client";
import { formatTimestamp } from "@/lib/format";

interface AnalysisSettingsFormState {
  analysisMode: AnalysisMode;
  openaiBaseUrl: string;
  openaiApiKey: string;
  openaiModel: string;
  llmBatchSize: string;
  llmMaxConcurrency: string;
  llmProductNameEnabled: boolean;
}

interface ModeOption {
  description: string;
  label: string;
  value: AnalysisMode;
}

const MODE_OPTIONS: ModeOption[] = [
  {
    value: "rules_only",
    label: "仅规则",
    description: "完全走本地规则词库，不依赖外部模型接口。",
  },
  {
    value: "llm_only",
    label: "仅 LLM",
    description: "所有有文本的评论都走大模型抽取，适合规则词库覆盖不足时。",
  },
  {
    value: "hybrid",
    label: "规则 + LLM 合并",
    description: "规则命中和 LLM 抽取会一起参与聚合，既保留高频问题，也尽量捞出更具体的补充意见。",
  },
];

const EMPTY_FORM: AnalysisSettingsFormState = {
  analysisMode: "rules_only",
  openaiBaseUrl: "",
  openaiApiKey: "",
  openaiModel: "",
  llmBatchSize: "20",
  llmMaxConcurrency: "3",
  llmProductNameEnabled: true,
};

function toFormState(settings: AnalysisSettings): AnalysisSettingsFormState {
  return {
    analysisMode: settings.analysisMode,
    openaiBaseUrl: settings.openaiBaseUrl,
    openaiApiKey: "",
    openaiModel: settings.openaiModel,
    llmBatchSize: String(settings.llmBatchSize),
    llmMaxConcurrency: String(settings.llmMaxConcurrency),
    llmProductNameEnabled: settings.llmProductNameEnabled,
  };
}

function toPayload(form: AnalysisSettingsFormState, apiKeyDirty: boolean): AnalysisSettingsUpdate {
  return {
    analysisMode: form.analysisMode,
    openaiBaseUrl: form.openaiBaseUrl,
    openaiModel: form.openaiModel,
    llmBatchSize: Number(form.llmBatchSize),
    llmMaxConcurrency: Number(form.llmMaxConcurrency),
    llmProductNameEnabled: form.llmProductNameEnabled,
    ...(apiKeyDirty ? { openaiApiKey: form.openaiApiKey } : {}),
  };
}

function requiresLlm(mode: AnalysisMode): boolean {
  return mode === "llm_only" || mode === "hybrid";
}

export function AnalysisSettingsPage(): ReactElement {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AnalysisSettingsFormState>(EMPTY_FORM);
  const [apiKeyDirty, setApiKeyDirty] = useState(false);
  const [feedback, setFeedback] = useState<string>("");

  const settingsQuery = useQuery({
    queryKey: ["settings", "analysis"],
    queryFn: () => apiGet<AnalysisSettings>("/settings/analysis"),
  });

  useEffect(() => {
    if (!settingsQuery.data) {
      return;
    }

    setForm(toFormState(settingsQuery.data));
    setApiKeyDirty(false);
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (payload: AnalysisSettingsUpdate) => apiPatch<AnalysisSettings, AnalysisSettingsUpdate>("/settings/analysis", payload),
    onSuccess: nextSettings => {
      queryClient.setQueryData(["settings", "analysis"], nextSettings);
      setForm(toFormState(nextSettings));
      setApiKeyDirty(false);
      setFeedback("分析设置已保存，后续上传任务会按新策略执行。");
    },
    onError: error => {
      setFeedback(getRequestErrorMessage(error, "保存失败，请稍后重试。"));
    },
  });

  const currentSettings = settingsQuery.data;
  const llmEnabled = requiresLlm(form.analysisMode);
  const statusPillClassName = form.analysisMode === "rules_only"
    ? "pill"
    : currentSettings?.hasApiKey
      ? "pill pill--success"
      : "pill pill--danger";

  if (settingsQuery.isLoading) {
    return (
      <section className="stack-lg">
        <div className="surface panel-card">
          <span className="eyebrow">Analysis Settings</span>
          <h3>正在读取分析配置...</h3>
          <p>会先加载当前分析模式，以及已经保存在本地 SQLite 里的 LLM 接口参数。</p>
        </div>
      </section>
    );
  }

  if (!currentSettings) {
    return (
      <section className="stack-lg">
        <div className="surface panel-card">
          <span className="eyebrow">Analysis Settings</span>
          <h3>暂时无法读取分析配置</h3>
          <p>请刷新页面重试；如果问题持续存在，检查后端是否已经完成数据库迁移。</p>
        </div>
      </section>
    );
  }

  return (
    <section className="stack-lg">
      <div className="dashboard-grid dashboard-grid--four">
        <article className="metric-card surface">
          <span>当前模式</span>
          <strong>{MODE_OPTIONS.find(item => item.value === currentSettings.analysisMode)?.label ?? "未知模式"}</strong>
          <p>会直接影响后续上传批次的痛点抽取路径。</p>
        </article>
        <article className="metric-card surface accent-card">
          <span>API Key</span>
          <strong>{currentSettings.hasApiKey ? "已保存" : "未配置"}</strong>
          <p>{currentSettings.maskedApiKey ? `当前仅显示遮罩：${currentSettings.maskedApiKey}` : "前端不会回显完整密钥。"}</p>
        </article>
        <article className="metric-card surface">
          <span>商品名提取</span>
          <strong>{currentSettings.llmProductNameEnabled ? "已开启" : "已关闭"}</strong>
          <p>启用后，导入标题会先用大模型提取更通用的核心商品名。</p>
        </article>
        <article className="metric-card surface">
          <span>最近更新</span>
          <strong>{currentSettings.updatedAt > 0 ? formatTimestamp(currentSettings.updatedAt) : "默认值"}</strong>
          <p>未保存过时，会使用 `.env` 里的启动默认值。</p>
        </article>
      </div>

      <div className="split-panel split-panel--balanced split-panel--top">
        <section className="surface panel-card stack-md">
          <div className="stack-sm">
            <span className="eyebrow">Mode Switch</span>
            <h3>分析模式</h3>
            <p>你可以明确指定只走规则、只走 LLM，或者使用规则 + LLM 合并的模式，让高频问题和更具体的补充意见一起进入聚合。</p>
          </div>

          <div className="list-stack">
            {MODE_OPTIONS.map(option => {
              const active = form.analysisMode === option.value;
              return (
                <button
                  key={option.value}
                  className={`list-row list-row--card list-row--interactive ${active ? "list-row--selected" : ""}`.trim()}
                  type="button"
                  onClick={() => {
                    setForm(current => ({ ...current, analysisMode: option.value }));
                    setFeedback("");
                  }}
                >
                  <div className="stack-sm">
                    <div className="row-heading">
                      <strong>{option.label}</strong>
                      {active ? <span className="pill pill--accent">当前编辑值</span> : null}
                    </div>
                    <p>{option.description}</p>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="surface-muted evidence-card stack-sm">
            <div className="row-heading row-heading--spread">
              <strong>当前保存状态</strong>
              <span className={statusPillClassName}>{llmEnabled ? (currentSettings.hasApiKey ? "LLM 可用" : "待补全" ) : "规则模式"}</span>
            </div>
            <p>
              {llmEnabled
                ? "切到需要 LLM 的模式后，必须确保 Base URL、模型名与 API Key 都可用，否则上传任务会在分析阶段失败。"
                : "当前选择的是规则模式，即使下面保留了 LLM 参数，也不会参与后续分析。"}
            </p>
          </div>
        </section>

        <section className="surface panel-card stack-md">
          <div className="stack-sm">
            <span className="eyebrow">LLM Runtime</span>
            <h3>接口配置</h3>
            <p>这里保存 OpenAI 兼容接口参数。保存后会写入本地数据库，不需要每次再改 `.env`。</p>
          </div>

          <div className="form-grid">
            <label className="field-group field-span-2">
              <span>API Base URL</span>
              <input
                className="input"
                value={form.openaiBaseUrl}
                onChange={event => {
                  setForm(current => ({ ...current, openaiBaseUrl: event.target.value }));
                  setFeedback("");
                }}
                placeholder="https://api.openai.com/v1"
              />
            </label>

            <label className="field-group field-span-2">
              <span>API Key</span>
              <input
                className="input"
                type="password"
                value={form.openaiApiKey}
                onChange={event => {
                  setApiKeyDirty(true);
                  setForm(current => ({ ...current, openaiApiKey: event.target.value }));
                  setFeedback("");
                }}
                placeholder={currentSettings.hasApiKey ? "留空则保留当前已保存的 Key" : "输入新的 API Key"}
              />
            </label>

            <label className="field-group">
              <span>模型名称</span>
              <input
                className="input"
                value={form.openaiModel}
                onChange={event => {
                  setForm(current => ({ ...current, openaiModel: event.target.value }));
                  setFeedback("");
                }}
                placeholder="gpt-4o-mini"
              />
            </label>

            <label className="field-group">
              <span>每批评论数</span>
              <input
                className="input"
                min="1"
                max="100"
                type="number"
                value={form.llmBatchSize}
                onChange={event => {
                  setForm(current => ({ ...current, llmBatchSize: event.target.value }));
                  setFeedback("");
                }}
              />
            </label>

            <label className="field-group">
              <span>最大并发</span>
              <input
                className="input"
                min="1"
                max="10"
                type="number"
                value={form.llmMaxConcurrency}
                onChange={event => {
                  setForm(current => ({ ...current, llmMaxConcurrency: event.target.value }));
                  setFeedback("");
                }}
              />
            </label>

            <label className="toggle-row field-span-2">
              <input
                checked={form.llmProductNameEnabled}
                type="checkbox"
                disabled={!llmEnabled}
                onChange={event => {
                  setForm(current => ({ ...current, llmProductNameEnabled: event.target.checked }));
                  setFeedback("");
                }}
              />
              <span>{llmEnabled ? "启用 LLM 商品名提取，导入标题会先抽取更通用的核心商品名" : "当前是纯规则模式，这个开关会暂时保留但不会生效"}</span>
            </label>

            <div className="field-group field-span-2">
              <span>当前已保存 Key</span>
              <div className="row-heading row-heading--spread surface-muted evidence-card">
                <p>{currentSettings.maskedApiKey ?? "还没有保存 API Key"}</p>
                {currentSettings.hasApiKey ? (
                  <button
                    className="button button--ghost"
                    type="button"
                    onClick={() => {
                      setApiKeyDirty(true);
                      setForm(current => ({ ...current, openaiApiKey: "" }));
                      setFeedback("已准备移除当前 API Key，保存后生效。");
                    }}
                  >
                    移除已保存 Key
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="surface-muted evidence-card stack-sm">
            <strong>保存说明</strong>
            <p>1. 仅规则模式可以不填任何 LLM 参数；商品名提取偏好会保留，但当前不会生效。</p>
            <p>2. 仅 LLM / 混合模式下，后端会校验 Base URL、模型名与 API Key 是否齐全。</p>
            <p>3. 开启商品名提取后，新上传商品会优先使用 LLM 提炼核心名称，再参与自动归组。</p>
            <p>4. 修改后的设置会作用于之后的新上传任务，不会回溯重跑历史批次。</p>
          </div>

          <div className="button-row">
            <button
              className="button"
              type="button"
              disabled={saveMutation.isPending}
              onClick={() => {
                setFeedback("");
                void saveMutation.mutateAsync(toPayload(form, apiKeyDirty));
              }}
            >
              {saveMutation.isPending ? "保存中..." : "保存分析设置"}
            </button>
            <button
              className="button button--ghost"
              type="button"
              disabled={saveMutation.isPending}
              onClick={() => {
                setForm(toFormState(currentSettings));
                setApiKeyDirty(false);
                setFeedback("已恢复为当前已保存的配置。");
              }}
            >
              恢复已保存值
            </button>
          </div>

          {feedback ? <p className="feedback-text">{feedback}</p> : null}
        </section>
      </div>
    </section>
  );
}
