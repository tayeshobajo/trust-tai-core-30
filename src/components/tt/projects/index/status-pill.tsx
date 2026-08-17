/** The one place Projects renders its status language. */

import {
  SURFACE_STATUS_LABEL,
  SURFACE_STATUS_TONE,
  type SurfaceStatus,
} from "@/data/projects/index-projection";
import { cn } from "@/lib/utils";

export function ProjectStatusPill({
  status,
  className,
}: {
  status: SurfaceStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em]",
        SURFACE_STATUS_TONE[status],
        className,
      )}
    >
      {SURFACE_STATUS_LABEL[status]}
    </span>
  );
}
