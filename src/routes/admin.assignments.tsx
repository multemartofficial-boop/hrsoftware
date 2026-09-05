import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Trash2, CalendarCheck, RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/hr/admin-shell";
import {
  Card, Field, GhostButton, Modal, PrimaryButton, inputCls,
  DataTable, Th, Td, EmptyRow, Person, SectionTitle,
} from "@/components/hr/bits";
import { useApi } from "@/lib/api-store";
import { apiClient } from "@/lib/api-client";
import { fmtDate } from "@/lib/hr-utils";

export const Route = createFileRoute("/admin/assignments")({
  head: () => ({
    meta: [
      { title: "Daily Assignments — WorkHR" },
      { name: "description", content: "Assign workers to locations per day and track check-in match." },
    ],
  }),
  component: AssignmentsPage,
});

type Assignment = {
  id: string; workerId: string; worker: string;
  locationId: string; location: string; address: string;
  date: string;
};

type TodayRow = {
  id: string; workerId: string; worker: string; location: string;
  status: "not_checked_in" | "match" | "mismatch";
  checkedInAt: string | null; actualLocation: string | null;
};

const todayStr = () => new Date().toISOString().slice(0, 10);

function AssignForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { workers, locations } = useApi();
  const [workerId, setWorkerId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [date, setDate] = useState(todayStr());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const activeWorkers = workers || [];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await apiClient.post<{ updated: boolean; email: string }>("/api/assignments", {
        workerId, locationId, date,
      });
      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message || "Failed to save assignment");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Assign worker to location"
      description="If this worker already has an assignment for that date, it will be updated."
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Worker">
          <select required value={workerId} onChange={(e) => setWorkerId(e.target.value)} className={inputCls}>
            <option value="">Select worker</option>
            {activeWorkers.map((w) => (
              <option key={w.id} value={w.id}>{w.name} ({w.id})</option>
            ))}
          </select>
        </Field>
        <Field label="Location">
          <select required value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputCls}>
            <option value="">Select location</option>
            {(locations || []).map((l) => (
              <option key={l.id} value={l.id}>{l.name} — {l.address}</option>
            ))}
          </select>
        </Field>
        <Field label="Date">
          <input required type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </Field>
        {err && <p className="text-sm text-danger">{err}</p>}
        <div className="flex justify-end gap-2">
          <GhostButton type="button" onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton type="submit" disabled={busy}>{busy ? "Saving..." : "Assign"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function AssignmentsPage() {
  const [open, setOpen] = useState(false);
  const [todayRows, setTodayRows] = useState<TodayRow[]>([]);
  const [viewDate, setViewDate] = useState(todayStr());
  const [dateRows, setDateRows] = useState<Assignment[]>([]);
  const [lastPoll, setLastPoll] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);

  const loadToday = async () => {
    try {
      setTodayRows(await apiClient.get<TodayRow[]>("/api/assignments/today"));
      setLastPoll(new Date());
    } catch (e) { console.error("Load today assignments failed:", e); }
  };

  const loadDate = async (d: string) => {
    try {
      setDateRows(await apiClient.get<Assignment[]>(`/api/assignments?date=${d}`));
    } catch (e) { console.error("Load assignments failed:", e); }
  };

  // Poll today's assignments every 45s (same pattern as Live Map)
  useEffect(() => {
    loadToday();
    const id = setInterval(loadToday, 45_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { loadDate(viewDate); }, [viewDate]);

  const refresh = () => {
    setRefreshing(true);
    Promise.all([loadToday(), loadDate(viewDate)]).finally(() => setTimeout(() => setRefreshing(false), 400));
  };

  const del = async (id: string) => {
    try {
      await apiClient.delete(`/api/assignments/${id}`);
      refresh();
    } catch (e) { console.error("Delete assignment failed:", e); }
  };

  const statusBadge = (s: TodayRow["status"], actual: string | null) => {
    if (s === "match")
      return <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">Checked in — Matches assignment</span>;
    if (s === "mismatch")
      return <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">Checked in — MISMATCH{actual ? ` (${actual})` : ""}</span>;
    return <span className="text-xs text-muted-foreground">Not checked in yet</span>;
  };

  return (
    <AdminShell
      title="Daily Assignments"
      action={
        <div className="flex items-center gap-2">
          <button onClick={refresh} className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium">
            <RefreshCw className={`size-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh
          </button>
          <button
            onClick={() => setOpen(true)}
            className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            <Plus className="size-4" /> New Assignment
          </button>
        </div>
      }
    >
      {/* Today's live view */}
      <Card>
        <SectionTitle
          title="Today's assignments"
          action={<span className="text-xs text-muted-foreground">Auto-refreshes every 45s · {lastPoll.toLocaleTimeString()}</span>}
        />
        <DataTable
          labels={["Worker", "Assigned Location", "Checked In", "Status"]}
          head={<><Th>Worker</Th><Th>Assigned Location</Th><Th>Checked In</Th><Th>Status</Th></>}
        >
          {todayRows.length === 0 && <EmptyRow colSpan={4} text="No assignments for today yet." />}
          {todayRows.map((r) => (
            <tr key={r.id}>
              <Td><Person name={r.worker} sub={r.workerId} /></Td>
              <Td>{r.location}</Td>
              <Td>{r.checkedInAt || "—"}</Td>
              <Td>{statusBadge(r.status, r.actualLocation)}</Td>
            </tr>
          ))}
        </DataTable>
      </Card>

      {/* Assignments by date */}
      <Card className="mt-4">
        <SectionTitle
          title="Assignments by date"
          action={
            <div className="flex items-center gap-2">
              <CalendarCheck className="size-4 text-muted-foreground" />
              <input type="date" value={viewDate} onChange={(e) => setViewDate(e.target.value)} className="h-8 rounded-lg border border-border bg-card px-2 text-sm" />
            </div>
          }
        />
        <DataTable
          labels={["Worker", "Location", "Date", ""]}
          head={<><Th>Worker</Th><Th>Location</Th><Th>Date</Th><Th className="text-right">Actions</Th></>}
        >
          {dateRows.length === 0 && <EmptyRow colSpan={4} text={`No assignments on ${fmtDate(viewDate)}.`} />}
          {dateRows.map((r) => (
            <tr key={r.id}>
              <Td><Person name={r.worker} sub={r.workerId} /></Td>
              <Td>{r.location} <span className="text-xs text-muted-foreground">({r.address})</span></Td>
              <Td>{fmtDate(r.date)}</Td>
              <Td className="text-right">
                <button onClick={() => del(r.id)} className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-danger">
                  <Trash2 className="size-4" />
                </button>
              </Td>
            </tr>
          ))}
        </DataTable>
      </Card>

      {open && <AssignForm onClose={() => setOpen(false)} onSaved={refresh} />}
    </AdminShell>
  );
}
