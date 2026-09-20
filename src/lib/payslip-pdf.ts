import { jsPDF } from "jspdf";

/* Shared payslip PDF — used by both the admin payrolls page and the worker
   portal Payments tab. Accepts either field naming convention. */
export type PayslipLike = {
  id: string;
  worker?: string;
  workerId?: string;
  companyName?: string;
  periodStart?: string; periodEnd?: string; from?: string; to?: string;
  created?: string; generatedAt?: string;
  payType?: string; monthlySalary?: number | null; payDetails?: any;
  hours?: number; overtime?: number;
  holidayAccruedHours?: number; holidayAccrualPay?: number;
  rate?: number; gross?: number;
  advance?: number; advanceDeduction?: number;
  tax?: number; taxNi?: number;
  net?: number; netPay?: number;
  status?: string; paidAt?: string | null; paidBy?: string | null;
  paymentReference?: string | null;
};

const money = (n: number) =>
  `£${Number(n || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtD = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString("en-GB") : "—";
const fmtTs = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("en-GB", { hour12: false }) : "—";

export const downloadPayslipPdf = (p: PayslipLike, companyName?: string) => {
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 18;
  const right = pageW - margin;
  let y = 22;

  const line = (label: string, value: string, bold = false) => {
    doc.setFontSize(10);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.text(label, margin, y);
    doc.text(value, right, y, { align: "right" });
    y += 6;
  };

  // Header
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(companyName || "WorkHR", margin, y);
  doc.setFontSize(11);
  doc.setTextColor(120);
  doc.text("PAYSLIP", right, y, { align: "right" });
  doc.setTextColor(0);
  y += 12;

  doc.setDrawColor(200);
  doc.line(margin, y, right, y);
  y += 8;

  const from = p.from || p.periodStart;
  const to = p.to || p.periodEnd;
  const issued = p.created || p.generatedAt;
  const net = p.net ?? p.netPay ?? 0;
  const tax = p.tax ?? p.taxNi ?? 0;
  const advance = p.advance ?? p.advanceDeduction ?? 0;
  const gross = p.gross ?? 0;
  const hours = p.hours ?? 0;
  const accrualH = p.holidayAccruedHours ?? 0;
  const accrualPay = p.holidayAccrualPay ?? 0;

  line("Worker", `${p.worker || ""}${p.workerId ? ` (${p.workerId})` : ""}`, true);
  line("Payroll ID", p.id);
  line("Period", `${fmtD(from)} – ${fmtD(to)}`);
  line("Issued", fmtD(issued));
  if (p.status === "Paid" && p.paidAt) {
    line("Paid", `${fmtTs(p.paidAt)}${p.paidBy ? ` by ${p.paidBy}` : ""}`);
  }
  if (p.status === "Paid" && p.paymentReference) {
    line("Payment ref", p.paymentReference);
  }
  line("Status", p.status || "Pending", true);
  y += 4;
  doc.line(margin, y, right, y);
  y += 8;

  // Earnings / deductions
  doc.setFont("helvetica", "bold");
  doc.text("Earnings", margin, y);
  y += 7;

  if (p.payType === "salary") {
    line("Monthly salary", p.monthlySalary != null ? `${money(p.monthlySalary)}/mo` : "—");
    line("Hours worked (records only)", `${hours.toFixed(2)} h`);
    for (const b of p.payDetails?.salaryBreakdown ?? []) {
      line(`Prorated ${b.month}`, `${b.days}/${b.daysInMonth} days = ${money(b.amount)}`);
    }
  } else {
    line("Hours worked", `${hours.toFixed(2)} h`);
    if ((p.overtime ?? 0) > 0) line("of which overtime", `${Number(p.overtime).toFixed(2)} h`);
    line("Hourly rate", money(p.rate ?? 0));
  }
  if (accrualH > 0) line("Holiday accrual (statutory)", `${accrualH.toFixed(2)} h = ${money(accrualPay)}`);

  line("Gross pay", money(gross), true);
  y += 3;

  doc.setFont("helvetica", "bold");
  doc.text("Deductions", margin, y);
  y += 7;
  line("Tax & NI", `-${money(tax)}`);
  line("Advance deducted", `-${money(advance)}`);

  y += 4;
  doc.line(margin, y, right, y);
  y += 9;
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("Net pay", margin, y);
  doc.text(money(net), right, y, { align: "right" });

  doc.save(`${(p.worker || "worker").replace(/[^\w-]+/g, "_")}-payslip-${p.id}.pdf`);
};
