import { useMemo, useState, type FormEvent, type ReactElement } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Shop, ShopInput } from "@shared/types";
import { apiDelete, apiGet, apiPatch, apiPost, ApiRequestError } from "@/api/client";
import { useShop } from "@/hooks/useShop";

interface ShopFormState {
  name: string;
  doudianShopId: string;
  description: string;
}

const EMPTY_FORM: ShopFormState = {
  name: "",
  doudianShopId: "",
  description: "",
};

function toPayload(form: ShopFormState): ShopInput {
  return {
    name: form.name,
    doudianShopId: form.doudianShopId,
    description: form.description,
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    return error.message;
  }

  return "操作失败，请稍后重试。";
}

export function ShopsPage(): ReactElement {
  const queryClient = useQueryClient();
  const { selectedShopId, setSelectedShopId } = useShop();
  const [form, setForm] = useState<ShopFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string>("");

  const shopsQuery = useQuery({
    queryKey: ["shops"],
    queryFn: () => apiGet<Shop[]>("/shops"),
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: ShopInput) => {
      if (editingId) {
        return apiPatch<Shop, Partial<ShopInput>>(`/shops/${editingId}`, payload);
      }

      return apiPost<Shop, ShopInput>("/shops", payload);
    },
    onSuccess: async nextShop => {
      await queryClient.invalidateQueries({ queryKey: ["shops"] });
      if (!selectedShopId) {
        setSelectedShopId(nextShop.id);
      }
      setEditingId(null);
      setForm(EMPTY_FORM);
      setFeedback(editingId ? "店铺信息已更新。" : "新店铺已创建。");
    },
    onError: error => {
      setFeedback(getErrorMessage(error));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (shopId: number) => apiDelete<{ id: number; deleted: true }>(`/shops/${shopId}`),
    onSuccess: async (_result, shopId) => {
      await queryClient.invalidateQueries({ queryKey: ["shops"] });
      if (selectedShopId === shopId) {
        const remaining = (shopsQuery.data ?? []).filter(shop => shop.id !== shopId);
        setSelectedShopId(remaining[0]?.id ?? null);
      }
      if (editingId === shopId) {
        setEditingId(null);
        setForm(EMPTY_FORM);
      }
      setFeedback("店铺已删除。");
    },
    onError: error => {
      setFeedback(getErrorMessage(error));
    },
  });

  const sortedShops = useMemo(() => shopsQuery.data ?? [], [shopsQuery.data]);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setFeedback("");
    void saveMutation.mutateAsync(toPayload(form));
  }

  return (
    <section className="stack-lg">
      <div className="split-panel split-panel--balanced">
        <section className="surface panel-card">
          <span className="eyebrow">Shop Form</span>
          <h3>{editingId ? "编辑店铺" : "新建店铺"}</h3>
          <p>多店铺数据会严格按店铺隔离，上传时也必须选择归属店铺。</p>

          <form className="form-grid" onSubmit={handleSubmit}>
            <label className="field-group field-span-2">
              <span>店铺名称</span>
              <input
                className="input"
                value={form.name}
                onChange={event => setForm(current => ({ ...current, name: event.target.value }))}
                placeholder="例如：南婆余味"
              />
            </label>

            <label className="field-group">
              <span>抖店店铺 ID</span>
              <input
                className="input"
                value={form.doudianShopId}
                onChange={event => setForm(current => ({ ...current, doudianShopId: event.target.value }))}
                placeholder="可选"
              />
            </label>

            <label className="field-group field-span-2">
              <span>备注</span>
              <textarea
                className="input textarea"
                value={form.description}
                onChange={event => setForm(current => ({ ...current, description: event.target.value }))}
                placeholder="写点关于这个店铺的说明，比如品类、定位或数据来源。"
              />
            </label>

            <div className="button-row field-span-2">
              <button className="button" type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "保存中..." : editingId ? "保存修改" : "创建店铺"}
              </button>
              <button
                className="button button--ghost"
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setForm(EMPTY_FORM);
                  setFeedback("");
                }}
              >
                清空表单
              </button>
            </div>
          </form>

          {feedback ? <p className="feedback-text">{feedback}</p> : null}
        </section>

        <section className="surface panel-card">
          <span className="eyebrow">Shops</span>
          <h3>店铺列表</h3>
          <div className="list-stack">
            {sortedShops.length > 0 ? (
              sortedShops.map(shop => (
                <article key={shop.id} className="list-row list-row--card">
                  <div>
                    <div className="row-heading">
                      <strong>{shop.name}</strong>
                      {selectedShopId === shop.id ? <span className="pill pill--accent">当前</span> : null}
                    </div>
                    <p>ID: {shop.doudianShopId || "未填写"}</p>
                    <p>{shop.description || "暂无备注"}</p>
                  </div>

                  <div className="button-row button-row--tight">
                    <button className="button button--ghost" type="button" onClick={() => setSelectedShopId(shop.id)}>
                      选中
                    </button>
                    <button
                      className="button button--ghost"
                      type="button"
                      onClick={() => {
                        setEditingId(shop.id);
                        setForm({
                          name: shop.name,
                          doudianShopId: shop.doudianShopId ?? "",
                          description: shop.description ?? "",
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
                        const shouldDelete = window.confirm(`确认删除店铺「${shop.name}」吗？`);
                        if (!shouldDelete) {
                          return;
                        }
                        void deleteMutation.mutateAsync(shop.id);
                      }}
                    >
                      删除
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <p>还没有店铺，先创建一个店铺作为上传评论的归属目标。</p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
