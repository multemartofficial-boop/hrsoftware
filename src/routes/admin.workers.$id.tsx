import { useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, Copy, Check, RotateCcw, FileImage, Trash2 } from "lucide-react";
import { AdminShell } from "@/components/hr/admin-shell";
import { Card, DataTable, EmptyRow, StatusBadge, Td, Th } from "@/components/hr/bits";
import { avatarUrl, money2 } from "@/lib/mock-data";
import { useApi } from "@/lib/api-store";
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

function WorkerDetails() {
  const { id } = useParams({ from: "/admin/workers/$id" });
  const { workers, attendance, payrolls, workerStatus, reactivateWorker, deleteWorker, loading } = useApi();
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
              <div className="mt-3 flex justify-center"><StatusBadge status={status} /></div>
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
                <Td>{r.location}</Td>
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
