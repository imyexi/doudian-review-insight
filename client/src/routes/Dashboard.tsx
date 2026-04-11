import { useMemo, type ReactElement } from "react";
import { useQuery } from "@tanstack/react-query";
import type { OverviewStats } from "@shared/types";
import { apiGet } from "@/api/client";
import { EmptyShopState } from "@/components/EmptyShopState";
import { useShop } from "@/hooks/useShop";
import { formatDecimal, formatPercent, formatShortDate } from "@/lib/format";

export function DashboardPage(): ReactElement {
  const { selectedShop, selectedShopId } = useShop();
  const statsQuery = useQuery({
    queryKey: ["stats", selectedShopId],
    queryFn: () => apiGet<OverviewStats>("/stats/overview", { query: { shopId: selectedShopId ?? undefined } }),
    enabled: selectedShopId !== null,
  });

  const trendMax = useMemo(() => {
    const counts = statsQuery.data?.trend30d.map(item => item.count) ?? [];
    return counts.length > 0 ? Math.max(...counts) : 0;
  }, [statsQuery.data?.trend30d]);

  if (!selectedShop) {
    return (
      <EmptyShopState
        kicker="Dashboard"
        title="先选择店铺"
        body="先在店铺页创建并选中一个店铺，总览页才会展示评论走势、负评占比和新增痛点。"
      />
    );
  }

  if (statsQuery.isLoading) {
    return (
      <div className="surface panel-card">
        <span className="eyebrow">Dashboard</span>
        <h3>正在加载 {selectedShop.name} 的总览...</h3>
        <p>统计接口已接通，正在读取评论规模、趋势和痛点摘要。</p>
      </div>
    );
  }

  const stats = statsQuery.data;
  if (!stats) {
    return (
      <div className="surface panel-card">
        <span className="eyebrow">Dashboard</span>
        <h3>暂时没有可展示的数据</h3>
        <p>你可以先上传该店铺的评论 Excel，解析完成后这里会自动出现概览指标。</p>
      </div>
    );
  }

  return (
    <section className="stack-lg">
      <div className="dashboard-grid dashboard-grid--four">
        <article className="metric-card surface">
          <span>总评论量</span>
          <strong>{stats.totalReviews}</strong>
          <p>累计入库评论，支持跨批次去重合并。</p>
        </article>
        <article className="metric-card surface accent-card">
          <span>近 7 天新增痛点</span>
          <strong>{stats.painPoints.new7d}</strong>
          <p>按评论时间首现判定，而不是按上传时间统计。</p>
        </article>
        <article className="metric-card surface">
          <span>负评占比</span>
          <strong>{formatPercent(stats.negativeCount, stats.totalReviews)}</strong>
          <p>{stats.negativeCount} 条评分小于等于 3 的评论。</p>
        </article>
        <article className="metric-card surface">
          <span>平均评分</span>
          <strong>{formatDecimal(stats.avgRating)}</strong>
          <p>可用于快速判断近期整体满意度水平。</p>
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
          <span className="eyebrow">Top Pain Points</span>
          <h3>高频痛点</h3>
          <div className="list-stack">
            {stats.topPainPoints.length > 0 ? (
              stats.topPainPoints.map(item => (
                <div key={`${item.category}-${item.canonicalLabel}`} className="list-row">
                  <div>
                    <strong>{item.canonicalLabel}</strong>
                    <p>
                      {item.category}
                      {" · "}
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
              <p>当前店铺还没有痛点记录，先上传评论后再回来查看。</p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
