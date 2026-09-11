import { useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { GlobalSearch } from "@/components/hr/global-search";
import {
  LayoutDashboard,
  CalendarCheck,
  Wallet,
  Bell,
  Settings,
  LifeBuoy,
  Users,
  UserCheck,
  MapPin,
  MapPinned,
  FileText,
  BarChart3,
  Scale,
  History,
  TriangleAlert,
  Building2,
  Search,

  Sparkles,
  MoreHorizontal,
  X,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { avatarUrl } from "@/lib/mock-data";
import { useApi } from "@/lib/api-store";
import { RequireRole } from "@/components/hr/auth-guard";

const mainMenu = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/attendance", label: "Attendance", icon: CalendarCheck },
  { to: "/admin/payrolls", label: "Payrolls", icon: Wallet },
] as const;

const teamMenu = [
  { to: "/admin/workers", label: "Worker Directory", icon: Users },
  { to: "/admin/approvals", label: "Registration Approvals", icon: UserCheck },
  { to: "/admin/locations", label: "Locations", icon: MapPin },
  { to: "/admin/live-map", label: "Live Map", icon: MapPinned },
  { to: "/admin/assignments", label: "Daily Assignments", icon: CalendarCheck },
  { to: "/admin/clients", label: "Clients", icon: Building2 },
  { to: "/admin/documents", label: "Documents", icon: FileText },
  { to: "/admin/finance", label: "Buyer & Profit/Loss", icon: Scale },
  { to: "/admin/reports", label: "Reports", icon: BarChart3 },
  { to: "/admin/incidents", label: "Incidents", icon: TriangleAlert },
] as const;

const systemMenu = [
  { to: "/admin/action-history", label: "Action History", icon: History },
] as const;

/* pinned to the very bottom of the sidebar */
const bottomMenu = [
  { to: "/admin/notifications", label: "Notifications", icon: Bell },
  { to: "/admin/settings", label: "Settings", icon: Settings },
  { to: "/admin/help", label: "Help & Center", icon: LifeBuoy },
] as const;

/* tabs shown in the mobile bottom bar */
const mobileTabs = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/workers", label: "Workers", icon: Users },
  { to: "/admin/attendance", label: "Attendance", icon: CalendarCheck },
  { to: "/admin/payrolls", label: "Payrolls", icon: Wallet },
  { to: "/admin/reports", label: "Reports", icon: BarChart3 },
] as const;

const moreMenu = [
  { to: "/admin/approvals", label: "Registration Approvals", icon: UserCheck },
  { to: "/admin/notifications", label: "Notifications", icon: Bell },
  { to: "/admin/locations", label: "Locations", icon: MapPin },
  { to: "/admin/live-map", label: "Live Map", icon: MapPinned },
  { to: "/admin/assignments", label: "Daily Assignments", icon: CalendarCheck },
  { to: "/admin/documents", label: "Documents", icon: FileText },
  { to: "/admin/finance", label: "Buyer & Profit/Loss", icon: Scale },
  { to: "/admin/incidents", label: "Incidents", icon: TriangleAlert },
  { to: "/admin/clients", label: "Clients", icon: Building2 },
  { to: "/admin/action-history", label: "Action History", icon: History },
  { to: "/admin/settings", label: "Settings", icon: Settings },
  { to: "/admin/help", label: "Help & Center", icon: LifeBuoy },
] as const;

function isActive(pathname: string, to: string) {
  return to === "/admin" ? pathname === "/admin" : pathname.startsWith(to);
}

function NavItem({ to, label, icon: Icon }: { to: string; label: string; icon: typeof Users }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const active = isActive(pathname, to);
  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
        active
          ? "bg-primary-soft font-semibold text-primary"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
      {label}
    </Link>
  );
}

function MobileNav({ onLogout }: { onLogout: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [more, setMore] = useState(false);
  const moreActive = moreMenu.some((m) => isActive(pathname, m.to));

  return (
    <>
      {more && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-foreground/40 backdrop-blur-sm lg:hidden">
          <button className="flex-1" aria-label="Close menu" onClick={() => setMore(false)} />
          <div className="card-surface rounded-b-none p-4 pb-6">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold">More</p>
              <button
                onClick={() => setMore(false)}
                aria-label="Close"
                className="grid size-8 place-items-center rounded-lg border border-border text-muted-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <nav className="flex flex-col gap-1">
              {moreMenu.map((i) => (
                <Link
                  key={i.to}
                  to={i.to}
                  onClick={() => setMore(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-3 text-sm",
                    isActive(pathname, i.to)
                      ? "bg-primary-soft font-semibold text-primary"
                      : "text-muted-foreground",
                  )}
                >
                  <i.icon className="size-4" /> {i.label}
                </Link>
              ))}
              <button
                onClick={() => {
                  setMore(false);
                  onLogout();
                }}
                className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-danger"
              >
                <LogOut className="size-4" /> Log Out
              </button>
            </nav>
          </div>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
        {mobileTabs.map((t) => {
          const active = isActive(pathname, t.to);
          return (
            <Link
              key={t.to}
              to={t.to}
              className={cn(
                "flex flex-col items-center gap-1 py-2 text-[10px] font-medium",
                active ? "text-primary" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "grid h-7 w-12 place-items-center rounded-full",
                  active && "bg-primary-soft",
                )}
              >
                <t.icon className="size-4" />
              </span>
              {t.label}
            </Link>
          );
        })}
        <button
          onClick={() => setMore(true)}
          className={cn(
            "flex flex-col items-center gap-1 py-2 text-[10px] font-medium",
            more || moreActive ? "text-primary" : "text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "grid h-7 w-12 place-items-center rounded-full",
              (more || moreActive) && "bg-primary-soft",
            )}
          >
            <MoreHorizontal className="size-4" />
          </span>
          More
        </button>
      </nav>
    </>
  );
}

export function AdminShell(props: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <RequireRole role="admin">
      <AdminShellInner {...props} />
    </RequireRole>
  );
}

function AdminShellInner({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const { notices, workers, logout, session } = useApi();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    void navigate({ to: "/", replace: true });
  };
  const urgentCount = notices.filter((n) => n.urgency !== "info").length;
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <div className="flex min-h-screen gap-3 bg-background p-3">
      <aside className="card-surface sticky top-3 hidden h-[calc(100vh-1.5rem)] w-64 shrink-0 flex-col p-4 lg:flex">
        <Link to="/admin" className="mb-6 flex items-center gap-2.5 px-1">
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </span>
          <span className="text-lg font-bold tracking-tight">WorkHR</span>
        </Link>

        <p className="px-3 pb-2 text-[11px] font-semibold tracking-widest text-muted-foreground/70">
          MAIN MENU
        </p>
        <nav className="flex flex-col gap-1">
          {mainMenu.map((i) => (
            <NavItem key={i.to} {...i} />
          ))}
        </nav>

        <p className="px-3 pt-6 pb-2 text-[11px] font-semibold tracking-widest text-muted-foreground/70">
          TEAM MANAGEMENT
        </p>
        <nav className="flex flex-col gap-1">
          {teamMenu.map((i) => (
            <NavItem key={i.to} {...i} />
          ))}
        </nav>

        <p className="px-3 pt-6 pb-2 text-[11px] font-semibold tracking-widest text-muted-foreground/70">
          SYSTEM
        </p>
        <nav className="flex flex-col gap-1">
          {systemMenu.map((i) => (
            <NavItem key={i.to} {...i} />
          ))}
        </nav>

        <nav className="mt-auto flex flex-col gap-1 border-t border-border pt-3">
          {bottomMenu.map((i) => (
            <NavItem key={i.to} {...i} />
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        {/* mobile header */}
        <header className="card-surface mb-3 flex items-center gap-2 px-4 py-3 lg:hidden">
          {searchOpen ? (
            <>
              <GlobalSearch className="flex-1" autoFocus onDone={() => setSearchOpen(false)} />
              <button
                onClick={() => setSearchOpen(false)}
                aria-label="Close search"
                className="grid size-9 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground"
              >
                <X className="size-4" />
              </button>
            </>
          ) : (
            <>
              <Link to="/admin" className="flex min-w-0 items-center gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
                  <Sparkles className="size-4" />
                </span>
                <span className="truncate text-base font-bold tracking-tight">WorkHR</span>
              </Link>
              <button
                onClick={() => setSearchOpen(true)}
                aria-label="Search"
                className="ml-auto grid size-9 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground"
              >
                <Search className="size-4" />
              </button>
              <Link
                to="/admin/notifications"
                aria-label={`Notifications, ${urgentCount} urgent`}
                className="relative grid size-9 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground"
              >
                <Bell className="size-4" />
                {urgentCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 grid min-w-4.5 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold text-primary-foreground">
                    {urgentCount}
                  </span>
                )}
              </Link>
              <img
                src={avatarUrl(session?.name ?? workers[0]?.name ?? "Admin")}
                alt="Profile"
                className="size-9 shrink-0 rounded-full border border-border bg-secondary"
              />
              <button
                onClick={handleLogout}
                aria-label="Log out"
                className="grid size-9 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground"
              >
                <LogOut className="size-4" />
              </button>
            </>
          )}
        </header>

        {/* desktop header */}
        <header className="card-surface mb-3 hidden flex-wrap items-center gap-3 px-5 py-3 lg:flex">
          <h1 className="mr-auto text-lg font-semibold tracking-tight">{title}</h1>

          <GlobalSearch className="hidden w-80 md:block" />

          <Link
            to="/admin/notifications"
            className="relative grid size-9 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-secondary"
            aria-label={`Notifications, ${urgentCount} urgent`}
          >
            <Bell className="size-4" />
            {urgentCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 grid min-w-4.5 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold text-primary-foreground">
                {urgentCount}
              </span>
            )}
          </Link>

          <div className="hidden items-center xl:flex">
            {workers.slice(0, 3).map((w, i) => (
              <img
                key={w.id}
                src={avatarUrl(w.name)}
                alt={w.name}
                className={cn("size-8 rounded-full border-2 border-card bg-secondary", i && "-ml-2.5")}
              />
            ))}
          </div>

          <button
            onClick={handleLogout}
            title={`Log out${session ? ` (${session.email})` : ""}`}
            aria-label="Log out"
            className="grid size-9 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-danger"
          >
            <LogOut className="size-4" />
          </button>

          {action}
        </header>

        <h1 className="mb-3 px-1 text-xl font-semibold tracking-tight lg:hidden">{title}</h1>

        <main className="pb-28 lg:pb-6">{children}</main>
      </div>

      {/* mobile primary action as a floating button */}
      {action && (
        <div className="fixed right-4 bottom-20 z-40 [&_button]:h-12 [&_button]:rounded-full [&_button]:px-5 [&_button]:shadow-lg lg:hidden">
          {action}
        </div>
      )}

      <MobileNav onLogout={handleLogout} />
    </div>
  );
}
