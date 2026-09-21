import { jsPDF } from "jspdf";
import { apiClient } from "@/lib/api-client";

const fmtTs = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("en-GB", { hour12: false }) : "—";

export type SignedRequestRef = {
  id: string;
  document_name?: string;
  worker_name?: string;
  worker_id?: string;
};

/* ---------- Build + download the fully signed PDF ---------- */
export const downloadSignedPdf = async (req: SignedRequestRef) => {
  const d = await apiClient.get<any>(`/api/documents/requests/${req.id}`);
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 18;
  let y = 20;

  const write = (text: string, size = 10, style: "normal" | "bold" = "normal") => {
    doc.setFontSize(size);
    doc.setFont("helvetica", style);
    for (const line of doc.splitTextToSize(text, pageW - margin * 2) as string[]) {
      if (y > 278) { doc.addPage(); y = 20; }
      doc.text(line, margin, y);
      y += size * 0.5;
    }
    y += 2;
  };

  write(d.document_name || req.document_name || "Document", 16, "bold");
  write(`Worker: ${d.worker_name || req.worker_name || ""} (${d.worker_id || req.worker_id || ""})`, 10);
  write(`Sent: ${fmtTs(d.sent_at)}`, 10);
  y += 4;

  // Body: rendered content (or signed_content minus the appended sig blocks)
  const body = String(d.rendered_content || d.signed_content || "[No content]");
  write(body, 10);
  y += 6;

  const sigBlock = (
    label: string,
    signer: string,
    at: string | null,
    ip: string | null,
    sigType: string | null,
    sigData: string | null,
  ) => {
    if (y > 240) { doc.addPage(); y = 20; }
    write(label, 11, "bold");
    if (sigType && sigData && sigType !== "type" && String(sigData).startsWith("data:image")) {
      try { doc.addImage(sigData, "PNG", margin, y, 45, 18); } catch { /* fall through to text */ }
      y += 22;
    } else if (sigType === "type" && sigData) {
      doc.setFont("times", "italic");
      doc.setFontSize(18);
      doc.text(String(sigData), margin, y + 8);
      y += 12;
    }
    write(`${signer}${at ? ` — ${fmtTs(at)}` : ""}${ip ? ` · IP ${ip}` : ""}`, 9);
    y += 4;
  };

  // Company signed at template creation — its block goes first chronologically.
  if (d.admin_signed_at) {
    sigBlock("Signed by the Director of SSSL", d.admin_signed_by || "Company", d.admin_signed_at, d.admin_signer_ip, d.admin_signature_type, d.admin_signature_data);
  }
  sigBlock("Signed by Worker", d.worker_name || d.worker_id, d.signed_at, d.signer_ip, d.signature_type, d.signature_data);

  doc.save(`${(d.document_name || "document").replace(/[^\w-]+/g, "_")}-signed.pdf`);
};
