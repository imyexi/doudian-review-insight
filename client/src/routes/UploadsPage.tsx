import { useMemo, useState, type ChangeEvent, type ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Upload } from "@shared/types";
import { apiDelete, apiGet, apiPost, ApiRequestError } from "@/api/client";
import { EmptyShopState } from "@/components/EmptyShopState";
import { useShop } from "@/hooks/useShop";
import { formatTimestamp } from "@/lib/format";

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return error.message;
  }

  return "操作失败，请稍后重试。";
}

export function UploadsPage(): ReactElement {
  const queryClient = useQueryClient();
  const { selectedShop, selectedShopId } = useShop();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [feedback, setFeedback] = useState<string>("");

  const uploadsQuery = useQuery({
    queryKey: ["uploads", selectedShopId],
    queryFn: () => apiGet<Upload[]>("/uploads", { query: { shopId: selectedShopId ?? undefined } }),
    enabled: selectedShopId !== null,
    refetchInterval: query => {
      const rows = query.state.data ?? [];
      const hasActiveUpload = rows.some(item => item.status === "queued" || item.status === "parsing" || item.status === "analyzing");
      return hasActiveUpload ? 2000 : false;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedShopId) {
        throw new Error("请先选择店铺");
      }

      if (!selectedFile) {
        throw new Error("请先选择文件");
      }

      const formData = new FormData();
      formData.append("shopId", String(selectedShopId));
      formData.append("file", selectedFile);
      return apiPost<{ uploadId: number }, FormData>("/uploads", formData);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["uploads", selectedShopId] });
      setSelectedFile(null);
      setFeedback("文件已加入处理队列，下面会持续刷新进度。");
    },
    onError: error => {
      setFeedback(getErrorMessage(error));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (uploadId: number) => apiDelete<{ id: number; deleted: true }>(`/uploads/${uploadId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["uploads", selectedShopId] });
      setFeedback("上传批次已删除。");
    },
    onError: error => {
      setFeedback(getErrorMessage(error));
    },
  });

  const uploads = useMemo(() => uploadsQuery.data ?? [], [uploadsQuery.data]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
  }

  if (!selectedShop) {
    return (
      <EmptyShopState
        kicker="Uploads"
        title="先选择店铺"
        body="上传批次必须明确归属店铺。选中店铺后，这里会把 Excel 上传、处理进度和历史记录串起来。"
      />
    );
  }

  return (
    <section className="stack-lg">
      <div className="split-panel split-panel--balanced">
        <section className="surface panel-card">
          <span className="eyebrow">Upload Batch</span>
          <h3>上传评论 Excel</h3>
          <p>当前店铺：{selectedShop.name}。上传后会自动进入队列，经历解析、写入、痛点分析三个阶段。系统会按文件内容校验，同一店铺重复上传完全相同的 Excel 会被拦截。</p>

          <label className="upload-dropzone">
            <input className="sr-only" type="file" accept=".xlsx,.xls" onChange={handleFileChange} />
            <span className="eyebrow">Excel File</span>
            <strong>{selectedFile ? selectedFile.name : "点击选择评论 Excel 文件"}</strong>
            <p>支持从抖店后台手动导出的评论表，推荐一次上传一个批次。</p>
          </label>

          <div className="button-row">
            <button
              className="button"
              type="button"
              disabled={uploadMutation.isPending || !selectedFile}
              onClick={() => {
                setFeedback("");
                void uploadMutation.mutateAsync();
              }}
            >
              {uploadMutation.isPending ? "上传中..." : "开始上传"}
            </button>
            <button
              className="button button--ghost"
              type="button"
              onClick={() => {
                setSelectedFile(null);
                setFeedback("");
              }}
            >
              清空文件
            </button>
          </div>

          {feedback ? <p className="feedback-text">{feedback}</p> : null}
        </section>

        <section className="surface panel-card">
          <span className="eyebrow">History</span>
          <h3>上传批次历史</h3>
          <div className="list-stack">
            {uploads.length > 0 ? (
              uploads.map(upload => {
                const progress = upload.progressTotal > 0
                  ? `${upload.progressCurrent}/${upload.progressTotal}`
                  : upload.rowCount
                    ? `0/${upload.rowCount}`
                    : "等待解析";

                return (
                  <article key={upload.id} className="list-row list-row--card list-row--tall">
                    <div>
                      <div className="row-heading">
                        <strong>{upload.originalFilename}</strong>
                        <span className={`pill pill--status-${upload.status}`}>{upload.status}</span>
                      </div>
                      <p>创建时间：{formatTimestamp(upload.createdAt)}</p>
                      <p>处理进度：{progress}</p>
                      <p>完成时间：{formatTimestamp(upload.finishedAt)}</p>
                      {upload.error ? <p>错误：{upload.error}</p> : null}
                    </div>

                    <div className="button-row button-row--tight">
                      <button
                        className="button button--ghost"
                        type="button"
                        disabled={deleteMutation.isPending}
                        onClick={() => {
                          const shouldDelete = window.confirm(`确认删除批次「${upload.originalFilename}」吗？`);
                          if (!shouldDelete) {
                            return;
                          }
                          void deleteMutation.mutateAsync(upload.id);
                        }}
                      >
                        删除批次
                      </button>
                    </div>
                  </article>
                );
              })
            ) : (
              <p>还没有上传记录。上传第一份 Excel 后，这里会显示处理状态和历史批次。</p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
