import { useMemo, useState, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import type { OverviewStats, Sentiment } from "@shared/types";
import { apiGet } from "@/api/client";
import { EmptyShopState } from "@/components/EmptyShopState";
import { useShop } from "@/hooks/useShop";
import { formatDecimal, formatPercent, formatShortDate } from "@/lib/format";

const SENTIMENT_OPTIONS: Sentiment[] = ["negative", "neutral", "positive"];

function getSentimentLabel(sentiment: Sentiment): string {
  if (sentiment === "positive") {
    return "正向";
  }

  if (sentiment === "neutral") {
    return "中性";
  }

  return "负向";
}

function getSentimentPillClassName(sentiment: Sentiment): string {
  if (sentiment === "positive") {
    return "pill pill--success";
  }

  if (sentiment === "neutral") {
    return "pill";
  }

  return "pill pill--danger";
}

export function DashboardPage(): ReactElement {
  const { selectedShop, selectedShopId } = useShop();
  const [selectedSentiments, setSelectedSentiments] = useState<Sentiment[]>([]);
  const statsQuery = useQuery({
    queryKey: ["stats", selectedShopId, selectedSentiments],
    queryFn: () => apiGet<OverviewStats>("/stats/overview", {
      query: {
        shopId: selectedShopId ?? undefined,
        sentiment: selectedSentiments,
      },
    }),
    enabled: selectedShopId !== null,
  });

  const trendMax = useMemo(() => {
    const counts = statsQuery.data?.trend30d.map(item => item.count) ?? [];
    return counts.length > 0 ? Math.max(...counts) : 0;
  }, [statsQuery.data?.trend30d]);

  function toggleSentiment(sentiment: Sentiment): void {
    setSelectedSentiments(current =>
      current.includes(sentiment) ? current.filter(item => item !== sentiment) : [...current, sentiment],
    );
  }

  if (!selectedShop) {
    return (
      <EmptyShopState
        kicker="Workspace"
        title="先选择店铺"
        body="选中店铺后，工作台首页会先带你进入上传、痛点和评论主线，再补充概览指标。"
      />
    );
  }

  if (statsQuery.isLoading) {
    return (
      <div className="surface panel-card stack-md">
        <span className="eyebrow">Workspace Home</span>
        <h3>正在加载 {selectedShop.name} 的工作台首页...</h3>
        <p>先整理关键概览，再为你保留上传、痛点和评论的快捷入口。</p>
      </div>
    );
  }

  const stats = statsQuery.data;
  if (!stats) {
    return (
      <div className="surface panel-card stack-md">
        <span className="eyebrow">Workspace Home</span>
        <h3>先上传第一批评论，再开始看痛点</h3>
        <p>你可以直接从这里进入上传页，把评论 Excel 导入后，再回来看概览、痛点和原始评论。</p>
        <div className="button-row">
          <Link className="button" href="/uploads">
            去上传评论
          </Link>
          <Link className="button button--ghost" href="/pain-points">
            查看痛点页
          </Link>
        </div>
      </div>
    );
  }

  return (
    <section className="stack-lg">
      <section className="dashboard-hero">
        <article className="surface panel-card dashboard-hero__intro">
          <span className="eyebrow">Workspace Home</span>
          <h3>{selectedShop.name} 的分析主线</h3>
          <p>先看上传是否完成，再进入痛点页定位问题，最后到评论页核对原话和规格证据。下面的概览指标只保留判断优先级所需的信息。</p>
          <div className="button-row">
            <Link className="button" href="/uploads">
              继续上传
            </Link>
            <Link className="button button--ghost" href="/pain-points">
              去看痛点
            </Link>
            <Link className="button button--ghost" href="/reviews">
              查看评论
            </Link>
          </div>
        </article>

        <aside className="dashboard-hero__actions">
          <Link className="quick-link-card" href="/uploads">
            <span className="eyebrow">Step 1</span>
            <strong>上传批次</strong>
            <p>导入新的评论 Excel，跟进解析、写入和分析进度。</p>
          </Link>
          <Link className="quick-link-card" href="/pain-points">
            <span className="eyebrow">Step 2</span>
            <strong>查看痛点</strong>
            <p>优先排查高频、最近新增和值得关注的具体意见。</p>
          </Link>
          <Link className="quick-link-card" href="/reviews">
            <span className="eyebrow">Step 3</span>
            <strong>核对评论</strong>
            <p>按商品、评分、规格和痛点回看原始评论与追评。</p>
          </Link>
        </aside>
      </section>

      <div className="dashboard-grid dashboard-grid--four">
        <article className="metric-card surface">
          <span>总评论量</span>
          <strong>{stats.totalReviews}</strong>
          <p>累计入库评论，支持跨批次去重合并。</p>
        </article>
        <article className="metric-card surface accent-card">
          <span>近 7 天新增痛点</span>
          <strong>{stats.painPoints.new7d}</strong>
          <p>快速判断近期有没有新问题冒头。</p>
        </article>
        <article className="metric-card surface">
          <span>负评占比</span>
          <strong>{formatPercent(stats.negativeCount, stats.totalReviews)}</strong>
          <p>{stats.negativeCount} 条评分小于等于 3 的评论。</p>
        </article>
        <article className="metric-card surface">
          <span>平均评分</span>
          <strong>{formatDecimal(stats.avgRating)}</strong>
          <p>用于判断整体满意度是否有波动。</p>
        </article>
      </div>

      <div className="split-panel split-panel--balanced">
        <section className="surface panel-card">
          <span className="eyebrow">30 Day Trend</span>
          <h3>近 30 天评论走势</h3>
          <div className="trend-list">
            {stats.trend30d.map(item => (
              <div key={item.date} className="trend-row">
                <span>{formatShortDate(item.date)}</span>
                <div className="trend-bar-track">
                  <div
                    className="trend-bar-fill"
                    style={{ width: trendMax > 0 ? `${(item.count / trendMax) * 100}%` : "0%" }}
                  />
                </div>
                <strong>{item.count}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="surface panel-card">
          <div className="row-heading row-heading--spread">
            <div>
              <span className="eyebrow">Top Pain Points</span>
              <h3>优先关注的痛点</h3>
            </div>
            <span className="pill">已筛选 {stats.topPainPoints.length}</span>
          </div>
          <div className="stack-md">
            <div className="chip-row">
              {SENTIMENT_OPTIONS.map(sentiment => {
                const isActive = selectedSentiments.includes(sentiment);
                return (
                  <button
                    key={sentiment}
                    className={`category-chip ${isActive ? "category-chip--active" : ""}`}
                    type="button"
                    onClick={() => toggleSentiment(sentiment)}
                  >
                    {getSentimentLabel(sentiment)}
                  </button>
                );
              })}
            </div>
            <div className="list-stack">
              {stats.topPainPoints.length > 0 ? (
                stats.topPainPoints.map(item => (
                  <div key={`${item.category}-${item.sentiment}-${item.canonicalLabel}`} className="list-row">
                    <div>
                      <div className="button-row button-row--tight">
                        <strong>{item.canonicalLabel}</strong>
                        <span className="pill pill--accent">{item.category}</span>
                        <span className={getSentimentPillClassName(item.sentiment)}>{getSentimentLabel(item.sentiment)}</span>
                      </div>
                      <p>
                        关联商品：{item.relatedProducts.join("、")}
                        {item.extraProductCount > 0 ? ` 等 +${item.extraProductCount}` : ""}
                        {" · "}
                        最近出现于 {new Date(item.lastSeenAt * 1000).toLocaleDateString("zh-CN")}
                      </p>
                    </div>
                    <span className="pill">{item.occurrenceCount} 次</span>
                  </div>
                ))
              ) : (
                <p>{selectedSentiments.length > 0 ? "当前情绪筛选下还没有痛点记录。" : "当前店铺还没有痛点记录，先上传评论后再回来查看。"}</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
