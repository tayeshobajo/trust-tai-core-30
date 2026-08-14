import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/modules/steward")({
  component: () => <Outlet />,
});
