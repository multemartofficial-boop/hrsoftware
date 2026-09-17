export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The demo's "current date" — the real today. */
export const today = () => new Date();

export const toISO = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const todayISO = () => toISO(today());

export const addDays = (iso: string, days: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return toISO(d);
};

export const addMonths = (iso: string, months: number) => {
  const d = new Date(iso + "T00:00:00");
  d.setMonth(d.getMonth() + months);
  return toISO(d);
};

export const fmtDate = (iso: string | Date | null | undefined) => {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso.includes("T") ? iso : iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

export const daysUntil = (iso: string | Date) => {
  if (!iso) return 0;
  // Handle both Date objects and ISO strings
  const b = iso instanceof Date ? iso.getTime() : new Date(iso.includes('T') ? iso : iso + "T00:00:00").getTime();
  const a = new Date(todayISO() + "T00:00:00").getTime();
  return Math.round((b - a) / 86400000);
};

export const nowTime = () =>
  new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

/** Normalise a TIME value ("HH:MM:SS" or "HH:MM") to 24-hour "HH:MM". */
export const hhmm = (t: string | null | undefined) =>
  t ? String(t).slice(0, 5) : t;

/** UK-style timestamp: "05/09/2026, 13:45" (24-hour). */
export const fmtDateTime = (v: string | Date | null | undefined) =>
  v ? new Date(v).toLocaleString("en-GB", { hour12: false }) : "—";

export const toMinutes = (t: string | null | undefined) => {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

export const hoursBetween = (tin: string | null | undefined, tout: string | null | undefined) => {
  if (!tin || !tout) return 0;
  let diff = toMinutes(tout) - toMinutes(tin);
  if (diff < 0) diff += 24 * 60;
  return Math.round((diff / 60) * 100) / 100;
};

export const inRange = (iso: string, from: string, to: string) => iso >= from && iso <= to;

export const money = (n: number) =>
  n.toLocaleString("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });

export const money2 = (n: number) =>
  n.toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const rid = (prefix: string, len = 5) => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}-${s}`;
};

/** Monday-based ISO week start */
export const weekStart = (iso: string) => {
  const d = new Date(iso + "T00:00:00");
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return toISO(d);
};

/** Days in the calendar month containing `iso` ("YYYY-MM-DD"). */
export const daysInMonth = (iso: string) => {
  const d = new Date(String(iso).slice(0, 10) + "T00:00:00");
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
};

/**
 * Monthly-salary proration — mirrors backend/routes/payroll.js:
 * each calendar month the period touches contributes
 * monthlySalary × (days of the period inside that month / days in that month).
 * `joined` bounds the start so salary never accrues before the join date.
 */
export const proratedMonthlySalary = (
  monthlySalary: number,
  from: string,
  to: string,
  joined?: string | Date | null,
) => {
  const toLocal = (v: string | Date) =>
    v instanceof Date
      ? new Date(v.getFullYear(), v.getMonth(), v.getDate())
      : new Date(String(v).slice(0, 10) + "T00:00:00");
  const start0 = toLocal(from);
  const end = toLocal(to);
  const j = joined ? toLocal(joined) : null;
  const start = j && j > start0 ? j : start0;
  const breakdown: { month: string; days: number; daysInMonth: number; amount: number }[] = [];
  if (!(monthlySalary > 0) || start > end) return { amount: 0, breakdown };
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const dim = new Date(y, m + 1, 0).getDate();
    const monthEnd = new Date(y, m, dim);
    const s = start > cursor ? start : cursor;
    const e = end < monthEnd ? end : monthEnd;
    if (s <= e) {
      const days = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
      breakdown.push({
        month: `${y}-${String(m + 1).padStart(2, "0")}`,
        days,
        daysInMonth: dim,
        amount: Math.round(((monthlySalary * days) / dim) * 100) / 100,
      });
    }
    cursor.setMonth(m + 1);
    cursor.setDate(1);
  }
  return { amount: Math.round(breakdown.reduce((t, b) => t + b.amount, 0) * 100) / 100, breakdown };
};
