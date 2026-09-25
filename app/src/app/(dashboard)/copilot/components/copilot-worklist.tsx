import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CopilotQuickActions } from "@/components/copilot/quick-actions";
import type { WorklistEntry } from "@/lib/copilot/worklist";

const HEALTH_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  HEALTHY: "default",
  AT_RISK: "secondary",
  CRITICAL: "destructive",
};

export function CopilotWorklist({
  entries,
  users,
}: {
  entries: WorklistEntry[];
  users: { id: string; name: string }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Prioritized Worklist</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Health</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Next Best Action</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.client.id}>
                <TableCell className="text-sm">
                  <Link href={`/clients/${entry.client.id}`} className="font-medium hover:underline">
                    {entry.client.name}
                  </Link>
                  <p className="text-xs text-muted-foreground font-mono">{entry.client.clientCode}</p>
                </TableCell>
                <TableCell className="text-sm">{entry.client.stageName}</TableCell>
                <TableCell>
                  <Badge variant={HEALTH_VARIANT[entry.health.status]}>{entry.health.status.replace("_", " ")}</Badge>
                  {entry.health.reasons[0] && (
                    <p className="text-xs text-muted-foreground mt-0.5">{entry.health.reasons[0]}</p>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  <span className="font-medium">{entry.priority.score}</span>
                  {entry.priority.reasons[0] && (
                    <p className="text-xs text-muted-foreground">{entry.priority.reasons[0]}</p>
                  )}
                </TableCell>
                <TableCell className="text-sm max-w-56">
                  <p>{entry.nba.label}</p>
                  <p className="text-xs text-muted-foreground">{entry.nba.detail}</p>
                </TableCell>
                <TableCell>
                  <CopilotQuickActions
                    clientId={entry.client.id}
                    assignedToId={entry.client.assignedToId}
                    suggestedFollowUp={entry.suggestedFollowUp}
                    messageSuggestion={entry.messageSuggestion}
                    users={users}
                  />
                </TableCell>
              </TableRow>
            ))}
            {entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  Nothing needs attention right now.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function CopilotWorklistSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Prioritized Worklist</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-10 w-full animate-pulse rounded-md bg-muted" />
        ))}
      </CardContent>
    </Card>
  );
}
