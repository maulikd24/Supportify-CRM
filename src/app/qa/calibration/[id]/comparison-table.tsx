import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const DISAGREEMENT_THRESHOLD = 20;

type Row = {
  label: string;
  overallScore: number | null;
  criteriaScores: Record<string, number>;
  notes?: string | null;
};

export function ComparisonTable({
  aiReview,
  entries,
  criteria,
}: {
  aiReview: { overallScore: number | null; criteriaScores: Record<string, number> };
  entries: { id: string; reviewerName: string; overallScore: number | null; criteriaScores: Record<string, number>; notes: string | null; submitted: boolean }[];
  criteria: [string, string][];
}) {
  const submitted = entries.filter((e) => e.submitted);
  const rows: Row[] = [
    { label: "AI (original review)", overallScore: aiReview.overallScore, criteriaScores: aiReview.criteriaScores },
    ...submitted.map((e) => ({
      label: e.reviewerName,
      overallScore: e.overallScore,
      criteriaScores: e.criteriaScores,
      notes: e.notes,
    })),
  ];

  function spread(values: (number | null | undefined)[]): number {
    const nums = values.filter((v): v is number => typeof v === "number");
    if (nums.length < 2) return 0;
    return Math.max(...nums) - Math.min(...nums);
  }

  const overallSpread = spread(rows.map((r) => r.overallScore));
  const criteriaSpreads = Object.fromEntries(
    criteria.map(([key]) => [key, spread(rows.map((r) => r.criteriaScores[key]))]),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Comparison</CardTitle>
        <CardDescription>
          {submitted.length} reviewer{submitted.length === 1 ? "" : "s"} scored this ticket, plus the AI&apos;s
          original review. Columns with a spread over {DISAGREEMENT_THRESHOLD} points are flagged for discussion.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reviewer</TableHead>
                <TableHead>
                  <div className="flex items-center gap-1.5">
                    Overall
                    {overallSpread > DISAGREEMENT_THRESHOLD && (
                      <Badge variant="destructive" className="text-xs">
                        ±{overallSpread}
                      </Badge>
                    )}
                  </div>
                </TableHead>
                {criteria.map(([key, label]) => (
                  <TableHead key={key}>
                    <div className="flex items-center gap-1.5">
                      {label}
                      {criteriaSpreads[key] > DISAGREEMENT_THRESHOLD && (
                        <Badge variant="destructive" className="text-xs">
                          ±{criteriaSpreads[key]}
                        </Badge>
                      )}
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{row.label}</TableCell>
                  <TableCell>{row.overallScore ?? "—"}</TableCell>
                  {criteria.map(([key]) => (
                    <TableCell key={key}>{row.criteriaScores[key] ?? "—"}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {submitted.some((e) => e.notes) && (
          <div className="mt-6 flex flex-col gap-3">
            <h3 className="text-sm font-medium">Notes</h3>
            {submitted
              .filter((e) => e.notes)
              .map((e) => (
                <div key={e.id} className="rounded-md border p-3 text-sm">
                  <div className="mb-1 font-medium">{e.reviewerName}</div>
                  <p className="text-muted-foreground">{e.notes}</p>
                </div>
              ))}
          </div>
        )}

        {submitted.length === 0 && (
          <p className="mt-4 text-sm text-muted-foreground">No reviewers have submitted a score yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
