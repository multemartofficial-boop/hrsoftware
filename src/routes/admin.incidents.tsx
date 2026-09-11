import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { jsPDF } from "jspdf";
import {
  TriangleAlert,
  RefreshCw,
  FileImage,
  FileText,
  ExternalLink,
  Loader2,
  X,
  Download,
  Paperclip,
} from "lucide-react";
import { AdminShell } from "@/components/hr/admin-shell";
import {
  Card,
  DataTable,
  EmptyRow,
  Modal,
  Td,
  Th,
  inputCls,
} from "@/components/hr/bits";
import { apiClient } from "@/lib/api-client";
import { fmtDateTime } from "@/lib/hr-utils";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/incidents")({
  head: () => ({
    meta: [
      { title: "Incidents — WorkHR" },
      { name: "description", content: "Worker-reported incidents, triage and internal notes." },
    ],
  }),
  component: IncidentsPage,
});

type Attachment = { index: number; name: string; url: string };
type InternalNote = { note: string; author: string; at: string };
type Incident = {
  id: string;
  reportedBy: string;
  reporterName: string;
  locationId: string | null;
  locationName: string | null;
  attendanceId: string | null;
  category: string;
  description: string;
  severity: "Low" | "Medium" | "High" | "Critical";
  status: "Open" | "Under Review" | "Resolved" | "Closed";
  internalNotes?: InternalNote[];
  attachments: Attachment[];
  createdAt: string;
  updatedAt: string;
};

const CATEGORIES = ["Theft", "Injury", "Property Damage", "Altercation", "Safety Hazard", "Other"];
const SEVERITIES = ["Low", "Medium", "High", "Critical"] as const;
const STATUSES = ["Open", "Under Review", "Resolved", "Closed"] as const;

const severityTone: Record<string, string> = {
  Low: "bg-secondary text-muted-foreground",
  Medium: "bg-primary-soft text-primary",
  High: "bg-warning-soft text-warning",
  Critical: "bg-danger-soft text-danger",
};
const statusTone: Record<string, string> = {
  Open: "bg-warning-soft text-warning",
  "Under Review": "bg-primary-soft text-primary",
  Resolved: "bg-success-soft text-success",
  Closed: "bg-secondary text-muted-foreground",
};

/** Secure attachment tile — loads via the authenticated endpoint, previews in a lightbox. */
function AttachmentTile({ incidentId, att }: { incidentId: string; att: Attachment }) {
  const [open, setOpen] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const blobRef = useRef<string | null>(null);

  const ext = (att.name.split(".").pop() || "").toLowerCase();
  const isImage = ["jpg", "jpeg", "png"].includes(ext);
  const isPdf = ext === "pdf";
  const endpoint = `/api/incidents/${incidentId}/attachment/${att.index}`;

  useEffect(() => {
    blobRef.current = blobUrl;
  }, [blobUrl]);
  useEffect(() => () => { if (blobRef.current) URL.revokeObjectURL(blobRef.current); }, []);

  const load = async () => {
    setOpen(true);
    if (blobUrl) return;
    setLoading(true);
    setErr(null);
    try {
      const blob = await apiClient.getBlob(endpoint);
      const url = URL.createObjectURL(blob);
      setBlobUrl(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load attachment");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={load}
        disabled={loading}
        className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-secondary disabled:opacity-60"
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : isImage ? (
          <FileImage className="size-4 text-muted-foreground" />
        ) : (
          <FileText className="size-4 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-left">{att.name}</span>
        <ExternalLink className="size-3.5 shrink-0 text-primary" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-foreground/60 p-4 backdrop-blur-sm">
          <div className="card-surface flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <h3 className="truncate text-sm font-semibold">{att.name}</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid size-8 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-secondary"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {loading ? (
                <div className="flex h-64 items-center justify-center text-muted-foreground">
                  <Loader2 className="mr-2 size-5 animate-spin" /> Loading attachment…
                </div>
              ) : err ? (
                <p className="text-sm text-danger">{err}</p>
              ) : isImage && blobUrl ? (
                <img src={blobUrl} alt={att.name} className="w-full rounded-lg" />
              ) : isPdf && blobUrl ? (
                <iframe src={blobUrl} title={att.name} className="h-[70vh] w-full rounded-lg" />
              ) : blobUrl ? (
                <a href={blobUrl} download={att.name} className="text-primary hover:underline">
                  Download attachment
                </a>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IncidentDetail({
  incident,
  onClose,
  onSaved,
}: {
  incident: Incident;
  onClose: () => void;
  onSaved: (i: Incident) => void;
}) {
  const [status, setStatus] = useState(incident.status);
  const [severity, setSeverity] = useState(incident.severity);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const updated = await apiClient.patch<Incident>(`/api/incidents/${incident.id}`, { status, severity });
      onSaved(updated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to update incident");
    } finally {
      setBusy(false);
    }
  };

  const addNote = async () => {
    if (!note.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const updated = await apiClient.post<Incident>(`/api/incidents/${incident.id}/notes`, { note: note.trim() });
      setNote("");
      onSaved(updated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to add note");
    } finally {
      setBusy(false);
    }
  };

  const exportPdf = () => {
    const doc = new jsPDF();
    let y = 16;
    const line = (text: string, opts?: { bold?: boolean; size?: number }) => {
      doc.setFontSize(opts?.size ?? 10);
      doc.setFont("helvetica", opts?.bold ? "bold" : "normal");
      for (const t of doc.splitTextToSize(text, 180)) {
        doc.text(t, 14, y);
        y += 6;
        if (y > 280) { doc.addPage(); y = 16; }
      }
    };

    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text("WorkHR — Incident Report", 14, y);
    y += 10;

    line(`Incident ID: ${incident.id}`, { bold: true });
    line(`Reported: ${fmtDateTime(incident.createdAt)}`);
    line(`Reported by: ${incident.reporterName} (${incident.reportedBy})`);
    line(`Location: ${incident.locationName || "Not specified"}`);
    line(`Linked shift: ${incident.attendanceId || "None"}`);
    line(`Category: ${incident.category}`);
    line(`Severity: ${incident.severity}`);
    line(`Status: ${incident.status}`);
    y += 4;
    line("Description", { bold: true, size: 12 });
    line(incident.description);
    y += 4;
    line(`Attachments: ${incident.attachments.length ? incident.attachments.map((a) => a.name).join(", ") : "None"}`);
    y += 4;
    line("Internal notes", { bold: true, size: 12 });
    if (incident.internalNotes?.length) {
      for (const n of incident.internalNotes) {
        line(`  ${fmtDateTime(n.at)} — ${n.author}: ${n.note}`);
      }
    } else {
      line("  None.");
    }
    line(`Last updated: ${fmtDateTime(incident.updatedAt)}`);
    doc.save(`incident-${incident.id}.pdf`);
  };

  return (
    <Modal
      title={`${incident.category} — ${incident.locationName || "No location"}`}
      description={`${incident.id} · reported ${fmtDateTime(incident.createdAt)} by ${incident.reporterName}`}
      onClose={onClose}
      wide
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", statusTone[incident.status])}>
            {incident.status}
          </span>
          <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", severityTone[incident.severity])}>
            {incident.severity} severity
          </span>
          {incident.attendanceId && (
            <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
              Shift {incident.attendanceId}
            </span>
          )}
        </div>

        <div>
          <p className="mb-1 text-sm font-medium">Description</p>
          <p className="whitespace-pre-wrap rounded-xl border border-border bg-secondary/40 p-3 text-sm">
            {incident.description}
          </p>
        </div>

        {incident.attachments.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
              <Paperclip className="size-4" /> Attachments ({incident.attachments.length})
            </p>
            <div className="space-y-2">
              {incident.attachments.map((a) => (
                <AttachmentTile key={a.index} incidentId={incident.id} att={a} />
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as Incident["status"])} className={inputCls}>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Severity</span>
            <select value={severity} onChange={(e) => setSeverity(e.target.value as Incident["severity"])} className={inputCls}>
              {SEVERITIES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
        </div>
        {(status !== incident.status || severity !== incident.severity) && (
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save status & severity"}
          </button>
        )}

        <div>
          <p className="mb-1.5 text-sm font-medium">Internal notes <span className="text-xs font-normal text-muted-foreground">(admin only)</span></p>
          <div className="space-y-2">
            {(incident.internalNotes ?? []).map((n, i) => (
              <div key={i} className="rounded-xl border border-border p-3">
                <p className="text-sm">{n.note}</p>
                <p className="mt-1 text-xs text-muted-foreground">{n.author} · {fmtDateTime(n.at)}</p>
              </div>
            ))}
            {!(incident.internalNotes ?? []).length && (
              <p className="text-sm text-muted-foreground">No internal notes yet.</p>
            )}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add an internal note…"
              className={cn(inputCls, "mt-0 flex-1")}
            />
            <button
              type="button"
              onClick={addNote}
              disabled={busy || !note.trim()}
              className="h-10 shrink-0 rounded-lg border border-border px-4 text-sm font-medium hover:bg-secondary disabled:opacity-50"
            >
              Add note
            </button>
          </div>
        </div>

        {err && <p className="text-sm text-danger">{err}</p>}

        <div className="flex justify-end border-t border-border pt-4">
          <button
            type="button"
            onClick={exportPdf}
            className="flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium hover:bg-secondary"
          >
            <Download className="size-4" /> Export as PDF
          </button>
        </div>
      </div>
    </Modal>
  );
}

function IncidentsPage() {
  const [rows, setRows] = useState<Incident[]>([]);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Incident | null>(null);

  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [locationId, setLocationId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (severity) params.set("severity", severity);
      if (locationId) params.set("locationId", locationId);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const qs = params.toString();
      setRows(await apiClient.get<Incident[]>(`/api/incidents${qs ? `?${qs}` : ""}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load incidents");
    } finally {
      setLoading(false);
    }
  }, [status, severity, locationId, from, to]);

  useEffect(() => {
    apiClient.get<{ id: string; name: string }[]>("/api/locations").then(setLocations).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <AdminShell
      title="Incidents"
      action={
        <button
          onClick={() => void load()}
          className="flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium hover:bg-secondary"
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} /> Refresh
        </button>
      }
    >
      <Card className="mb-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}>
              <option value="">All</option>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Severity</span>
            <select value={severity} onChange={(e) => setSeverity(e.target.value)} className={inputCls}>
              <option value="">All</option>
              {SEVERITIES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Location</span>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputCls}>
              <option value="">All</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">From</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">To</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
          </label>
          <button
            onClick={() => { setStatus(""); setSeverity(""); setLocationId(""); setFrom(""); setTo(""); }}
            className="h-10 rounded-lg border border-border px-4 text-sm font-medium text-muted-foreground hover:bg-secondary"
          >
            Clear
          </button>
        </div>
      </Card>

      <Card>
        <DataTable
          labels={["Reported", "Reporter", "Location", "Category", "Severity", "Status", ""]}
          head={
            <>
              <Th>Reported</Th>
              <Th>Reporter</Th>
              <Th>Location</Th>
              <Th>Category</Th>
              <Th>Severity</Th>
              <Th>Status</Th>
              <Th></Th>
            </>
          }
        >
          {loading ? (
            <EmptyRow colSpan={7} text="Loading incidents…" />
          ) : error ? (
            <EmptyRow colSpan={7} text={error} />
          ) : rows.length === 0 ? (
            <EmptyRow colSpan={7} text="No incidents match these filters." />
          ) : (
            rows.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-secondary/40" onClick={() => setSelected(r)}>
                <Td className="whitespace-nowrap text-muted-foreground">{fmtDateTime(r.createdAt)}</Td>
                <Td>
                  <div className="leading-tight">
                    <div className="text-sm font-medium">{r.reporterName}</div>
                    <div className="text-xs text-muted-foreground">{r.reportedBy}</div>
                  </div>
                </Td>
                <Td className="text-muted-foreground">{r.locationName || "—"}</Td>
                <Td className="font-medium">
                  <span className="flex items-center gap-1.5">
                    {r.category === "Injury" || r.category === "Altercation" ? (
                      <TriangleAlert className="size-3.5 text-danger" />
                    ) : null}
                    {r.category}
                  </span>
                </Td>
                <Td>
                  <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", severityTone[r.severity])}>
                    {r.severity}
                  </span>
                </Td>
                <Td>
                  <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", statusTone[r.status])}>
                    {r.status}
                  </span>
                </Td>
                <Td>
                  <span className="text-xs font-medium text-primary">View</span>
                </Td>
              </tr>
            ))
          )}
        </DataTable>
      </Card>

      {selected && (
        <IncidentDetail
          incident={selected}
          onClose={() => setSelected(null)}
          onSaved={(updated) => {
            setSelected(updated);
            setRows((rs) => rs.map((r) => (r.id === updated.id ? updated : r)));
          }}
        />
      )}
    </AdminShell>
  );
}
