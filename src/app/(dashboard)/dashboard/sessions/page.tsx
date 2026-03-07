import { createAdminClient } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { MessageSquare } from "lucide-react";

export default async function SessionsPage() {
  const supabase = await createAdminClient();

  const { data: sessions } = await supabase
    .from("sessions")
    .select(
      "id, chat_id, agent_id, version, updated_at, messages, agents(name)"
    )
    .order("updated_at", { ascending: false })
    .limit(50);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sessions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          View active conversation sessions
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Sessions</CardTitle>
          <CardDescription>Most recent 50 sessions</CardDescription>
        </CardHeader>
        <CardContent>
          {sessions && sessions.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Chat ID</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Messages</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Last Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessions.map((s) => {
                  const agent = s.agents as unknown as {
                    name: string;
                  } | null;
                  const msgs = Array.isArray(s.messages) ? s.messages : [];
                  return (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-sm">
                        {s.chat_id}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{agent?.name ?? "Unknown"}</Badge>
                      </TableCell>
                      <TableCell className="tabular-nums">{msgs.length}</TableCell>
                      <TableCell className="tabular-nums">{s.version}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(s.updated_at).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center gap-4 py-10">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <MessageSquare className="size-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">No sessions yet.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
