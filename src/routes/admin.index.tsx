import { createFileRoute, Link } from "@tanstack/react-router";
import { MoreHorizontal, Users, Wallet, UserPlus, Clock } from "lucide-react";
import { AdminShell } from "@/components/hr/admin-shell";
import { Card, SectionTitle, StatCard, Person } from "@/components/hr/bits";
import { PayrollBarChart, DonutChart, donutColors } from "@/components/hr/charts";
import { admin } from "@/lib/mock-data";
import { useApi } from "@/lib/api-store";
import { money } from "@/lib/hr-utils";
import { cn } from "@/lib/utils";

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
  const { totals, applications, payrollChart, deductionsData, notices, loading } = useApi();
  const deductionTotal = deductionsData.reduce((t, d) => t + d.value, 0);

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
            <UserPlus className="size-4" /> Registration form
          </Link>
        </div>

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
