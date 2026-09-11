import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { History, RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/hr/admin-shell";
import { Card, DataTable, EmptyRow, Td, Th, inputCls } from "@/components/hr/bits";
import { apiClient } from "@/lib/api-client";
import { fmtDateTime } from "@/lib/hr-utils";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/action-history")({
  head: () => ({
    meta: [
      { title: "Action History — WorkHR" },
      { name: "description", content: "Audit log of every meaningful admin and worker action." },
    ],
  }),
  component: ActionHistoryPage,
});

type ActionLog = {
  id: number;
  actorType: "admin" | "worker" | "system";
  actorId: string | null;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
};

const ACTION_LABELS: Record<string, string> = {
  approved_application: "Approved application",
  rejected_application: "Rejected application",
  resent_setup_link: "Resent setup link",
  generated_payroll: "Generated payroll",
  updated_payroll_status: "Updated payroll status",
  deleted_payroll: "Deleted payroll",
  added_attendance: "Added attendance",
  edited_attendance: "Edited attendance",
  deleted_attendance: "Deleted attendance",
  added_location: "Added location",
  edited_location: "Edited location",
  deleted_location: "Deleted location",
  changed_settings: "Changed settings",
  added_bank_holiday: "Added bank holiday",
  updated_bank_holiday: "Updated bank holiday",
  deleted_bank_holiday: "Deleted bank holiday",
  created_worker: "Created worker",
  updated_worker: "Updated worker",
  reactivated_worker: "Reactivated worker",
  deleted_worker: "Deleted worker",
  reset_worker_password: "Reset worker password",
  updated_worker_compliance: "Updated worker compliance",
};

const actionLabel = (a: string) =>
  ACTION_LABELS[a] ?? a.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const actorTone: Record<string, string> = {
  admin: "bg-primary-soft text-primary",
  worker: "bg-success-soft text-success",
  system: "bg-secondary text-muted-foreground",
};

/** Render the JSON details blob as compact "key: value" text (from → to for diffs). */
function describe(details: ActionLog["details"]): string {
  if (!details || typeof details !== "object") return "—";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(details)) {
    if (v === null || v === undefined) continue;
    if (k === "changes" && v && typeof v === "object") {
      for (const [ck, cv] of Object.entries(v as Record<string, { from?: unknown; to?: unknown }>)) {
        if (cv && typeof cv === "object" && ("from" in cv || "to" in cv)) {
          parts.push(`${ck}: ${cv.from ?? "—"} → ${cv.to ?? "—"}`);
        }
      }
      continue;
    }
    if (v && typeof v === "object") {
      if ("from" in (v as object) || "to" in (v as object)) {
        const d = v as { from?: unknown; to?: unknown };
        parts.push(`${k}: ${d.from ?? "—"} → ${d.to ?? "—"}`);
      } else {
        const inner = Object.entries(v as Record<string, unknown>)
          .filter(([, iv]) => iv !== null && iv !== undefined)
          .map(([ik, iv]) => `${ik} ${iv}`)
          .join(", ");
        if (inner) parts.push(`${k}: ${inner}`);
      }
      continue;
    }
    parts.push(`${k}: ${String(v)}`);
  }
  return parts.join(" · ") || "—";
}

function ActionHistoryPage() {
  const [rows, setRows] = useState<ActionLog[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [actor, setActor] = useState("");
  const [actorType, setActorType] = useState("");
  const [action, setAction] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (actor.trim()) params.set("actor", actor.trim());
      if (actorType) params.set("actorType", actorType);
      if (action) params.set("action", action);
      const qs = params.toString();
      setRows(await apiClient.get<ActionLog[]>(`/api/action-logs${qs ? `?${qs}` : ""}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load action history");
    } finally {
      setLoading(false);
    }
  }, [from, to, actor, actorType, action]);

  useEffect(() => {
    apiClient.get<string[]>("/api/action-logs/actions").then(setActions).catch(() => setActions([]));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  const clearFilters = () => {
    setFrom("");
    setTo("");
    setActor("");
    setActorType("");
    setAction("");
  };

  return (
    <AdminShell
      title="Action History"
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
            <span className="text-xs font-medium text-muted-foreground">From</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">To</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Actor</span>
            <input
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              placeholder="Name or ID…"
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Actor type</span>
            <select value={actorType} onChange={(e) => setActorType(e.target.value)} className={inputCls}>
              <option value="">All</option>
              <option value="admin">Admin</option>
              <option value="worker">Worker</option>
              <option value="system">System</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Action</span>
            <select value={action} onChange={(e) => setAction(e.target.value)} className={cn(inputCls, "min-w-52")}>
              <option value="">All actions</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {actionLabel(a)}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={clearFilters}
            className="h-10 rounded-lg border border-border px-4 text-sm font-medium text-muted-foreground hover:bg-secondary"
          >
            Clear
          </button>
        </div>
      </Card>

      <Card className="p-0">
        <DataTable
          labels={["When", "Actor", "Action", "Target", "Details"]}
          head={
            <>
              <Th>When</Th>
              <Th>Actor</Th>
              <Th>Action</Th>
              <Th>Target</Th>
              <Th>Details</Th>
            </>
          }
        >
          {loading ? (
            <EmptyRow colSpan={5} text="Loading action history…" />
          ) : error ? (
            <EmptyRow colSpan={5} text={error} />
          ) : rows.length === 0 ? (
            <EmptyRow colSpan={5} text="No actions recorded yet for these filters." />
          ) : (
            rows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap text-muted-foreground">{fmtDateTime(r.createdAt)}</Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium capitalize", actorTone[r.actorType])}>
                      {r.actorType}
                    </span>
                    <div className="leading-tight">
                      <div className="text-sm font-medium">{r.actorName || "—"}</div>
                      {r.actorId && <div className="text-xs text-muted-foreground">{r.actorId}</div>}
                    </div>
                  </div>
                </Td>
                <Td className="whitespace-nowrap font-medium">{actionLabel(r.action)}</Td>
                <Td className="text-muted-foreground">
                  {r.targetType ? (
                    <span>
                      <span className="capitalize">{r.targetType.replace(/_/g, " ")}</span>
                      {r.targetId ? <span className="text-xs"> #{r.targetId}</span> : null}
                    </span>
                  ) : (
                    "—"
                  )}
                </Td>
                <Td className="max-w-md text-xs text-muted-foreground">{describe(r.details)}</Td>
              </tr>
            ))
          )}
        </DataTable>
      </Card>
    </AdminShell>
  );
}
