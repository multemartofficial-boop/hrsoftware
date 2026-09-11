import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, RefreshCw, Building2, MapPin, Trash2, KeyRound, Pencil } from "lucide-react";
import { AdminShell } from "@/components/hr/admin-shell";
import {
  Card, Field, GhostButton, Modal, PrimaryButton, inputCls,
  DataTable, Th, Td, EmptyRow, SectionTitle,
} from "@/components/hr/bits";
import { apiClient } from "@/lib/api-client";
import { fmtDate } from "@/lib/hr-utils";
import { useApi } from "@/lib/api-store";

export const Route = createFileRoute("/admin/clients")({
  head: () => ({
    meta: [
      { title: "Clients — WorkHR" },
      { name: "description", content: "Manage client portal accounts and their site links." },
    ],
  }),
  component: ClientsPage,
});

type Client = {
  id: string;
  userId: number;
  name: string;
  company: string;
  email: string;
  buyerName: string | null;
  locations: { id: string; name: string; address: string }[];
  createdAt: string;
};

function LocationPicker({
  selected, onChange,
}: { selected: Set<string>; onChange: (s: Set<string>) => void }) {
  const { locations } = useApi();
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  };
  return (
    <div className="mt-1.5 max-h-40 overflow-y-auto rounded-lg border border-border">
      {(locations || []).map((l) => (
        <label key={l.id} className="flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-secondary/40">
          <input
            type="checkbox"
            checked={selected.has(l.id)}
            onChange={() => toggle(l.id)}
            className="size-4 accent-primary"
          />
          <span className="flex-1">{l.name}</span>
          <span className="text-xs text-muted-foreground">{l.address}</span>
        </label>
      ))}
      {(locations || []).length === 0 && (
        <p className="px-3 py-4 text-sm text-muted-foreground">No locations configured.</p>
      )}
    </div>
  );
}

function ClientForm({
  existing, onClose, onSaved,
}: { existing: Client | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(existing?.name ?? "");
  const [company, setCompany] = useState(existing?.company ?? "");
  const [email, setEmail] = useState(existing?.email ?? "");
  const [password, setPassword] = useState("");
  const [buyerName, setBuyerName] = useState(existing?.buyerName ?? "");
  const [locIds, setLocIds] = useState<Set<string>>(new Set((existing?.locations ?? []).map(l => l.id)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      if (existing) {
        await apiClient.put(`/api/clients/${existing.id}`, {
          name, company, email, buyerName: buyerName || company, locationIds: [...locIds],
        });
      } else {
        await apiClient.post("/api/clients", {
          name, company, email, password, buyerName: buyerName || company, locationIds: [...locIds],
        });
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message || "Failed to save client");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={existing ? `Edit ${existing.company}` : "Add client account"}
      description={
        existing
          ? "Update the client's details and which sites they can see."
          : "Creates a login for the client portal. They sign in on the Client tab with this email + password."
      }
      onClose={onClose}
      wide
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Contact name">
            <input required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Jane Smith" />
          </Field>
          <Field label="Company">
            <input required value={company} onChange={(e) => setCompany(e.target.value)} className={inputCls} placeholder="Acme Facilities Ltd" />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Email (login)">
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="jane@acme.com" />
          </Field>
          {!existing && (
            <Field label="Initial password">
              <input required type="text" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} placeholder="min 6 characters" />
            </Field>
          )}
          <Field label="Buyer name (billing link)">
            <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} className={inputCls} placeholder={company || "Matches buyer_income buyer_name"} />
          </Field>
        </div>
        <Field label="Locations this client can see">
          <LocationPicker selected={locIds} onChange={setLocIds} />
        </Field>
        {err && <p className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <GhostButton type="button" onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? "Saving..." : existing ? "Save changes" : "Create client"}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordForm({ client, onClose }: { client: Client; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await apiClient.post(`/api/clients/${client.id}/reset-password`, { password });
      setDone(true);
    } catch (e: any) {
      setErr(e.message || "Failed to reset password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Reset password — ${client.company}`} description="Set a new password for this client account." onClose={onClose}>
      {done ? (
        <div className="space-y-4">
          <p className="rounded-lg bg-success-soft px-3 py-2 text-sm font-medium text-success">Password updated.</p>
          <div className="flex justify-end"><GhostButton onClick={onClose}>Close</GhostButton></div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="New password">
            <input required type="text" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} placeholder="min 6 characters" />
          </Field>
          {err && <p className="text-sm text-danger">{err}</p>}
          <div className="flex justify-end gap-2">
            <GhostButton type="button" onClick={onClose}>Cancel</GhostButton>
            <PrimaryButton type="submit" disabled={busy}>{busy ? "Saving..." : "Reset password"}</PrimaryButton>
          </div>
        </form>
      )}
    </Modal>
  );
}

function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [resetting, setResetting] = useState<Client | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setClients(await apiClient.get<Client[]>("/api/clients"));
    } catch (e) {
      console.error("Load clients failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const del = async (c: Client) => {
    if (!confirm(`Delete client account for ${c.company}? Their login will stop working.`)) return;
    try {
      await apiClient.delete(`/api/clients/${c.id}`);
      void load();
    } catch (e) {
      console.error("Delete client failed:", e);
    }
  };

  return (
    <AdminShell
      title="Clients"
      action={
        <div className="flex items-center gap-2">
          <button onClick={() => void load()} className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium">
            <RefreshCw className="size-4" /> Refresh
          </button>
          <button
            onClick={() => { setEditing(null); setOpen(true); }}
            className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            <Plus className="size-4" /> Add Client
          </button>
        </div>
      }
    >
      <Card>
        <SectionTitle title="Client portal accounts" />
        <DataTable
          labels={["Client", "Company", "Buyer link", "Locations", "Created", ""]}
          head={
            <>
              <Th>Client</Th>
              <Th>Company</Th>
              <Th>Buyer link</Th>
              <Th>Locations</Th>
              <Th>Created</Th>
              <Th className="text-right">Actions</Th>
            </>
          }
        >
          {loading ? (
            <EmptyRow colSpan={6} text="Loading clients…" />
          ) : clients.length === 0 ? (
            <EmptyRow colSpan={6} text="No client accounts yet. Add one to give a buyer portal access." />
          ) : (
            clients.map((c) => (
              <tr key={c.id}>
                <Td>
                  <div className="leading-tight">
                    <div className="text-sm font-medium">{c.name}</div>
                    <div className="text-xs text-muted-foreground">{c.email}</div>
                  </div>
                </Td>
                <Td>
                  <span className="flex items-center gap-1.5 font-medium">
                    <Building2 className="size-4 text-muted-foreground" /> {c.company}
                  </span>
                </Td>
                <Td className="text-muted-foreground">{c.buyerName || "—"}</Td>
                <Td>
                  {c.locations.length === 0 ? (
                    <span className="text-xs text-muted-foreground">None linked</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {c.locations.map((l) => (
                        <span key={l.id} className="flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs">
                          <MapPin className="size-3" /> {l.name}
                        </span>
                      ))}
                    </div>
                  )}
                </Td>
                <Td className="whitespace-nowrap text-muted-foreground">{fmtDate(c.createdAt)}</Td>
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      title="Edit client"
                      onClick={() => { setEditing(c); setOpen(true); }}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      title="Reset password"
                      onClick={() => setResetting(c)}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
                    >
                      <KeyRound className="size-4" />
                    </button>
                    <button
                      title="Delete client"
                      onClick={() => void del(c)}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-danger"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </Td>
              </tr>
            ))
          )}
        </DataTable>
      </Card>

      {open && (
        <ClientForm
          existing={editing}
          onClose={() => { setOpen(false); setEditing(null); }}
          onSaved={load}
        />
      )}
      {resetting && <ResetPasswordForm client={resetting} onClose={() => setResetting(null)} />}
    </AdminShell>
  );
}
