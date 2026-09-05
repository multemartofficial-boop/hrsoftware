import { useState, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Download, Printer, Check, Trash2, Search } from "lucide-react";
import { AdminShell } from "@/components/hr/admin-shell";
import {
  Card,
  DataTable,
  EmptyRow,
  Field,
  GhostButton,
  Modal,
  Person,
  PrimaryButton,
  SectionTitle,
  StatCard,
  StatusBadge,
  Td,
  Th,
  inputCls,
} from "@/components/hr/bits";
import { PayrollBarChart, DonutChart, donutColors } from "@/components/hr/charts";
import { useApi } from "@/lib/api-store";
import { apiClient } from "@/lib/api-client";
import { addDays, fmtDate, money, money2, todayISO } from "@/lib/hr-utils";
import type { Payroll } from "@/lib/mock-data";

type PayrollPreview = {
  workerId: string;
  worker: string;
  rate: number;
  hours: number;
  overtime: number;
  gross: number;
  tax: number;
  advance: number;
  net: number;
  from: string;
  to: string;
};

export const Route = createFileRoute("/admin/payrolls")({
  head: () => ({
    meta: [
      { title: "Payrolls — WorkHR" },
      { name: "description", content: "Generate payroll runs from attendance, track deductions and issue payslips." },
      { property: "og:title", content: "Payrolls — WorkHR" },
      { property: "og:description", content: "Generate payroll runs from attendance, track deductions and issue payslips." },
    ],
  }),
  component: PayrollsPage,
});

function NewPayrollForm({ onClose }: { onClose: () => void }) {
  const { workers, createPayroll, settings } = useApi();
  const [workerId, setWorkerId] = useState(workers?.[0]?.id ?? "");
  const [from, setFrom] = useState(addDays(todayISO(), -30));
  const [to, setTo] = useState(todayISO());
  const [advance, setAdvance] = useState("0");
  const [preview, setPreview] = useState<PayrollPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Live preview: call the backend endpoint that runs the SAME calculatePayroll()
  // used by "Generate payroll", so the numbers shown here always match the result.
  useEffect(() => {
    if (!workerId || !from || !to) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    const timer = setTimeout(async () => {
      try {
        const data = await apiClient.post<PayrollPreview>("/api/payroll/preview", {
          workerId,
          from,
          to,
          advance: Number(advance) || 0,
        });
        if (!cancelled) setPreview(data);
      } catch (err) {
        if (!cancelled) {
          setPreview(null);
          setPreviewError(err instanceof Error ? err.message : "Failed to load preview");
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [workerId, from, to, advance]);

  if (!workers || workers.length === 0) {
    return (
      <Modal title="New payroll run" description="No workers available" onClose={onClose}>
        <div className="rounded-xl bg-secondary/60 p-4 text-sm text-muted-foreground">
          No workers available. Please create workers first by approving registration applications.
        </div>
        <div className="mt-4 flex justify-end">
          <PrimaryButton onClick={onClose}>Close</PrimaryButton>
        </div>
      </Modal>
    );
  }

  if (!settings) {
    return (
      <Modal title="New payroll run" description="Settings not loaded" onClose={onClose}>
        <div className="rounded-xl bg-secondary/60 p-4 text-sm text-muted-foreground">
          Settings not loaded. Please refresh the page.
        </div>
        <div className="mt-4 flex justify-end">
          <PrimaryButton onClick={onClose}>Close</PrimaryButton>
        </div>
      </Modal>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workerId) return;
    try {
      await createPayroll(workerId, from, to, Number(advance) || 0);
      onClose();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create payroll. Please try again.');
    }
  };

  return (
    <Modal
      title="New payroll run"
      description="Hours are summed from attendance in the selected period."
      onClose={onClose}
      wide
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Worker" className="sm:col-span-2">
          <select value={workerId} onChange={(e) => setWorkerId(e.target.value)} className={inputCls}>
            {workers?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} — £{(w.rate ?? 0).toFixed(2)}/h
              </option>
            ))}
          </select>
        </Field>
        <Field label="Period from">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Period to">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Advance taken (£)" hint={settings ? `Max advance ${money(settings.maxAdvance)}` : "Max advance"}>
          <input
            type="number"
            min="0"
            step="10"
            value={advance}
            onChange={(e) => setAdvance(e.target.value)}
            className={inputCls}
          />
        </Field>

        {previewLoading && !preview && (
          <div className="sm:col-span-2 rounded-xl bg-secondary/60 p-4 text-sm text-muted-foreground">
            Calculating preview from attendance…
          </div>
        )}
        {previewError && (
          <div className="sm:col-span-2 rounded-xl bg-secondary/60 p-4 text-sm text-danger">
            {previewError}
          </div>
        )}
        {preview && settings && (
          <div className={`sm:col-span-2 rounded-xl bg-secondary/60 p-4${previewLoading ? " opacity-60" : ""}`}>
            <p className="mb-2 text-sm font-semibold">Calculation preview</p>
            <dl className="grid gap-y-1 text-sm sm:grid-cols-2">
              {[
                ["Hours in period", `${preview.hours.toFixed(2)} h`],
                ["Overtime hours", `${preview.overtime.toFixed(2)} h × ${settings.overtimeMultiplier}`],
                ["Hourly rate", money2(preview.rate)],
                ["Gross pay", money2(preview.gross)],
                [`Tax + NI (${settings.taxRate + settings.niRate}%)`, `-${money2(preview.tax)}`],
                ["Advance", `-${money2(preview.advance)}`],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 pr-4">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-4 pr-4 font-semibold">
                <dt>Net pay</dt>
                <dd>{money2(preview.net)}</dd>
              </div>
            </dl>
            {preview.hours === 0 && (
              <p className="mt-2 text-xs text-danger">
                No attendance found in this period — the payroll will be zero.
              </p>
            )}
          </div>
        )}

        <div className="sm:col-span-2 flex justify-end gap-2">
          <GhostButton type="button" onClick={onClose}>
            Cancel
          </GhostButton>
          <PrimaryButton type="submit">Generate payroll</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function Payslip({ p, onClose }: { p: Payroll; onClose: () => void }) {
  const { settings } = useApi();

  if (!settings) {
    return (
      <Modal title="Payslip preview" description={p.id} onClose={onClose}>
        <div className="rounded-xl bg-secondary/60 p-4 text-sm text-muted-foreground">
          Settings not loaded. Please refresh the page.
        </div>
        <div className="mt-4 flex justify-end">
          <PrimaryButton onClick={onClose}>Close</PrimaryButton>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Payslip preview" description={p.id} onClose={onClose}>
      <div className="rounded-xl border border-border p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-semibold">{settings.companyName}</p>
            <p className="text-xs text-muted-foreground">{settings.payrollEmail}</p>
          </div>
          <StatusBadge status={p.status} />
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {[
            ["Worker", p.worker],
            ["Worker ID", p.workerId],
            ["Period", `${fmtDate(p.from)} – ${fmtDate(p.to)}`],
            ["Issued", fmtDate(p.created)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-secondary/60 p-3">
              <p className="text-xs text-muted-foreground">{k}</p>
              <p className="text-sm font-medium">{v}</p>
            </div>
          ))}
        </div>

        <dl className="mt-5 space-y-2 text-sm">
          {[
            ["Hours worked", `${p.hours.toFixed(2)} h`],
            ["Hourly rate", money2(p.rate)],
            ["Gross pay", money2(p.gross)],
            ["Tax & NI", `-${money2(p.tax)}`],
            ["Advance deducted", `-${money2(p.advance)}`],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-border pb-2">
              <dt className="text-muted-foreground">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
          <div className="flex justify-between pt-1 text-base font-semibold">
            <dt>Net pay</dt>
            <dd>{money2(p.net)}</dd>
          </div>
        </dl>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <GhostButton onClick={() => window.print()}>
          <Printer className="size-4" /> Print
        </GhostButton>
        <PrimaryButton onClick={onClose}>Close</PrimaryButton>
      </div>
    </Modal>
  );
}

function PayrollsPage() {
  const { payrolls, payrollChart, deductionsData, totals, setPayrollStatus, deletePayroll, loading, workers, settings, error, loadPayrolls } = useApi();
  const [open, setOpen] = useState(false);
  const [slip, setSlip] = useState<Payroll | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");

  const rows = (payrolls || []).filter(
    (p) =>
      (status === "all" || p.status === status) &&
      (!q.trim() || p.worker.toLowerCase().includes(q.trim().toLowerCase()) || p.id.toLowerCase().includes(q.trim().toLowerCase())),
  );

  const deductionTotal = (deductionsData || []).reduce((t, d) => t + d.value, 0);

  if (loading.payrolls) {
    return (
      <AdminShell title="Payrolls">
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Loading payrolls...</div>
        </div>
      </AdminShell>
    );
  }

  if (error) {
    return (
      <AdminShell title="Payrolls">
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <div className="text-red-500 font-medium">Failed to load payrolls</div>
          <div className="text-sm text-muted-foreground">{error}</div>
          <button
            onClick={() => loadPayrolls()}
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
      title="Payrolls"
      action={
        <button
          onClick={() => {
            if (!workers || workers.length === 0) {
              alert('No workers available. Please create workers first by approving registration applications.');
              return;
            }
            if (!settings) {
              alert('Settings not loaded. Please refresh the page.');
              return;
            }
            setOpen(true);
          }}
          className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          <Plus className="size-4" /> New Payroll
        </button>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard label="Payroll Cost" value={money(totals?.payrollCost ?? 0)} hint="gross, all runs" />
          <StatCard label="Deductions & Advances" value={money(totals?.expenses ?? 0)} hint="tax, NI, advances" />
          <StatCard
            label="Pending Payments"
            value={money(totals?.pending ?? 0)}
            tone="down"
            hint={`${totals?.pendingCount ?? 0} runs`}
          />
          <StatCard label="Total Payrolls" value={String(payrolls?.length ?? 0)} hint="all time" />
        </div>

        <div className="grid gap-3 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <SectionTitle title="Payroll Cost Overview" action={<span className="text-xs text-muted-foreground">Last 9 months</span>} />
            <PayrollBarChart data={payrollChart} />
          </Card>
          <Card>
            <SectionTitle title="Deductions & Advances" />
            <DonutChart data={deductionsData || []} total={money(deductionTotal ?? 0)} label="Totals" />
            <div className="mt-4 grid grid-cols-3 gap-2">
              {(deductionsData || []).map((d, i) => (
                <div key={d.name} className="border-l-2 pl-2" style={{ borderColor: donutColors[i] }}>
                  <p className="text-sm font-semibold">{money(d.value ?? 0)}</p>
                  <p className="text-xs text-muted-foreground">{d.name}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Card className="p-0">
          <div className="flex flex-wrap items-center gap-3 p-5">
            <h2 className="mr-auto text-base font-semibold">Payroll list ({rows.length})</h2>
            <div className="relative w-full sm:w-auto">
              <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search worker"
                className="h-9 w-full rounded-lg sm:w-52 border border-border bg-card pl-9 text-sm outline-none focus:border-primary"
              />
            </div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="h-9 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary"
            >
              <option value="all">All Status</option>
              <option value="Pending">Pending</option>
              <option value="Completed">Completed</option>
            </select>
            <button className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm">
              <Download className="size-4" /> Export
            </button>
          </div>

          <DataTable
            labels={["Payroll ID", "Worker", "Period", "Hours", "Rate", "Gross Pay", "Advance", "Net Pay", "Status", "Action"]}
            head={
              <>
                <Th>Payroll ID</Th>
                <Th>Worker Name</Th>
                <Th>Period</Th>
                <Th>Hours</Th>
                <Th>Rate</Th>
                <Th>Gross Pay</Th>
                <Th>Advance</Th>
                <Th>Net Pay</Th>
                <Th>Status</Th>
                <Th className="text-right">Action</Th>
              </>
            }
          >
            {(!rows || rows.length === 0) && <EmptyRow colSpan={10} text="No payroll runs yet." />}
            {(rows || []).map((p) => (
              <tr key={p.id} className="hover:bg-secondary/40">
                <Td className="font-medium">{p.id}</Td>
                <Td><Person name={p.worker} sub={fmtDate(p.created)} /></Td>
                <Td className="whitespace-nowrap text-xs text-muted-foreground">
                  {fmtDate(p.from)} – {fmtDate(p.to)}
                </Td>
                <Td>{p.hours.toFixed(2)} h</Td>
                <Td>{money2(p.rate)}</Td>
                <Td>{money2(p.gross)}</Td>
                <Td className={p.advance ? "text-danger" : "text-muted-foreground"}>
                  {p.advance ? `-${money2(p.advance)}` : "—"}
                </Td>
                <Td className="font-semibold">{money2(p.net)}</Td>
                <Td><StatusBadge status={p.status} /></Td>
                <Td>
                  <div className="flex justify-end gap-1 text-muted-foreground">
                    <button title="View payslip" onClick={() => setSlip(p)} className="rounded-md p-1.5 hover:bg-secondary hover:text-primary">
                      <Printer className="size-4" />
                    </button>
                    {p.status === "Pending" && (
                      <button
                        title="Mark completed"
                        onClick={() => setPayrollStatus(p.id, "Completed")}
                        className="rounded-md p-1.5 hover:bg-secondary hover:text-success"
                      >
                        <Check className="size-4" />
                      </button>
                    )}
                    <button title="Delete" onClick={() => deletePayroll(p.id)} className="rounded-md p-1.5 hover:bg-secondary hover:text-danger">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </Td>
              </tr>
            ))}
          </DataTable>
        </Card>
      </div>

      {open && <NewPayrollForm onClose={() => setOpen(false)} />}
      {slip && <Payslip p={slip} onClose={() => setSlip(null)} />}
    </AdminShell>
  );
}
