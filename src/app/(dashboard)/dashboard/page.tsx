import { createAdminClient } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function DashboardPage() {
  const supabase = await createAdminClient();

  const [agents, sessions, events, recentEvents] = await Promise.all([
    supabase.from("agents").select("*", { count: "exact", head: true }),
    supabase.from("sessions").select("*", { count: "exact", head: true }),
    supabase.from("events").select("*", { count: "exact", head: true }),
    supabase
      .from("events")
      .select("id, source, status, trace_id, created_at")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          OpenCrab system overview
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard title="Agents" value={agents.count ?? 0} desc="Configured AI agents" />
        <StatCard title="Sessions" value={sessions.count ?? 0} desc="Active conversations" />
        <StatCard title="Events" value={events.count ?? 0} desc="Total events processed" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Events</CardTitle>
          <CardDescription>Last 10 events across all agents</CardDescription>
        </CardHeader>
        <CardContent>
          {recentEvents.data && recentEvents.data.length > 0 ? (
            <div className="flex flex-col gap-2">
              {recentEvents.data.map((event) => (
                <div
                  key={event.id}
                  className="flex items-center justify-between rounded-md border p-3 text-sm"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">{event.source}</Badge>
                    <span className="font-mono text-xs text-muted-foreground">
                      {event.trace_id.slice(0, 8)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={event.status} />
                    <span className="text-xs text-muted-foreground">
                      {new Date(event.created_at).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No events yet. Send a message to your Telegram bot to get started.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  title,
  value,
  desc,
}: {
  title: string;
  value: number;
  desc: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "processed"
      ? "default"
      : status === "failed" || status === "dead"
        ? "destructive"
        : "secondary";
  return <Badge variant={variant}>{status}</Badge>;
}
