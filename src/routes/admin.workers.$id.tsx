import { useState, useEffect } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, Copy, Check, RotateCcw, FileImage, Trash2, ShieldCheck } from "lucide-react";
import { AdminShell } from "@/components/hr/admin-shell";
import { Card, DataTable, EmptyRow, StatusBadge, Td, Th, inputCls } from "@/components/hr/bits";
import {
  avatarUrl,
  money2,
  COMPLIANCE_ITEMS,
  CRIMINAL_CHECK_LEVELS,
  WORKER_CHECK_STATUSES,
  type WorkerCompliance,
  type WorkerComplianceCheck,
} from "@/lib/mock-data";
import { useApi } from "@/lib/api-store";
import { apiClient } from "@/lib/api-client";
import { fmtDate, daysUntil } from "@/lib/hr-utils";

export const Route = createFileRoute("/admin/workers/$id")({
  head: () => ({
    meta: [
      { title: "Worker Details — WorkHR" },
      { name: "description", content: "Full worker profile with unique code, documents, attendance history and payroll history." },
      { property: "og:title", content: "Worker Details — WorkHR" },
      { property: "og:description", content: "Full worker profile with unique code, documents, attendance history and payroll history." },
    ],
  }),
  component: WorkerDetails,
});

/** Admin-only BS7858 compliance checklist — saved per worker via /api/workers/:id/compliance. */
function ComplianceSection({ workerId, onSaved }: { workerId: string; onSaved: () => void }) {
  const [data, setData] = useState<WorkerCompliance | null>(null);
  const [loadingC, setLoadingC] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingC(true);
    apiClient
      .get<WorkerCompliance>(`/api/workers/${workerId}/compliance`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load checklist"); })
      .finally(() => { if (!cancelled) setLoadingC(false); });
    return () => { cancelled = true; };
  }, [workerId]);

  const update = (key: string, patch: Partial<WorkerComplianceCheck>) => {
    setData((d) => (d ? { ...d, checks: d.checks.map((c) => (c.key === key ? { ...c, ...patch } : c)) } : d));
    setSaved(false);
  };

  const save = async () => {
    if (!data) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiClient.put<WorkerCompliance>(`/api/workers/${workerId}/compliance`, { checks: data.checks });
      setData(res);
      setSaved(true);
      onSaved();
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save checklist");
    } finally {
      setSaving(false);
    }
  };

  const done = data?.checks.filter((c) => c.status === "complete").length ?? 0;
  const labelOf = (key: string) => COMPLIANCE_ITEMS.find((i) => i.key === key)?.label ?? key;

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
          <ShieldCheck className="size-4" />
        </span>
        <div className="mr-auto">
          <h2 className="text-base font-semibold">Compliance Checklist (BS7858)</h2>
          <p className="text-xs text-muted-foreground">
            {loadingC ? "Loading…" : `${done}/8 checks complete`} — tick off each screening step as it is completed outside the system.
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving || loadingC}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {saved ? <Check className="size-4" /> : null}
          {saving ? "Saving…" : saved ? "Saved" : "Save checklist"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      {!loadingC && data && (
        <div className="mt-4 space-y-2">
          {data.checks.map((c) => (
            <div key={c.key} className="grid items-center gap-2 rounded-xl border border-border p-3 sm:grid-cols-[1fr_150px_140px]">
              <div>
                <p className="text-sm font-medium">{labelOf(c.key)}</p>
                {c.key === "criminalRecords" && (
                  <select
                    value={c.level}
                    onChange={(e) => update(c.key, { level: e.target.value })}
                    className={`${inputCls} mt-1.5 h-8 w-40 text-xs`}
                  >
                    <option value="">Check level…</option>
                    {CRIMINAL_CHECK_LEVELS.map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                )}
                <input
                  value={c.notes}
                  onChange={(e) => update(c.key, { notes: e.target.value })}
                  placeholder="Notes (optional)"
                  className={`${inputCls} mt-1.5 h-8 text-xs`}
                />
              </div>
              <select
                value={c.status}
                onChange={(e) => update(c.key, { status: e.target.value as WorkerComplianceCheck["status"] })}
                className={`${inputCls} h-9`}
              >
                {WORKER_CHECK_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <input
                type="date"
                value={c.completedDate ?? ""}
                onChange={(e) => update(c.key, { completedDate: e.target.value || null })}
                className={`${inputCls} h-9`}
                title="Date completed"
              />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function WorkerDetails() {
  const { id } = useParams({ from: "/admin/workers/$id" });
  const { workers, attendance, payrolls, workerStatus, reactivateWorker, deleteWorker, loading, loadWorkers } = useApi();
  const [copied, setCopied] = useState(false);
  const worker = workers?.find((w) => w.id === id);

  if (loading.workers) {
    return (
      <AdminShell title="Worker Details">
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Loading worker details...</div>
        </div>
      </AdminShell>
    );
  }

  if (!worker) {
    return (
      <AdminShell title="Worker Details">
        <Card>
          <p className="text-sm text-muted-foreground">This worker no longer exists.</p>
          <Link to="/admin/workers" className="mt-3 inline-flex items-center gap-2 text-sm text-primary">
            <ArrowLeft className="size-4" /> Back to Worker Directory
          </Link>
        </Card>
      </AdminShell>
    );
  }

  const status = workerStatus(worker);
  const left = daysUntil(worker.expiry);
  const rows = (attendance || []).filter((a) => a.workerId === worker.id);
  const pays = (payrolls || []).filter((p) => p.workerId === worker.id);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(worker.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <AdminShell
      title="Worker Details"
      action={
        <Link
          to="/admin/workers"
          className="flex h-9 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium"
        >
          <ArrowLeft className="size-4" /> Directory
        </Link>
      }
    >
      <div className="space-y-3">
        <Card>
          <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
            <div className="text-center">
              <img src={avatarUrl(worker.name)} alt={worker.name} className="mx-auto size-32 rounded-2xl bg-secondary" />
              <h2 className="mt-4 text-lg font-semibold">{worker.name}</h2>
              <p className="text-sm text-muted-foreground">{worker.role}</p>
              <div className="mt-3 flex justify-center gap-2">
                <StatusBadge status={status} />
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                    (worker.complianceDone ?? 0) >= 8
                      ? "bg-success/10 text-success"
                      : "bg-secondary text-muted-foreground"
                  }`}
                  title="BS7858 compliance checks complete"
                >
                  {worker.complianceDone ?? 0}/8 checks
                </span>
              </div>
            </div>

            <div>
              <div className="rounded-2xl bg-primary-soft p-4">
                <p className="text-xs font-semibold tracking-widest text-primary/70">WORKER CODE</p>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <p className="text-2xl font-bold tracking-tight text-primary">{worker.id}</p>
                  <button
                    onClick={copy}
                    className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground"
                  >
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copied ? "Copied" : "Copy Code"}
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {[
                  ["Phone", worker.phone],
                  ["Email", worker.email],
                  ["Address", worker.address ?? "—"],
                  ["NID Number", worker.nid ?? "—"],
                  ["Location", worker.location],
                  ["Hourly rate", money2(worker.rate)],
                  ["Joining date", fmtDate(worker.joined)],
                  [
                    "Expiry date",
                    `${fmtDate(worker.expiry)} · ${left < 0 ? `${Math.abs(left)}d overdue` : `${left}d left`}`,
                  ],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-secondary/60 p-3">
                    <p className="text-xs text-muted-foreground">{k}</p>
                    <p className="mt-0.5 text-sm font-medium">{v}</p>
                  </div>
                ))}
              </div>

              <p className="mt-6 mb-2 text-sm font-semibold">Passport, visa &amp; SIA badge</p>
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  ["Employment type", worker.workerType || "Direct"],
                  ...(worker.workerType === "Sub-contract"
                    ? [["Sub-contract company", worker.subcontractCompany || "—"] as [string, string]]
                    : []),
                  ["Passport country", worker.passportCountry || "—"],
                  ["Passport number", worker.passportNumber || "—"],
                  ["Passport expiry", worker.passportExpiry ? fmtDate(worker.passportExpiry) : "—"],
                  ["Visa number", worker.visaNumber || "—"],
                  ["Visa expiry", worker.visaExpiry ? fmtDate(worker.visaExpiry) : "—"],
                  ["SIA badge number", worker.siaBadgeNumber || "—"],
                  ["SIA badge expiry", worker.siaBadgeExpiry ? fmtDate(worker.siaBadgeExpiry) : "—"],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl bg-secondary/60 p-3">
                    <p className="text-xs text-muted-foreground">{k}</p>
                    <p className="mt-0.5 text-sm font-medium">{v}</p>
                  </div>
                ))}
              </div>

              <p className="mt-6 mb-2 text-sm font-semibold">NID documents</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {["NID Front", "NID Back"].map((d) => (
                  <div
                    key={d}
                    className="flex h-28 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-secondary/40 text-muted-foreground"
                  >
                    <FileImage className="size-6" />
                    <span className="text-xs">{d} preview</span>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex flex-wrap gap-3">
                {(status === "Expiring Soon" || status === "Expired") && (
                  <button
                    onClick={() => reactivateWorker(worker.id)}
                    className="flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground"
                  >
                    <RotateCcw className="size-4" /> Reactivate contract
                  </button>
                )}
                <Link
                  to="/admin/workers"
                  onClick={() => deleteWorker(worker.id)}
                  className="flex h-10 items-center gap-2 rounded-lg border border-border px-5 text-sm font-medium text-danger"
                >
                  <Trash2 className="size-4" /> Remove worker
                </Link>
              </div>
            </div>
          </div>
        </Card>

        <ComplianceSection workerId={worker.id} onSaved={() => loadWorkers()} />

        <Card className="p-0">
          <div className="p-5">
            <h2 className="text-base font-semibold">Attendance history ({rows.length})</h2>
          </div>
          <DataTable
            labels={["Date", "Check In", "Check Out", "Hours", "Location", "Source"]}
            head={
              <>
                <Th>Date</Th>
                <Th>Check In</Th>
                <Th>Check Out</Th>
                <Th>Hours</Th>
                <Th>Location</Th>
                <Th>Source</Th>
              </>
            }
          >
            {(!rows || rows.length === 0) && <EmptyRow colSpan={6} text="No attendance recorded yet." />}
            {(rows || []).map((r) => (
              <tr key={r.id} className="hover:bg-secondary/40">
                <Td>{fmtDate(r.date)}</Td>
                <Td>{r.in}</Td>
                <Td>{r.out || "—"}</Td>
                <Td className="font-medium">{Number(r.hours ?? 0).toFixed(2)}h</Td>
                <Td>
                  <div className="leading-tight">
                    <p>{r.location}</p>
                    {r.locationMismatch && (
                      <p className="text-xs font-medium text-danger">Location Mismatch</p>
                    )}
                  </div>
                </Td>
                <Td><StatusBadge status={r.source} /></Td>
              </tr>
            ))}
          </DataTable>
        </Card>

        <Card className="p-0">
          <div className="p-5">
            <h2 className="text-base font-semibold">Payroll history ({pays.length})</h2>
          </div>
          <DataTable
            labels={["Payroll ID", "Period", "Hours", "Gross", "Advance", "Net Pay", "Status"]}
            head={
              <>
                <Th>Payroll ID</Th>
                <Th>Period</Th>
                <Th>Hours</Th>
                <Th>Gross</Th>
                <Th>Advance</Th>
                <Th>Net Pay</Th>
                <Th>Status</Th>
              </>
            }
          >
            {(!pays || pays.length === 0) && <EmptyRow colSpan={7} text="No payrolls generated yet." />}
            {(pays || []).map((p) => (
              <tr key={p.id} className="hover:bg-secondary/40">
                <Td className="font-medium">{p.id}</Td>
                <Td>{fmtDate(p.from)} — {fmtDate(p.to)}</Td>
                <Td>{p.hours}h</Td>
                <Td>{money2(p.gross)}</Td>
                <Td>{p.advance ? money2(p.advance) : "—"}</Td>
                <Td className="font-medium">{money2(p.net)}</Td>
                <Td><StatusBadge status={p.status} /></Td>
              </tr>
            ))}
          </DataTable>
        </Card>
      </div>
    </AdminShell>
  );
}
