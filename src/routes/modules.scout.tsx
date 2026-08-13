import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/modules/scout")({
  component: () => <Outlet />,
});
