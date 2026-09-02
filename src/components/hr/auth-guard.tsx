import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { useApi, type Role } from "@/lib/api-store";

/**
 * Frontend-only role gate. Redirects unauthenticated users to the login screen
 * and shows an "Access Denied" card when the signed-in role doesn't match.
 */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { session, authReady } = useApi();
  const navigate = useNavigate();

  useEffect(() => {
    if (authReady && !session) void navigate({ to: "/", replace: true });
  }, [authReady, session, navigate]);

  if (!authReady || !session) {
    return (
      <div className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (session.role !== role) {
    const home = session.role === "admin" ? "/admin" : "/worker/dashboard";
    return (
      <div className="grid min-h-screen place-items-center bg-background px-6">
        <div className="card-surface max-w-md p-8 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-danger-soft text-danger">
            <ShieldAlert className="size-5" />
          </span>
          <h1 className="mt-4 text-xl font-bold tracking-tight">Access Denied</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your account role ({session.role}) doesn't have permission to view this page.
          </p>
          <button
            onClick={() => void navigate({ to: home, replace: true })}
            className="mt-6 h-10 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground"
          >
            Go to my dashboard
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
