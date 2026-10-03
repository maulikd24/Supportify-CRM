import Link from "next/link";

import { Button } from "@/components/ui/button";

/** Shown where a Growth-and-above QA feature is used on a plan that doesn't include it. */
export function GrowthUpsell({ feature, canUpgrade, children }: { feature: string; canUpgrade: boolean; children?: React.ReactNode }) {
  return (
    <div className="mx-5 mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-4">
      <p className="max-w-prose text-[13px]">
        {feature} {feature.endsWith("s") ? "are" : "is"} included on <strong>Growth</strong> and above.
        {children ? <> {children}</> : null}
      </p>
      {canUpgrade && (
        <Button size="sm" render={<Link href="/billing/QA_SENTINEL" />}>
          Upgrade
        </Button>
      )}
    </div>
  );
}
