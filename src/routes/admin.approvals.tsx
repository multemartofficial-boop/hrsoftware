import { useState, useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, X, ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/hr/admin-shell";
import { Card, DataTable, EmptyRow, Field, GhostButton, Modal, Person, PrimaryButton, StatusBadge, Td, Th, inputCls } from "@/components/hr/bits";
import { type Application } from "@/lib/mock-data";
import { ApplicationDetail } from "@/components/hr/application-detail";
import { useApi } from "@/lib/api-store";
import { fmtDate } from "@/lib/hr-utils";

export const Route = createFileRoute("/admin/approvals")({
  head: () => ({
    meta: [
      { title: "Registration Approvals — WorkHR" },
      { name: "description", content: "Review pending worker applications and approve or reject bio-data submissions." },
      { property: "og:title", content: "Registration Approvals — WorkHR" },
      { property: "og:description", content: "Review pending worker applications and approve or reject bio-data submissions." },
    ],
  }),
  component: Approvals,
});

function Detail({
  app,
  onBack,
  onApprove,
  onReject,
  processing,
}: {
  app: Application;
  onBack: () => void;
  onApprove: () => void;
  onReject: () => void;
  processing?: boolean;
}) {
  return (
    <Card>
      <button
        type="button"
        onClick={onBack}
        className="mb-5 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to applications
      </button>

      <ApplicationDetail app={app} />

      <div className="mt-6 flex flex-wrap gap-3 border-t border-border pt-5">
        <button
          type="button"
          onClick={onApprove}
          className="flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          <Check className="size-4" /> Approve
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={processing}
          className="flex h-10 items-center gap-2 rounded-lg border border-border px-5 text-sm font-medium text-danger disabled:opacity-50"
        >
          <X className="size-4" /> {processing ? "Rejecting…" : "Reject"}
        </button>
      </div>
    </Card>
  );
}

function RateConfirmModal({
  app,
  onConfirm,
  onCancel,
}: {
  app: Application;
  onConfirm: (pay: { payType: "hourly" | "salary"; rate?: number; monthlySalary?: number; employmentType?: "full_time" | "irregular" }) => Promise<void>;
  onCancel: () => void;
}) {
  const expected = Number(app.rate) || 0;
  const [payType, setPayType] = useState<"hourly" | "salary">("hourly");
  const [employmentType, setEmploymentType] = useState<"full_time" | "irregular">("irregular");
  const [rate, setRate] = useState(expected > 0 ? expected.toFixed(2) : "");
  const [saving, setSaving] = useState(false);
  const isSubcontract = app.workerType === "Sub-contract";
  const parsed = Number(rate);
  // Sub-contract staff may be £0.00/h — hours are recorded but the
  // sub-contract company pays them.
  const valid = Number.isFinite(parsed) && (isSubcontract ? parsed >= 0 : parsed > 0);
  const changed = payType === "hourly" && valid && Math.abs(parsed - expected) > 0.004;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    try {
      const amount = Math.round(parsed * 100) / 100;
      await onConfirm(
        payType === "salary"
          ? { payType, monthlySalary: amount, employmentType }
          : { payType, rate: amount, employmentType },
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Confirm pay"
      description={`Approving ${app.name} (${app.id})`}
      onClose={onCancel}
    >
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {payType === "hourly" ? (
            expected > 0 ? (
              <>
                This applicant expects{" "}
                <strong className="text-foreground">£{expected.toFixed(2)}/hour</strong>. Do you want to continue with
                this rate, or set a different rate?
              </>
            ) : (
              <>No expected hourly rate was provided. Please set the worker&apos;s hourly rate below.</>
            )
          ) : (
            <>Monthly-salaried workers are paid a fixed amount per month, prorated by calendar days for partial periods — attendance is still tracked for records but is not multiplied by a rate.</>
          )}{" "}
          {payType === "hourly" && "The confirmed rate becomes the worker's hourly rate used for all payroll calculations."}
          {isSubcontract && (
            <span className="mt-1 block text-xs">
              Sub-contract applicant{app.subcontractCompany ? ` (${app.subcontractCompany})` : ""} — £0.00/h is allowed: hours are tracked for records and the sub-contract company handles their pay and holiday.
            </span>
          )}
        </p>
        <Field label="Pay type" hint="Choose how this worker is paid">
          <div className="grid grid-cols-2 gap-2">
            {(["hourly", "salary"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setPayType(t)}
                className={`h-10 rounded-lg border text-sm font-medium transition-colors ${
                  payType === t
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-secondary"
                }`}
              >
                {t === "hourly" ? "Hourly" : "Monthly Salary"}
              </button>
            ))}
          </div>
        </Field>
        <Field
          label="Contract type"
          hint={
            employmentType === "full_time"
              ? "Permanent staff — statutory 28-day holiday entitlement, pro-rated from their join date (1/12th per month)."
              : "Zero-hours / casual staff — holiday accrues at 12.07% of hours worked (rolled-up)."
          }
        >
          <div className="grid grid-cols-2 gap-2">
            {([
              ["irregular", "Irregular · Zero-hours"],
              ["full_time", "Full-time Permanent"],
            ] as const).map(([t, label]) => (
              <button
                key={t}
                type="button"
                onClick={() => setEmploymentType(t)}
                className={`h-10 rounded-lg border text-sm font-medium transition-colors ${
                  employmentType === t
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-secondary"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>
        <Field
          label={payType === "salary" ? "Monthly salary (£)" : "Hourly rate (£)"}
          hint={
            payType === "salary"
              ? "Fixed amount per calendar month — prorated automatically for partial periods"
              : expected > 0
                ? (changed ? `Changed from applicant's expected £${expected.toFixed(2)}` : "Applicant's expected rate")
                : "Enter the worker's hourly rate"
          }
        >
          <input
            type="number"
            min="0.01"
            step="0.01"
            required
            autoFocus
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className={inputCls}
          />
        </Field>
        {!valid && rate !== "" && (
          <p className="text-xs text-danger">
            {payType === "salary" ? "Enter a salary greater than 0." : "Enter a rate greater than 0."}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <GhostButton type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </GhostButton>
          <PrimaryButton type="submit" disabled={!valid || saving}>
            <Check className="size-4" /> {saving ? "Approving…" : payType === "salary" ? "Approve as salaried" : changed ? "Approve with new rate" : "Approve with this rate"}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function Approvals() {
  const { applications, rejected, workers, approveApplication, rejectApplication, resendSetupLink, loading, error, loadAllApplications } = useApi();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [flashWorkerId, setFlashWorkerId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const selected = (applications || []).find((a) => a.id === selectedId) ?? null;
  const confirming = (applications || []).find((a) => a.id === confirmingId) ?? null;

  // Separate approved applications into awaiting setup vs completed.
  // Prefer the server-computed passwordSet flag (worker row + password_hash),
  // falling back to worker-existence only when the flag isn't available.
  const isSetupComplete = (a: any) =>
    a.passwordSet != null ? a.passwordSet : workers?.some(w => w.id === a.workerId) ?? false;
  const awaitingSetup = (applications || []).filter(a => a.status === 'approved' && !isSetupComplete(a));
  const completedSetup = (applications || []).filter(a => a.status === 'approved' && isSetupComplete(a));

  // Load all applications on mount
  useEffect(() => {
    loadAllApplications();
  }, []);

  // Step 1: clicking Approve opens the rate confirmation; nothing is sent yet.
  const approve = (id: string) => setConfirmingId(id);

  // Step 2: admin confirmed the pay type and amount — now actually approve.
  const confirmApprove = async (id: string, pay: { payType: "hourly" | "salary"; rate?: number; monthlySalary?: number; employmentType?: "full_time" | "irregular" }) => {
    const result = await approveApplication(id, pay);
    setConfirmingId(null);
    setSelectedId(null);
    await loadAllApplications();
    if (result) {
      setFlashWorkerId(result.workerId);
      const payLabel = pay.payType === "salary"
        ? `Salary £${Number(result.monthlySalary ?? pay.monthlySalary).toFixed(2)}/month`
        : `Rate £${Number(result.rate ?? pay.rate).toFixed(2)}/h`;
      const contractLabel = pay.employmentType === "full_time" ? "Full-time" : "Zero-hours";
      setFlash(`Application approved — Worker Code: ${result.workerId} · ${contractLabel} · ${payLabel} · Setup link sent to email.`);
    }
  };

  const reject = async (id: string, name: string) => {
    setProcessingId(id);
    await rejectApplication(id);
    setProcessingId(null);
    setSelectedId(null);
    await loadAllApplications();
    setFlashWorkerId(null);
    setFlash(`${name}'s application was rejected.`);
  };

  const resend = async (id: string) => {
    const result = await resendSetupLink(id);
    await loadAllApplications();
    if (result) {
      setFlash(`Setup link resent successfully.`);
    }
  };

  if (loading["applications"]) {
    return (
      <AdminShell title="Registration Approvals">
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Loading applications...</div>
        </div>
      </AdminShell>
    );
  }

  if (error) {
    return (
      <AdminShell title="Registration Approvals">
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <div className="text-red-500 font-medium">Failed to load applications</div>
          <div className="text-sm text-muted-foreground">{error}</div>
          <button
            onClick={() => loadAllApplications()}
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
      title="Registration Approvals"
      action={
        <Link
          to="/register"
          className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          <ExternalLink className="size-4" /> Worker Registration
        </Link>
      }
    >
      {confirming && (
        <RateConfirmModal
          app={confirming}
          onConfirm={(pay) => confirmApprove(confirming.id, pay)}
          onCancel={() => setConfirmingId(null)}
        />
      )}
      <div className="space-y-3">
        {flash && (
          <div className="card-surface flex items-center gap-3 px-5 py-3 text-sm">
            <Check className="size-4 text-success" />
            <span>{flash}</span>
            {flashWorkerId && (
              <Link
                to="/admin/workers/$id"
                params={{ id: flashWorkerId }}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
              >
                View Worker
              </Link>
            )}
            <button onClick={() => { setFlash(null); setFlashWorkerId(null); }} className="ml-auto text-muted-foreground">
              <X className="size-4" />
            </button>
          </div>
        )}

        {selected ? (
          <Detail
            app={selected}
            onBack={() => setSelectedId(null)}
            onApprove={() => approve(selected.id)}
            onReject={() => reject(selected.id, selected.name)}
            processing={processingId === selected.id}
          />
        ) : (
          <Card className="p-0">
            <div className="flex items-center justify-between p-5">
              <h2 className="text-base font-semibold">Pending Applications ({applications?.filter(a => a.status === 'pending').length ?? 0})</h2>
              <p className="text-xs text-muted-foreground">Click a row to view full bio-data</p>
            </div>
            <DataTable
              labels={["Application ID", "Applicant", "Applied For", "Submitted", "Status", "Action"]}
              head={
                <>
                  <Th>Application ID</Th>
                  <Th>Applicant</Th>
                  <Th>Applied For</Th>
                  <Th>Submitted</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Action</Th>
                </>
              }
            >
              {(!applications || applications.filter(a => a.status === 'pending').length === 0) && <EmptyRow colSpan={6} text="No pending applications." />}
              {(applications || []).filter(a => a.status === 'pending').map((a) => (
                <tr key={a.id} className="cursor-pointer hover:bg-secondary/40" onClick={() => setSelectedId(a.id)}>
                  <Td className="font-medium">{a.id}</Td>
                  <Td><Person name={a.name} sub={a.email} /></Td>
                  <Td>{a.appliedFor}</Td>
                  <Td>{fmtDate(a.submitted)}</Td>
                  <Td><StatusBadge status="Pending" /></Td>
                  <Td>
                    <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); approve(a.id); }}
                        disabled={confirmingId === a.id}
                        className="flex h-8 items-center gap-1.5 rounded-lg bg-success-soft px-3 text-xs font-medium text-success disabled:opacity-50"
                      >
                        <Check className="size-3.5" /> Approve
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); reject(a.id, a.name); }}
                        disabled={processingId === a.id}
                        className="flex h-8 items-center gap-1.5 rounded-lg bg-danger-soft px-3 text-xs font-medium text-danger disabled:opacity-50"
                      >
                        {processingId === a.id ? (
                          <><RefreshCw className="size-3.5 animate-spin" /> Rejecting…</>
                        ) : (
                          <><X className="size-3.5" /> Reject</>
                        )}
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </DataTable>
          </Card>
        )}

        {rejected.length > 0 && (
          <Card className="p-0">
            <div className="p-5">
              <h2 className="text-base font-semibold">Rejected log ({rejected.length})</h2>
            </div>
            <DataTable
              labels={["Application ID", "Applicant", "Applied For", "Rejected On", "Status"]}
              head={
                <>
                  <Th>Application ID</Th>
                  <Th>Applicant</Th>
                  <Th>Applied For</Th>
                  <Th>Rejected On</Th>
                  <Th>Status</Th>
                </>
              }
            >
              {(rejected || []).map((r) => (
                <tr key={r.id} className="hover:bg-secondary/40">
                  <Td className="font-medium">{r.id}</Td>
                  <Td><Person name={r.name} sub={r.email} /></Td>
                  <Td>{r.appliedFor}</Td>
                  <Td>{fmtDate(r.rejectedOn)}</Td>
                  <Td><StatusBadge status="Rejected" /></Td>
                </tr>
              ))}
            </DataTable>
          </Card>
        )}

        {/* Approved but not yet completed setup */}
        {awaitingSetup.length > 0 && (
          <Card className="p-0">
            <div className="p-5">
              <h2 className="text-base font-semibold">Awaiting Password Setup ({awaitingSetup.length})</h2>
            </div>
            <DataTable
              labels={["Application ID", "Applicant", "Worker Code", "Approved On", "Action"]}
              head={
                <>
                  <Th>Application ID</Th>
                  <Th>Applicant</Th>
                  <Th>Worker Code</Th>
                  <Th>Approved On</Th>
                  <Th className="text-right">Action</Th>
                </>
              }
            >
              {awaitingSetup.map((a) => (
                <tr key={a.id} className="hover:bg-secondary/40">
                  <Td className="font-medium">{a.id}</Td>
                  <Td><Person name={a.name} sub={a.email} /></Td>
                  <Td className="font-medium">{a.workerId || 'Pending'}</Td>
                  <Td>{fmtDate(a.submitted)}</Td>
                  <Td>
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => resend(a.id)}
                        className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium hover:bg-secondary"
                      >
                        <RefreshCw className="size-3.5" /> Resend Link
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
            </DataTable>
          </Card>
        )}

        {/* Completed setup */}
        {completedSetup.length > 0 && (
          <Card className="p-0">
            <div className="p-5">
              <h2 className="text-base font-semibold">Completed Setup ({completedSetup.length})</h2>
            </div>
            <DataTable
              labels={["Application ID", "Applicant", "Worker Code", "Completed On", "Action"]}
              head={
                <>
                  <Th>Application ID</Th>
                  <Th>Applicant</Th>
                  <Th>Worker Code</Th>
                  <Th>Completed On</Th>
                  <Th className="text-right">Action</Th>
                </>
              }
            >
              {completedSetup.map((a) => (
                <tr key={a.id} className="hover:bg-secondary/40">
                  <Td className="font-medium">{a.id}</Td>
                  <Td><Person name={a.name} sub={a.email} /></Td>
                  <Td className="font-medium">{a.workerId}</Td>
                  <Td>{fmtDate(a.worker_joined || a.submitted)}</Td>
                  <Td>
                    <div className="flex justify-end gap-2">
                      <Link
                        to="/admin/workers/$id"
                        params={{ id: a.workerId || '' }}
                        className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium hover:bg-secondary"
                      >
                        View Worker
                      </Link>
                    </div>
                  </Td>
                </tr>
              ))}
            </DataTable>
          </Card>
        )}
      </div>
    </AdminShell>
  );
}
