import { useEffect, useMemo, useState, type ChangeEvent, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  OverviewStats,
  PainPoint,
  PainPointCategory,
  PainPointEvidence,
  PainPointMode,
  Product,
  SpecStat,
} from "@shared/types";
import { apiGet } from "@/api/client";
import { EmptyShopState } from "@/components/EmptyShopState";
import { useShop } from "@/hooks/useShop";
import { formatTimestamp } from "@/lib/format";

const PAIN_POINT_CATEGORIES: PainPointCategory[] = ["质量", "物流", "款式外观", "客服", "价格", "使用体验", "其他"];

type ProductFilterValue = "all" | number;

interface CategorySummaryItem {
  category: PainPointCategory;
  count: number;
}

interface TimelineItem {
  count: number;
  dateKey: string;
}

function getEvidenceText(evidence: PainPointEvidence): string {
  return evidence.excerpt || evidence.review?.content || evidence.review?.appendContent || "暂无代表评论摘录。";
}

export function PainPointsPage(): ReactElement {
  const { selectedShop, selectedShopId } = useShop();
  const [mode, setMode] = useState<PainPointMode>("historical");
  const [search, setSearch] = useState<string>("");
  const [selectedCategories, setSelectedCategories] = useState<PainPointCategory[]>([]);
  const [selectedPainPointId, setSelectedPainPointId] = useState<number | null>(null);
  const [selectedProductId, setSelectedProductId] = useState<ProductFilterValue>("all");

  const productsQuery = useQuery({
    queryKey: ["products", selectedShopId],
    queryFn: () => apiGet<Product[]>(`/shops/${selectedShopId}/products`),
    enabled: selectedShopId !== null,
  });

  const statsQuery = useQuery({
    queryKey: ["stats", selectedShopId],
    queryFn: () => apiGet<OverviewStats>("/stats/overview", { query: { shopId: selectedShopId ?? undefined } }),
    enabled: selectedShopId !== null,
  });

  const painPointsQuery = useQuery({
    queryKey: ["pain-points", selectedShopId, mode, selectedProductId, search, selectedCategories],
    queryFn: () =>
      apiGet<PainPoint[]>("/pain-points", {
        query: {
          shopId: selectedShopId ?? undefined,
          mode,
          productRefId: selectedProductId === "all" ? undefined : selectedProductId,
          category: selectedCategories,
          q: search || undefined,
        },
      }),
    enabled: selectedShopId !== null,
  });

  const evidenceQuery = useQuery({
    queryKey: ["pain-point-evidence", selectedPainPointId],
    queryFn: () => apiGet<PainPointEvidence[]>(`/pain-points/${selectedPainPointId}/evidence`),
    enabled: selectedPainPointId !== null,
  });

  const specStatsQuery = useQuery({
    queryKey: ["pain-point-spec-stats", selectedPainPointId],
    queryFn: () => apiGet<SpecStat[]>(`/pain-points/${selectedPainPointId}/spec-stats`),
    enabled: selectedPainPointId !== null,
  });

  const products = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);
  const painPoints = useMemo(() => painPointsQuery.data ?? [], [painPointsQuery.data]);
  const selectedPainPoint = useMemo(
    () => painPoints.find(item => item.id === selectedPainPointId) ?? painPoints[0] ?? null,
    [painPoints, selectedPainPointId],
  );
  const selectedEvidence = useMemo(() => evidenceQuery.data ?? selectedPainPoint?.topEvidence ?? [], [evidenceQuery.data, selectedPainPoint]);
  const specStats = useMemo(() => specStatsQuery.data ?? [], [specStatsQuery.data]);

  const categorySummary = useMemo<CategorySummaryItem[]>(() => {
    const counts = painPoints.reduce<Record<PainPointCategory, number>>(
      (current, item) => ({
        ...current,
        [item.category]: (current[item.category] ?? 0) + 1,
      }),
      {
        质量: 0,
        物流: 0,
        款式外观: 0,
        客服: 0,
        价格: 0,
        使用体验: 0,
        其他: 0,
      },
    );

    return PAIN_POINT_CATEGORIES.map(category => ({ category, count: counts[category] ?? 0 })).filter(item => item.count > 0);
  }, [painPoints]);

  const timeline = useMemo<TimelineItem[]>(() => {
    const counts = painPoints.reduce<Record<string, number>>((current, item) => {
      const dateKey = new Date(item.firstSeenAt * 1000).toISOString().slice(0, 10);
      return {
        ...current,
        [dateKey]: (current[dateKey] ?? 0) + 1,
      };
    }, {});

    return Object.entries(counts)
      .map(([dateKey, count]) => ({ dateKey, count }))
      .sort((left, right) => left.dateKey.localeCompare(right.dateKey))
      .slice(-8);
  }, [painPoints]);

  const maxCategoryCount = useMemo(() => Math.max(...categorySummary.map(item => item.count), 1), [categorySummary]);
  const maxTimelineCount = useMemo(() => Math.max(...timeline.map(item => item.count), 1), [timeline]);
  const maxSpecCount = useMemo(() => Math.max(...specStats.map(item => item.count), 1), [specStats]);

  useEffect(() => {
    if (selectedProductId === "all") {
      return;
    }

    const hasSelectedProduct = products.some(product => product.id === selectedProductId);
    if (!hasSelectedProduct) {
      setSelectedProductId("all");
    }
  }, [products, selectedProductId]);

  useEffect(() => {
    if (!selectedPainPoint) {
      if (selectedPainPointId !== null) {
        setSelectedPainPointId(null);
      }
      return;
    }

    if (selectedPainPoint.id !== selectedPainPointId) {
      setSelectedPainPointId(selectedPainPoint.id);
    }
  }, [selectedPainPoint, selectedPainPointId]);

  function handleProductChange(event: ChangeEvent<HTMLSelectElement>): void {
    const value = event.target.value;
    setSelectedProductId(value ? Number(value) : "all");
  }

  function toggleCategory(category: PainPointCategory): void {
    setSelectedCategories(current =>
      current.includes(category) ? current.filter(item => item !== category) : [...current, category],
    );
  }

  if (!selectedShop) {
    return (
      <EmptyShopState
        kicker="Pain Points"
        title="先选择店铺"
        body="痛点页会区分历史痛点与近 7 天新增痛点，并支持按商品、分类、关键词和规格证据来查看。"
      />
    );
  }

  const stats = statsQuery.data;

  return (
    <section className="stack-lg">
      <div className="dashboard-grid dashboard-grid--four">
        <article className="metric-card surface">
          <span>历史痛点</span>
          <strong>{stats?.painPoints.historical ?? painPoints.length}</strong>
          <p>该店铺当前累计识别出的活跃痛点条目。</p>
        </article>
        <article className="metric-card surface accent-card">
          <span>近 7 天新增</span>
          <strong>{stats?.painPoints.new7d ?? 0}</strong>
          <p>按评论首现时间判定，不受上传时间干扰。</p>
        </article>
        <article className="metric-card surface">
          <span>已登记商品</span>
          <strong>{products.length}</strong>
          <p>可按商品维度进一步筛选痛点与规格表现。</p>
        </article>
        <article className="metric-card surface">
          <span>当前筛出</span>
          <strong>{painPoints.length}</strong>
          <p>受模式、商品、分类和关键词筛选影响。</p>
        </article>
      </div>

      <section className="surface panel-card">
        <div className="row-heading row-heading--spread">
          <div>
            <span className="eyebrow">Filters</span>
            <h3>{selectedShop.name} 的痛点全景</h3>
          </div>
          <div className="segmented-control" role="tablist" aria-label="痛点模式">
            <button
              className={`segmented-control__item ${mode === "historical" ? "segmented-control__item--active" : ""}`}
              type="button"
              onClick={() => setMode("historical")}
            >
              历史痛点
            </button>
            <button
              className={`segmented-control__item ${mode === "new7d" ? "segmented-control__item--active" : ""}`}
              type="button"
              onClick={() => setMode("new7d")}
            >
              近 7 天新增
            </button>
          </div>
        </div>

        <div className="filter-grid filter-grid--three">
          <label className="field-group">
            <span>商品</span>
            <select className="input" value={selectedProductId === "all" ? "" : selectedProductId} onChange={handleProductChange}>
              <option value="">全部商品</option>
              {products.map(product => (
                <option key={product.id} value={product.id}>
                  {product.displayName || product.rawName || product.doudianProductId}
                </option>
              ))}
            </select>
          </label>

          <label className="field-group field-span-2">
            <span>搜索</span>
            <input
              className="input"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="按痛点标签或描述搜索，例如 包装 / 太硬 / 客服"
            />
          </label>
        </div>

        <div className="chip-row">
          {PAIN_POINT_CATEGORIES.map(category => {
            const isActive = selectedCategories.includes(category);
            return (
              <button
                key={category}
                className={`category-chip ${isActive ? "category-chip--active" : ""}`}
                type="button"
                onClick={() => toggleCategory(category)}
              >
                {category}
              </button>
            );
          })}
        </div>
      </section>

      <div className="split-panel split-panel--balanced split-panel--top">
        <section className="surface panel-card">
          <span className="eyebrow">Pain Point List</span>
          <h3>{mode === "historical" ? "历史痛点列表" : "近 7 天新增痛点"}</h3>
          <div className="list-stack">
            {painPoints.length > 0 ? (
              painPoints.map(item => {
                const isSelected = item.id === selectedPainPoint?.id;

                return (
                  <article
                    key={item.id}
                    className={`list-row list-row--card list-row--tall list-row--interactive ${isSelected ? "list-row--selected" : ""}`}
                    onClick={() => setSelectedPainPointId(item.id)}
                  >
                    <div className="stack-sm">
                      <div className="row-heading row-heading--spread">
                        <strong>{item.canonicalLabel}</strong>
                        <div className="button-row button-row--tight">
                          <span className="pill pill--accent">{item.category}</span>
                          {mode === "new7d" ? <span className="pill pill--danger">新增</span> : null}
                        </div>
                      </div>
                      <p>出现次数：{item.occurrenceCount} · 首次出现：{formatTimestamp(item.firstSeenAt)} · 最近出现：{formatTimestamp(item.lastSeenAt)}</p>
                      {item.description ? <p>{item.description}</p> : null}
                      <div className="evidence-list evidence-list--compact">
                        {(item.topEvidence ?? []).slice(0, 3).map(evidence => (
                          <blockquote key={evidence.id} className="evidence-card">
                            <p>{getEvidenceText(evidence)}</p>
                            <small>
                              {evidence.review?.productSpec || "未标注规格"} · {formatTimestamp(evidence.review?.reviewTime)}
                            </small>
                          </blockquote>
                        ))}
                      </div>
                    </div>
                  </article>
                );
              })
            ) : (
              <p>{mode === "new7d" ? "近 7 天没有新增痛点。" : "当前筛选条件下还没有痛点记录。"}</p>
            )}
          </div>
        </section>

        <div className="detail-stack">
          <section className="surface panel-card">
            <span className="eyebrow">Selected Detail</span>
            <h3>{selectedPainPoint?.canonicalLabel ?? "选择左侧痛点查看详情"}</h3>
            {selectedPainPoint ? (
              <div className="stack-md">
                <div className="button-row">
                  <span className="pill pill--accent">{selectedPainPoint.category}</span>
                  <span className="pill">{selectedPainPoint.source}</span>
                  <span className="pill">{selectedPainPoint.occurrenceCount} 次</span>
                </div>
                <p>{selectedPainPoint.description || "该痛点暂未补充说明，以下展示代表评论和规格分布。"}</p>
                <div className="evidence-list">
                  {selectedEvidence.length > 0 ? (
                    selectedEvidence.slice(0, 6).map(evidence => (
                      <blockquote key={evidence.id} className="evidence-card">
                        <p>{getEvidenceText(evidence)}</p>
                        <small>
                          {evidence.review?.productName || evidence.review?.doudianProductId || "未知商品"}
                          {" · "}
                          {evidence.review?.productSpec || "未标注规格"}
                          {" · "}
                          {formatTimestamp(evidence.review?.reviewTime)}
                        </small>
                      </blockquote>
                    ))
                  ) : (
                    <p>这个痛点暂时没有可展示的证据评论。</p>
                  )}
                </div>
                <div className="stack-sm">
                  <strong>规格高发分布</strong>
                  {specStats.length > 0 ? (
                    specStats.slice(0, 8).map(item => (
                      <div key={item.spec} className="count-bar-row">
                        <span>{item.spec}</span>
                        <div className="count-bar-track">
                          <div className="count-bar-fill" style={{ width: `${(item.count / maxSpecCount) * 100}%` }} />
                        </div>
                        <strong>{item.count}</strong>
                      </div>
                    ))
                  ) : (
                    <p>暂时没有规格聚合数据。</p>
                  )}
                </div>
              </div>
            ) : (
              <p>先从左侧选择一条痛点，再查看代表评论、首现时间和规格热点。</p>
            )}
          </section>

          <section className="surface panel-card">
            <span className="eyebrow">Category Mix</span>
            <h3>分类占比</h3>
            <div className="list-stack">
              {categorySummary.length > 0 ? (
                categorySummary.map(item => (
                  <div key={item.category} className="count-bar-row">
                    <span>{item.category}</span>
                    <div className="count-bar-track">
                      <div className="count-bar-fill" style={{ width: `${(item.count / maxCategoryCount) * 100}%` }} />
                    </div>
                    <strong>{item.count}</strong>
                  </div>
                ))
              ) : (
                <p>没有足够数据生成分类占比。</p>
              )}
            </div>
          </section>

          <section className="surface panel-card">
            <span className="eyebrow">First Seen Trend</span>
            <h3>痛点首现时间线</h3>
            <div className="trend-list">
              {timeline.length > 0 ? (
                timeline.map(item => (
                  <div key={item.dateKey} className="trend-row">
                    <span>{item.dateKey.slice(5).replace("-", "/")}</span>
                    <div className="trend-bar-track">
                      <div className="trend-bar-fill" style={{ width: `${(item.count / maxTimelineCount) * 100}%` }} />
                    </div>
                    <strong>{item.count}</strong>
                  </div>
                ))
              ) : (
                <p>当前筛选范围内还没有首现时间线数据。</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
