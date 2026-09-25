"use client";

import { Area, Bar, ComposedChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

import { formatCompact } from "@/lib/utils/date-buckets";

export type TrendPoint = { label: string; value: number; bar?: number };

/**
 * Harbor-style trend: a green line with a soft growth fill, over faint
 * background bars. `bar` is optional and plotted on its own hidden scale.
 */
export function TrendChart({
  data,
  valueLabel,
  barLabel,
  valueFormat = "plain",
}: {
  data: TrendPoint[];
  valueLabel: string;
  barLabel?: string;
  /** A key, not a function — functions can't be passed from Server Components. */
  valueFormat?: "plain" | "compact";
}) {
  const formatValue = (v: number) => (valueFormat === "compact" ? formatCompact(v) : String(v));
  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
          <XAxis dataKey="label" hide />
          <Tooltip
            cursor={{ fill: "var(--color-chart-pending)" }}
            formatter={(v, name) => [name === valueLabel ? formatValue(Number(v)) : String(v), name]}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              color: "var(--popover-foreground)",
              fontSize: 12,
            }}
          />
          {barLabel && (
            <Bar dataKey="bar" name={barLabel} yAxisId="bar" fill="var(--color-chart-bar)" barSize={6} radius={[2, 2, 0, 0]} />
          )}
          <Area
            dataKey="value"
            name={valueLabel}
            yAxisId="value"
            type="linear"
            stroke="var(--color-primary)"
            strokeWidth={2}
            fill="var(--color-chart-growth)"
            dot={false}
            activeDot={{ r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
