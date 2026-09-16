import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, RefreshCw, Trash2, Check } from "lucide-react";
import { AdminShell } from "@/components/hr/admin-shell";
import {
  Card, DataTable, EmptyRow, Field, GhostButton, Modal, Person,
  PrimaryButton, StatusBadge, Td, Th, inputCls,
} from "@/components/hr/bits";
import { apiClient } from "@/lib/api-client";
import { fmtDate } from "@/lib/hr-utils";

export const Route = createFileRoute("/admin/team")({
  head: () => ({
    meta: [
      { title: "Team — WorkHR" },
      { name: "description", content: "Manage admin accounts and invite new administrators." },
    ],
  }),
  component: TeamPage,
});

type Admin = {
  id: number;
  name: string;
  email: string;
  note: string | null;
  createdAt: string;
  status: "active" | "invited";
  isSelf: boolean;
};

function InviteModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await apiClient.post("/api/admins", { name, email, note });
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message || "Failed to send invitation");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add Admin"
      description="They'll receive an email with a password setup link. Once they set a password, they become an active admin."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name">
          <input required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Rahim Uddin" />
        </Field>
        <Field label="Email">
          <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="rahim@example.com" />
        </Field>
        <Field label="Note" hint="Optional — short details included in the invite email (e.g. role, responsibilities)">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className={`${inputCls} h-auto py-2`}
            placeholder="Payroll & shift coordinator"
          />
        </Field>
        {err && <p className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <GhostButton type="button" onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={busy}>{busy ? "Sending..." : "Send invitation"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function TeamPage() {
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAdmins(await apiClient.get<Admin[]>("/api/admins"));
    } catch (e: any) {
      setError(e.message || "Failed to load admins");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const resend = async (a: Admin) => {
    setBusyId(a.id);
    try {
      await apiClient.post(`/api/admins/${a.id}/resend-invite`);
      setFlash(`Invitation resent to ${a.email}`);
    } catch (e: any) {
      setFlash(e.message || "Failed to resend invitation");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (a: Admin) => {
    if (!window.confirm(`Remove ${a.name} (${a.email}) as an admin?`)) return;
    setBusyId(a.id);
    try {
      await apiClient.delete(`/api/admins/${a.id}`);
      setFlash(`${a.name} removed.`);
      await load();
    } catch (e: any) {
      setFlash(e.message || "Failed to remove admin");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AdminShell
      title="Team"
      action={
        <PrimaryButton onClick={() => setShowInvite(true)}>
          <Plus className="size-4" /> Add Admin
        </PrimaryButton>
      }
    >
      {showInvite && <InviteModal onClose={() => setShowInvite(false)} onSaved={() => { setFlash("Invitation sent."); void load(); }} />}

      <div className="space-y-3">
        {flash && (
          <div className="card-surface flex items-center gap-3 px-5 py-3 text-sm">
            <Check className="size-4 text-success" />
            <span>{flash}</span>
            <button onClick={() => setFlash(null)} className="ml-auto text-muted-foreground">×</button>
          </div>
        )}

        <Card className="p-0">
          <div className="flex items-center justify-between p-5">
            <h2 className="text-base font-semibold">Admin accounts ({admins.length})</h2>
            <p className="text-xs text-muted-foreground">Everyone here has full admin access</p>
          </div>
          <DataTable
            labels={["Admin", "Email", "Details", "Joined", "Status", "Action"]}
            head={
              <>
                <Th>Admin</Th>
                <Th>Email</Th>
                <Th>Details</Th>
                <Th>Joined</Th>
                <Th>Status</Th>
                <Th className="text-right">Action</Th>
              </>
            }
          >
            {loading ? (
              <EmptyRow colSpan={6} text="Loading admins..." />
            ) : error ? (
              <EmptyRow colSpan={6} text={error} />
            ) : admins.length === 0 ? (
              <EmptyRow colSpan={6} text="No admins found." />
            ) : (
              admins.map((a) => (
                <tr key={a.id} className="hover:bg-secondary/40">
                  <Td><Person name={a.name} {...(a.isSelf ? { sub: "You" } : {})} /></Td>
                  <Td>{a.email}</Td>
                  <Td className="max-w-56"><span className="block truncate text-muted-foreground">{a.note || "—"}</span></Td>
                  <Td>{fmtDate(a.createdAt)}</Td>
                  <Td><StatusBadge status={a.status === "active" ? "Active" : "Pending"} /></Td>
                  <Td>
                    <div className="flex justify-end gap-2">
                      {a.status === "invited" && (
                        <button
                          onClick={() => resend(a)}
                          disabled={busyId === a.id}
                          className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium hover:bg-secondary disabled:opacity-50"
                        >
                          <RefreshCw className={`size-3.5 ${busyId === a.id ? "animate-spin" : ""}`} /> Resend
                        </button>
                      )}
                      {!a.isSelf && (
                        <button
                          onClick={() => remove(a)}
                          disabled={busyId === a.id}
                          className="flex h-8 items-center gap-1.5 rounded-lg bg-danger-soft px-3 text-xs font-medium text-danger hover:opacity-90 disabled:opacity-50"
                        >
                          <Trash2 className="size-3.5" /> Remove
                        </button>
                      )}
                    </div>
                  </Td>
                </tr>
              ))
            )}
          </DataTable>
        </Card>
      </div>
    </AdminShell>
  );
}
