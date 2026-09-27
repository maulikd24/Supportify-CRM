import { Check } from "lucide-react";

import type { Stage } from "@/generated/prisma/client";
import { cn } from "@/lib/utils";

/** Pipeline progress as segmented bars (Harbor style): done and current stages filled green. */
export function StageTracker({ stages, currentSequence }: { stages: Stage[]; currentSequence: number }) {
  return (
    <ol className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Pipeline stages">
      {stages.map((stage) => {
        const isDone = stage.sequence < currentSequence;
        const isCurrent = stage.sequence === currentSequence;
        return (
          <li key={stage.id} className="min-w-24 flex-1" aria-current={isCurrent ? "step" : undefined}>
            <div className={cn("h-1.5 rounded-full", isDone ? "bg-primary" : isCurrent ? "bg-primary/60" : "bg-mist")} />
            <p
              className={cn(
                "mt-2 flex items-center gap-1 text-[11px] leading-tight",
                isCurrent ? "font-bold text-foreground" : "text-muted-foreground",
              )}
            >
              {isDone && <Check className="size-3 shrink-0 text-primary" aria-hidden />}
              <span className="truncate">{stage.name}</span>
            </p>
          </li>
        );
      })}
    </ol>
  );
}
