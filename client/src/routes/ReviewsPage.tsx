import { useEffect, useMemo, useState, type ChangeEvent, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import type { PainPoint, Product, ProductGroup, Review, ReviewListResponse } from "@shared/types";
import { apiGet } from "@/api/client";
import { EmptyShopState } from "@/components/EmptyShopState";
import { useShop } from "@/hooks/useShop";
import { formatTimestamp } from "@/lib/format";

const PAGE_SIZE = 20;

type ProductGroupFilterValue = "all" | number;
type RatingFilterValue = "all" | number;

function getReviewText(review: Review): string {
  return review.content || review.appendContent || "这条评论没有可展示的正文。";
}

function getProductDisplayLabel(product: Product): string {
  return product.displayName || product.rawName || product.doudianProductId;
}

function getProductGroupLabel(productGroup: ProductGroup): string {
  return productGroup.name;
}

function getPainPointOptionLabel(painPoint: PainPoint, products: Product[]): string {
  if (painPoint.productGroup) {
    return `${painPoint.canonicalLabel} · ${painPoint.productGroup.name}`;
  }

  if (painPoint.productRefId === null) {
    return `${painPoint.canonicalLabel} · 店铺级`;
  }

  const product = products.find(item => item.id === painPoint.productRefId);
  const productLabel = product ? getProductDisplayLabel(product) : `商品 #${painPoint.productRefId}`;

  return `${painPoint.canonicalLabel} · ${productLabel}`;
}

export function ReviewsPage(): ReactElement {
  const { selectedShop, selectedShopId } = useShop();
  const [page, setPage] = useState<number>(1);
  const [search, setSearch] = useState<string>("");
  const [spec, setSpec] = useState<string>("");
  const [selectedProductGroupId, setSelectedProductGroupId] = useState<ProductGroupFilterValue>("all");
  const [selectedPainPointId, setSelectedPainPointId] = useState<number | null>(null);
  const [selectedRating, setSelectedRating] = useState<RatingFilterValue>("all");

  const productsQuery = useQuery({
    queryKey: ["products", selectedShopId],
    queryFn: () => apiGet<Product[]>(`/shops/${selectedShopId}/products`),
    enabled: selectedShopId !== null,
  });

  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);
  const productGroups = useMemo<ProductGroup[]>(() => {
    const groupsById = products.reduce<Map<number, ProductGroup>>((current, product) => {
      if (!product.productGroup) {
        return current;
      }

      return new Map(current).set(product.productGroup.id, product.productGroup);
    }, new Map<number, ProductGroup>());

    return Array.from(groupsById.values()).sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  }, [products]);

  const painPointsQuery = useQuery({
    queryKey: ["pain-points", "review-filters", selectedShopId, selectedProductGroupId],
    queryFn: () =>
      apiGet<PainPoint[]>("/pain-points", {
        query: {
          shopId: selectedShopId ?? undefined,
          mode: "historical",
          productGroupId: selectedProductGroupId === "all" ? undefined : selectedProductGroupId,
        },
      }),
    enabled: selectedShopId !== null,
  });

  const reviewsQuery = useQuery({
    queryKey: ["reviews", selectedShopId, page, search, spec, selectedProductGroupId, selectedPainPointId, selectedRating],
    queryFn: () =>
      apiGet<ReviewListResponse>("/reviews", {
        query: {
          shopId: selectedShopId ?? undefined,
          page,
          pageSize: PAGE_SIZE,
          q: search || undefined,
          spec: spec || undefined,
          productGroupId: selectedProductGroupId === "all" ? undefined : selectedProductGroupId,
          painPointId: selectedPainPointId ?? undefined,
          rating: selectedRating === "all" ? undefined : selectedRating,
        },
      }),
    enabled: selectedShopId !== null,
  });

  const painPoints = useMemo(() => painPointsQuery.data ?? [], [painPointsQuery.data]);
  const reviewRows = useMemo(() => reviewsQuery.data?.items ?? [], [reviewsQuery.data]);
  const total = reviewsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const selectedProductGroup = useMemo(
    () => (selectedProductGroupId === "all" ? null : productGroups.find(group => group.id === selectedProductGroupId) ?? null),
    [productGroups, selectedProductGroupId],
  );
  const selectedPainPoint = useMemo(
    () => (selectedPainPointId === null ? null : painPoints.find(item => item.id === selectedPainPointId) ?? null),
    [painPoints, selectedPainPointId],
  );

  useEffect(() => {
    if (selectedPainPointId === null) {
      return;
    }

    const stillAvailable = painPoints.some(item => item.id === selectedPainPointId);
    if (!stillAvailable) {
      setSelectedPainPointId(null);
      setPage(1);
    }
  }, [painPoints, selectedPainPointId]);

  function resetPagination(): void {
    setPage(1);
  }

  function handleProductGroupChange(event: ChangeEvent<HTMLSelectElement>): void {
    const value = event.target.value;
    setSelectedProductGroupId(value ? Number(value) : "all");
    resetPagination();
  }

  function handlePainPointChange(event: ChangeEvent<HTMLSelectElement>): void {
    const value = event.target.value;
    setSelectedPainPointId(value ? Number(value) : null);
    resetPagination();
  }

  function handleRatingChange(event: ChangeEvent<HTMLSelectElement>): void {
    const value = event.target.value;
    setSelectedRating(value ? Number(value) : "all");
    resetPagination();
  }

  function resetFilters(): void {
    setPage(1);
    setSearch("");
    setSpec("");
    setSelectedProductGroupId("all");
    setSelectedPainPointId(null);
    setSelectedRating("all");
  }

  if (!selectedShop) {
    return (
      <EmptyShopState
        kicker="Reviews"
        title="先选择店铺"
        body="评论页会支持商品、规格、评分、关键词和痛点联动筛选，帮助你回看每条痛点背后的原始评论。"
      />
    );
  }

  return (
    <section className="stack-lg">
      <section className="surface panel-card stack-md">
        <div className="row-heading row-heading--spread">
          <div>
            <span className="eyebrow">Step 3</span>
            <h3>{selectedShop.name} 的原始评论核对</h3>
          </div>
          <div className="button-row button-row--tight">
            <Link className="button button--ghost" href="/uploads">
              返回上传
            </Link>
            <Link className="button button--ghost" href="/pain-points">
              返回痛点
            </Link>
          </div>
        </div>
        <p>这里用于核对痛点背后的原话、追评、评分和规格证据。先从痛点页锁定问题，再在这里按商品组、痛点和关键词继续下钻。</p>
      </section>

      <section className="surface panel-card">
        <div className="row-heading row-heading--spread">
          <div>
            <span className="eyebrow">Review Filters</span>
            <h3>按商品组、痛点和关键词筛选评论</h3>
          </div>
          <div className="button-row button-row--tight">
            <button className="button button--ghost" type="button" onClick={resetFilters}>
              重置筛选
            </button>
            <span className="pill pill--accent">共 {total} 条</span>
          </div>
        </div>

        <div className="filter-grid filter-grid--three">
          <label className="field-group">
            <span>商品组</span>
            <select className="input" value={selectedProductGroupId === "all" ? "" : selectedProductGroupId} onChange={handleProductGroupChange}>
              <option value="">全部商品组</option>
              {productGroups.map(group => (
                <option key={group.id} value={group.id}>
                  {getProductGroupLabel(group)}
                </option>
              ))}
            </select>
          </label>

          <label className="field-group">
            <span>痛点</span>
            <select className="input" value={selectedPainPointId ?? ""} onChange={handlePainPointChange}>
              <option value="">{selectedProductGroupId === "all" ? "全部痛点" : "该商品组全部痛点"}</option>
              {painPoints.map(item => (
                <option key={item.id} value={item.id}>
                  {getPainPointOptionLabel(item, products)}
                </option>
              ))}
            </select>
          </label>

          <label className="field-group">
            <span>评分</span>
            <select className="input" value={selectedRating === "all" ? "" : selectedRating} onChange={handleRatingChange}>
              <option value="">全部评分</option>
              {[1, 2, 3, 4, 5].map(item => (
                <option key={item} value={item}>
                  {item} 星
                </option>
              ))}
            </select>
          </label>

          <label className="field-group">
            <span>规格关键词</span>
            <input
              className="input"
              value={spec}
              onChange={event => {
                setSpec(event.target.value);
                resetPagination();
              }}
              placeholder="例如：500g / 大份 / 香葱味"
            />
          </label>

          <label className="field-group field-span-2">
            <span>正文关键词</span>
            <input
              className="input"
              value={search}
              onChange={event => {
                setSearch(event.target.value);
                resetPagination();
              }}
              placeholder="例如：碎了 / 太硬 / 发货慢 / 不会回购"
            />
          </label>
        </div>
      </section>

      <div className="split-panel split-panel--balanced split-panel--top">
        <section className="surface panel-card">
          <div className="row-heading row-heading--spread">
            <div>
              <span className="eyebrow">Review Stream</span>
              <h3>评论明细</h3>
            </div>
            <span className="pill">第 {page} / {totalPages} 页</span>
          </div>
          <div className="list-stack">
            {reviewRows.length > 0 ? (
              reviewRows.map(review => (
                <article key={review.id} className="list-row list-row--card list-row--tall">
                  <div className="stack-sm">
                    <div className="row-heading row-heading--spread">
                      <strong>{review.productName || review.doudianProductId}</strong>
                      <div className="button-row button-row--tight">
                        {review.rating ? <span className="pill pill--accent">{review.rating} 星</span> : null}
                        {review.level ? <span className="pill">{review.level}</span> : null}
                      </div>
                    </div>
                    <p>规格：{review.productSpec || "未标注"}</p>
                    <p>评论时间：{formatTimestamp(review.reviewTime)}</p>
                    <p>订单号：{review.doudianOrderId || "未记录"}</p>
                    <blockquote className="review-card">{getReviewText(review)}</blockquote>
                    {review.appendContent ? <p>追评：{review.appendContent}</p> : null}
                    {review.replyContent ? <p>商家回复：{review.replyContent}</p> : null}
                  </div>
                </article>
              ))
            ) : (
              <p>当前筛选下没有评论结果，可以放宽商品、痛点、评分或关键词条件。</p>
            )}
          </div>

          <div className="pagination-row pagination-row--between">
            <p className="pagination-meta">共 {total} 条评论 · 每页 {PAGE_SIZE} 条</p>
            <div className="button-row button-row--tight">
              <button className="button button--ghost" type="button" disabled={page <= 1} onClick={() => setPage(current => Math.max(1, current - 1))}>
                上一页
              </button>
              <button
                className="button"
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage(current => Math.min(totalPages, current + 1))}
              >
                下一页
              </button>
            </div>
          </div>
        </section>

        <section className="surface panel-card">
          <span className="eyebrow">Quick Summary</span>
          <h3>当前下钻范围</h3>
          <div className="list-stack">
            <div className="list-row">
              <div>
                <strong>选中商品组</strong>
                <p>
                  {selectedProductGroupId === "all"
                    ? "全部商品组"
                    : selectedProductGroup
                      ? getProductGroupLabel(selectedProductGroup)
                      : "已删除商品组"}
                </p>
              </div>
            </div>
            <div className="list-row">
              <div>
                <strong>关联痛点</strong>
                <p>
                  {selectedPainPoint
                    ? getPainPointOptionLabel(selectedPainPoint, products)
                    : selectedProductGroupId === "all"
                      ? "全部痛点"
                      : "当前商品组的全部痛点"}
                </p>
              </div>
            </div>
            <div className="list-row">
              <div>
                <strong>评分范围</strong>
                <p>{selectedRating === "all" ? "全部评分" : `${selectedRating} 星`}</p>
              </div>
            </div>
            <div className="list-row">
              <div>
                <strong>分页信息</strong>
                <p>
                  当前第 {page} / {totalPages} 页 · 共 {total} 条
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
