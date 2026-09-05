import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Search, Download, RotateCcw, Trash2, Eye } from "lucide-react";
import { AdminShell } from "@/components/hr/admin-shell";
import { Card, DataTable, EmptyRow, Person, StatusBadge, Td, Th } from "@/components/hr/bits";
import { avatarUrl } from "@/lib/mock-data";
import { useApi } from "@/lib/api-store";
import { fmtDate, daysUntil } from "@/lib/hr-utils";

export const Route = createFileRoute("/admin/workers/")({
  head: () => ({
    meta: [
      { title: "Worker Directory — WorkHR" },
      { name: "description", content: "Browse every worker with contact details, location, joining date and live contract status." },
      { property: "og:title", content: "Worker Directory — WorkHR" },
      { property: "og:description", content: "Browse every worker with contact details, location, joining date and live contract status." },
    ],
  }),
  component: WorkerDirectory,
});

const selectCls =
  "h-9 rounded-lg border border-border bg-card px-3 text-sm outline-none focus:border-primary";

function WorkerDirectory() {
  const { workers, locations, workerStatus, reactivateWorker, deleteWorker, loading, error, loadWorkers, loadLocations, attendance } = useApi();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [loc, setLoc] = useState("all");

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (workers || []).filter((w) => {
      const s = workerStatus(w);
      if (status !== "all" && s !== status) return false;
      if (loc !== "all" && w.location !== loc) return false;
      if (!term) return true;
      return [w.name, w.id, w.email, w.phone, w.role, w.location].some((v) =>
        v.toLowerCase().includes(term),
      );
    });
  }, [workers, q, status, loc, workerStatus]);

  // Determine which workers are currently checked in (active)
  const activeWorkers = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const checkedIn = new Set<string>();
    
    (attendance || []).forEach(a => {
      if (a.date === today && (a.out === "00:00:00" || a.out === "00:00" || !a.out)) {
        checkedIn.add(a.workerId);
      }
    });
    
    return checkedIn;
  }, [attendance]);

  if (loading.workers) {
    return (
      <AdminShell title="Worker Directory">
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Loading workers...</div>
        </div>
      </AdminShell>
    );
  }

  if (error) {
    return (
      <AdminShell title="Worker Directory">
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <div className="text-red-500 font-medium">Failed to load workers</div>
          <div className="text-sm text-muted-foreground">{error}</div>
          <button
            onClick={() => loadWorkers()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm"
          >
            Retry
          </button>
        </div>
      </AdminShell>
    );
  }

  if (!workers || workers.length === 0) {
    return (
      <AdminShell title="Worker Directory">
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <div className="text-muted-foreground">No workers found</div>
          <button
            onClick={() => { loadWorkers(); loadLocations(); }}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm"
          >
            Refresh
          </button>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell title="Worker Directory">
      <Card className="p-0">
        <div className="flex flex-wrap items-center gap-3 p-5">
          <h2 className="mr-auto text-base font-semibold">
            All Workers ({rows.length}
            {workers && rows.length !== workers.length ? ` of ${workers.length}` : ""})
          </h2>
          <div className="relative w-full sm:w-auto">
            <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search worker"
              className="h-9 w-full rounded-lg sm:w-56 border border-border bg-card pl-9 text-sm outline-none focus:border-primary"
            />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls}>
            <option value="all">All Status</option>
            <option value="Active">Active</option>
            <option value="Expiring Soon">Expiring Soon</option>
            <option value="Expired">Expired</option>
            <option value="On Leave">On Leave</option>
          </select>
          <select value={loc} onChange={(e) => setLoc(e.target.value)} className={selectCls}>
            <option value="all">All Locations</option>
            {locations?.map((l) => (
              <option key={l.id} value={l.name}>
                {l.name}
              </option>
            ))}
          </select>
          <button className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm">
            <Download className="size-4" /> Export
          </button>
        </div>

        <DataTable
          labels={["Photo", "Code", "Name", "Contact", "Location", "Joined", "Expiry", "Compliance", "Status", "Action"]}
          head={
            <>
              <Th>Photo</Th>
              <Th>Worker Code</Th>
              <Th>Name</Th>
              <Th>Phone / Email</Th>
              <Th>Location</Th>
              <Th>Joining Date</Th>
              <Th>Expiry</Th>
              <Th>Compliance</Th>
              <Th>Status</Th>
              <Th className="text-right">Action</Th>
            </>
          }
        >
          {(!rows || rows.length === 0) && <EmptyRow colSpan={10} text="No workers match these filters." />}
          {(rows || []).map((w) => {
            const left = daysUntil(w.expiry);
            return (
              <tr
                key={w.id}
                onClick={() => navigate({ to: "/admin/workers/$id", params: { id: w.id } })}
                className="cursor-pointer hover:bg-secondary/40"
              >
                <Td>
                  <img src={avatarUrl(w.name)} alt={w.name} className="size-9 rounded-full bg-secondary" />
                </Td>
                <Td className="font-medium">{w.id}</Td>
                <Td>
                  <Person name={w.name} sub={w.role} />
                </Td>
                <Td>
                  <div className="leading-tight">
                    <p>{w.phone}</p>
                    <p className="text-xs text-muted-foreground">{w.email}</p>
                  </div>
                </Td>
                <Td>{w.location}</Td>
                <Td>{fmtDate(w.joined)}</Td>
                <Td>
                  <div className="leading-tight">
                    <p>{fmtDate(w.expiry)}</p>
                    <p className="text-xs text-muted-foreground">
                      {left < 0 ? `${Math.abs(left)}d overdue` : `${left}d left`}
                    </p>
                  </div>
                </Td>
                <Td>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      (w.complianceDone ?? 0) >= 8
                        ? "bg-success/10 text-success"
                        : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {w.complianceDone ?? 0}/8
                  </span>
                </Td>
                <Td>
                  <div className="flex items-center gap-2">
                    {activeWorkers.has(w.id) && (
                      <div className="w-2 h-2 rounded-full bg-green-500" title="Currently checked in" />
                    )}
                    <StatusBadge status={workerStatus(w)} />
                  </div>
                </Td>
                <Td>
                  <div className="flex justify-end gap-1 text-muted-foreground" onClick={(e) => e.stopPropagation()}>
                    <Link
                      title="View details"
                      to="/admin/workers/$id"
                      params={{ id: w.id }}
                      className="rounded-md p-1.5 hover:bg-secondary hover:text-primary"
                    >
                      <Eye className="size-4" />
                    </Link>
                    <button
                      title="Reactivate for 3 months"
                      onClick={() => reactivateWorker(w.id)}
                      className="rounded-md p-1.5 hover:bg-secondary hover:text-primary"
                    >
                      <RotateCcw className="size-4" />
                    </button>
                    <button
                      title="Remove worker"
                      onClick={() => deleteWorker(w.id)}
                      className="rounded-md p-1.5 hover:bg-secondary hover:text-danger"
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
    </AdminShell>
  );
}
