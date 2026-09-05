import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { AdminShell } from "@/components/hr/admin-shell";
import {
  Card,
  DataTable,
  EmptyRow,
  Field,
  GhostButton,
  Modal,
  Person,
  PrimaryButton,
  StatCard,
  StatusBadge,
  Td,
  Th,
  inputCls,
} from "@/components/hr/bits";
import { useApi } from "@/lib/api-store";
import { fmtDate, todayISO, hoursBetween } from "@/lib/hr-utils";
import type { Attendance } from "@/lib/mock-data";

export const Route = createFileRoute("/admin/attendance")({
  head: () => ({
    meta: [
      { title: "Attendance — WorkHR" },
      { name: "description", content: "Daily check-in and check-out records per worker, location and source." },
      { property: "og:title", content: "Attendance — WorkHR" },
      { property: "og:description", content: "Daily check-in and check-out records per worker, location and source." },
    ],
  }),
  component: AttendancePage,
});

type FormState = { workerId: string; date: string; in: string; out: string; location: string };

function EntryForm({
  initial,
  editing,
  onClose,
}: {
  initial: FormState;
  editing: Attendance | null;
  onClose: () => void;
}) {
  const { workers, locations, addAttendance, updateAttendance } = useApi();
  const [form, setForm] = useState<FormState>(initial);
  const set = (k: keyof FormState) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workers || workers.length === 0) {
      alert('No workers available. Please create workers first.');
      return;
    }
    const w = workers.find((x) => x.id === form.workerId);
    if (!w) return;
    if (editing) {
      await updateAttendance(editing.id, { ...form, worker: w.name });
    } else {
      const result = await addAttendance({
        workerId: form.workerId,
        date: form.date,
        in: form.in,
        out: form.out,
        location: form.location,
        worker: w.name,
        source: "Admin"
      });
      if (!result) {
        alert('Failed to add attendance. Please try again.');
        return;
      }
    }
    onClose();
  };

  return (
    <Modal
      title={editing ? "Edit attendance entry" : "Add attendance entry"}
      description={editing ? `Editing ${editing.id}` : "Manually recorded entries are tagged as Admin."}
      onClose={onClose}
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Worker" className="sm:col-span-2">
          <select required value={form.workerId} onChange={set("workerId")} className={inputCls}>
            {workers?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} — {w.id}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date">
          <input required type="date" value={form.date} onChange={set("date")} className={inputCls} />
        </Field>
        <Field label="Location">
          <select required value={form.location} onChange={set("location")} className={inputCls}>
            {locations?.map((l) => (
              <option key={l.id}>{l.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Time in">
          <input required type="time" value={form.in} onChange={set("in")} className={inputCls} />
        </Field>
        <Field label="Time out">
          <input type="time" value={form.out} onChange={set("out")} className={inputCls} placeholder="Still checked in" />
        </Field>
        <p className="sm:col-span-2 rounded-lg bg-secondary/60 px-3 py-2 text-sm text-muted-foreground">
          Total hours:{" "}
          <strong className="text-foreground">
            {form.out ? `${hoursBetween(form.in, form.out).toFixed(2)} h` : "— (still active)"}
          </strong>
        </p>
        <div className="sm:col-span-2 flex justify-end gap-2">
          <GhostButton type="button" onClick={onClose}>
            Cancel
          </GhostButton>
          <PrimaryButton type="submit">{editing ? "Save changes" : "Add entry"}</PrimaryButton>
        </div>
      </form>
    </Modal>
  );
}

function AttendancePage() {
  const { attendance, workers, locations, deleteAttendance, loading, error, loadAttendance } = useApi();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Attendance | null>(null);
  const [workerFilter, setWorkerFilter] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const rows = useMemo(
    () =>
      [...(attendance || [])]
        .filter((a) => (workerFilter === "all" ? true : a.workerId === workerFilter))
        .filter((a) => (from ? a.date >= from : true))
        .filter((a) => (to ? a.date <= to : true))
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [attendance, workerFilter, from, to],
  );

  const today = todayISO();
  const todayRows = (attendance || []).filter((a) => a.date === today);
  const avg = rows.length ? rows.reduce((t, a) => t + a.hours, 0) / rows.length : 0;
  const openShifts = todayRows.filter((a) => a.out === "00:00:00" || a.out === "00:00");

  if (loading.attendance) {
    return (
      <AdminShell title="Attendance">
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Loading attendance...</div>
        </div>
      </AdminShell>
    );
  }

  if (error) {
    return (
      <AdminShell title="Attendance">
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <div className="text-red-500 font-medium">Failed to load attendance</div>
          <div className="text-sm text-muted-foreground">{error}</div>
          <button
            onClick={() => loadAttendance()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm"
          >
            Retry
          </button>
        </div>
      </AdminShell>
    );
  }

  const blank: FormState = {
    workerId: (workers && workers.length > 0) ? workers[0].id : "",
    date: today,
    in: "08:00",
    out: "17:00",
    location: (locations && locations.length > 0) ? locations[0].name : "",
  };

  return (
    <AdminShell
      title="Attendance"
      action={
        <button
          onClick={() => {
            if (!workers || workers.length === 0) {
              alert('No workers available. Please create workers first by approving registration applications.');
              return;
            }
            setEditing(null);
            setOpen(true);
          }}
          className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          <Plus className="size-4" /> Add Entry
        </button>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard label="Entries Today" value={String(todayRows.length)} hint="recorded" />
          <StatCard label="Average Hours / Entry" value={`${avg.toFixed(2)}h`} hint="current filter" />
          <StatCard
            label="Currently Checked In"
            value={String(openShifts.length)}
            hint="open shifts"
            tone="down"
          />
        </div>

        <Card className="p-0">
          <div className="flex flex-wrap items-center gap-3 p-5">
            <h2 className="mr-auto text-base font-semibold">Attendance Log ({rows.length})</h2>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-9 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary"
            />
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-9 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary"
            />
            <select
              value={workerFilter}
              onChange={(e) => setWorkerFilter(e.target.value)}
              className="h-9 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary"
            >
              <option value="all">All Workers</option>
              {workers && workers.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>

          <DataTable
            labels={["Worker", "Date", "Check-In", "Check-Out", "Location", "Total Hours", "Source", "Action"]}
            head={
              <>
                <Th>Worker</Th>
                <Th>Date</Th>
                <Th>Check-In</Th>
                <Th>Check-Out</Th>
                <Th>Location</Th>
                <Th>Total Hours</Th>
                <Th>Source</Th>
                <Th className="text-right">Action</Th>
              </>
            }
          >
            {rows.length === 0 && <EmptyRow colSpan={8} text="No attendance records for this filter." />}
            {rows.map((a) => (
              <tr key={a.id} className="hover:bg-secondary/40">
                <Td>
                  <div className="flex items-center gap-2">
                    {(!a.out || a.out === "00:00:00" || a.out === "00:00") && (
                      <div className="w-2 h-2 rounded-full bg-green-500" title="Currently checked in" />
                    )}
                    <Person name={a.worker} />
                  </div>
                </Td>
                <Td>{fmtDate(a.date)}</Td>
                <Td>{a.in}</Td>
                <Td>{a.out}</Td>
                <Td>
                  <div className="leading-tight">
                    <p>{a.location}</p>
                    {a.locationMismatch && (
                      <p className="text-xs font-medium text-danger">Location Mismatch</p>
                    )}
                    {a.checkInLat != null && (
                      <p className="text-xs text-muted-foreground">
                        {a.checkInLat.toFixed(5)}, {a.checkInLng?.toFixed(5)}
                      </p>
                    )}
                  </div>
                </Td>
                <Td className="font-medium">{a.hours.toFixed(2)} h</Td>
                <Td><StatusBadge status={a.source} /></Td>
                <Td>
                  <div className="flex justify-end gap-1 text-muted-foreground">
                    <button
                      onClick={() => {
                        setEditing(a);
                        setOpen(true);
                      }}
                      className="rounded-md p-1.5 hover:bg-secondary hover:text-primary"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      onClick={() => deleteAttendance(a.id)}
                      className="rounded-md p-1.5 hover:bg-secondary hover:text-danger"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </Td>
              </tr>
            ))}
          </DataTable>
        </Card>
      </div>

      {open && (
        <EntryForm
          editing={editing}
          initial={
            editing
              ? {
                  workerId: editing.workerId,
                  date: editing.date,
                  in: editing.in,
                  out: editing.out || "",
                  location: editing.location,
                }
              : blank
          }
          onClose={() => {
            setOpen(false);
            setEditing(null);
          }}
        />
      )}
    </AdminShell>
  );
}
