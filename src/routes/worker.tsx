import { Outlet } from "@tanstack/react-router";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/worker")({
  head: () => ({
    meta: [
      { title: "Worker — WorkHR" },
      { name: "description", content: "Worker portal" },
    ],
  }),
  component: WorkerRoute,
});

function WorkerRoute() {
  return <Outlet />;
}
