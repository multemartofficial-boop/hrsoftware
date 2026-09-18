import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { money } from "@/lib/hr-utils";

const axis = {
  stroke: "transparent",
  tick: { fill: "oklch(0.55 0.02 275)", fontSize: 12 },
} as const;

const tooltipStyle = {
  borderRadius: 12,
  border: "1px solid oklch(0.92 0.008 285)",
  boxShadow: "0 8px 24px oklch(0.4 0.05 285 / 0.12)",
  fontSize: 12,
} as const;

export function PayrollBarChart({
  data,
}: {
  data: { month: string; cost: number; expense: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} barGap={-18} barCategoryGap={28}>
        <CartesianGrid vertical={false} stroke="oklch(0.93 0.006 285)" />
        <XAxis dataKey="month" axisLine={false} tickLine={false} {...axis} />
        <YAxis
          axisLine={false}
          tickLine={false}
          {...axis}
          tickFormatter={(v: number) => (v >= 1000 ? `${v / 1000}k` : String(v))}
        />
        <Tooltip
          cursor={{ fill: "oklch(0.55 0.23 291 / 0.06)" }}
          contentStyle={tooltipStyle}
          formatter={(v: number, n: string) => [money(v), n === "cost" ? "Gross pay" : "Deductions"]}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          formatter={(v: string) => (
            <span className="text-xs text-muted-foreground">
              {v === "cost" ? "Gross pay" : "Deductions"}
            </span>
          )}
        />
        <Bar dataKey="cost" fill="oklch(0.55 0.23 291)" radius={[6, 6, 6, 6]} barSize={22} />
        <Bar dataKey="expense" fill="oklch(0.84 0.08 291)" radius={[6, 6, 6, 6]} barSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DailyHoursChart({ data }: { data: { day: string; hours: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} barCategoryGap={20}>
        <CartesianGrid vertical={false} stroke="oklch(0.93 0.006 285)" />
        <XAxis dataKey="day" axisLine={false} tickLine={false} {...axis} />
        <YAxis
          axisLine={false}
          tickLine={false}
          {...axis}
          tickFormatter={(v: number) => (v >= 1000 ? `${v / 1000}k` : String(v))}
        />
        <Tooltip
          cursor={{ fill: "oklch(0.55 0.23 291 / 0.06)" }}
          contentStyle={tooltipStyle}
          formatter={(v: number) => [`${Number(v).toFixed(2)} h`, "Hours worked"]}
        />
        <Bar dataKey="hours" fill="oklch(0.55 0.23 291)" radius={[6, 6, 6, 6]} barSize={16} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export const donutColors = ["oklch(0.55 0.23 291)", "oklch(0.72 0.12 195)", "oklch(0.84 0.08 291)", "oklch(0.65 0.18 30)", "oklch(0.5 0.1 260)"];

export function DonutChart({
  data,
  total,
  label,
}: {
  data: { name: string; value: number }[];
  total: string;
  label: string;
}) {
  const empty = data.every((d) => !d.value);
  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={empty ? [{ name: "None", value: 1 }] : data}
            dataKey="value"
            innerRadius={68}
            outerRadius={92}
            paddingAngle={3}
            cornerRadius={8}
            stroke="none"
          >
            {(empty ? [0] : data).map((_, i) => (
              <Cell key={i} fill={empty ? "oklch(0.92 0.008 285)" : donutColors[i % donutColors.length]} />
            ))}
          </Pie>
          {!empty && <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => money(v)} />}
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="text-center">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold">{total}</p>
        </div>
      </div>
    </div>
  );
}

export function BillingLineChart({
  data,
}: {
  data: { week: string; cost: number; billing: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data}>
        <CartesianGrid vertical={false} stroke="oklch(0.93 0.006 285)" />
        <XAxis dataKey="week" axisLine={false} tickLine={false} {...axis} />
        <YAxis
          axisLine={false}
          tickLine={false}
          {...axis}
          tickFormatter={(v: number) => (v >= 1000 ? `${v / 1000}k` : String(v))}
        />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => money(v)} />
        <Legend iconType="circle" iconSize={8} />
        <Line
          type="monotone"
          dataKey="cost"
          stroke="oklch(0.55 0.23 291)"
          strokeWidth={3}
          dot={{ r: 3 }}
        />
        <Line
          type="monotone"
          dataKey="billing"
          stroke="oklch(0.72 0.12 195)"
          strokeWidth={3}
          dot={{ r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

