"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function StageFunnelChart({ data }: { data: { stage: string; count: number }[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 48, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="stage"
            angle={-30}
            textAnchor="end"
            interval={0}
            height={70}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          />
          <YAxis allowDecimals={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} />
          <Tooltip
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              color: "var(--popover-foreground)",
              fontSize: 12,
            }}
          />
          <Bar dataKey="count" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
