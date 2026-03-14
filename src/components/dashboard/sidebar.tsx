"use client";

import { Suspense, useEffect, useSyncExternalStore, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { LOGIN_GATE_QUERY_PARAM } from "@/lib/security/login-gate";
import {
  LayoutDashboard,
  Bot,
  Brain,
  Clock,
  Code2,
  Settings,
  LogOut,
  ChevronRight,
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";

type NavItem = {
  titleKey: string;
  href: string;
};

type NavGroup = {
  id: string;
  titleKey: string;
  icon: LucideIcon;
  items: NavItem[];
};

type ExpandedGroupsState = {
  ids: string[];
  pathname?: string;
};

const EXPANDED_GROUPS_STORAGE_KEY = "dashboard_sidebar_expanded_groups_v1";
const expandedGroupsListeners = new Set<() => void>();

const OVERVIEW_ITEM: NavItem & { icon: LucideIcon } = {
  titleKey: "sidebar.overview",
  href: "/dashboard",
  icon: LayoutDashboard,
};

const NAV_GROUPS: NavGroup[] = [
  {
    id: "agent-workspace",
    titleKey: "sidebar.agentWorkspace",
    icon: Bot,
    items: [
      { titleKey: "sidebar.agents", href: "/dashboard/agents" },
      { titleKey: "sidebar.channels", href: "/dashboard/channels" },
      { titleKey: "sidebar.subscriptions", href: "/dashboard/subscriptions" },
      { titleKey: "sidebar.subApps", href: "/dashboard/sub-apps" },
    ],
  },
  {
    id: "capability-hub",
    titleKey: "sidebar.capabilityHub",
    icon: Brain,
    items: [
      { titleKey: "sidebar.memories", href: "/dashboard/memories" },
      { titleKey: "sidebar.knowledge", href: "/dashboard/knowledge" },
      { titleKey: "sidebar.models", href: "/dashboard/models" },
      { titleKey: "sidebar.voice", href: "/dashboard/multimodal" },
      { titleKey: "sidebar.mcpServers", href: "/dashboard/mcp" },
      { titleKey: "sidebar.skills", href: "/dashboard/skills" },
    ],
  },
  {
    id: "operations",
    titleKey: "sidebar.operations",
    icon: Clock,
    items: [
      { titleKey: "sidebar.sessions", href: "/dashboard/sessions" },
      { titleKey: "sidebar.tasks", href: "/dashboard/tasks" },
      { titleKey: "sidebar.events", href: "/dashboard/events" },
    ],
  },
  {
    id: "dev-lab",
    titleKey: "sidebar.devLab",
    icon: Code2,
    items: [
      { titleKey: "sidebar.coding", href: "/dashboard/coding" },
      { titleKey: "sidebar.jellybox", href: "/dashboard/jellybox" },
    ],
  },
  {
    id: "system",
    titleKey: "sidebar.system",
    icon: Settings,
    items: [
      { titleKey: "sidebar.secrets", href: "/dashboard/secrets" },
      { titleKey: "sidebar.settings", href: "/dashboard/settings" },
    ],
  },
];

const VALID_GROUP_IDS = new Set(NAV_GROUPS.map((group) => group.id));

function isItemActive(pathname: string, href: string) {
  return href === "/dashboard"
    ? pathname === "/dashboard"
    : pathname.startsWith(href);
}

function getActiveGroupId(pathname: string) {
  return NAV_GROUPS.find((group) =>
    group.items.some((item) => isItemActive(pathname, item.href))
  )?.id;
}

function getDefaultExpandedGroupIds(pathname: string) {
  const activeGroupId = getActiveGroupId(pathname);
  return activeGroupId ? [activeGroupId] : [];
}

function serializeExpandedGroupIds(ids: string[]) {
  return JSON.stringify(ids);
}

function parseExpandedGroupIds(snapshot: string) {
  try {
    const parsed = JSON.parse(snapshot);
    return Array.isArray(parsed)
      ? parsed.filter(
          (groupId): groupId is string =>
            typeof groupId === "string" && VALID_GROUP_IDS.has(groupId),
        )
      : [];
  } catch {
    return [];
  }
}

function readExpandedGroupsState(): ExpandedGroupsState | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(EXPANDED_GROUPS_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const saved = JSON.parse(raw);
    if (Array.isArray(saved)) {
      return {
        ids: saved.filter(
          (groupId): groupId is string =>
            typeof groupId === "string" && VALID_GROUP_IDS.has(groupId),
        ),
      };
    }

    if (!saved || typeof saved !== "object") {
      return null;
    }

    return {
      ids: Array.isArray(saved.ids)
        ? saved.ids.filter(
            (groupId): groupId is string =>
              typeof groupId === "string" && VALID_GROUP_IDS.has(groupId),
          )
        : [],
      pathname:
        typeof saved.pathname === "string" ? saved.pathname : undefined,
    };
  } catch {
    return null;
  }
}

function getExpandedGroupIdsSnapshot(pathname: string) {
  const storedState = readExpandedGroupsState();

  if (!storedState) {
    return serializeExpandedGroupIds(getDefaultExpandedGroupIds(pathname));
  }

  const activeGroupId = getActiveGroupId(pathname);
  if (
    storedState.pathname !== pathname &&
    activeGroupId &&
    !storedState.ids.includes(activeGroupId)
  ) {
    return serializeExpandedGroupIds([...storedState.ids, activeGroupId]);
  }

  return serializeExpandedGroupIds(storedState.ids);
}

function getExpandedGroupIdsServerSnapshot(pathname: string) {
  return serializeExpandedGroupIds(getDefaultExpandedGroupIds(pathname));
}

function writeExpandedGroupsState(state: ExpandedGroupsState) {
  window.localStorage.setItem(
    EXPANDED_GROUPS_STORAGE_KEY,
    JSON.stringify(state),
  );
}

function subscribeExpandedGroups(listener: () => void) {
  expandedGroupsListeners.add(listener);
  window.addEventListener("storage", listener);

  return () => {
    expandedGroupsListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function notifyExpandedGroupsChange() {
  expandedGroupsListeners.forEach((listener) => listener());
}

function LocalTime() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    const update = () => setTime(new Date().toLocaleTimeString());
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, []);

  if (!time) return <div className="h-4 mt-1" />;

  return (
    <div className="mt-1 flex w-full items-center justify-center gap-1.5 text-[11px] font-medium text-muted-foreground/60">
      <Clock className="size-3" />
      <span>{time}</span>
    </div>
  );
}

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
  const { isMobile, setOpenMobile } = useSidebar();
  const expandedGroupIdsSnapshot = useSyncExternalStore(
    subscribeExpandedGroups,
    () => getExpandedGroupIdsSnapshot(pathname),
    () => getExpandedGroupIdsServerSnapshot(pathname),
  );
  const expandedGroupIds = parseExpandedGroupIds(expandedGroupIdsSnapshot);

  const translate = (key: string) => t(key as Parameters<typeof t>[0]);

  const toggleGroup = (groupId: string) => {
    const nextExpandedGroupIds = expandedGroupIds.includes(groupId)
      ? expandedGroupIds.filter((currentGroupId) => currentGroupId !== groupId)
      : [...expandedGroupIds, groupId];

    writeExpandedGroupsState({
      ids: nextExpandedGroupIds,
      pathname,
    });
    notifyExpandedGroupsChange();
  };

  const handleNavigation = () => {
    if (isMobile) {
      setOpenMobile(false);
    }
  };

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
      <SidebarHeader className="border-b px-4 pt-4 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image src="/logo.svg" alt="SEAJelly Logo" width={32} height={32} />
            <span className="text-xl font-semibold tracking-tight">
              SEAJelly
            </span>
          </div>
          <LanguageSwitcher variant="ghost" size="icon-sm" />
        </div>
        <LocalTime />
      </SidebarHeader>
      <SidebarContent className="px-2 py-4">
        <SidebarGroup>
          <SidebarGroupLabel className="px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            {t("sidebar.dashboard")}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1.5">
              <SidebarMenuItem>
                <SidebarMenuButton
                  render={
                    <a
                      href={OVERVIEW_ITEM.href}
                      onClick={handleNavigation}
                      className={cn(
                        "transition-all duration-300",
                        isItemActive(pathname, OVERVIEW_ITEM.href) &&
                          "font-medium bg-sidebar-accent text-sidebar-accent-foreground shadow-sm ring-1 ring-border/50",
                      )}
                    />
                  }
                  isActive={isItemActive(pathname, OVERVIEW_ITEM.href)}
                  size="lg"
                  className="px-4 rounded-xl"
                >
                  <OVERVIEW_ITEM.icon
                    className={cn(
                      "size-5 transition-transform duration-300 group-hover/menu-button:scale-110 group-hover/menu-button:text-primary",
                      isItemActive(pathname, OVERVIEW_ITEM.href) && "text-primary",
                    )}
                  />
                  <span className="transition-colors duration-300">
                    {translate(OVERVIEW_ITEM.titleKey)}
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>

              <SidebarMenuItem className="px-2 py-1">
                <SidebarSeparator />
              </SidebarMenuItem>

              {NAV_GROUPS.map((group) => {
                const isExpanded = expandedGroupIds.includes(group.id);
                const isGroupActive = group.items.some((item) =>
                  isItemActive(pathname, item.href),
                );

                return (
                  <SidebarMenuItem
                    key={group.id}
                    className={cn(
                      "rounded-2xl border border-transparent p-1 transition-colors",
                      (isExpanded || isGroupActive) &&
                        "bg-sidebar-accent/45",
                      isGroupActive && "border-sidebar-border/70 shadow-sm",
                    )}
                  >
                    <SidebarMenuButton
                      type="button"
                      onClick={() => toggleGroup(group.id)}
                      aria-controls={`${group.id}-submenu`}
                      aria-expanded={isExpanded}
                      isActive={isGroupActive}
                      size="lg"
                      className={cn(
                        "rounded-xl px-3.5",
                        isExpanded && "bg-sidebar-accent text-sidebar-accent-foreground",
                      )}
                    >
                      <group.icon
                        className={cn(
                          "size-5 transition-transform duration-300",
                          isGroupActive && "text-primary",
                        )}
                      />
                      <span>{translate(group.titleKey)}</span>
                      <ChevronRight
                        className={cn(
                          "ml-auto size-4 text-muted-foreground transition-transform duration-200",
                          isExpanded && "rotate-90 text-foreground",
                        )}
                      />
                    </SidebarMenuButton>

                    {isExpanded ? (
                      <SidebarMenuSub
                        id={`${group.id}-submenu`}
                        className="mx-4 mt-1 mb-2 border-sidebar-border/70 pb-1"
                      >
                        {group.items.map((item) => {
                          const isActive = isItemActive(pathname, item.href);

                          return (
                            <SidebarMenuSubItem key={item.href}>
                              <SidebarMenuSubButton
                                render={
                                  <a href={item.href} onClick={handleNavigation} />
                                }
                                isActive={isActive}
                                className={cn(
                                  "h-8 rounded-lg px-3 transition-colors duration-200",
                                  isActive && "font-medium shadow-sm ring-1 ring-border/50",
                                )}
                              >
                                <span>{translate(item.titleKey)}</span>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          );
                        })}
                      </SidebarMenuSub>
                    ) : null}
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
