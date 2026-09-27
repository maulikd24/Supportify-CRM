"use client";

import { Panel } from "@/components/dashboard/panel";
import { Button } from "@/components/ui/button";

/**
 * In-app error card for route segments. Shows the error digest so a failure
 * seen in production can be matched to its entry in the server logs.
 */
export function RouteError({ error, reset }: { error?: Error & { digest?: string }; reset: () => void }) {
  return (
    <Panel
      eyebrow="Error"
      title="Something went wrong"
      description="This section failed to load. You can try again."
      action={
        <Button variant="outline" size="sm" onClick={() => reset()}>
          Try again
        </Button>
      }
      footer={error?.digest ? `Error reference ${error.digest} — share this with support.` : undefined}
    />
  );
}
