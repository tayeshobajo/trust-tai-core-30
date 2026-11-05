import type { LucideIcon } from "lucide-react";
import "./components.css";
export type CmdStatusTone =
  | "captured"
  | "qualifying"
  | "preparing"
  | "review"
  | "ready"
  | "submitted"
  | "awarded"
  | "declined"
  | "closed";
/** Visible text carries meaning; color and decorative icon reinforce it. */
export function CmdStatusBadge({
  tone,
  label,
  icon: Icon,
}: {
  tone: CmdStatusTone;
  label: string;
  icon: LucideIcon;
}) {
  return (
    <span className="cmd-status" data-tone={tone}>
      <Icon aria-hidden="true" size={14} />
      <span>{label}</span>
    </span>
  );
}
