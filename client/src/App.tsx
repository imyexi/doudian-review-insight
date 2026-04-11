import { useMemo, type ReactElement } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Route, Switch, useLocation } from "wouter";
import { apiGet, apiPost } from "@/api/client";
import { AppShell, type NavigationItem } from "@/components/AppShell";
import { ShopProvider, useShop } from "@/hooks/useShop";
import { DashboardPage } from "@/routes/Dashboard";
import { AnalysisSettingsPage } from "@/routes/AnalysisSettingsPage";
import { PainPointsPage } from "@/routes/PainPointsPage";
import { ProductsPage } from "@/routes/ProductsPage";
import { ReviewsPage } from "@/routes/ReviewsPage";
import { ShopsPage } from "@/routes/ShopsPage";
import { UploadsPage } from "@/routes/UploadsPage";

const NAVIGATION: NavigationItem[] = [
  { href: "/", label: "总览", description: "店铺概览与最近趋势" },
  { href: "/shops", label: "店铺", description: "维护多个店铺资料" },
  { href: "/products", label: "商品", description: "补充商品别名与分类" },
  { href: "/uploads", label: "上传", description: "导入评论 Excel 批次" },
  { href: "/analysis-settings", label: "分析设置", description: "切换规则与 LLM 分析策略" },
  { href: "/pain-points", label: "痛点", description: "历史与新增痛点总览" },
  { href: "/reviews", label: "评论", description: "按条件浏览原始评论" },
];

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

function AppLayout(): ReactElement {
  const [location] = useLocation();
  const [, navigate] = useLocation();
  const { selectedShopId, setSelectedShopId, shops } = useShop();
  const logoutMutation = useMutation({
    mutationFn: () => apiPost<AuthState, Record<string, never>>("/auth/logout", {}),
    onSuccess: () => {
      void navigate("/login");
    },
  });

  const pageMeta = useMemo(() => {
    const current = NAVIGATION.find(item => location === item.href || location.startsWith(`${item.href}/`));
    return {
      title: current?.label ?? "工作台",
      description: current?.description ?? "浏览本地评论分析数据。",
    };
  }, [location]);

  return (
    <AppShell
      currentPath={location}
      description={pageMeta.description}
      navigation={NAVIGATION}
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
  const [location] = useLocation();
  const [, navigate] = useLocation();
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
