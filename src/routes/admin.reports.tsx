import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { jsPDF } from "jspdf";
import { AdminShell } from "@/components/hr/admin-shell";
import { Card, DataTable, SectionTitle, StatCard, Td, Th, EmptyRow, Field, inputCls } from "@/components/hr/bits";
import { DailyHoursChart, DonutChart, donutColors } from "@/components/hr/charts";
import { PayrollSummary } from "@/components/hr/payroll-summary";
import { useApi } from "@/lib/api-store";
import { apiClient } from "@/lib/api-client";
import { addDays, fmtDate, money, money2, todayISO } from "@/lib/hr-utils";

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

type SigReq = {
  id: string; document_name: string; worker_id: string; worker_name: string;
  status: string; sent_at: string; signed_at: string | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

function ReportsPage() {
  const { attendance, workers, locations, settings, payrolls, workerStatus, loading, error, loadWorkers, loadAttendance } = useApi();

  /* ---------- filters ---------- */
  const [from, setFrom] = useState(addDays(todayISO(), -90));
  const [to, setTo] = useState(todayISO());
  const [worker, setWorker] = useState("all");
  const [loc, setLoc] = useState("all");
  const [period, setPeriod] = useState<"weekly" | "monthly" | "yearly">("weekly");
  const [sigRequests, setSigRequests] = useState<SigReq[]>([]);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    apiClient.get<SigReq[]>("/api/documents/requests").then(setSigRequests).catch(() => setSigRequests([]));
  }, []);

  const inRange = (d: string) => d >= from && d <= to;

  /* ---------- filtered data (everything below respects these) ---------- */
  const rateOf = (id: string) => workers?.find((w) => w.id === id)?.rate ?? settings?.hourlyRate ?? 0;

  const fAtt = useMemo(
    () => (attendance || []).filter((a) =>
      inRange(a.date) &&
      (worker === "all" || a.workerId === worker) &&
      (loc === "all" || a.location === loc)
    ),
    [attendance, from, to, worker, loc],
  );

  const fPays = useMemo(
    () => (payrolls || []).filter((p) =>
      inRange(String(p.created).slice(0, 10)) && (worker === "all" || p.workerId === worker)
    ),
    [payrolls, from, to, worker],
  );

  const fDocs = useMemo(
    () => sigRequests.filter((r) =>
      inRange((r.sent_at || "").slice(0, 10)) && (worker === "all" || r.worker_id === worker)
    ),
    [sigRequests, from, to, worker],
  );

  /* ---------- stat cards ---------- */
  const totalHours = r2(fAtt.reduce((t, a) => t + a.hours, 0));
  const labourCost = r2(fAtt.reduce((t, a) => t + a.hours * rateOf(a.workerId), 0));
  const payrollIssued = r2(fPays.reduce((t, p) => t + p.gross, 0));
  const billing = r2(labourCost * (settings?.billingMultiplier ?? 1));
  const profit = r2(billing - labourCost);
  const margin = billing > 0 ? Math.round((profit / billing) * 100) : 0;

  /* ---------- attendance chart: hours per day ---------- */
  const attChart = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of fAtt) map.set(a.date, (map.get(a.date) ?? 0) + a.hours);
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, h]) => ({ day: fmtDate(d), hours: r2(h) }));
  }, [fAtt]);

  /* ---------- worker distribution (respects worker/location filters) ---------- */
  const filteredWorkers = useMemo(
    () => (workers || []).filter((w) =>
      (worker === "all" || w.id === worker) && (loc === "all" || w.location === loc)
    ),
    [workers, worker, loc],
  );

  const statusDist = useMemo(() => {
    const map = new Map<string, number>();
    for (const w of filteredWorkers) {
      const s = workerStatus ? workerStatus(w) : "Active";
      map.set(s, (map.get(s) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [filteredWorkers, workerStatus]);

  const typeDist = useMemo(() => {
    const map = new Map<string, number>();
    for (const w of filteredWorkers) {
      const t = w.workerType || "Direct";
      map.set(t, (map.get(t) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [filteredWorkers]);

  /* ---------- location report ---------- */
  const byLocation = useMemo(() => {
    const map = new Map<string, { hours: number; cost: number }>();
    for (const a of fAtt) {
      const cur = map.get(a.location) ?? { hours: 0, cost: 0 };
      cur.hours += a.hours;
      cur.cost += a.hours * rateOf(a.workerId);
      map.set(a.location, cur);
    }
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, hours: r2(v.hours), cost: r2(v.cost), billing: r2(v.cost * (settings?.billingMultiplier ?? 1)) }))
      .sort((a, b) => b.hours - a.hours);
  }, [fAtt, workers, settings]);

  /* ---------- documents ratio ---------- */
  const docStats = useMemo(() => {
    const c = { sent: fDocs.length, signed: 0, pending: 0, declined: 0, cancelled: 0 };
    for (const r of fDocs) {
      if (r.status === "signed") c.signed++;
      else if (r.status === "pending") c.pending++;
      else if (r.status === "declined") c.declined++;
      else c.cancelled++;
    }
    return c;
  }, [fDocs]);

  /* ---------- export ---------- */
  const exportCSV = () => {
    const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines: string[] = [
      "WorkHR Report", `Range: ${from} to ${to} | Worker: ${worker} | Location: ${loc}`, "",
      "SUMMARY",
      `Total Hours Worked,${totalHours}`,
      `Total Labour Cost,${labourCost}`,
      `Payroll Issued,${payrollIssued}`,
      `Profit/Loss,${profit}`,
      "",
      "ATTENDANCE",
      ["Date", "Worker", "Worker Code", "Location", "Check In", "Check Out", "Hours", "Cost"].join(","),
      ...fAtt.map((a) => [a.date, a.worker, a.workerId, a.location, a.in, a.out ?? "", a.hours, r2(a.hours * rateOf(a.workerId))].map(esc).join(",")),
      "",
      "PAYROLLS",
      ["ID", "Worker", "Period", "Hours", "Gross", "Net", "Status"].join(","),
      ...fPays.map((p) => [p.id, p.worker, `${p.from} to ${p.to}`, p.hours, p.gross, p.net, p.status].map(esc).join(",")),
      "",
      "BY LOCATION",
      ["Location", "Hours", "Labour Cost", "Billing"].join(","),
      ...byLocation.map((l) => [l.name, l.hours, l.cost, l.billing].map(esc).join(",")),
      "",
      "SIGNATURE REQUESTS",
      `Sent,${docStats.sent}`, `Signed,${docStats.signed}`, `Pending,${docStats.pending}`, `Declined,${docStats.declined}`,
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workhr-report-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setExportOpen(false);
  };

  const exportPDF = () => {
    const doc = new jsPDF();
    let y = 16;
    const line = (text: string, opts?: { bold?: boolean; size?: number }) => {
      doc.setFontSize(opts?.size ?? 10);
      doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
      doc.text(text, 14, y);
      y += 6;
      if (y > 280) { doc.addPage(); y = 16; }
    };
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("WorkHR Report", 14, y); y += 8;
    line(`Range: ${from} to ${to}   Worker: ${worker === "all" ? "All" : worker}   Location: ${loc === "all" ? "All" : loc}`);
    y += 4;
    line("Summary", { bold: true, size: 12 });
    line(`Total Hours Worked: ${totalHours} h`);
    line(`Total Labour Cost: ${money(labourCost)}`);
    line(`Payroll Issued: ${money(payrollIssued)}`);
    line(`Profit/Loss: ${money(profit)} (margin ${margin}%)`);
    y += 4;
    line("By Location", { bold: true, size: 12 });
    for (const l of byLocation) line(`  ${l.name}: ${l.hours} h — ${money(l.cost)} (billing ${money(l.billing)})`);
    if (!byLocation.length) line("  No attendance in range.");
    y += 4;
    line("Signature Requests", { bold: true, size: 12 });
    line(`  Sent ${docStats.sent} · Signed ${docStats.signed} · Pending ${docStats.pending} · Declined ${docStats.declined} · Cancelled ${docStats.cancelled}`);
    y += 4;
    line("Payroll Runs", { bold: true, size: 12 });
    for (const p of fPays.slice(0, 40)) line(`  ${p.id} — ${p.worker} — ${p.from} to ${p.to} — net ${money2(p.net)} — ${p.status}`);
    if (!fPays.length) line("  No payroll runs in range.");
    doc.save(`workhr-report-${from}-to-${to}.pdf`);
    setExportOpen(false);
  };

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
        <div className="relative">
          <button
            onClick={() => setExportOpen((v) => !v)}
            className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            <Download className="size-4" /> Export
          </button>
          {exportOpen && (
            <div className="absolute right-0 top-11 z-50 w-48 overflow-hidden rounded-xl border border-border bg-card shadow-lg">
              <button onClick={exportPDF} className="flex w-full items-center gap-2 px-3 py-2.5 text-sm hover:bg-secondary">
                <FileText className="size-4" /> Export as PDF
              </button>
              <button onClick={exportCSV} className="flex w-full items-center gap-2 px-3 py-2.5 text-sm hover:bg-secondary">
                <FileSpreadsheet className="size-4" /> Export as Excel/CSV
              </button>
            </div>
          )}
        </div>
      }
    >
      <div className="space-y-3">
        {/* filters — every section below recalculates from these */}
        <Card className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <Field label="From" className="sm:w-40">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          </Field>
          <Field label="To" className="sm:w-40">
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Worker" className="sm:w-52">
            <select value={worker} onChange={(e) => setWorker(e.target.value)} className={inputCls}>
              <option value="all">All Workers</option>
              {(workers || []).map((w) => (
                <option key={w.id} value={w.id}>{w.name} ({w.id})</option>
              ))}
            </select>
          </Field>
          <Field label="Location" className="sm:w-52">
            <select value={loc} onChange={(e) => setLoc(e.target.value)} className={inputCls}>
              <option value="all">All Locations</option>
              {locations?.map((l) => (
                <option key={l.id} value={l.name}>{l.name}</option>
              ))}
            </select>
          </Field>
          {settings && (
            <span className="text-xs text-muted-foreground sm:pb-3">
              Billing modelled at {settings.billingMultiplier}× labour cost
            </span>
          )}
        </Card>

        {/* stat cards — filtered */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total Hours Worked" value={`${totalHours.toFixed(1)} h`} hint="filtered range" />
          <StatCard label="Total Labour Cost" value={money(labourCost)} hint="hours × rate" />
          <StatCard label="Payroll Issued" value={money(payrollIssued)} hint={`${fPays.length} runs`} />
          <StatCard label="Profit / Loss" value={money(profit)} hint={`margin ${margin}%`} tone={profit >= 0 ? "up" : "down"} />
        </div>

        {/* weekly / monthly / yearly summary (moved from Payrolls) */}
        <Card className="p-0">
          <div className="flex flex-wrap items-center gap-3 p-5 pb-0">
            <div>
              <h2 className="text-base font-semibold">Payroll Period Summary</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Live from attendance records and hourly rates — click a row to expand per-worker details.
              </p>
            </div>
            <div className="ml-auto flex gap-1 rounded-lg border border-border bg-secondary/40 p-1">
              {(["weekly", "monthly", "yearly"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setPeriod(t)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                    period === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <PayrollSummary period={period} />
        </Card>

        {/* attendance overview chart */}
        <Card>
          <SectionTitle title="Attendance Overview" action={<span className="text-xs text-muted-foreground">Hours per day in range</span>} />
          {attChart.length ? (
            <DailyHoursChart data={attChart} />
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">No attendance in this range.</p>
          )}
        </Card>

        <div className="grid gap-3 xl:grid-cols-2">
          {/* worker distribution */}
          <Card>
            <SectionTitle title="Worker Distribution" />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">By status</p>
                <DonutChart data={statusDist} total={String(filteredWorkers.length)} label="Workers" />
                <div className="mt-2 flex flex-wrap gap-2">
                  {statusDist.map((d, i) => (
                    <div key={d.name} className="border-l-2 pl-2" style={{ borderColor: donutColors[i % donutColors.length] }}>
                      <p className="text-sm font-semibold">{d.value}</p>
                      <p className="text-xs text-muted-foreground">{d.name}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">By type</p>
                <DonutChart data={typeDist} total={String(filteredWorkers.length)} label="Workers" />
                <div className="mt-2 flex flex-wrap gap-2">
                  {typeDist.map((d, i) => (
                    <div key={d.name} className="border-l-2 pl-2" style={{ borderColor: donutColors[i % donutColors.length] }}>
                      <p className="text-sm font-semibold">{d.value}</p>
                      <p className="text-xs text-muted-foreground">{d.name}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          {/* documents / signatures ratio */}
          <Card>
            <SectionTitle title="Documents & Signatures" action={<span className="text-xs text-muted-foreground">Sent in range</span>} />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg bg-secondary/50 p-3 text-center">
                <p className="text-xl font-semibold">{docStats.sent}</p>
                <p className="text-xs text-muted-foreground">Sent</p>
              </div>
              <div className="rounded-lg bg-success-soft p-3 text-center">
                <p className="text-xl font-semibold text-success">{docStats.signed}</p>
                <p className="text-xs text-muted-foreground">Signed</p>
              </div>
              <div className="rounded-lg bg-warning-soft p-3 text-center">
                <p className="text-xl font-semibold text-warning">{docStats.pending}</p>
                <p className="text-xs text-muted-foreground">Pending</p>
              </div>
              <div className="rounded-lg bg-danger-soft p-3 text-center">
                <p className="text-xl font-semibold text-danger">{docStats.declined}</p>
                <p className="text-xs text-muted-foreground">Declined</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {docStats.sent > 0
                ? `${Math.round((docStats.signed / docStats.sent) * 100)}% signature completion rate in range.`
                : "No signature requests sent in this range."}
            </p>
          </Card>
        </div>

        {/* location report */}
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
            {(!byLocation || byLocation.length === 0) && <EmptyRow colSpan={5} text="No data for this range/location." />}
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
    </AdminShell>
  );
}
