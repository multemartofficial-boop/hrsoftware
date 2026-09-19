import type { ReactNode } from "react";
import { useId } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { avatarUrl } from "@/lib/mock-data";

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("card-surface p-5", className)}>{children}</div>;
}

export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {action}
    </div>
  );
}

const badgeTones: Record<string, string> = {
  Active: "bg-success-soft text-success",
  Completed: "bg-success-soft text-success",
  Paid: "bg-success-soft text-success",
  Approved: "bg-success-soft text-success",
  "Full-time": "bg-success-soft text-success",
  Pending: "bg-warning-soft text-warning",
  "Needs signature": "bg-warning-soft text-warning",
  Signed: "bg-success-soft text-success",
  Declined: "bg-danger-soft text-danger",
  Matched: "bg-success-soft text-success",
  "Location Mismatch": "bg-danger-soft text-danger",
  "Unknown/Unmatched": "bg-warning-soft text-warning",
  Cancelled: "bg-secondary text-muted-foreground",
  "On Leave": "bg-warning-soft text-warning",
  "Expiring Soon": "bg-warning-soft text-warning",
  Expired: "bg-danger-soft text-danger",
  "Visa Expired": "bg-purple-100 text-purple-700",
  Rejected: "bg-danger-soft text-danger",
  Self: "bg-primary-soft text-primary",
  Admin: "bg-secondary text-muted-foreground",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
        badgeTones[status] ?? "bg-secondary text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}

export function Person({ name, sub }: { name: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <img src={avatarUrl(name)} alt={name} className="size-8 rounded-full bg-secondary" />
      <div className="leading-tight">
        <div className="text-sm font-medium">{name}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  delta,
  hint,
  tone = "up",
  icon,
}: {
  label: string;
  value: string;
  delta?: string;
  hint?: string;
  tone?: "up" | "down";
  icon?: ReactNode;
}) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <div className="mt-3 flex items-end gap-2">
        <span className="text-2xl font-semibold tracking-tight">{value}</span>
        {delta && (
          <span
            className={cn(
              "mb-1 rounded-full px-2 py-0.5 text-xs font-medium",
              tone === "up" ? "bg-success-soft text-success" : "bg-danger-soft text-danger",
            )}
          >
            {delta}
          </span>
        )}
        {hint && <span className="mb-1 text-xs text-muted-foreground">{hint}</span>}
      </div>
    </Card>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th className={cn("px-4 py-3 text-left text-xs font-medium text-muted-foreground", className)}>
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn("px-4 py-3.5 text-sm", className)}>{children}</td>;
}

export function DataTable({
  head,
  labels,
  children,
}: {
  head: ReactNode;
  /** Column labels — enables the stacked-card layout on mobile. */
  labels?: string[];
  children: ReactNode;
}) {
  const rid = "dt" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const css = labels
    ? `@media (max-width:767px){
#${rid} thead{display:none}
#${rid},#${rid} tbody,#${rid} tr,#${rid} td{display:block;width:100%}
#${rid} tbody{border:0}
#${rid} tr{border:1px solid var(--border);border-radius:1rem;padding:.35rem .75rem;margin-bottom:.65rem;background:var(--card)}
#${rid} td{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.5rem .1rem;text-align:right;border-bottom:1px solid color-mix(in oklab,var(--border) 60%,transparent)}
#${rid} td:last-child{border-bottom:0}
#${rid} td::before{content:attr(data-l);font-size:.75rem;font-weight:500;color:var(--muted-foreground);text-align:left;flex:0 0 auto}
#${rid} td>*{margin-left:auto}
#${rid} td.dt-empty{display:block;text-align:center}
#${rid} td.dt-empty::before{content:""}
${labels.map((l, i) => `#${rid} td:nth-child(${i + 1})::before{content:"${l.replace(/"/g, "")}"}`).join("\n")}
}`
    : "";
  return (
    <div className="overflow-x-auto md:overflow-x-auto">
      {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
      <table id={rid} className="w-full border-collapse">
        <thead className="bg-secondary/70">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-border max-md:divide-y-0">{children}</tbody>
      </table>
    </div>
  );
}

export function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="dt-empty px-4 py-10 text-center text-sm text-muted-foreground">
        {text}
      </td>
    </tr>
  );
}

/* ---------------- form + modal primitives ---------------- */

export const inputCls =
  "mt-1.5 h-10 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary";

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="text-sm font-medium">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs font-medium text-danger">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

export function Modal({
  title,
  description,
  onClose,
  children,
  wide,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-foreground/40 backdrop-blur-sm md:items-start md:p-4">
      <div
        className={cn(
          "card-surface w-full p-5 shadow-xl max-md:min-h-[90dvh] max-md:animate-in max-md:slide-in-from-bottom max-md:rounded-b-none md:my-8 md:p-6",
          wide ? "md:max-w-2xl" : "md:max-w-lg",
        )}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-secondary"
          >
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function PrimaryButton({
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={cn(
        "flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={cn(
        "flex h-10 items-center justify-center gap-2 rounded-lg border border-border px-4 text-sm font-medium hover:bg-secondary",
        className,
      )}
    >
      {children}
    </button>
  );
}
