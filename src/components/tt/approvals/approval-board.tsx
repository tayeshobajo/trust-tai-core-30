/**
 * The queue: four columns, one card shape, no matter which room prepared it.
 *
 * A card says the same five things every time: what it is, who it concerns,
 * what happens if you approve, why it needs you, and how long it has waited.
 * Learning to read one card is learning to read all of them.
 *
 * Two things the board deliberately refuses to do. It never expands a payload
 * in place, because reading the work belongs in the workspace where the
 * boundary and the evidence are visible. And it never holds the whole queue:
 * each column shows a bounded page and asks for more, so a hundred waiting
 * decisions cost the same as ten.
 *
 * Dragging a card into Approved is a shortcut to the card's own authorising
 * action, not a second decision path. The card lifts, the column lights up,
 * the move shows immediately, and if the decision is refused the card returns
 * to where it was with the reason said out loud.
 */

import { useState } from "react";

import { MetaPill, TTButton } from "@/components/tt/primitives";
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

export interface BoardColumnView {
  rows: ApprovalRequest[];
  /** Everything matching the current filter, not just the rows on screen. */
  total: number;
  hasMore: boolean;
  loading: boolean;
}

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
  moving,
  onOpen,
  onApprove,
}: {
  request: ApprovalRequest;
  now: string;
  active: boolean;
  moving: boolean;
  onOpen: () => void;
  onApprove: () => void;
}) {
  const approvable = columnFor(request.status) !== "approved";

  return (
    <div
      draggable={approvable}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", request.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      className={`tt-level-secondary rounded-xl transition-all ${
        active ? "ring-1 ring-foreground/25" : ""
      } ${moving ? "opacity-60" : "hover:-translate-y-0.5 hover:shadow-sm"}`}
    >
      <button type="button" onClick={onOpen} className="w-full p-4 text-left">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-foreground">
            {request.title}
          </p>
          {request.urgency === "now" ? (
            <span className="tt-eyebrow shrink-0 text-foreground">Now</span>
          ) : null}
        </div>

        {request.sourceEntity.label ? (
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {request.sourceEntity.label}
          </p>
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

      {approvable ? (
        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2">
          <span className="text-[10px] text-muted-foreground">Drag to Approved, or</span>
          <TTButton variant="quiet" size="sm" onClick={onApprove} disabled={moving}>
            {moving ? "Recording…" : "Approve"}
          </TTButton>
        </div>
      ) : null}
    </div>
  );
}

export function ApprovalBoard({
  columns,
  now,
  activeId,
  movingId,
  onOpen,
  onLoadMore,
  onDropInto,
}: {
  columns: Record<BoardColumn, BoardColumnView>;
  now: string;
  activeId: string | null;
  movingId: string | null;
  onOpen: (request: ApprovalRequest) => void;
  onLoadMore: (column: BoardColumn) => void;
  onDropInto: (request: ApprovalRequest, column: BoardColumn) => void;
}) {
  const [over, setOver] = useState<BoardColumn | null>(null);

  const find = (id: string): ApprovalRequest | undefined =>
    BOARD_COLUMNS.flatMap((column) => columns[column].rows).find((row) => row.id === id);

  return (
    <div className="grid gap-4 lg:grid-cols-4">
      {BOARD_COLUMNS.map((column) => {
        const view = columns[column];
        return (
          <section
            key={column}
            aria-label={BOARD_COLUMN_LABEL[column]}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setOver(column);
            }}
            onDragLeave={() => setOver((current) => (current === column ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              setOver(null);
              const request = find(event.dataTransfer.getData("text/plain"));
              if (request) onDropInto(request, column);
            }}
            className={`rounded-xl p-1 transition-colors ${
              over === column ? "bg-royal/10 ring-1 ring-royal/40" : ""
            }`}
          >
            <header className="mb-3 flex items-baseline justify-between gap-2 px-1">
              <h3 className="tt-eyebrow">{BOARD_COLUMN_LABEL[column]}</h3>
              <span className="font-mono text-[10px] text-muted-foreground">{view.total}</span>
            </header>
            <div className="space-y-2">
              {view.rows.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">
                  {view.loading ? "Reading…" : "Nothing here."}
                </p>
              ) : (
                view.rows.map((request) => (
                  <Card
                    key={request.id}
                    request={request}
                    now={now}
                    active={request.id === activeId}
                    moving={request.id === movingId}
                    onOpen={() => onOpen(request)}
                    onApprove={() => onDropInto(request, "approved")}
                  />
                ))
              )}

              {view.hasMore ? (
                <TTButton
                  variant="quiet"
                  size="sm"
                  className="w-full"
                  onClick={() => onLoadMore(column)}
                  disabled={view.loading}
                >
                  {view.loading
                    ? "Loading…"
                    : `Load more (${Math.max(0, view.total - view.rows.length)} remaining)`}
                </TTButton>
              ) : null}
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
