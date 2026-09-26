import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { FileText, Send, Eye, Ban, FileSignature, Pencil, Trash2, PenLine, Download, Upload } from "lucide-react";
import { AdminShell } from "@/components/hr/admin-shell";
import {
  Card, Field, GhostButton, Modal, PrimaryButton, inputCls,
  DataTable, Th, Td, EmptyRow, Person, SectionTitle, StatusBadge,
} from "@/components/hr/bits";
import { useApi } from "@/lib/api-store";
import { apiClient, fetchFileUrl } from "@/lib/api-client";
import { fmtDate } from "@/lib/hr-utils";
import { downloadSignedPdf } from "@/lib/signed-pdf";

export const Route = createFileRoute("/admin/documents")({
  head: () => ({
    meta: [
      { title: "Documents — WorkHR" },
      { name: "description", content: "Reusable templates sent to workers for dual e-signature." },
    ],
  }),
  component: DocumentsPage,
});

type Doc = {
  id: string; name: string; type: "uploaded_pdf" | "template" | "uploaded";
  file_path?: string | null; content?: string | null; created_at: string;
  admin_signature_type?: string | null; admin_signature_data?: string | null;
  admin_signed_by?: string | null; admin_signed_at?: string | null;
  signed_content_hash?: string | null;
};

type SigRequest = {
  id: string; document_id: string; document_name: string; document_type: string;
  worker_id: string; worker_name: string;
  status: "pending" | "worker_signed" | "signed" | "declined" | "cancelled";
  sent_at: string; signed_at: string | null; declined_at: string | null;
  admin_signed_at: string | null; admin_signed_by: string | null;
  file_path: string | null; has_file?: boolean | number;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const statusLabel = (s: SigRequest["status"]) =>
  s === "worker_signed" ? "Awaiting Countersign" : cap(s);

/* ---------- Signature pad (draw on canvas) ---------- */
function DrawPad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const c = ref.current!;
    c.width = c.offsetWidth;
    c.height = 160;
    const ctx = c.getContext("2d")!;
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div>
      <canvas
        ref={ref}
        className="w-full h-40 rounded-lg border border-border bg-white touch-none cursor-crosshair"
        onPointerDown={(e) => {
          drawing.current = true;
          const ctx = ref.current!.getContext("2d")!;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = ref.current!.getContext("2d")!;
          const p = pos(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }}
        onPointerUp={() => {
          drawing.current = false;
          onChange(ref.current!.toDataURL("image/png"));
        }}
      />
      <button
        type="button"
        onClick={() => {
          const c = ref.current!;
          c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
          onChange(null);
        }}
        className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        Clear
      </button>
    </div>
  );
}

function TemplateModal({ editing, onClose, onSaved }: { editing?: Doc | null; onClose: () => void; onSaved: (doc: Doc, needsSignature: boolean) => void }) {
  const renameOnly = !!editing && editing.type !== "template";
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
        // Editing the content of a signed template invalidates the signature —
        // the admin must re-sign before it can be sent again.
        const invalidated = !renameOnly && !!editing.admin_signed_at && content !== (editing.content ?? "");
        onSaved({ ...editing, name, content, ...(invalidated ? { admin_signed_at: null } : {}) }, invalidated);
      } else {
        const res = await apiClient.post<{ id: string }>("/api/documents/template", { name, content });
        onSaved({ id: res.id, name, content, type: "template", created_at: new Date().toISOString() }, true);
      }
      onClose();
    } catch (e: any) {
      setErr(e.message || "Failed to save template");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? (renameOnly ? "Rename document" : "Edit template") : "New template"}
      description={renameOnly
        ? "Only the display name can be changed — the uploaded file stays the same."
        : "Reusable text — placeholders are auto-filled from the worker's record when sent. After saving you'll be asked to add the company signature, which is required before the template can be sent."}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label={renameOnly ? "Document name" : "Template name"}>
          <input required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Offer Letter" />
        </Field>
        {!renameOnly && (
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
        )}
        {err && <p className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <GhostButton type="button" onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={busy}>{busy ? "Saving..." : editing ? "Save changes" : "Save template"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Admin countersignature modal ---------- */
function CountersignModal({ req, onClose, onDone }: { req: SigRequest; onClose: () => void; onDone: () => void }) {
  const [detail, setDetail] = useState<any>(null);
  const [method, setMethod] = useState<"draw" | "type">("draw");
  const [drawData, setDrawData] = useState<string | null>(null);
  const [typedName, setTypedName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get(`/api/documents/requests/${req.id}`).then(setDetail).catch(() => setDetail({ error: true }));
  }, [req.id]);

  const signatureData = method === "draw" ? drawData : typedName.trim();
  const ready = method === "draw" ? !!drawData : typedName.trim().length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await apiClient.post(`/api/documents/requests/${req.id}/countersign`, {
        signatureType: method,
        signatureData,
      });
      onDone();
      onClose();
    } catch (e: any) {
      setErr(e.message || "Failed to countersign");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Countersign — ${req.document_name}`}
      description={`${req.worker_name} has signed. Add the company signature to complete the document.`}
      onClose={onClose}
      wide
    >
      <form onSubmit={submit} className="space-y-4">
        {detail === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : detail?.signed_content || detail?.rendered_content ? (
          <pre className="max-h-52 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-secondary/50 p-3 text-sm">
            {detail.signed_content || detail.rendered_content}
          </pre>
        ) : null}

        <Field label="Company signature" hint="Draw or type the authorised signatory's name.">
          <div>
            <div className="mb-2 flex gap-2">
              {(["draw", "type"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`px-3 py-1.5 rounded-lg text-sm capitalize ${method === m ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}
                >
                  {m === "draw" ? "Draw" : "Type"}
                </button>
              ))}
            </div>
            {method === "draw" ? (
              <DrawPad onChange={setDrawData} />
            ) : (
              <div>
                <input
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  placeholder="Type the signatory's full name"
                  className={inputCls}
                />
                {typedName.trim() && (
                  <p className="mt-2 rounded-lg border border-border bg-white px-3 py-2 text-2xl italic" style={{ fontFamily: "cursive" }}>
                    {typedName}
                  </p>
                )}
              </div>
            )}
          </div>
        </Field>
        {err && <p className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <GhostButton type="button" onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={busy || !ready}>
            <PenLine className="size-4" /> {busy ? "Signing..." : "Countersign"}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Company signature on the template itself ---------- */
function SignTemplateModal({ doc, onClose, onDone }: { doc: Doc; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState<"draw" | "type">("draw");
  const [drawData, setDrawData] = useState<string | null>(null);
  const [typedName, setTypedName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const signatureData = method === "draw" ? drawData : typedName.trim();
  const ready = method === "draw" ? !!drawData : typedName.trim().length > 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await apiClient.post(`/api/documents/${doc.id}/sign-template`, {
        signatureType: method,
        signatureData,
      });
      onDone();
      onClose();
    } catch (e: any) {
      setErr(e.message || "Failed to sign template");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Sign template — ${doc.name}`}
      description="Add the company signature to this template. It must be signed before it can be sent to workers, and is reused for every send until the content changes."
      onClose={onClose}
      wide
    >
      <form onSubmit={submit} className="space-y-4">
        {doc.content && (
          <pre className="max-h-52 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-secondary/50 p-3 text-sm">
            {doc.content}
          </pre>
        )}
        <Field label="Company signature" hint="Draw or type the authorised signatory's name — this signature will appear on every document sent from this template.">
          <div>
            <div className="mb-2 flex gap-2">
              {(["draw", "type"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`px-3 py-1.5 rounded-lg text-sm capitalize ${method === m ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}
                >
                  {m === "draw" ? "Draw" : "Type"}
                </button>
              ))}
            </div>
            {method === "draw" ? (
              <DrawPad onChange={setDrawData} />
            ) : (
              <div>
                <input
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  placeholder="Type the signatory's full name"
                  className={inputCls}
                />
                {typedName.trim() && (
                  <p className="mt-2 rounded-lg border border-border bg-white px-3 py-2 text-2xl italic" style={{ fontFamily: "cursive" }}>
                    {typedName}
                  </p>
                )}
              </div>
            )}
          </div>
        </Field>
        {err && <p className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <GhostButton type="button" onClick={onClose}>Not now</GhostButton>
          <PrimaryButton type="submit" disabled={busy || !ready}>
            <PenLine className="size-4" /> {busy ? "Signing..." : "Sign template"}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Upload a document file (job description, RAMS…) ---------- */
function UploadModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (name.trim()) fd.append("name", name.trim());
      await apiClient.uploadFile("/documents/upload", fd);
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message || "Failed to upload document");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Upload document"
      description="Job descriptions, RAMS and other .docx/.pdf files you want workers to sign. Upload once, then send to any worker — they sign it and you countersign to complete."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Document name" hint="Leave blank to use the file name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Kitchen Porter Job Description" />
        </Field>
        <Field label="File *" hint=".docx, .doc, .pdf, .txt or .rtf — up to 10 MB">
          <input
            type="file"
            required
            accept=".docx,.doc,.pdf,.txt,.rtf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className={inputCls}
          />
        </Field>
        {err && <p className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <GhostButton type="button" onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={busy || !file}>
            {busy ? "Uploading..." : "Upload"}
          </PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function SendModal({ doc, docs, requests, onClose, onSaved }: { doc: Doc | null; docs: Doc[]; requests: SigRequest[]; onClose: () => void; onSaved: () => void }) {
  const { workers } = useApi();
  const [workerId, setWorkerId] = useState("");
  const [selected, setSelected] = useState<string[]>(doc ? [doc.id] : []);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ sent: number; failed: { name: string; error: string }[] } | null>(null);

  // Uploaded files can always be sent; templates need the company signature first.
  const sendable = docs.filter((d) => d.type === "uploaded" || (d.type === "template" && !!d.admin_signed_at));
  // Documents already waiting on this worker — sending again would duplicate.
  const alreadyPending = new Set(
    requests.filter((r) => r.worker_id === workerId && r.status === "pending").map((r) => r.document_id)
  );

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const loadPreview = async (wid: string) => {
    if (!doc || doc.type !== "template" || !wid) { setPreview(null); return; }
    try {
      const d = await apiClient.get<{ rendered: string }>(`/api/documents/${doc.id}/preview/${wid}`);
      setPreview(d.rendered);
    } catch { setPreview(null); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const toSend = selected.filter((id) => !alreadyPending.has(id));
      const res = await apiClient.post<{ sent: number; failed: { name: string; error: string }[] }>(
        "/api/documents/send-batch",
        { workerId, documentIds: toSend }
      );
      if (res.sent === 0) {
        setErr(res.failed?.[0]?.error || "Nothing was sent");
        return;
      }
      if (res.failed?.length) {
        setResult(res);
      } else {
        onSaved();
        onClose();
        return;
      }
      onSaved();
    } catch (e: any) {
      setErr(e.message || "Failed to send");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Send documents for signature"
      description="Pick a worker, tick the documents to send, and they can review, agree and sign them in one go."
      onClose={onClose}
      wide
    >
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

        <Field label="Documents to send">
          <div className="mt-1.5 max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border">
            {sendable.length === 0 && (
              <p className="p-3 text-sm text-muted-foreground">No sendable documents — upload a file or sign a template first.</p>
            )}
            {sendable.map((d) => {
              const pending = alreadyPending.has(d.id);
              const checked = selected.includes(d.id);
              return (
                <label key={d.id} className={`flex items-center gap-3 px-3 py-2.5 text-sm ${pending ? "opacity-50" : "cursor-pointer hover:bg-secondary/50"}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={pending}
                    onChange={() => toggle(d.id)}
                    className="size-4 accent-primary"
                  />
                  <span className="flex-1 font-medium">{d.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {pending ? "already sent" : d.type === "template" ? "template" : "file"}
                  </span>
                </label>
              );
            })}
          </div>
        </Field>

        {preview != null && selected.length === 1 && doc?.type === "template" && (
          <Field label="Rendered preview (placeholders filled)">
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-secondary/50 p-3 text-xs">{preview}</pre>
          </Field>
        )}
        {err && <p className="text-sm text-danger">{err}</p>}
        {result && (
          <div className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm">
            <p className="font-medium">{result.sent} sent. {result.failed.length} skipped:</p>
            <ul className="mt-1 list-disc pl-5 text-xs">
              {result.failed.map((f, i) => <li key={i}>{f.name} — {f.error}</li>)}
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <GhostButton type="button" onClick={onClose}>{result ? "Done" : "Cancel"}</GhostButton>
          {!result && (
            <PrimaryButton type="submit" disabled={busy || !workerId || selected.filter((id) => !alreadyPending.has(id)).length === 0}>
              <Send className="size-4" /> {busy ? "Sending..." : `Send ${selected.length} document${selected.length === 1 ? "" : "s"}`}
            </PrimaryButton>
          )}
        </div>
      </form>
    </Modal>
  );
}

const fmtTs = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("en-GB", { hour12: false }) : "—";

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
    <Modal title={req.document_name} description={`Sent to ${req.worker_name} · Status: ${statusLabel(req.status)}`} onClose={onClose}>
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
              {detail.signed_at && <p><span className="font-medium">Worker signed:</span> {fmtTs(detail.signed_at)}{detail.signer_ip ? ` · IP ${detail.signer_ip}` : ""}</p>}
              {detail.admin_signed_at && <p><span className="font-medium">Company signed:</span> {fmtTs(detail.admin_signed_at)} by {detail.admin_signed_by || "admin"}{detail.admin_signer_ip ? ` · IP ${detail.admin_signer_ip}` : ""}</p>}
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
              <div className="mt-2 flex flex-wrap gap-4">
                {detail.signature_type !== "type" && detail.signature_data ? (
                  <div>
                    <p className="text-xs text-muted-foreground">Signed by Worker{detail.signed_at ? ` · ${fmtTs(detail.signed_at)}` : ""}</p>
                    <img src={detail.signature_data} alt="Worker signature" className="max-h-20 rounded border border-border bg-white" />
                  </div>
                ) : null}
                {detail.admin_signature_type !== "type" && detail.admin_signature_data ? (
                  <div>
                    <p className="text-xs text-muted-foreground">Signed by the Director of SSSL — {detail.admin_signed_by}{detail.admin_signed_at ? ` · ${fmtTs(detail.admin_signed_at)}` : ""}</p>
                    <img src={detail.admin_signature_data} alt="Company signature" className="max-h-20 rounded border border-border bg-white" />
                  </div>
                ) : null}
              </div>
            </div>
          ) : detail.rendered_content ? (
            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-secondary/50 p-3 text-sm">{detail.rendered_content}</pre>
          ) : detail.has_file ? (
            <button
              type="button"
              onClick={async () => {
                try {
                  const url = await fetchFileUrl(`/api/documents/requests/${req.id}/file`);
                  window.open(url, "_blank", "noopener");
                } catch { alert("Failed to load document file"); }
              }}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline"
            >
              <Download className="size-4" /> Open document file
            </button>
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
  const [modal, setModal] = useState<"template" | "upload" | null>(null);
  const [editing, setEditing] = useState<Doc | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendPreselect, setSendPreselect] = useState<Doc | null>(null);
  const [signing, setSigning] = useState<Doc | null>(null);
  const [viewing, setViewing] = useState<SigRequest | null>(null);
  const [countersigning, setCountersigning] = useState<SigRequest | null>(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
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

  const download = async (r: SigRequest) => {
    setPdfBusy(r.id);
    setErr(null);
    try {
      await downloadSignedPdf(r);
    } catch (e: any) {
      setErr(e.message || "Failed to build PDF");
    } finally {
      setPdfBusy(null);
    }
  };

  return (
    <AdminShell
      title="Documents"
      action={
        <div className="flex gap-2">
          <button
            onClick={() => { setSendPreselect(null); setSendOpen(true); }}
            className="flex h-9 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium hover:bg-secondary"
          >
            <Send className="size-4" /> Send to Worker
          </button>
          <button onClick={() => setModal("upload")} className="flex h-9 items-center gap-2 rounded-lg border border-border px-4 text-sm font-medium hover:bg-secondary">
            <Upload className="size-4" /> Upload Document
          </button>
          <button onClick={() => setModal("template")} className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
            <FileSignature className="size-4" /> New Template
          </button>
        </div>
      }
    >
      {err && <p className="mb-3 text-sm text-danger">{err}</p>}

      <Card>
        <SectionTitle title="Signature templates" />
        <p className="-mt-3 mb-4 text-xs text-muted-foreground">
          Signature documents come in two forms: reusable text templates (sign once for the company, placeholders fill per worker) and uploaded files like job descriptions or RAMS (.docx/.pdf). Send either to a worker — they sign, then the company countersigns to complete.
        </p>
        <DataTable
          labels={["Name", "Type", "Created", ""]}
          head={<><Th>Name</Th><Th>Type</Th><Th>Created</Th><Th className="text-right">Actions</Th></>}
        >
          {docs.length === 0 && <EmptyRow colSpan={4} text="No documents yet — create a template or upload a file." />}
          {docs.map((d) => {
            const templateSigned = d.type === "template" && !!d.admin_signed_at;
            const canSend = d.type === "uploaded" || templateSigned;
            return (
            <tr key={d.id}>
              <Td>
                <div className="flex items-center gap-2">
                  <FileText className="size-4 text-muted-foreground" />
                  <div>
                    <span className="font-medium">{d.name}</span>
                    {templateSigned && (
                      <p className="text-xs text-muted-foreground">Signed by the Director of SSSL — {d.admin_signed_by} · {fmtDate(d.admin_signed_at)}</p>
                    )}
                  </div>
                </div>
              </Td>
              <Td>
                <div className="flex items-center gap-1.5">
                  <StatusBadge status={d.type === "template" ? "Template" : d.type === "uploaded" ? "Uploaded" : "Legacy PDF"} />
                  {d.type === "template" && (
                    <StatusBadge status={templateSigned ? "Signed" : "Needs signature"} />
                  )}
                </div>
              </Td>
              <Td>{fmtDate(d.created_at)}</Td>
              <Td className="text-right">
                <div className="flex items-center justify-end gap-1">
                  {d.type === "template" && !templateSigned && (
                    <button
                      onClick={() => setSigning(d)}
                      title="Add the company signature — required before this template can be sent"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-primary px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary-soft"
                    >
                      <PenLine className="size-3.5" /> Sign template
                    </button>
                  )}
                  {canSend && (
                    <button
                      onClick={() => { setSendPreselect(d); setSendOpen(true); }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
                    >
                      <Send className="size-3.5" /> Send for Signature
                    </button>
                  )}
                  {(d.type === "template" || d.type === "uploaded") && (
                    <button
                      onClick={() => setEditing(d)}
                      title="Edit"
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-primary"
                    >
                      <Pencil className="size-4" />
                    </button>
                  )}
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
            );
          })}
        </DataTable>
      </Card>

      <Card className="mt-4">
        <SectionTitle title="Signature requests" />
        <DataTable
          labels={["Worker", "Document", "Status", "Sent", "Worker signed", "Countersigned", ""]}
          head={<><Th>Worker</Th><Th>Document</Th><Th>Status</Th><Th>Sent</Th><Th>Worker signed</Th><Th>Countersigned</Th><Th className="text-right">Actions</Th></>}
        >
          {requests.length === 0 && <EmptyRow colSpan={7} text="No signature requests yet." />}
          {requests.map((r) => (
            <tr key={r.id}>
              <Td><Person name={r.worker_name} sub={r.worker_id} /></Td>
              <Td>{r.document_name}</Td>
              <Td><StatusBadge status={statusLabel(r.status)} /></Td>
              <Td>{fmtDate(r.sent_at)}</Td>
              <Td>{r.signed_at ? fmtDate(r.signed_at) : "—"}</Td>
              <Td>
                {r.admin_signed_at
                  ? <span title={r.admin_signed_by ?? undefined}>{fmtDate(r.admin_signed_at)}</span>
                  : "—"}
              </Td>
              <Td>
                <div className="flex justify-end gap-1 text-muted-foreground">
                  {(r.status === "worker_signed" || (r.status === "signed" && !r.admin_signed_at)) && (
                    <button
                      onClick={() => setCountersigning(r)}
                      title="Countersign for the company"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary hover:text-primary"
                    >
                      <PenLine className="size-3.5" /> Countersign
                    </button>
                  )}
                  {r.status === "signed" && r.admin_signed_at && (
                    <button
                      onClick={() => void download(r)}
                      disabled={pdfBusy === r.id}
                      title="Download signed PDF"
                      className="rounded-md p-1.5 hover:bg-secondary hover:text-primary disabled:opacity-50"
                    >
                      <Download className="size-4" />
                    </button>
                  )}
                  <button onClick={() => setViewing(r)} title="View" className="rounded-md p-1.5 hover:bg-secondary hover:text-primary">
                    <Eye className="size-4" />
                  </button>
                  {(r.status === "pending" || r.status === "worker_signed") && (
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

      {modal === "template" && (
        <TemplateModal
          onClose={() => setModal(null)}
          onSaved={(doc, needsSignature) => {
            void load();
            if (needsSignature) setSigning(doc);
          }}
        />
      )}
      {modal === "upload" && (
        <UploadModal onClose={() => setModal(null)} onSaved={load} />
      )}
      {editing && (
        <TemplateModal
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={(doc, needsSignature) => {
            void load();
            if (needsSignature) setSigning(doc);
          }}
        />
      )}
      {signing && <SignTemplateModal doc={signing} onClose={() => setSigning(null)} onDone={load} />}
      {countersigning && <CountersignModal req={countersigning} onClose={() => setCountersigning(null)} onDone={load} />}
      {sendOpen && (
        <SendModal
          doc={sendPreselect}
          docs={docs}
          requests={requests}
          onClose={() => setSendOpen(false)}
          onSaved={load}
        />
      )}
      {viewing && <ViewModal req={viewing} onClose={() => setViewing(null)} />}
    </AdminShell>
  );
}
