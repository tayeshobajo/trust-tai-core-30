import { BOARD_STATUS_LABEL, type BOARD_STATUSES } from "@/domain/cmd-tasks";
import { CmdStatusBadge, type CmdStatusTone } from "./status";

const tone: Record<(typeof BOARD_STATUSES)[number], CmdStatusTone> = {
  draft: "captured",
  open: "captured",
  in_progress: "preparing",
  waiting: "review",
  blocked: "declined",
  in_review: "review",
  needs_approval: "review",
  complete: "awarded",
};

export function CmdTaskStatus({ status }: { status: (typeof BOARD_STATUSES)[number] }) {
  return <CmdStatusBadge tone={tone[status]} label={BOARD_STATUS_LABEL[status]} />;
}
