import { useEffect, useState, Fragment } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { DataTable, EmptyRow, Person, Td, Th } from "@/components/hr/bits";
import { apiClient } from "@/lib/api-client";
import { money2 } from "@/lib/hr-utils";

export type SummaryWorker = {
  workerId: string;
  worker: string;
  payType?: "hourly" | "salary";
  monthlySalary?: number | null;
  rate: number;
  hours: number;
  overtime: number;
  holidayHours: number;
  holidayPay: number;
  holidayAccruedHours?: number;
  holidayAccrualPay?: number;
  gross: number;
  tax: number;
  net: number;
};

export type SummaryPeriod = {
  period: string;
  label: string;
  hours: number;
  holidayHours: number;
  holidayPay: number;
  holidayAccruedHours?: number;
  holidayAccrualPay?: number;
  holidayAccrualRate?: number;
  gross: number;
  tax: number;
  net: number;
  workers: SummaryWorker[];
};

export function PayrollSummary({ period }: { period: "weekly" | "monthly" | "yearly" }) {
  const [data, setData] = useState<SummaryPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiClient
      .get<SummaryPeriod[]>(`/api/payroll/summary?period=${period}`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load summary"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period]);

  const toggle = (key: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="text-muted-foreground">Loading summary…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-32 gap-2">
        <div className="text-red-500 text-sm font-medium">{error}</div>
      </div>
    );
  }

  return (
    <DataTable
      labels={["Period", "Hours", "Holiday Accrual", "Gross Pay", "Tax & NI", "Net Pay"]}
      head={
        <>
          <Th>Period</Th>
          <Th>Hours</Th>
          <Th>Holiday Accrual</Th>
          <Th>Gross Pay</Th>
          <Th>Tax & NI</Th>
          <Th>Net Pay</Th>
        </>
      }
    >
      {data.length === 0 && <EmptyRow colSpan={6} text="No attendance data yet." />}
      {data.map((p) => (
        <Fragment key={p.period}>
          <tr
            className="cursor-pointer hover:bg-secondary/40"
            onClick={() => toggle(p.period)}
          >
            <Td className="font-medium">
              <span className="inline-flex items-center gap-1">
                {expanded.has(p.period) ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                {p.label}
              </span>
            </Td>
            <Td>{p.hours.toFixed(2)} h{p.holidayHours > 0 ? ` (${p.holidayHours.toFixed(2)}h bank hol.)` : ""}</Td>
            <Td className="text-muted-foreground">
              {(p.holidayAccruedHours ?? 0).toFixed(2)} h
              {p.holidayAccrualRate != null ? ` (${p.holidayAccrualRate}%)` : ""} = {money2(p.holidayAccrualPay ?? 0)}
            </Td>
            <Td>{money2(p.gross)}</Td>
            <Td className="text-muted-foreground">-{money2(p.tax)}</Td>
            <Td className="font-semibold">{money2(p.net)}</Td>
          </tr>
          {expanded.has(p.period) && p.workers.map((w) => (
            <tr key={`${p.period}-${w.workerId}`} className="bg-secondary/20">
              <Td className="pl-8 text-sm text-muted-foreground">
                <Person
                  name={w.worker}
                  sub={`${w.workerId}${w.payType === "salary" ? " · Monthly Salary" : ""}`}
                />
              </Td>
              <Td className="text-sm">
                {w.hours.toFixed(2)} h
                {w.payType === "salary" ? " (records)" : ""}
                {w.overtime > 0 ? ` (+${w.overtime.toFixed(2)} OT)` : ""}
                {w.holidayHours > 0 ? ` (${w.holidayHours.toFixed(2)}h bank hol.)` : ""}
              </Td>
              <Td className="text-sm text-muted-foreground">
                {w.payType === "salary"
                  ? `salary ${money2(w.monthlySalary ?? 0)}/mo`
                  : `${(w.holidayAccruedHours ?? 0).toFixed(2)} h = ${money2(w.holidayAccrualPay ?? 0)}`}
              </Td>
              <Td className="text-sm">{money2(w.gross)}</Td>
              <Td className="text-sm text-muted-foreground">-{money2(w.tax)}</Td>
              <Td className="text-sm font-medium">{money2(w.net)}</Td>
            </tr>
          ))}
        </Fragment>
      ))}
    </DataTable>
  );
}
