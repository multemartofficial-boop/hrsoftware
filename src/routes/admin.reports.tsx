import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { AdminShell } from "@/components/hr/admin-shell";
import { Card, DataTable, SectionTitle, StatCard, Td, Th, EmptyRow } from "@/components/hr/bits";
import { BillingLineChart } from "@/components/hr/charts";
import { useApi } from "@/lib/api-store";
import { money } from "@/lib/hr-utils";

export const Route = createFileRoute("/admin/reports")({
  head: () => ({
    meta: [
      { title: "Reports — WorkHR" },
      { name: "description", content: "Labour cost, hours worked and client billing performance calculated from live data." },
      { property: "og:title", content: "Reports — WorkHR" },
      { property: "og:description", content: "Labour cost, hours worked and client billing performance calculated from live data." },
    ],
  }),
  component: ReportsPage,
});

function ReportsPage() {
  const { weeklyReport, totals, attendance, workers, locations, settings, loading, error, loadWorkers, loadAttendance } = useApi();
  const [loc, setLoc] = useState("all");

  const byLocation = useMemo(() => {
    const rateOf = (id: string) => workers?.find((w) => w.id === id)?.rate ?? settings?.hourlyRate ?? 0;
    const rows = (locations || []).map((l) => {
      const recs = (attendance || []).filter((a) => a.location === l.name);
      const hours = Math.round(recs.reduce((t, a) => t + a.hours, 0) * 100) / 100;
      const cost = Math.round(recs.reduce((t, a) => t + a.hours * rateOf(a.workerId), 0) * 100) / 100;
      return { name: l.name, hours, cost, billing: Math.round(cost * (settings?.billingMultiplier ?? 1) * 100) / 100 };
    });
    return loc === "all" ? rows : rows.filter((r) => r.name === loc);
  }, [attendance, workers, locations, settings, loc]);

  const margin = totals.billing ? Math.round((totals.profit / totals.billing) * 100) : 0;

  if (loading.workers || loading.attendance) {
    return (
      <AdminShell title="Reports">
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Loading reports...</div>
        </div>
      </AdminShell>
    );
  }

  if (error) {
    return (
      <AdminShell title="Reports">
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <div className="text-red-500 font-medium">Failed to load reports</div>
          <div className="text-sm text-muted-foreground">{error}</div>
          <button
            onClick={() => { loadWorkers(); loadAttendance(); }}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm"
          >
            Retry
          </button>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell
      title="Reports"
      action={
        <button className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
          <Download className="size-4" /> Export Report
        </button>
      }
    >
      <div className="space-y-3">
        <Card className="flex flex-wrap items-center gap-3 py-3">
          <span className="text-sm font-medium">Filters</span>
          <select
            value={loc}
            onChange={(e) => setLoc(e.target.value)}
            className="h-9 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary"
          >
            <option value="all">All Locations</option>
            {locations?.map((l) => (
              <option key={l.id}>{l.name}</option>
            ))}
          </select>
          {settings && (
            <span className="text-xs text-muted-foreground">
              Billing modelled at {settings.billingMultiplier}× labour cost
            </span>
          )}
        </Card>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total Hours Worked" value={`${totals.totalHours.toFixed(1)} h`} hint="all attendance" />
          <StatCard label="Total Labour Cost" value={money(totals.labourCost)} hint="hours × rate" />
          <StatCard label="Payroll Issued" value={money(totals.payrollCost)} hint="gross, all runs" />
          <StatCard label="Profit / Loss" value={money(totals.profit)} hint={`margin ${margin}%`} />
        </div>

        <Card>
          <SectionTitle title="Labour Cost vs Client Billing" action={<span className="text-xs text-muted-foreground">Last 6 weeks</span>} />
          <BillingLineChart data={weeklyReport} />
        </Card>

        <div className="grid gap-3 xl:grid-cols-2">
          <Card className="p-0">
            <div className="p-5">
              <h2 className="text-base font-semibold">Weekly Breakdown</h2>
            </div>
            <DataTable
              labels={["Week", "Hours", "Labour Cost", "Billing", "Profit"]}
              head={
                <>
                  <Th>Week</Th>
                  <Th>Hours</Th>
                  <Th>Labour Cost</Th>
                  <Th>Billing</Th>
                  <Th>Profit</Th>
                </>
              }
            >
              {(weeklyReport || []).map((r) => (
                <tr key={r.week} className="hover:bg-secondary/40">
                  <Td className="font-medium">
                    {r.week}
                    <span className="ml-2 text-xs text-muted-foreground">{r.label}</span>
                  </Td>
                  <Td>{r.hours.toFixed(1)} h</Td>
                  <Td>{money(r.cost)}</Td>
                  <Td>{money(r.billing)}</Td>
                  <Td className="font-semibold text-success">{money(r.billing - r.cost)}</Td>
                </tr>
              ))}
            </DataTable>
          </Card>

          <Card className="p-0">
            <div className="p-5">
              <h2 className="text-base font-semibold">By Location</h2>
            </div>
            <DataTable
              labels={["Location", "Hours", "Labour Cost", "Billing", "Profit"]}
              head={
                <>
                  <Th>Location</Th>
                  <Th>Hours</Th>
                  <Th>Labour Cost</Th>
                  <Th>Billing</Th>
                  <Th>Profit</Th>
                </>
              }
            >
              {(!byLocation || byLocation.length === 0) && <EmptyRow colSpan={5} text="No data for this location." />}
              {(byLocation || []).map((r) => (
                <tr key={r.name} className="hover:bg-secondary/40">
                  <Td className="font-medium">{r.name}</Td>
                  <Td>{r.hours.toFixed(1)} h</Td>
                  <Td>{money(r.cost)}</Td>
                  <Td>{money(r.billing)}</Td>
                  <Td className="font-semibold text-success">{money(r.billing - r.cost)}</Td>
                </tr>
              ))}
            </DataTable>
          </Card>
        </div>
      </div>
    </AdminShell>
  );
}
