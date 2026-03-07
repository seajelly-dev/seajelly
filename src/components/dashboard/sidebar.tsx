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

const NAV_ITEMS = [
  { title: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { title: "Agents", href: "/dashboard/agents", icon: Bot },
  { title: "Channels", href: "/dashboard/channels", icon: Users },
  { title: "Secrets", href: "/dashboard/secrets", icon: KeyRound },
  { title: "Sessions", href: "/dashboard/sessions", icon: MessageSquare },
  { title: "Tasks", href: "/dashboard/tasks", icon: Clock },
  { title: "MCP Servers", href: "/dashboard/mcp", icon: Plug },
  { title: "Skills", href: "/dashboard/skills", icon: Sparkles },
  { title: "Events", href: "/dashboard/events", icon: Radio },
];

export function DashboardSidebar({ userEmail }: { userEmail: string }) {
  const pathname = usePathname();
  const router = useRouter();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <Sidebar>
      <SidebarHeader className="border-b px-4 py-3">
        <div className="flex items-center gap-2.5">
          <CrabLogo size={28} className="text-primary" />
          <span className="text-lg font-semibold tracking-tight">
            OpenCrab
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Dashboard</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    render={<a href={item.href} />}
                    isActive={
                      item.href === "/dashboard"
                        ? pathname === "/dashboard"
                        : pathname.startsWith(item.href)
                    }
                  >
                    <item.icon className="size-4" />
                    <span>{item.title}</span>
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
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
