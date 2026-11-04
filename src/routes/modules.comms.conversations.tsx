import { createFileRoute, redirect } from "@tanstack/react-router";
import { conversationSearch } from "@/domain/comms-navigation";

export const Route = createFileRoute("/modules/comms/conversations")({
  validateSearch: conversationSearch,
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/modules/comms/relationships", search, replace: true });
  },
});
