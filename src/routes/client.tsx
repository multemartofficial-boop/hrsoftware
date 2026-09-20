import { Outlet, createFileRoute } from "@tanstack/react-router";
import { RequireRole } from "@/components/hr/auth-guard";

export const Route = createFileRoute("/client")({
  head: () => ({
    meta: [
      { title: "Client — WorkHR" },
      { name: "description", content: "Client portal" },
    ],
  }),
  component: ClientRoute,
});

function ClientRoute() {
  return (
    <RequireRole role="client">
      <Outlet />
    </RequireRole>
  );
}
