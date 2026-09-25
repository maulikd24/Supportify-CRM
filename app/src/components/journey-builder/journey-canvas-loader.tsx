"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";
import type { JourneyGraph } from "@/lib/journeys/types";

const JourneyCanvas = dynamic(() => import("./journey-canvas").then((mod) => mod.JourneyCanvas), {
  ssr: false,
  loading: () => <Skeleton className="h-[600px] w-full rounded-lg" />,
});

export function JourneyCanvasLoader(props: {
  journeyId: string;
  initialGraph: JourneyGraph;
  isActive: boolean;
  canEdit: boolean;
  users: { id: string; name: string }[];
  templates: { id: string; name: string; channel: string }[];
}) {
  return <JourneyCanvas {...props} />;
}
