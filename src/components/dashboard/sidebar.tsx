"use client";

import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  LayoutDashboard,
  Bot,
  Users,
  KeyRound,
  MessageSquare,
  Radio,
  Clock,
  Plug,
  Sparkles,
  LogOut,
} from "lucide-react";
import { CrabLogo } from "@/components/crab-logo";
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
  { titleKey: "sidebar.secrets", href: "/dashboard/secrets", icon: KeyRound },
  { titleKey: "sidebar.sessions", href: "/dashboard/sessions", icon: MessageSquare },
  { titleKey: "sidebar.tasks", href: "/dashboard/tasks", icon: Clock },
  { titleKey: "sidebar.mcpServers", href: "/dashboard/mcp", icon: Plug },
  { titleKey: "sidebar.skills", href: "/dashboard/skills", icon: Sparkles },
  { titleKey: "sidebar.events", href: "/dashboard/events", icon: Radio },
];

export function DashboardSidebar({ userEmail }: { userEmail: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useT();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <Sidebar>
      <SidebarHeader className="border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <CrabLogo size={28} className="text-primary" />
            <span className="text-lg font-semibold tracking-tight">
              OpenCrab
            </span>
          </div>
          <LanguageSwitcher variant="ghost" size="icon-sm" />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t("sidebar.dashboard")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    render={<a href={item.href} className="transition-all duration-300" />}
                    isActive={
                      item.href === "/dashboard"
                        ? pathname === "/dashboard"
                        : pathname.startsWith(item.href)
                    }
                  >
                    <item.icon className="size-4 transition-transform duration-300 group-hover/menu-button:scale-110 group-hover/menu-button:text-primary" />
                    <span className="transition-colors duration-300">{t(item.titleKey as Parameters<typeof t>[0])}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t p-3">
        <DropdownMenu>
          <DropdownMenuTrigger
            id="dashboard-user-menu-trigger"
            render={
              <Button
                variant="ghost"
                className="w-full justify-start text-sm"
              />
            }
          >
            <span className="truncate">{userEmail}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onClick={handleSignOut}>
              <LogOut className="mr-2 size-4" />
              {t("common.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
