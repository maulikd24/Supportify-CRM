import { Check } from "lucide-react";

import type { Stage } from "@/generated/prisma/client";

export function StageTracker({ stages, currentSequence }: { stages: Stage[]; currentSequence: number }) {
  return (
    <div className="flex items-center overflow-x-auto py-2">
      {stages.map((stage, i) => {
        const isDone = stage.sequence < currentSequence;
        const isCurrent = stage.sequence === currentSequence;
        return (
          <div key={stage.id} className="flex items-center shrink-0">
            <div className="flex flex-col items-center gap-1.5 w-24">
              <div
                className={`flex size-7 items-center justify-center rounded-full border-2 text-xs font-medium shrink-0 ${
                  isDone
                    ? "border-primary bg-primary text-primary-foreground"
                    : isCurrent
                      ? "border-primary text-primary"
                      : "border-muted-foreground/30 text-muted-foreground"
                }`}
              >
                {isDone ? <Check className="size-3.5" /> : stage.sequence}
              </div>
              <span
                className={`text-[10px] text-center leading-tight ${
                  isCurrent ? "font-semibold text-foreground" : "text-muted-foreground"
                }`}
              >
                {stage.name}
              </span>
            </div>
            {i < stages.length - 1 && (
              <div className={`h-0.5 w-6 shrink-0 -mt-4 ${isDone ? "bg-primary" : "bg-muted-foreground/20"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
