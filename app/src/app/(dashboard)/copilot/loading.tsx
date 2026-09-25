import { CopilotSummarySkeleton } from "./components/copilot-summary";
import { CopilotWorklistSkeleton } from "./components/copilot-worklist";

export default function CopilotLoading() {
  return (
    <div className="flex flex-col gap-4">
      <CopilotSummarySkeleton />
      <CopilotWorklistSkeleton />
    </div>
  );
}
