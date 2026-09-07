/**
 * The one line delivery projection, read directly under a milestone heading.
 *
 * It shows only what the owning rooms already record. When no target date has
 * been recorded it offers the existing outcome editor rather than a new form,
 * so the read never dead ends (Canon 16).
 */

import type { DeliveryProjection } from "@/domain/delivery-projection";

export function DeliveryLine({
  projection,
  subject,
  onAddTargetDate,
}: {
  projection: DeliveryProjection;
  subject: string;
  onAddTargetDate?: (() => void) | undefined;
}) {
  return (
    <p
      className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground"
      aria-label={`Delivery of ${subject}`}
    >
      {projection.segments.map((segment, index) => (
        <span key={segment} className="flex items-center gap-2">
          {index === 0 ? (
            <span
              aria-hidden
              className={
                projection.unowned
                  ? "size-1.5 rounded-full bg-muted-foreground/40"
                  : "size-1.5 rounded-full bg-primary"
              }
            />
          ) : (
            <span aria-hidden className="text-border">
              ·
            </span>
          )}
          <span className={index <= 1 && !projection.unowned ? "font-medium text-foreground" : ""}>
            {segment}
          </span>
        </span>
      ))}
      {projection.missing === "target-date" && onAddTargetDate ? (
        <button
          type="button"
          onClick={onAddTargetDate}
          className="rounded-full text-[13px] font-medium text-royal underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Add a target date
        </button>
      ) : null}
    </p>
  );
}
