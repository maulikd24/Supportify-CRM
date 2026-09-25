"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

const StageFunnelChart = dynamic(() => import("./stage-funnel-chart").then((mod) => mod.StageFunnelChart), {
  ssr: false,
  loading: () => <Skeleton className="h-72 w-full" />,
});

export function StageFunnelChartLoader({ data }: { data: { stage: string; count: number }[] }) {
  return <StageFunnelChart data={data} />;
}
