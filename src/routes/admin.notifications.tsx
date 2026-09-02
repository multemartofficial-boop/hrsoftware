import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, Clock, Info, RotateCcw } from "lucide-react";
import { AdminShell } from "@/components/hr/admin-shell";
import { Card, Person } from "@/components/hr/bits";
import { useApi } from "@/lib/api-store";
import type { Notice } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications Center — WorkHR" },
      { name: "description", content: "Live contract expiry alerts and system notices grouped by urgency." },
      { property: "og:title", content: "Notifications Center — WorkHR" },
      { property: "og:description", content: "Live contract expiry alerts and system notices grouped by urgency." },
    ],
  }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const { notices, settings, reactivateWorker, loading } = useApi();

  if (loading.notifications) {
    return (
      <AdminShell title="Notifications Center">
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Loading notifications...</div>
        </div>
      </AdminShell>
    );
  }

  const groups = [
    {
      key: "critical" as const,
      title: settings ? `Urgent — ${settings.finalReminderDays} days or less` : "Urgent",
      icon: AlertTriangle,
      tone: "bg-danger-soft text-danger",
    },
    {
      key: "warning" as const,
      title: settings ? `Upcoming — within ${settings.firstReminderDays} days` : "Upcoming",
      icon: Clock,
      tone: "bg-warning-soft text-warning",
    },
    { key: "info" as const, title: "General updates", icon: Info, tone: "bg-secondary text-muted-foreground" },
  ];

  const Row = ({ n, tone }: { n: Notice; tone: string }) => (
    <div className="flex flex-wrap items-center gap-4 py-3.5">
      <Person name={n.worker} sub={n.occurred_at} />
      <p className="text-sm text-muted-foreground">{n.message}</p>
      <span className={cn("ml-auto rounded-full px-2.5 py-1 text-xs font-medium capitalize", tone)}>
        {n.urgency}
      </span>
      {n.workerId && (
        <Link
          to="/admin/workers/$id"
          params={{ id: n.workerId }}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
        >
          View Worker
        </Link>
      )}
      {n.workerId && (
        <button
          onClick={() => reactivateWorker(n.workerId!)}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
        >
          <RotateCcw className="size-3.5" /> Reactivate
        </button>
      )}
    </div>
  );

  return (
    <AdminShell title="Notifications Center">
      <div className="space-y-3">
        {groups.map((g) => {
          const items = notices.filter((n) => n.urgency === g.key);
          if (!items.length) return null;
          return (
            <Card key={g.key}>
              <div className="mb-2 flex items-center gap-2.5">
                <span className={cn("grid size-8 place-items-center rounded-lg", g.tone)}>
                  <g.icon className="size-4" />
                </span>
                <h2 className="text-base font-semibold">{g.title}</h2>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                  {items.length}
                </span>
              </div>
              <div className="divide-y divide-border">
                {items.map((n) => (
                  <Row key={n.id} n={n} tone={g.tone} />
                ))}
              </div>
            </Card>
          );
        })}
        {(!notices || notices.length === 0) && (
          <Card>
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing needs your attention.</p>
          </Card>
        )}
      </div>
    </AdminShell>
  );
}
