/**
 * The queue: four columns, one card shape, no matter which room prepared it.
 *
 * A card says the same five things every time: what it is, who it concerns,
 * what happens if you approve, why it needs you, and how long it has waited.
 * Learning to read one card is learning to read all of them.
 */

import { MetaPill } from "@/components/tt/primitives";
import {
  BOARD_COLUMNS,
  BOARD_COLUMN_LABEL,
  SOURCE_APP_LABEL,
  STATUS_LABEL,
  URGENCY_LABEL,
  columnFor,
  type ApprovalRequest,
  type BoardColumn,
} from "@/domain/approvals";

function waited(createdAt: string, now: string): string {
  const hours = Math.max(0, (Date.parse(now) - Date.parse(createdAt)) / 3_600_000);
  if (hours < 1) return "Just now";
  if (hours < 24) return `${Math.round(hours)}h waiting`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} waiting`;
}

function Card({
  request,
  now,
  active,
  onOpen,
}: {
  request: ApprovalRequest;
  now: string;
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active ? "true" : undefined}
      className={`tt-level-secondary w-full rounded-xl p-4 text-left transition-colors ${
        active ? "ring-1 ring-foreground/25" : "hover:bg-muted/40"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-foreground">
          {request.title}
        </p>
        {request.urgency === "now" ? (
          <span className="tt-eyebrow shrink-0 text-foreground">Now</span>
        ) : null}
      </div>

      {request.sourceEntity.label ? (
        <p className="mt-1 truncate text-xs text-muted-foreground">{request.sourceEntity.label}</p>
      ) : null}

      <p className="mt-3 text-sm text-muted-foreground">
        {request.boundary.willDo[0] ?? "Records your decision only."}
      </p>

      <p className="mt-2 text-xs italic text-muted-foreground">{request.whyItNeedsYou}</p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <MetaPill>{SOURCE_APP_LABEL[request.sourceApp]}</MetaPill>
        {request.batch ? (
          <MetaPill>
            {request.batch.total} items
            {request.batch.exceptions > 0 ? `, ${request.batch.exceptions} flagged` : ""}
          </MetaPill>
        ) : null}
        <MetaPill>{waited(request.createdAt, now)}</MetaPill>
      </div>
    </button>
  );
}

export function ApprovalBoard({
  requests,
  now,
  activeId,
  onOpen,
}: {
  requests: ApprovalRequest[];
  now: string;
  activeId: string | null;
  onOpen: (request: ApprovalRequest) => void;
}) {
  const byColumn = (column: BoardColumn) =>
    requests.filter((request) => columnFor(request.status) === column);

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      {BOARD_COLUMNS.map((column) => {
        const rows = byColumn(column);
        return (
          <section key={column} aria-label={BOARD_COLUMN_LABEL[column]}>
            <header className="mb-3 flex items-baseline justify-between gap-2">
              <h3 className="tt-eyebrow">{BOARD_COLUMN_LABEL[column]}</h3>
              <span className="font-mono text-[10px] text-muted-foreground">{rows.length}</span>
            </header>
            <div className="space-y-2">
              {rows.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">
                  Nothing here.
                </p>
              ) : (
                rows.map((request) => (
                  <Card
                    key={request.id}
                    request={request}
                    now={now}
                    active={request.id === activeId}
                    onOpen={() => onOpen(request)}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function urgencyLine(request: ApprovalRequest): string {
  return `${URGENCY_LABEL[request.urgency]} · ${STATUS_LABEL[request.status]}`;
}
