"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { LOGIN_GATE_QUERY_PARAM } from "@/lib/security/login-gate";
import {
  LayoutDashboard,
  Bot,
  Users,
  Brain,
  KeyRound,
  MessageSquare,
  Radio,
  Clock,
  Plug,
  Sparkles,
  Code2,
  Settings,
  LogOut,
  Cpu,
  Layers,
  CreditCard,
  BookOpen,
  AppWindow,
} from "lucide-react";
import Image from "next/image";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useT } from "@/lib/i18n";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";

const NAV_ITEMS: { titleKey: string; href: string; icon: LucideIcon }[] = [
  { titleKey: "sidebar.overview", href: "/dashboard", icon: LayoutDashboard },
  { titleKey: "sidebar.agents", href: "/dashboard/agents", icon: Bot },
  { titleKey: "sidebar.channels", href: "/dashboard/channels", icon: Users },
  { titleKey: "sidebar.subscriptions", href: "/dashboard/subscriptions", icon: CreditCard },
  { titleKey: "sidebar.memories", href: "/dashboard/memories", icon: Brain },
  { titleKey: "sidebar.knowledge", href: "/dashboard/knowledge", icon: BookOpen },
  { titleKey: "sidebar.models", href: "/dashboard/models", icon: Cpu },
  { titleKey: "sidebar.voice", href: "/dashboard/multimodal", icon: Layers },
  { titleKey: "sidebar.secrets", href: "/dashboard/secrets", icon: KeyRound },
  { titleKey: "sidebar.sessions", href: "/dashboard/sessions", icon: MessageSquare },
  { titleKey: "sidebar.tasks", href: "/dashboard/tasks", icon: Clock },
  { titleKey: "sidebar.mcpServers", href: "/dashboard/mcp", icon: Plug },
  { titleKey: "sidebar.skills", href: "/dashboard/skills", icon: Sparkles },
  { titleKey: "sidebar.subApps", href: "/dashboard/sub-apps", icon: AppWindow },
  { titleKey: "sidebar.coding", href: "/dashboard/coding", icon: Code2 },
  { titleKey: "sidebar.events", href: "/dashboard/events", icon: Radio },
  { titleKey: "sidebar.settings", href: "/dashboard/settings", icon: Settings },
];

/**
 * 隔离 useSearchParams —— 该 hook 会触发 Suspense 边界，
 * 如果放在 DashboardSidebar 顶层，可能导致整个 sidebar 被 Suspense
 * 捕获，从而使 I18nProvider context 在 SSR 时不可用。
 */
function LoginGateCapture() {
  const searchParams = useSearchParams();
  useEffect(() => {
    const key = searchParams.get(LOGIN_GATE_QUERY_PARAM);
    if (key) {
      sessionStorage.setItem("seajelly_login_gate_key", key);
    }
  }, [searchParams]);
  return null;
}

export function DashboardSidebar({ userEmail }: { userEmail: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useT();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    const savedKey = sessionStorage.getItem("seajelly_login_gate_key");
    const loginPath = savedKey
      ? `/login?${LOGIN_GATE_QUERY_PARAM}=${encodeURIComponent(savedKey)}`
      : "/login";
    router.push(loginPath);
    router.refresh();
  };

  return (
    <Sidebar>
      <Suspense fallback={null}>
        <LoginGateCapture />
      </Suspense>
      <SidebarHeader className="border-b px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image src="/logo.svg" alt="SEAJelly Logo" width={32} height={32} />
            <span className="text-xl font-semibold tracking-tight">
              SEAJelly
            </span>
          </div>
          <LanguageSwitcher variant="ghost" size="icon-sm" />
        </div>
      </SidebarHeader>
      <SidebarContent className="px-2 py-4">
        <SidebarGroup>
          <SidebarGroupLabel className="px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            {t("sidebar.dashboard")}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1.5">
              {NAV_ITEMS.map((item) => {
                const isActive = item.href === "/dashboard"
                  ? pathname === "/dashboard"
                  : pathname.startsWith(item.href);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      render={<a href={item.href} className={cn("transition-all duration-300", isActive && "font-medium bg-sidebar-accent text-sidebar-accent-foreground shadow-sm ring-1 ring-border/50")} />}
                      isActive={isActive}
                      size="lg"
                      className="px-4 rounded-xl"
                    >
                      <item.icon className={cn("size-5 transition-transform duration-300 group-hover/menu-button:scale-110 group-hover/menu-button:text-primary", isActive && "text-primary")} />
                      <span className="transition-colors duration-300">{t(item.titleKey as Parameters<typeof t>[0])}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t p-4">
        <DropdownMenu>
          <DropdownMenuTrigger
            id="dashboard-user-menu-trigger"
            render={
              <Button
                variant="ghost"
                className="w-full justify-between h-auto py-3 px-3 hover:bg-sidebar-accent rounded-xl"
              />
            }
          >
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold">
                {userEmail.charAt(0).toUpperCase()}
              </div>
              <div className="flex flex-col items-start overflow-hidden text-sm">
                <span className="truncate font-medium w-full text-left">
                  {userEmail.split('@')[0]}
                </span>
                <span className="truncate text-xs text-muted-foreground w-full text-left">
                  {userEmail}
                </span>
              </div>
            </div>
            <LogOut className="size-4 text-muted-foreground ml-2 shrink-0" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56 rounded-xl">
            <DropdownMenuItem onClick={handleSignOut} className="gap-2 cursor-pointer text-destructive focus:text-destructive">
              <LogOut className="size-4" />
              {t("common.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
