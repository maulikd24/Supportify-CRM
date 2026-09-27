import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

/** "1–25 of 80" plus Previous/Next, shared by paginated list pages. */
export function Pagination({
  page,
  pageSize,
  total,
  noun,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  noun: string;
  hrefFor: (page: number) => string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const range = total === 0 ? `0 ${noun}` : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
      <p>{range}</p>
      <div className="flex gap-2">
        {page <= 1 ? (
          <Button size="sm" variant="outline" disabled>
            <ChevronLeft /> Previous
          </Button>
        ) : (
          <Button size="sm" variant="outline" render={<Link href={hrefFor(page - 1)} />}>
            <ChevronLeft /> Previous
          </Button>
        )}
        {page >= totalPages ? (
          <Button size="sm" variant="outline" disabled>
            Next <ChevronRight />
          </Button>
        ) : (
          <Button size="sm" variant="outline" render={<Link href={hrefFor(page + 1)} />}>
            Next <ChevronRight />
          </Button>
        )}
      </div>
    </div>
  );
}
