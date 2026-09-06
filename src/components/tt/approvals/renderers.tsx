/**
 * The approval renderer registry.
 *
 * Every approval type shares one shell: the same header, the same context, the
 * same boundary statement, the same decision bar. What differs is the middle,
 * and only the middle. A new approval type is a new entry here, not a new
 * screen, so the room cannot fragment as the suite grows.
 *
 * A renderer reads its own `payload` and nothing else. The shell reads the
 * universal fields and never the payload. That boundary is what keeps a
 * hundred approval types feeling like one room.
 */

import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";

import { MetaPill, TonePill, TTButton } from "@/components/tt/primitives";
import {
  EXCEPTION_LABEL,
  ITEM_STATE_LABEL,
  ITEM_STATE_TONE,
  MIN_OVERRIDE_REASON,
  batchReviewLine,
  summariseBatch,
  type ApprovalItem,
  type ApprovalRequest,
  type ApprovalType,
  type StateTone,
} from "@/domain/approvals";

function str(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function list(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
}

function Block({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <p className="tt-eyebrow mb-2">{label}</p>
      {children}
    </section>
  );
}

function Reasons({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <Block label={label}>
      <ul className="space-y-1.5 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span aria-hidden className="mt-[0.45rem] size-1 shrink-0 rounded-full bg-border" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </Block>
  );
}

export interface RendererProps {
  request: ApprovalRequest;
  items: ApprovalItem[];
  /** Which batch items the person has chosen to authorise. */
  selected: Set<string>;
  onToggle: (itemId: string) => void;
  /**
   * Accepting one flagged item, deliberately and with a reason. Absent when
   * the surface has no such act to offer.
   */
  override?: {
    /** Non-null when this person may not decide here at all. */
    refusal: string | null;
    pending: boolean;
    onSubmit: (itemId: string, reason: string) => void;
  };
}

/* --------------------------------------------------------- batch items */

/**
 * The resting surface of an item, by what its state means. Soft tints and a
 * border shift, never a saturated fill: the page should read as paper with
 * a few things marked on it, not as a dashboard.
 */
const TONE_SURFACE: Record<StateTone, string> = {
  neutral: "border-border bg-card",
  active: "border-border bg-card",
  good: "border-success/30 bg-success/6",
  caution: "border-warning/35 bg-warning/6",
  risk: "border-destructive/25 bg-destructive/5",
};

const TONE_DOT: Record<StateTone, string> = {
  neutral: "bg-border",
  active: "bg-royal",
  good: "bg-success",
  caution: "bg-warning",
  risk: "bg-destructive",
};

function ItemFacts({ item }: { item: ApprovalItem }) {
  const tone = ITEM_STATE_TONE[item.state];
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      <TonePill tone={tone}>{ITEM_STATE_LABEL[item.state]}</TonePill>
      {item.facts["hitScore"] != null ? <MetaPill>HIT {String(item.facts["hitScore"])}</MetaPill> : null}
      {item.facts["wordCount"] != null ? (
        <MetaPill>{String(item.facts["wordCount"])} words</MetaPill>
      ) : null}
      {item.facts["imageState"] && item.facts["imageState"] !== "ready" ? (
        <MetaPill>Image {String(item.facts["imageState"])}</MetaPill>
      ) : null}
      {item.facts["seoState"] && item.facts["seoState"] !== "ready" ? (
        <MetaPill>SEO {String(item.facts["seoState"])}</MetaPill>
      ) : null}
    </div>
  );
}

/**
 * The way into the article itself. A distinct link, never a way of selecting
 * the row: reading and deciding are two different acts.
 */
function ArticleLink({ item }: { item: ApprovalItem }) {
  if (!item.facts["contentItemId"]) return null;
  return (
    <Link
      to="/modules/studio/$itemId"
      params={{ itemId: String(item.facts["contentItemId"]) }}
      onClick={(event) => event.stopPropagation()}
      className="text-sm text-royal underline decoration-royal/40 underline-offset-4 transition-colors hover:decoration-royal focus-visible:decoration-royal"
    >
      Read the article
    </Link>
  );
}

/**
 * The compact decision panel for one flagged item. Opened on purpose, one at
 * a time, and closed again by a decision or by Cancel. It asks for a sentence
 * because taking an exception should cost a sentence.
 */
function ReviewPanel({
  id,
  item,
  override,
  onCancel,
}: {
  id: string;
  item: ApprovalItem;
  override: NonNullable<RendererProps["override"]>;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const reasonId = useId();
  const trimmed = reason.trim();
  const valid = trimmed.length >= MIN_OVERRIDE_REASON;

  function submit() {
    if (!valid || override.pending) return;
    override.onSubmit(item.id, trimmed);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div
      id={id}
      role="group"
      aria-label={`Approve ${item.title}`}
      data-testid="review-panel"
      onClick={(event) => event.stopPropagation()}
      className="rounded-b-xl border-t border-warning/30 bg-card/80 px-4 py-4"
    >
      <label htmlFor={reasonId} className="block text-sm font-medium text-foreground">
        Why you are approving this article
      </label>
      <textarea
        id={reasonId}
        autoFocus
        rows={2}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="One sentence is enough. It is kept on the record with your name."
        className="mt-2 w-full resize-y rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-royal"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <TTButton
          size="sm"
          disabled={!valid}
          pending={override.pending}
          pendingLabel="Recording…"
          onClick={submit}
        >
          Approve this article
        </TTButton>
        <TTButton variant="quiet" size="sm" onClick={onCancel}>
          Cancel
        </TTButton>
        <p className="text-xs text-muted-foreground sm:ml-auto">
          Approves only this article. Nothing is queued or published.
        </p>
      </div>
    </div>
  );
}

/**
 * One flagged item: the state, why it was flagged, the article, and one clear
 * way in. The whole card is the way in, and so is the button, so nobody has
 * to discover which pixel is live. No tick box appears here at all, because a
 * tick box that cannot be ticked reads as broken rather than governed.
 */
function FlaggedItem({
  item,
  override,
  reviewing,
  onOpen,
  onClose,
}: {
  item: ApprovalItem;
  override: RendererProps["override"];
  reviewing: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const panelId = useId();
  const interactive = Boolean(override) && !override?.refusal;
  const reasons = item.exceptionReasons.map((reason) => EXCEPTION_LABEL[reason]).join(". ");

  return (
    <li>
      <div
        data-item-state={item.state}
        data-reviewing={reviewing || undefined}
        onClick={interactive && !reviewing ? onOpen : undefined}
        className={`group rounded-xl border transition-all duration-200 ${TONE_SURFACE.caution} ${
          reviewing
            ? "shadow-card ring-1 ring-warning/40"
            : interactive
              ? "cursor-pointer hover:-translate-y-px hover:border-warning/60 hover:bg-warning/10 hover:shadow-card"
              : ""
        }`}
      >
        <div className="flex items-start gap-3 p-4">
          <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${TONE_DOT.caution}`} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-snug text-foreground">{item.title}</p>
            <ItemFacts item={item} />
            {reasons ? <p className="mt-2 text-sm text-muted-foreground">{reasons}.</p> : null}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <ArticleLink item={item} />
              {interactive && !reviewing ? (
                <TTButton
                  variant="secondary"
                  size="sm"
                  aria-expanded={false}
                  aria-controls={panelId}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen();
                  }}
                  className="ml-auto border-warning/40 group-hover:border-warning/70 group-hover:bg-card active:scale-[0.98]"
                >
                  Review &amp; approve
                </TTButton>
              ) : null}
              {interactive && reviewing ? (
                <span className="ml-auto text-xs text-muted-foreground">Reviewing</span>
              ) : null}
            </div>
          </div>
        </div>
        {interactive && reviewing && override ? (
          <ReviewPanel id={panelId} item={item} override={override} onCancel={onClose} />
        ) : null}
      </div>
    </li>
  );
}

/** A ready item keeps the familiar tick box. The title is its label. */
function ReadyItem({
  item,
  checked,
  onToggle,
}: {
  item: ApprovalItem;
  checked: boolean;
  onToggle: () => void;
}) {
  const checkId = useId();
  return (
    <li>
      <div
        data-item-state={item.state}
        data-selected={checked || undefined}
        className={`rounded-xl border transition-all duration-200 ${
          checked
            ? "border-royal/50 bg-royal/6 shadow-card"
            : "border-border bg-card hover:border-royal/40 hover:shadow-card"
        }`}
      >
        <div className="flex items-start gap-3 p-4">
          <input
            id={checkId}
            type="checkbox"
            className="mt-1 size-4 cursor-pointer accent-royal"
            checked={checked}
            onChange={onToggle}
            aria-label={`Approve ${item.title}`}
          />
          <div className="min-w-0 flex-1">
            <label
              htmlFor={checkId}
              className="block cursor-pointer text-sm font-semibold leading-snug text-foreground"
            >
              {item.title}
            </label>
            <ItemFacts item={item} />
            <div className="mt-3">
              <ArticleLink item={item} />
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

/** An item that has already been decided. It says so, and by whom if a person took it. */
function SettledItem({ item }: { item: ApprovalItem }) {
  const tone = ITEM_STATE_TONE[item.state];
  const override = item.facts["override"] as
    | { reason?: unknown; by?: { label?: unknown } }
    | undefined;
  const acceptedBy = override && typeof override.by?.label === "string" ? override.by.label : null;
  const acceptedWhy = override && typeof override.reason === "string" ? override.reason : null;

  return (
    <li>
      <div
        data-item-state={item.state}
        className={`rounded-xl border transition-colors ${TONE_SURFACE[tone]}`}
      >
        <div className="flex items-start gap-3 p-4">
          {tone === "good" ? (
            <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
          ) : (
            <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${TONE_DOT[tone]}`} />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-snug text-foreground">{item.title}</p>
            <ItemFacts item={item} />
            {acceptedBy ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Accepted by {acceptedBy}
                {acceptedWhy ? `: ${acceptedWhy}` : ""}
              </p>
            ) : null}
            <div className="mt-3">
              <ArticleLink item={item} />
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

/* ------------------------------------------------------- comms draft */

function CommsDraft({ request }: RendererProps) {
  const payload = request.payload;
  const uncertainties = list(payload, "uncertainties");
  const subject = str(payload, "subject");

  return (
    <div className="space-y-7">
      <Block label={`${str(payload, "channel") || "email"} to ${str(payload, "personName")}`}>
        <article className="tt-level-secondary rounded-xl p-5">
          {subject ? (
            <p className="mb-3 border-b border-border pb-3 text-sm font-semibold text-foreground">
              {subject}
            </p>
          ) : null}
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {str(payload, "body")}
          </p>
        </article>
      </Block>

      <Block label="Why it was written this way">
        <p className="max-w-reading text-sm text-muted-foreground">{str(payload, "reasoning")}</p>
      </Block>

      <Reasons label="What the agent could not settle" items={uncertainties} />
    </div>
  );
}

/* ------------------------------------------------ scout relationship */

function ScoutRelationship({ request }: RendererProps) {
  const payload = request.payload;
  const score = Number(payload["fitScore"] ?? 0);

  return (
    <div className="space-y-7">
      <Block label="Who this is">
        <p className="text-lg font-semibold text-foreground">
          {str(payload, "personName") || "Decision maker not identified yet"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {[str(payload, "roleTitle"), str(payload, "companyName")].filter(Boolean).join(" · ")}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <MetaPill>Fit {score}/100</MetaPill>
        </div>
      </Block>

      <Reasons label="Why they fit" items={list(payload, "fitReasons")} />
      <Reasons label="What is still unknown" items={list(payload, "gaps")} />
    </div>
  );
}

/* ---------------------------------------------------------- blog batch */

/**
 * A batch is a list of individual judgments. Ready items keep the familiar
 * tick box and go together; flagged items each open into their own compact
 * decision, one at a time, so ten flagged posts never look like ten forms.
 */
function BlogBatch({ items, selected, onToggle, override }: RendererProps) {
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">{batchReviewLine(items)}</p>;
  }

  const summary = summariseBatch(items);
  /* Derived, not stored: the moment an item stops being an exception (it was
     just accepted), its panel is gone and the card reads as approved. */
  const reviewing = items.some((item) => item.id === reviewingId && item.state === "exception")
    ? reviewingId
    : null;
  const canOverride = Boolean(override) && !override?.refusal;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-foreground" data-testid="batch-review-line">
          {batchReviewLine(items)}
        </p>
        {summary.exceptions > 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {canOverride
              ? "Flagged articles cannot be approved in bulk. Open one to see why it was flagged and approve it on the record."
              : (override?.refusal ??
                "Flagged articles cannot be approved in bulk. An owner or admin can accept each one on the record.")}
          </p>
        ) : null}
        {summary.ready > 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Tick the ready articles you want published, then approve them together below.
          </p>
        ) : null}
      </div>

      <ul className="space-y-2">
        {items.map((item) => {
          if (item.state === "exception") {
            return (
              <FlaggedItem
                key={item.id}
                item={item}
                override={override}
                reviewing={reviewing === item.id}
                onOpen={() => setReviewingId(item.id)}
                onClose={() => setReviewingId(null)}
              />
            );
          }
          if (item.state === "ready") {
            return (
              <ReadyItem
                key={item.id}
                item={item}
                checked={selected.has(item.id)}
                onToggle={() => onToggle(item.id)}
              />
            );
          }
          return <SettledItem key={item.id} item={item} />;
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------ roadmap change */

function RoadmapChange({ request }: RendererProps) {
  const payload = request.payload;
  return (
    <div className="space-y-7">
      <div className="grid gap-4 sm:grid-cols-2">
        <Block label="Today">
          <p className="tt-level-secondary rounded-xl p-4 text-sm text-muted-foreground">
            {str(payload, "before")}
          </p>
        </Block>
        <Block label="Proposed">
          <p className="tt-level-secondary rounded-xl p-4 text-sm text-foreground">
            {str(payload, "after")}
          </p>
        </Block>
      </div>
      <Block label="Reasoning">
        <p className="max-w-reading text-sm text-muted-foreground">{str(payload, "rationale")}</p>
      </Block>
      <Reasons label="What this touches" items={list(payload, "affects")} />
    </div>
  );
}

/* ----------------------------------------------------- delivery change */

function DeliveryChange({ request }: RendererProps) {
  const payload = request.payload;
  return (
    <div className="space-y-7">
      <Block label="The change">
        <p className="text-sm text-foreground">{str(payload, "change")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <MetaPill>{str(payload, "clientName") || "Internal"}</MetaPill>
          {str(payload, "scheduleImpact") ? (
            <MetaPill>Schedule: {str(payload, "scheduleImpact")}</MetaPill>
          ) : null}
          {str(payload, "costImpact") ? (
            <MetaPill>Cost: {str(payload, "costImpact")}</MetaPill>
          ) : null}
          <MetaPill>{payload["clientVisible"] ? "Client will see this" : "Internal only"}</MetaPill>
        </div>
      </Block>
      <Block label="Why">
        <p className="max-w-reading text-sm text-muted-foreground">{str(payload, "reason")}</p>
      </Block>
    </div>
  );
}

/* ------------------------------------------------------------ registry */

export type ApprovalRenderer = (props: RendererProps) => ReactNode;

const RENDERERS: Record<ApprovalType, ApprovalRenderer> = {
  comms_draft: CommsDraft,
  scout_relationship: ScoutRelationship,
  blog_batch: BlogBatch,
  roadmap_change: RoadmapChange,
  delivery_change: DeliveryChange,
};

/** An unregistered type still renders honestly rather than crashing the room. */
export function rendererFor(type: ApprovalType): ApprovalRenderer {
  return (
    RENDERERS[type] ??
    (({ request }: RendererProps) => (
      <p className="text-sm text-muted-foreground">
        Trust Tai does not have a reviewer for {request.approvalType} yet, so it will not pretend to
        show you one. Open the source record to decide there.
      </p>
    ))
  );
}

export function registeredRendererTypes(): ApprovalType[] {
  return Object.keys(RENDERERS) as ApprovalType[];
}
