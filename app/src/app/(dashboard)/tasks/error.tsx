"use client";

import { RouteError } from "@/components/route-error";

export default function TasksError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError reset={reset} />;
}
