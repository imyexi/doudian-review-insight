import { useMemo, useState, type ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Product, ProductGroup, ProductInput, ProductRegroupInput } from "@shared/types";
import { apiDelete, apiGet, apiPatch, apiPost, getRequestErrorMessage } from "@/api/client";
import { EmptyShopState } from "@/components/EmptyShopState";
import { useShop } from "@/hooks/useShop";
import { formatTimestamp } from "@/lib/format";

interface ProductGroupListItem extends ProductGroup {
  productCount: number;
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

function getProductDisplayLabel(product: Product): string {
  return product.displayName || product.rawName || product.doudianProductId;
}

function getProductGroupLabel(group: Pick<ProductGroup, "name" | "shortName"> | null | undefined): string {
  if (!group) {
    return "未归组";
  }

  return group.name === group.shortName ? group.name : `${group.name} · ${group.shortName}`;
}

function getClassificationSourceLabel(product: Pick<Product, "classificationSource" | "classificationLocked">): string {
  if (product.classificationSource === "manual") {
    return "人工改组";
  }

  if (product.classificationLocked) {
    return "已锁定";
  }

  return "自动归组";
}

function getLlmExtractedName(product: Pick<Product, "llmExtractedName" | "shortName">): string | null {
  if (!product.llmExtractedName) {
    return null;
  }

  if (product.llmExtractedName === product.shortName) {
    return null;
  }

  return product.llmExtractedName;
}

export function ProductsPage(): ReactElement {
  const queryClient = useQueryClient();
  const { selectedShop, selectedShopId } = useShop();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ProductFormState>(EMPTY_PRODUCT_FORM);
  const [regroupTargetId, setRegroupTargetId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string>("");

  const productsQuery = useQuery({
    queryKey: ["products", selectedShopId],
    queryFn: () => apiGet<Product[]>(`/shops/${selectedShopId}/products`),
    enabled: selectedShopId !== null,
  });

  const productGroupsQuery = useQuery({
    queryKey: ["product-groups", selectedShopId],
    queryFn: () => apiGet<ProductGroupListItem[]>(`/shops/${selectedShopId}/products/groups`),
    enabled: selectedShopId !== null,
  });

  async function invalidateProductQueries(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["products", selectedShopId] }),
      queryClient.invalidateQueries({ queryKey: ["product-groups", selectedShopId] }),
    ]);
  }

  async function invalidateAnalyticsQueries(): Promise<void> {
    if (selectedShopId === null) {
      return;
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["pain-points", selectedShopId] }),
      queryClient.invalidateQueries({ queryKey: ["pain-points", "noteworthy", selectedShopId] }),
      queryClient.invalidateQueries({ queryKey: ["pain-points", "review-filters", selectedShopId] }),
      queryClient.invalidateQueries({ queryKey: ["reviews", selectedShopId] }),
      queryClient.invalidateQueries({ queryKey: ["stats", selectedShopId] }),
    ]);
  }

  function resetEditor(): void {
    setEditingId(null);
    setForm(EMPTY_PRODUCT_FORM);
    setRegroupTargetId(null);
  }

  function beginEditing(product: Product): void {
    setEditingId(product.id);
    setForm({
      doudianProductId: product.doudianProductId,
      displayName: product.displayName ?? "",
      rawName: product.rawName ?? "",
      category: product.category ?? "",
      notes: product.notes ?? "",
      enabled: product.enabled,
    });
    setRegroupTargetId(product.productGroupId);
    setFeedback("");
  }

  const saveMutation = useMutation({
    mutationFn: async (payload: ProductInput) => {
      if (!selectedShopId) {
        throw new Error("请先选择店铺");
      }

      if (editingId) {
        return apiPatch<Product, Partial<ProductInput>>(`/shops/${selectedShopId}/products/${editingId}`, payload);
      }

      return apiPost<Product, ProductInput>(`/shops/${selectedShopId}/products`, payload);
    },
    onSuccess: async () => {
      await invalidateProductQueries();
      resetEditor();
      setFeedback(editingId ? "商品信息已更新。" : "商品已创建，并已按短名称自动归组。");
    },
    onError: error => {
      setFeedback(getRequestErrorMessage(error, "操作失败，请稍后重试。"));
    },
  });

  const regroupMutation = useMutation({
    mutationFn: async (payload: ProductRegroupInput) => {
      if (!selectedShopId || !editingId) {
        throw new Error("请先选择要调整归组的商品");
      }

      return apiPatch<Product, ProductRegroupInput>(`/shops/${selectedShopId}/products/${editingId}/regroup`, payload);
    },
    onSuccess: async updatedProduct => {
      await invalidateProductQueries();
      await invalidateAnalyticsQueries();
      setRegroupTargetId(updatedProduct.productGroupId);
      setFeedback(`商品已改到“${getProductGroupLabel(updatedProduct.productGroup)}”，历史痛点与评论归属已重算。`);
    },
    onError: error => {
      setFeedback(getRequestErrorMessage(error, "改组失败，请稍后重试。"));
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
      await invalidateProductQueries();
      await invalidateAnalyticsQueries();
      if (editingId === deletedId.id) {
        resetEditor();
      }
      setFeedback("商品已删除。");
    },
    onError: error => {
      setFeedback(getRequestErrorMessage(error, "删除失败，请稍后重试。"));
    },
  });

  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);
  const productGroups = useMemo(() => productGroupsQuery.data ?? [], [productGroupsQuery.data]);
  const editingProduct = useMemo(
    () => (editingId === null ? null : products.find(product => product.id === editingId) ?? null),
    [editingId, products],
  );
  const canSubmitRegroup =
    editingProduct !== null &&
    regroupTargetId !== null &&
    regroupTargetId !== editingProduct.productGroupId &&
    !regroupMutation.isPending;

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
          <p>通常上传评论后会自动登记商品；进入编辑后，你也可以查看短名称、当前商品组，并手动改到已有组。</p>

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

            {editingProduct ? (
              <div className="field-span-2 stack-sm">
                <div className="row-heading row-heading--spread">
                  <strong>当前归组信息</strong>
                  <span className="pill pill--accent">{getClassificationSourceLabel(editingProduct)}</span>
                </div>
                <p>短名称：{editingProduct.shortName || "未提取"}</p>
                {getLlmExtractedName(editingProduct) ? <p>LLM 提取名：{getLlmExtractedName(editingProduct)}</p> : null}
                <p>当前商品组：{getProductGroupLabel(editingProduct.productGroup)}</p>
                <p>{editingProduct.classificationLocked ? "该商品已锁定到人工指定分组。" : "该商品会随原始名称变化自动重新匹配商品组。"}</p>

                <label className="field-group">
                  <span>改到已有商品组</span>
                  <select
                    className="input"
                    value={regroupTargetId ?? ""}
                    onChange={event => setRegroupTargetId(event.target.value ? Number(event.target.value) : null)}
                  >
                    <option value="">请选择商品组</option>
                    {productGroups.map(group => (
                      <option key={group.id} value={group.id}>
                        {getProductGroupLabel(group)} · {group.productCount} 个商品 · {group.painPointCount} 个痛点
                      </option>
                    ))}
                  </select>
                </label>

                <div className="button-row button-row--tight">
                  <button
                    className="button button--ghost"
                    type="button"
                    disabled={!canSubmitRegroup}
                    onClick={() => {
                      if (regroupTargetId === null) {
                        return;
                      }

                      setFeedback("");
                      void regroupMutation.mutateAsync({ productGroupId: regroupTargetId });
                    }}
                  >
                    {regroupMutation.isPending ? "改组中..." : "应用归组"}
                  </button>
                  <span>{productGroups.length > 0 ? "改组后会立即重算受影响商品组的历史痛点。" : "当前还没有可选商品组。"}</span>
                </div>
              </div>
            ) : (
              <div className="field-span-2 stack-sm">
                <strong>自动归组说明</strong>
                <p>新商品保存后会根据原始名称自动提取短名称，并复用店铺内已有商品组；匹配不到时会自动建组。</p>
              </div>
            )}

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
                  resetEditor();
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
                  <div className="stack-sm">
                    <div className="row-heading row-heading--spread">
                      <strong>{getProductDisplayLabel(product)}</strong>
                      <div className="button-row button-row--tight">
                        <span className={product.enabled ? "pill pill--success" : "pill"}>{product.enabled ? "启用" : "停用"}</span>
                        <span className="pill pill--accent">{getClassificationSourceLabel(product)}</span>
                      </div>
                    </div>
                    <p>商品 ID：{product.doudianProductId}</p>
                    <p>短名称：{product.shortName || "未提取"}</p>
                    {getLlmExtractedName(product) ? <p>LLM 提取名：{getLlmExtractedName(product)}</p> : null}
                    <p>商品组：{getProductGroupLabel(product.productGroup)}</p>
                    <p>分类：{product.category || "未分类"}</p>
                    <p>最近评论：{formatTimestamp(product.latestReviewTime)}</p>
                    <p>痛点数：{product.painPointCount}</p>
                  </div>

                  <div className="button-row button-row--tight">
                    <button className="button button--ghost" type="button" onClick={() => beginEditing(product)}>
                      {editingId === product.id ? "正在编辑" : "编辑 / 改组"}
                    </button>
                    <button
                      className="button button--ghost"
                      type="button"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        const shouldDelete = window.confirm(`确认删除商品「${getProductDisplayLabel(product)}」吗？`);
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
