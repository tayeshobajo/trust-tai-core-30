// ============= Full file contents =============
/**
 * Steward, the meeting workroom.
 *
 * The first page under Steward: stored meetings on the left, the confirmed
 * promises of one meeting in the middle, and the selected promise's source
 * and next step on the right. Real rows only; meeting review confirms
 * proposals, not completion. Verify/reopen controls remain unavailable.
 * The compact Steward workroom is embedded in AppShell; global suite
 * navigation and account controls remain in the shared shell.
 *
 * The selected meeting and task live in validated search params so reload
 * and back/forward restore exactly what a person was looking at. The params
 * carry ids only; every read stays scoped to the active membership.
 */

import { createFileRoute } from "@tanstack/react-router";

import { StewardWorkroom } from "@/components/tt/steward/workroom";
import { WorkspaceGate } from "@/components/tt/workspace-gate";

const TITLE = "Steward · Meetings · Trust Tai OS";
const DESCRIPTION =
  "What was promised in each meeting, who owns it, and what is genuinely verified complete.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROW_KEY = /^(commitment|business-task|required-task):[0-9a-f-]{36}$/i;

interface WorkroomSearch {
  meeting?: string;
  task?: string;
}

export const Route = createFileRoute("/modules/steward/")({
  validateSearch: (search: Record<string, unknown>): WorkroomSearch => {
    const meeting =
      typeof search["meeting"] === "string" && UUID.test(search["meeting"])
        ? search["meeting"].toLowerCase()
        : undefined;
    const task =
      typeof search["task"] === "string" && ROW_KEY.test(search["task"])
        ? search["task"]
        : undefined;
    return { ...(meeting ? { meeting } : {}), ...(task ? { task } : {}) };
  },
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: StewardWorkroomRoute,
});

function StewardWorkroomRoute() {
  const { meeting, task } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <WorkspaceGate appId="steward">
      {(identity) => (
        <StewardWorkroom
          identity={identity}
          selection={{ meetingId: meeting ?? null, rowKey: task ?? null }}
          onSelect={(meetingId, rowKey) =>
            void navigate({
              to: "/modules/steward",
              search: {
                ...(meetingId ? { meeting: meetingId } : {}),
                ...(rowKey ? { task: rowKey } : {}),
              },
              replace: false,
            })
          }
        />
      )}
    </WorkspaceGate>
  );
}
