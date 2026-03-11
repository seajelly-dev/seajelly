import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import Image from "next/image";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <DashboardSidebar userEmail={user.email ?? ""} />
        <main className="flex flex-1 flex-col overflow-auto bg-muted/20">
          <div className="flex h-14 items-center gap-4 border-b bg-background/50 backdrop-blur-md px-4 md:hidden">
            <SidebarTrigger />
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <Image src="/logo.svg" alt="SEAJelly Logo" width={24} height={24} />
              <span>SEAJelly</span>
            </div>
          </div>
          <div className="mx-auto w-full max-w-[1400px] flex-1 px-6 py-8 md:px-10 md:py-12">
            {children}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
