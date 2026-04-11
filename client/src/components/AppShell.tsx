import type { ReactElement, ReactNode } from "react";
import { Link } from "wouter";
import type { Shop } from "@shared/types";
import { cn } from "@/lib/cn";

export interface NavigationItem {
  href: string;
  label: string;
  description: string;
}

interface AppShellProps {
  children: ReactNode;
  currentPath: string;
  description: string;
  navigation: NavigationItem[];
  onLogout: () => Promise<void>;
  onSelectShopId: (shopId: number | null) => void;
  selectedShopId: number | null;
  shops: Shop[];
  title: string;
}

function isActivePath(currentPath: string, targetPath: string): boolean {
  return currentPath === targetPath || currentPath.startsWith(`${targetPath}/`);
}

export function AppShell({
  children,
  currentPath,
  description,
  navigation,
  onLogout,
  onSelectShopId,
  selectedShopId,
  shops,
  title,
}: AppShellProps): ReactElement {
  return (
    <div className="app-shell">
      <aside className="sidebar surface">
        <div className="brand-block">
          <span className="eyebrow">Doudian Review Insight</span>
          <h1>评论洞察工作台</h1>
          <p>围绕店铺、商品、规格和痛点，把手动导出的评论批次串成可追溯的本地分析台。</p>
        </div>

        <nav className="nav-list" aria-label="主导航">
          {navigation.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={cn("nav-link", isActivePath(currentPath, item.href) && "nav-link--active")}
            >
              <span>{item.label}</span>
              <small>{item.description}</small>
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer surface-muted">
          <strong>本地优先</strong>
          <p>数据落在本机 SQLite，上传的 Excel 批次与分析结果一一对应。</p>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar surface">
          <div>
            <span className="eyebrow">Workspace</span>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>

          <div className="topbar-actions">
            <label className="field-group field-group--compact">
              <span>当前店铺</span>
              <select
                className="input"
                value={selectedShopId ?? ""}
                onChange={event => {
                  const nextValue = event.target.value;
                  onSelectShopId(nextValue ? Number(nextValue) : null);
                }}
              >
                <option value="">未选择</option>
                {shops.map(shop => (
                  <option key={shop.id} value={shop.id}>
                    {shop.name}
                  </option>
                ))}
              </select>
            </label>

            <button className="button button--ghost" type="button" onClick={() => void onLogout()}>
              退出登录
            </button>
          </div>
        </header>

        <section className="page-section">{children}</section>
      </main>
    </div>
  );
}
