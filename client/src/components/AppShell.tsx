import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { Link } from "wouter";
import type { Shop } from "@shared/types";
import { cn } from "@/lib/cn";

export interface NavigationItem {
  href: string;
  label: string;
  description: string;
}

export interface NavigationSection {
  id: string;
  label: string;
  description?: string;
  items: NavigationItem[];
  collapsible?: boolean;
  tone?: "overview" | "primary" | "secondary";
}

interface AppShellProps {
  children: ReactNode;
  currentPath: string;
  description: string;
  navigationSections: NavigationSection[];
  onLogout: () => Promise<void>;
  onSelectShopId: (shopId: number | null) => void;
  selectedShopId: number | null;
  shops: Shop[];
  title: string;
}

function isActivePath(currentPath: string, targetPath: string): boolean {
  return currentPath === targetPath || currentPath.startsWith(`${targetPath}/`);
}

function hasActiveItem(currentPath: string, items: NavigationItem[]): boolean {
  return items.some(item => isActivePath(currentPath, item.href));
}

export function AppShell({
  children,
  currentPath,
  description,
  navigationSections,
  onLogout,
  onSelectShopId,
  selectedShopId,
  shops,
  title,
}: AppShellProps): ReactElement {
  const secondarySection = navigationSections.find(section => section.collapsible) ?? null;
  const isSecondaryActive = secondarySection ? hasActiveItem(currentPath, secondarySection.items) : false;
  const [isSecondaryExpanded, setIsSecondaryExpanded] = useState<boolean>(isSecondaryActive);

  useEffect(() => {
    setIsSecondaryExpanded(isSecondaryActive);
  }, [isSecondaryActive]);

  return (
    <div className="app-shell">
      <aside className="sidebar surface">
        <div className="brand-block">
          <span className="eyebrow">Doudian Review Insight</span>
          <h1>评论洞察工作台</h1>
          <p>把上传、痛点和原始评论串成一条可追溯的分析主线，配置项后置到需要时再展开。</p>
        </div>

        <nav className="sidebar-nav" aria-label="工作台导航">
          {navigationSections.map(section => {
            const isCollapsible = Boolean(section.collapsible);
            const isExpanded = isCollapsible ? isSecondaryExpanded : true;
            const isSectionActive = hasActiveItem(currentPath, section.items);
            const sectionId = `nav-section-${section.id}`;

            return (
              <section
                key={section.id}
                className={cn(
                  "nav-section",
                  section.tone ? `nav-section--${section.tone}` : undefined,
                  isSectionActive && "nav-section--active",
                )}
              >
                <div className="nav-section__header">
                  <div>
                    <span className="eyebrow">{section.label}</span>
                    {section.description ? <p>{section.description}</p> : null}
                  </div>
                  {isCollapsible ? (
                    <button
                      className={cn("nav-section__toggle", isExpanded && "nav-section__toggle--expanded")}
                      type="button"
                      aria-expanded={isExpanded}
                      aria-controls={sectionId}
                      onClick={() => setIsSecondaryExpanded(current => !current)}
                    >
                      <span>{isExpanded ? "收起" : "展开"}</span>
                    </button>
                  ) : null}
                </div>

                <div id={sectionId} className={cn("nav-section__content", !isExpanded && "nav-section__content--collapsed")}>
                  <div className="nav-list">
                    {section.items.map(item => (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={cn("nav-link", isActivePath(currentPath, item.href) && "nav-link--active")}
                      >
                        <span>{item.label}</span>
                        <small>{item.description}</small>
                      </Link>
                    ))}
                  </div>
                </div>
              </section>
            );
          })}
        </nav>

        <div className="sidebar-footer surface-muted">
          <strong>本地优先</strong>
          <p>数据落在本机 SQLite，上传的 Excel 批次、痛点结论和证据评论一一对应。</p>
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
