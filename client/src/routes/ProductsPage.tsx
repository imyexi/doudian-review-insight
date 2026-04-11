import { useMemo, useState, type ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProductInput } from "@shared/types";
import { apiDelete, apiGet, apiPatch, apiPost, ApiRequestError } from "@/api/client";
import { EmptyShopState } from "@/components/EmptyShopState";
import { useShop } from "@/hooks/useShop";
import { formatTimestamp } from "@/lib/format";

interface ProductListItem {
  id: number;
  shopId: number;
  doudianProductId: string;
  displayName: string | null;
  rawName: string | null;
  category: string | null;
  notes: string | null;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  latestReviewTime: number | null;
  painPointCount: number;
}

interface ProductFormState {
  doudianProductId: string;
  displayName: string;
  rawName: string;
  category: string;
  notes: string;
  enabled: boolean;
}

const EMPTY_PRODUCT_FORM: ProductFormState = {
  doudianProductId: "",
  displayName: "",
  rawName: "",
  category: "",
  notes: "",
  enabled: true,
};

function toPayload(form: ProductFormState): ProductInput {
  return {
    doudianProductId: form.doudianProductId,
    displayName: form.displayName,
    rawName: form.rawName,
    category: form.category,
    notes: form.notes,
    enabled: form.enabled,
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return error.message;
  }

  return "操作失败，请稍后重试。";
}

export function ProductsPage(): ReactElement {
  const queryClient = useQueryClient();
  const { selectedShop, selectedShopId } = useShop();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ProductFormState>(EMPTY_PRODUCT_FORM);
  const [feedback, setFeedback] = useState<string>("");

  const productsQuery = useQuery({
    queryKey: ["products", selectedShopId],
    queryFn: () => apiGet<ProductListItem[]>(`/shops/${selectedShopId}/products`),
    enabled: selectedShopId !== null,
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: ProductInput) => {
      if (!selectedShopId) {
        throw new Error("请先选择店铺");
      }

      if (editingId) {
        return apiPatch<ProductListItem, Partial<ProductInput>>(`/shops/${selectedShopId}/products/${editingId}`, payload);
      }

      return apiPost<ProductListItem, ProductInput>(`/shops/${selectedShopId}/products`, payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["products", selectedShopId] });
      setEditingId(null);
      setForm(EMPTY_PRODUCT_FORM);
      setFeedback(editingId ? "商品信息已更新。" : "商品已创建。");
    },
    onError: error => {
      setFeedback(getErrorMessage(error));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (productId: number) => {
      if (!selectedShopId) {
        throw new Error("请先选择店铺");
      }

      return apiDelete<{ id: number; deleted: true }>(`/shops/${selectedShopId}/products/${productId}`);
    },
    onSuccess: async deletedId => {
      await queryClient.invalidateQueries({ queryKey: ["products", selectedShopId] });
      if (editingId === deletedId.id) {
        setEditingId(null);
        setForm(EMPTY_PRODUCT_FORM);
      }
      setFeedback("商品已删除。");
    },
    onError: error => {
      setFeedback(getErrorMessage(error));
    },
  });

  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);

  if (!selectedShop) {
    return (
      <EmptyShopState
        kicker="Products"
        title="先选择店铺"
        body="商品维护以店铺为单位，选择店铺后这里会展示自动登记的商品和你手工补充的别名、分类、备注。"
      />
    );
  }

  return (
    <section className="stack-lg">
      <div className="split-panel split-panel--balanced">
        <section className="surface panel-card">
          <span className="eyebrow">Product Form</span>
          <h3>{editingId ? "编辑商品" : `为 ${selectedShop.name} 添加商品`}</h3>
          <p>通常上传评论后会自动登记商品，你也可以提前手动补充商品别名、分类和备注。</p>

          <div className="form-grid">
            <label className="field-group">
              <span>商品 ID</span>
              <input
                className="input"
                value={form.doudianProductId}
                onChange={event => setForm(current => ({ ...current, doudianProductId: event.target.value }))}
                placeholder="抖店商品 ID"
              />
            </label>

            <label className="field-group">
              <span>显示名</span>
              <input
                className="input"
                value={form.displayName}
                onChange={event => setForm(current => ({ ...current, displayName: event.target.value }))}
                placeholder="更短、更好认的名字"
              />
            </label>

            <label className="field-group field-span-2">
              <span>原始名称</span>
              <input
                className="input"
                value={form.rawName}
                onChange={event => setForm(current => ({ ...current, rawName: event.target.value }))}
                placeholder="最近一次上传里出现的原始商品名"
              />
            </label>

            <label className="field-group">
              <span>分类</span>
              <input
                className="input"
                value={form.category}
                onChange={event => setForm(current => ({ ...current, category: event.target.value }))}
                placeholder="例如：零食 / 配件 / 套装"
              />
            </label>

            <label className="field-group field-span-2">
              <span>备注</span>
              <textarea
                className="input textarea"
                value={form.notes}
                onChange={event => setForm(current => ({ ...current, notes: event.target.value }))}
                placeholder="可写规格、供货信息或人工观察。"
              />
            </label>

            <label className="toggle-row field-span-2">
              <input
                checked={form.enabled}
                type="checkbox"
                onChange={event => setForm(current => ({ ...current, enabled: event.target.checked }))}
              />
              <span>启用该商品参与后续分析</span>
            </label>

            <div className="button-row field-span-2">
              <button
                className="button"
                type="button"
                disabled={saveMutation.isPending}
                onClick={() => {
                  setFeedback("");
                  void saveMutation.mutateAsync(toPayload(form));
                }}
              >
                {saveMutation.isPending ? "保存中..." : editingId ? "保存修改" : "新增商品"}
              </button>
              <button
                className="button button--ghost"
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setForm(EMPTY_PRODUCT_FORM);
                  setFeedback("");
                }}
              >
                清空表单
              </button>
            </div>
          </div>

          {feedback ? <p className="feedback-text">{feedback}</p> : null}
        </section>

        <section className="surface panel-card">
          <span className="eyebrow">Catalog</span>
          <h3>商品清单</h3>
          <div className="list-stack">
            {products.length > 0 ? (
              products.map(product => (
                <article key={product.id} className="list-row list-row--card list-row--tall">
                  <div>
                    <div className="row-heading">
                      <strong>{product.displayName || product.rawName || product.doudianProductId}</strong>
                      <span className={product.enabled ? "pill pill--success" : "pill"}>{product.enabled ? "启用" : "停用"}</span>
                    </div>
                    <p>商品 ID：{product.doudianProductId}</p>
                    <p>分类：{product.category || "未分类"}</p>
                    <p>最近评论：{formatTimestamp(product.latestReviewTime)}</p>
                    <p>痛点数：{product.painPointCount}</p>
                  </div>

                  <div className="button-row button-row--tight">
                    <button
                      className="button button--ghost"
                      type="button"
                      onClick={() => {
                        setEditingId(product.id);
                        setForm({
                          doudianProductId: product.doudianProductId,
                          displayName: product.displayName ?? "",
                          rawName: product.rawName ?? "",
                          category: product.category ?? "",
                          notes: product.notes ?? "",
                          enabled: product.enabled,
                        });
                        setFeedback("");
                      }}
                    >
                      编辑
                    </button>
                    <button
                      className="button button--ghost"
                      type="button"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        const shouldDelete = window.confirm(`确认删除商品「${product.displayName || product.doudianProductId}」吗？`);
                        if (!shouldDelete) {
                          return;
                        }
                        void deleteMutation.mutateAsync(product.id);
                      }}
                    >
                      删除
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <p>这个店铺还没有商品。你可以手动添加，或先上传一份评论 Excel 让系统自动登记。</p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
