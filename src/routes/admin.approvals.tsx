import { useState, useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, X, ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/hr/admin-shell";
import { Card, DataTable, EmptyRow, Person, StatusBadge, Td, Th } from "@/components/hr/bits";
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
}: {
  app: Application;
  onBack: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <Card>
      <button onClick={onBack} className="mb-5 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to applications
      </button>

      <ApplicationDetail app={app} />

      <div className="mt-6 flex flex-wrap gap-3 border-t border-border pt-5">
        <button onClick={onApprove} className="flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground">
          <Check className="size-4" /> Approve
        </button>
        <button onClick={onReject} className="flex h-10 items-center gap-2 rounded-lg border border-border px-5 text-sm font-medium text-danger">
          <X className="size-4" /> Reject
        </button>
      </div>
    </Card>
  );
}

function Approvals() {
  const { applications, rejected, approveApplication, rejectApplication, resendSetupLink, loading, error, loadAllApplications } = useApi();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [flashWorkerId, setFlashWorkerId] = useState<string | null>(null);
  const selected = (applications || []).find((a) => a.id === selectedId) ?? null;

  // Load all applications on mount
  useEffect(() => {
    loadAllApplications();
  }, []);

  const approve = async (id: string) => {
    const result = await approveApplication(id);
    setSelectedId(null);
    await loadAllApplications();
    if (result) {
      setFlashWorkerId(result.workerId);
      setFlash(`Application approved — Worker Code: ${result.workerId} · Setup link sent to email.`);
    }
  };

  const reject = async (id: string, name: string) => {
    await rejectApplication(id);
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

  if (loading.applications) {
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
            onClick={() => loadApplications()}
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
          <ExternalLink className="size-4" /> Public form
        </Link>
      }
    >
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
                        onClick={() => approve(a.id)}
                        className="flex h-8 items-center gap-1.5 rounded-lg bg-success-soft px-3 text-xs font-medium text-success"
                      >
                        <Check className="size-3.5" /> Approve
                      </button>
                      <button
                        onClick={() => reject(a.id, a.name)}
                        className="flex h-8 items-center gap-1.5 rounded-lg bg-danger-soft px-3 text-xs font-medium text-danger"
                      >
                        <X className="size-3.5" /> Reject
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
        {applications && applications.some(a => a.status === 'approved') && (
          <Card className="p-0">
            <div className="p-5">
              <h2 className="text-base font-semibold">Awaiting Password Setup ({applications.filter(a => a.status === 'approved').length})</h2>
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
              {applications.filter(a => a.status === 'approved').map((a) => (
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
      </div>
    </AdminShell>
  );
}
