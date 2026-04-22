import { useMemo, type ReactElement } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Route, Switch, useLocation } from "wouter";
import { apiGet, apiPost } from "@/api/client";
import { AppShell, type NavigationItem, type NavigationSection } from "@/components/AppShell";
import { ShopProvider, useShop } from "@/hooks/useShop";
import { DashboardPage } from "@/routes/Dashboard";
import { AnalysisSettingsPage } from "@/routes/AnalysisSettingsPage";
import { PainPointsPage } from "@/routes/PainPointsPage";
import { ProductsPage } from "@/routes/ProductsPage";
import { ReviewsPage } from "@/routes/ReviewsPage";
import { ShopsPage } from "@/routes/ShopsPage";
import { UploadsPage } from "@/routes/UploadsPage";

const OVERVIEW_NAVIGATION: NavigationItem[] = [
  { href: "/", label: "工作台首页", description: "快速进入上传、痛点与评论主线" },
];

const PRIMARY_NAVIGATION: NavigationItem[] = [
  { href: "/uploads", label: "上传", description: "导入评论 Excel 并跟进处理进度" },
  { href: "/pain-points", label: "痛点", description: "优先排查高频与值得关注的意见" },
  { href: "/reviews", label: "评论", description: "下钻查看原始评论、追评与证据" },
];

const SECONDARY_NAVIGATION: NavigationItem[] = [
  { href: "/shops", label: "店铺", description: "维护店铺资料与登录后的工作上下文" },
  { href: "/products", label: "商品", description: "管理商品分组、别名与展示名称" },
  { href: "/analysis-settings", label: "分析设置", description: "调整规则与 LLM 提取策略" },
];

const NAVIGATION_SECTIONS: NavigationSection[] = [
  {
    id: "overview",
    label: "工作台入口",
    items: OVERVIEW_NAVIGATION,
    tone: "overview",
  },
  {
    id: "primary",
    label: "主要流程",
    description: "上传评论、定位痛点、核对原始评论",
    items: PRIMARY_NAVIGATION,
    tone: "primary",
  },
  {
    id: "secondary",
    label: "配置与维护",
    description: "店铺、商品与分析策略",
    items: SECONDARY_NAVIGATION,
    collapsible: true,
    tone: "secondary",
  },
];

const ALL_NAVIGATION_ITEMS = NAVIGATION_SECTIONS.flatMap(section => section.items);

interface AuthState {
  authenticated: boolean;
}

interface LoginPageProps {
  isSubmitting: boolean;
  onSubmit: (password: string) => Promise<void>;
}

function LoginPage({ isSubmitting, onSubmit }: LoginPageProps): ReactElement {
  return (
    <div className="auth-page">
      <div className="auth-panel surface">
        <span className="eyebrow">Local-first Workspace</span>
        <h1>抖店评论分析台</h1>
        <p>
          每次从抖店后台手动导出评论 Excel，按店铺上传后，在本地完成解析、去重、痛点抽取与趋势可视化。
        </p>

        <form
          className="auth-form"
          onSubmit={async event => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            const password = String(formData.get("password") ?? "").trim();
            await onSubmit(password);
          }}
        >
          <label className="field-group">
            <span>访问密码</span>
            <input className="input" name="password" type="password" placeholder="输入本地应用密码" />
          </label>

          <button className="button" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "登录中..." : "进入工作台"}
          </button>
        </form>
      </div>
    </div>
  );
}

function matchesNavigationItem(location: string, href: string): boolean {
  if (href === "/") {
    return location === "/";
  }

  return location === href || location.startsWith(`${href}/`);
}

function AppLayout(): ReactElement {
  const [location, navigate] = useLocation();
  const { selectedShopId, setSelectedShopId, shops } = useShop();
  const logoutMutation = useMutation({
    mutationFn: () => apiPost<AuthState, Record<string, never>>("/auth/logout", {}),
    onSuccess: () => {
      void navigate("/login");
    },
  });

  const pageMeta = useMemo(() => {
    const current = ALL_NAVIGATION_ITEMS.find(item => matchesNavigationItem(location, item.href));
    return {
      title: current?.label ?? "工作台",
      description: current?.description ?? "浏览本地评论分析数据。",
    };
  }, [location]);

  return (
    <AppShell
      currentPath={location}
      description={pageMeta.description}
      navigationSections={NAVIGATION_SECTIONS}
      onLogout={async () => {
        await logoutMutation.mutateAsync();
      }}
      onSelectShopId={setSelectedShopId}
      selectedShopId={selectedShopId}
      shops={shops}
      title={pageMeta.title}
    >
      <Switch>
        <Route path="/" component={DashboardPage} />
        <Route path="/shops" component={ShopsPage} />
        <Route path="/products" component={ProductsPage} />
        <Route path="/uploads" component={UploadsPage} />
        <Route path="/analysis-settings" component={AnalysisSettingsPage} />
        <Route path="/pain-points" component={PainPointsPage} />
        <Route path="/reviews" component={ReviewsPage} />
        <Route component={DashboardPage} />
      </Switch>
    </AppShell>
  );
}

export function App(): ReactElement {
  const [location, navigate] = useLocation();
  const authQuery = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => apiGet<AuthState>("/auth/me", { skipAuthRedirect: true }),
  });
  const loginMutation = useMutation({
    mutationFn: (password: string) => apiPost<AuthState, { password: string }>("/auth/login", { password }, { skipAuthRedirect: true }),
    onSuccess: () => {
      void navigate("/");
      void authQuery.refetch();
    },
  });

  if (authQuery.isLoading) {
    return (
      <div className="boot-screen">
        <div className="surface boot-card">
          <span className="eyebrow">Booting</span>
          <h1>正在连接本地评论分析台</h1>
          <p>检查登录状态与店铺配置...</p>
        </div>
      </div>
    );
  }

  const isAuthenticated = Boolean(authQuery.data?.authenticated);

  if (!isAuthenticated) {
    if (location !== "/login") {
      void navigate("/login");
    }

    return (
      <LoginPage
        isSubmitting={loginMutation.isPending}
        onSubmit={async password => {
          await loginMutation.mutateAsync(password);
        }}
      />
    );
  }

  if (location === "/login") {
    void navigate("/");
  }

  return (
    <ShopProvider enabled={isAuthenticated}>
      <AppLayout />
    </ShopProvider>
  );
}
