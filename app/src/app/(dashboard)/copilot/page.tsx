import { Suspense } from "react";

import { requireUser } from "@/lib/auth/require-role";
import { getVisibleUserIds } from "@/lib/auth/visibility";
import { CopilotContent } from "./components/copilot-content";
import { CopilotSummarySkeleton } from "./components/copilot-summary";
import { CopilotWorklistSkeleton } from "./components/copilot-worklist";

export default async function CopilotPage() {
  const session = await requireUser();
  const visibleUserIds = await getVisibleUserIds(session.user.id, session.user.role, session.user.organizationId);

  return (
    <Suspense
      fallback={
        <div className="flex flex-col gap-4">
          <CopilotSummarySkeleton />
          <CopilotWorklistSkeleton />
        </div>
      }
    >
      <CopilotContent visibleUserIds={visibleUserIds} organizationId={session.user.organizationId} />
    </Suspense>
  );
}
