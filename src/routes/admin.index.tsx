import { createFileRoute, Link } from "@tanstack/react-router";
import { MoreHorizontal, Users, Wallet, UserPlus, Clock, X, AlertTriangle } from "lucide-react";
import { AdminShell } from "@/components/hr/admin-shell";
import { Card, SectionTitle, StatCard, Person } from "@/components/hr/bits";
import { PayrollBarChart, DonutChart, donutColors } from "@/components/hr/charts";
import { admin } from "@/lib/mock-data";
import { useApi } from "@/lib/api-store";
import { money } from "@/lib/hr-utils";
import { cn } from "@/lib/utils";
import { useState } from "react";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Admin Dashboard — WorkHR" },
      { name: "description", content: "Workforce, payroll cost and contract expiry overview for HR admins." },
      { property: "og:title", content: "Admin Dashboard — WorkHR" },
      { property: "og:description", content: "Workforce, payroll cost and contract expiry overview for HR admins." },
    ],
  }),
  component: Dashboard,
});

const urgencyTone = {
  critical: "bg-danger-soft text-danger",
  warning: "bg-warning-soft text-warning",
  info: "bg-secondary text-muted-foreground",
} as const;

function Dashboard() {
  const { totals, applications, payrollChart, deductionsData, notices, expiryNotices, visaNotices, loading, session } = useApi();
  const deductionTotal = deductionsData.reduce((t, d) => t + d.value, 0);
  const [dismissedUrgent, setDismissedUrgent] = useState<string[]>([]);

  // Urgent expiry warnings — computed live from current worker records so only
  // workers actually nearing expiry show up (no stale/demo entries).
  const urgentNotifications = [...(expiryNotices || []), ...(visaNotices || [])]
    .filter(n => !dismissedUrgent.includes(n.id));

  if (loading.workers || loading.applications) {
    return (
      <AdminShell title="Dashboard">
        <div className="flex items-center justify-center h-64">
          <div className="text-muted-foreground">Loading dashboard...</div>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell title="Dashboard">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="mr-auto text-2xl font-bold tracking-tight">Good Morning, {admin.name}</h2>
          <Link
            to="/register"
            className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            <UserPlus className="size-4" /> Worker Registration
          </Link>
        </div>

        {/* Urgent notification popup */}
        {urgentNotifications.length > 0 && (
          <div className="card-surface flex items-start gap-3 p-4 border-l-4 border-l-danger">
            <AlertTriangle className="size-5 text-danger shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-sm">Urgent Worker Expiry Warnings</p>
              <div className="mt-2 space-y-2">
                {urgentNotifications.map((n) => (
                  <div key={n.id} className="flex items-start gap-2 text-sm">
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium capitalize", urgencyTone[n.urgency])}>
                      {n.urgency}
                    </span>
                    <p className="text-muted-foreground">{n.message}</p>
                  </div>
                ))}
              </div>
            </div>
            <button
              onClick={() => setDismissedUrgent([...dismissedUrgent, ...urgentNotifications.map(n => n.id)])}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard label="Total Active Workers" value={String(totals.activeWorkers)} hint="in contract" icon={<Users className="size-4" />} />
          <StatCard label="Total Payroll Cost" value={money(totals.payrollCost)} hint="gross issued" icon={<Wallet className="size-4" />} />
          <StatCard label="Pending Registrations" value={String(applications?.length ?? 0)} hint="awaiting review" icon={<UserPlus className="size-4" />} />
          <StatCard label="Workers Expiring Soon" value={String(totals.expiringSoon)} tone="down" hint="contract" icon={<Clock className="size-4" />} />
        </div>

        <div className="grid gap-3 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <SectionTitle title="Payroll Cost Overview" action={<span className="text-xs text-muted-foreground">Last 9 months</span>} />
            <PayrollBarChart data={payrollChart} />
          </Card>

          <Card>
            <SectionTitle title="Advance & Deductions" action={<MoreHorizontal className="size-4 text-muted-foreground" />} />
            <DonutChart data={deductionsData} total={money(deductionTotal)} label="Total" />
            <div className="mt-4 grid grid-cols-3 gap-2">
              {deductionsData.map((d, i) => (
                <div key={d.name} className="border-l-2 pl-2" style={{ borderColor: donutColors[i] }}>
                  <p className="text-sm font-semibold">{money(d.value)}</p>
                  <p className="text-xs text-muted-foreground">{d.name}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Card>
          <SectionTitle
            title="Recent Notifications"
            action={
              <Link to="/admin/notifications" className="text-xs text-muted-foreground">
                View all ›
              </Link>
            }
          />
          <div className="divide-y divide-border">
            {(notices || []).slice(0, 5).map((n) => (
              <div key={n.id} className="flex items-center gap-3 py-3">
                <Person name={n.worker} sub={n.occurred_at} />
                <p className="ml-4 text-sm text-muted-foreground">{n.message}</p>
                <span className={cn("ml-auto rounded-full px-2.5 py-1 text-xs font-medium capitalize", urgencyTone[n.urgency])}>
                  {n.urgency}
                </span>
              </div>
            ))}
            {(!notices || notices.length === 0) && (
              <p className="py-6 text-center text-sm text-muted-foreground">No notifications right now.</p>
            )}
          </div>
        </Card>
      </div>
    </AdminShell>
  );
}
