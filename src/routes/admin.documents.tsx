import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, FileText, Send, Eye, Ban, FileUp, FileSignature, Pencil, Trash2 } from "lucide-react";
import { AdminShell } from "@/components/hr/admin-shell";
import {
  Card, Field, GhostButton, Modal, PrimaryButton, inputCls,
  DataTable, Th, Td, EmptyRow, Person, SectionTitle, StatusBadge,
} from "@/components/hr/bits";
import { useApi } from "@/lib/api-store";
import { apiClient } from "@/lib/api-client";
import { fmtDate } from "@/lib/hr-utils";

export const Route = createFileRoute("/admin/documents")({
  head: () => ({
    meta: [
      { title: "Documents — WorkHR" },
      { name: "description", content: "Upload documents and templates, send them to workers for e-signature." },
    ],
  }),
  component: DocumentsPage,
});

type Doc = {
  id: string; name: string; type: "uploaded_pdf" | "template";
  file_path?: string | null; content?: string | null; created_at: string;
};

type SigRequest = {
  id: string; document_name: string; document_type: string;
  worker_id: string; worker_name: string;
  status: "pending" | "signed" | "declined" | "cancelled";
  sent_at: string; signed_at: string | null; declined_at: string | null;
  file_path: string | null;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function UploadModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { setErr("Choose a PDF file"); return; }
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("name", name || file.name.replace(/\.pdf$/i, ""));
      await apiClient.uploadFile("/documents/upload", fd);
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Upload PDF" description="Store a PDF document (offer letter, contract, policy) to send for signature." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Document name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Employment Contract" />
        </Field>
        <Field label="PDF file">
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className={inputCls}
            required
          />
        </Field>
        {err && <p className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <GhostButton type="button" onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={busy}>{busy ? "Uploading..." : "Upload"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function TemplateModal({ editing, onClose, onSaved }: { editing?: Doc | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(editing?.name ?? "");
  const [content, setContent] = useState(editing?.content ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (editing) {
        await apiClient.put(`/api/documents/${editing.id}`, { name, content });
      } else {
        await apiClient.post("/api/documents/template", { name, content });
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message || "Failed to save template");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? "Edit template" : "New template"}
      description="Reusable text — placeholders are auto-filled from the worker's record when sent. Already-sent requests keep their original content."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Template name">
          <input required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Offer Letter" />
        </Field>
        <Field
          label="Content"
          hint="Placeholders: {{worker_name}} {{worker_code}} {{start_date}} {{hourly_rate}} {{location_name}}"
        >
          <textarea
            required
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={8}
            className={`${inputCls} h-auto py-2 font-mono text-xs`}
            placeholder={"Dear {{worker_name}} ({{worker_code}}),\n\nYou are offered the role at {{location_name}} starting {{start_date}} at {{hourly_rate}} per hour..."}
          />
        </Field>
        {err && <p className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <GhostButton type="button" onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={busy}>{busy ? "Saving..." : editing ? "Save changes" : "Save template"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function EditPdfModal({ doc, onClose, onSaved }: { doc: Doc; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(doc.name);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await apiClient.put(`/api/documents/${doc.id}`, { name });
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        await apiClient.uploadFile(`/documents/${doc.id}/file`, fd);
      }
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message || "Failed to update document");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Edit PDF document" description="Rename the document or replace the PDF file. Already-sent requests keep their original file." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Document name">
          <input required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Replace PDF (optional)" hint="Leave empty to keep the current file">
          <input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className={inputCls}
          />
        </Field>
        {err && <p className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <GhostButton type="button" onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={busy}>{busy ? "Saving..." : "Save changes"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function SendModal({ doc, onClose, onSaved }: { doc: Doc; onClose: () => void; onSaved: () => void }) {
  const { workers } = useApi();
  const [workerId, setWorkerId] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadPreview = async (wid: string) => {
    if (doc.type !== "template" || !wid) { setPreview(null); return; }
    try {
      const d = await apiClient.get<{ rendered: string }>(`/api/documents/${doc.id}/preview/${wid}`);
      setPreview(d.rendered);
    } catch { setPreview(null); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await apiClient.post(`/api/documents/${doc.id}/send`, { workerId });
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message || "Failed to send");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Send for signature — ${doc.name}`} description="The worker will see this in their dashboard and get an email." onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Worker">
          <select
            required
            value={workerId}
            onChange={(e) => { setWorkerId(e.target.value); loadPreview(e.target.value); }}
            className={inputCls}
          >
            <option value="">Select worker</option>
            {(workers || []).map((w) => (
              <option key={w.id} value={w.id}>{w.name} ({w.id})</option>
            ))}
          </select>
        </Field>
        {preview != null && (
          <Field label="Rendered preview (placeholders filled)">
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-secondary/50 p-3 text-xs">{preview}</pre>
          </Field>
        )}
        {err && <p className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <GhostButton type="button" onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={busy || !workerId}>
            <Send className="size-4" /> {busy ? "Sending..." : "Send for Signature"}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

const fmtTs = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString() : "—";

function ViewModal({ req, onClose }: { req: SigRequest; onClose: () => void }) {
  const [detail, setDetail] = useState<any>(null);
  useEffect(() => {
    apiClient.get(`/api/documents/requests/${req.id}`).then(setDetail).catch(() => setDetail({ error: true }));
  }, [req.id]);

  let audit: { event: string; at: string; ip?: string }[] = [];
  try {
    audit = typeof detail?.audit_log === "string" ? JSON.parse(detail.audit_log) : detail?.audit_log || [];
  } catch { audit = []; }

  return (
    <Modal title={req.document_name} description={`Sent to ${req.worker_name} · Status: ${cap(req.status)}`} onClose={onClose}>
      {detail === null ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (
        <div className="space-y-4">
          {/* Audit trail timeline */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Audit trail</p>
            <div className="space-y-1.5 text-sm">
              <p><span className="font-medium">Sent:</span> {fmtTs(detail.sent_at)}</p>
              <p><span className="font-medium">Viewed:</span> {fmtTs(detail.viewed_at)}</p>
              {detail.signed_at && <p><span className="font-medium">Signed:</span> {fmtTs(detail.signed_at)}{detail.signer_ip ? ` · IP ${detail.signer_ip}` : ""}</p>}
              {detail.declined_at && <p><span className="font-medium text-danger">Declined:</span> {fmtTs(detail.declined_at)}</p>}
              {audit.length > 0 && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Full event log ({audit.length} events)</summary>
                  <ul className="mt-1 space-y-0.5 pl-3">
                    {audit.map((e, i) => (
                      <li key={i}>{fmtTs(e.at)} — {e.event}{e.ip ? ` (${e.ip})` : ""}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </div>

          {/* Signed version or original content */}
          {detail.signed_content ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Signed document</p>
              <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-secondary/50 p-3 text-sm">{detail.signed_content}</pre>
              {detail.signature_type === "type" ? null : detail.signature_data ? (
                <img src={detail.signature_data} alt="Signature" className="mt-2 max-h-24 rounded border border-border bg-white" />
              ) : null}
            </div>
          ) : detail.rendered_content ? (
            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-secondary/50 p-3 text-sm">{detail.rendered_content}</pre>
          ) : detail.file_path ? (
            <a
              href={`http://localhost:3001/${String(detail.file_path).replace(/\\/g, "/")}`}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-primary underline"
            >
              Open PDF document
            </a>
          ) : (
            <p className="text-sm text-muted-foreground">No content available.</p>
          )}
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <GhostButton onClick={onClose}>Close</GhostButton>
      </div>
    </Modal>
  );
}

function DocumentsPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [requests, setRequests] = useState<SigRequest[]>([]);
  const [modal, setModal] = useState<"upload" | "template" | null>(null);
  const [editing, setEditing] = useState<Doc | null>(null);
  const [editPdf, setEditPdf] = useState<Doc | null>(null);
  const [sending, setSending] = useState<Doc | null>(null);
  const [viewing, setViewing] = useState<SigRequest | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, r] = await Promise.all([
        apiClient.get<Doc[]>("/api/documents"),
        apiClient.get<SigRequest[]>("/api/documents/requests"),
      ]);
      setDocs(d);
      setRequests(r);
    } catch (e: any) {
      setErr(e.message || "Failed to load documents");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const del = async (d: Doc) => {
    if (!window.confirm(`Delete "${d.name}"? This cannot be undone.`)) return;
    try {
      await apiClient.delete(`/api/documents/${d.id}`);
      setErr(null);
      load();
    } catch (e: any) {
      setErr(e.message);
    }
  };

  const cancel = async (id: string) => {
    try {
      await apiClient.post(`/api/documents/requests/${id}/cancel`, {});
      load();
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <AdminShell
      title="Documents"
      action={
        <div className="flex items-center gap-2">
          <button onClick={() => setModal("template")} className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium">
            <FileSignature className="size-4" /> New Template
          </button>
          <button onClick={() => setModal("upload")} className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
            <FileUp className="size-4" /> Upload PDF
          </button>
        </div>
      }
    >
      {err && <p className="mb-3 text-sm text-danger">{err}</p>}

      <Card>
        <SectionTitle title="Documents & templates" />
        <DataTable
          labels={["Name", "Type", "Created", ""]}
          head={<><Th>Name</Th><Th>Type</Th><Th>Created</Th><Th className="text-right">Actions</Th></>}
        >
          {docs.length === 0 && <EmptyRow colSpan={4} text="No documents yet — upload a PDF or create a template." />}
          {docs.map((d) => (
            <tr key={d.id}>
              <Td>
                <div className="flex items-center gap-2">
                  <FileText className="size-4 text-muted-foreground" />
                  <span className="font-medium">{d.name}</span>
                </div>
              </Td>
              <Td><StatusBadge status={d.type === "template" ? "Template" : "PDF"} /></Td>
              <Td>{fmtDate(d.created_at)}</Td>
              <Td className="text-right">
                <div className="flex items-center justify-end gap-1">
                  <button
                    onClick={() => setSending(d)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
                  >
                    <Send className="size-3.5" /> Send for Signature
                  </button>
                  <button
                    onClick={() => (d.type === "template" ? setEditing(d) : setEditPdf(d))}
                    title="Edit"
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-primary"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    onClick={() => del(d)}
                    title="Delete"
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-danger"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </Td>
            </tr>
          ))}
        </DataTable>
      </Card>

      <Card className="mt-4">
        <SectionTitle title="Signature requests" />
        <DataTable
          labels={["Worker", "Document", "Status", "Sent", "Signed", ""]}
          head={<><Th>Worker</Th><Th>Document</Th><Th>Status</Th><Th>Sent</Th><Th>Signed</Th><Th className="text-right">Actions</Th></>}
        >
          {requests.length === 0 && <EmptyRow colSpan={6} text="No signature requests yet." />}
          {requests.map((r) => (
            <tr key={r.id}>
              <Td><Person name={r.worker_name} sub={r.worker_id} /></Td>
              <Td>{r.document_name}</Td>
              <Td><StatusBadge status={cap(r.status)} /></Td>
              <Td>{fmtDate(r.sent_at)}</Td>
              <Td>{r.signed_at ? fmtDate(r.signed_at) : "—"}</Td>
              <Td>
                <div className="flex justify-end gap-1 text-muted-foreground">
                  <button onClick={() => setViewing(r)} title="View" className="rounded-md p-1.5 hover:bg-secondary hover:text-primary">
                    <Eye className="size-4" />
                  </button>
                  {r.status === "pending" && (
                    <button onClick={() => cancel(r.id)} title="Cancel request" className="rounded-md p-1.5 hover:bg-secondary hover:text-danger">
                      <Ban className="size-4" />
                    </button>
                  )}
                </div>
              </Td>
            </tr>
          ))}
        </DataTable>
      </Card>

      {modal === "upload" && <UploadModal onClose={() => setModal(null)} onSaved={load} />}
      {modal === "template" && <TemplateModal onClose={() => setModal(null)} onSaved={load} />}
      {editing && <TemplateModal editing={editing} onClose={() => setEditing(null)} onSaved={load} />}
      {editPdf && <EditPdfModal doc={editPdf} onClose={() => setEditPdf(null)} onSaved={load} />}
      {sending && <SendModal doc={sending} onClose={() => setSending(null)} onSaved={load} />}
      {viewing && <ViewModal req={viewing} onClose={() => setViewing(null)} />}
    </AdminShell>
  );
}
