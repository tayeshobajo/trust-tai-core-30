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

import type { ReactNode } from "react";

import { MetaPill } from "@/components/tt/primitives";
import {
  EXCEPTION_LABEL,
  ITEM_STATE_LABEL,
  type ApprovalItem,
  type ApprovalRequest,
  type ApprovalType,
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

function BlogBatch({ request, items, selected, onToggle }: RendererProps) {
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">This batch has no posts in it.</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Tick what you want published. Exceptions cannot be approved in bulk: they are here
        because something needed you specifically.
      </p>
      <ul className="space-y-2">
        {items.map((item) => {
          const decidable = item.state === "ready";
          const checked = selected.has(item.id);
          return (
            <li
              key={item.id}
              className={`tt-level-secondary rounded-xl p-4 ${decidable ? "" : "opacity-90"}`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-[var(--tt-accent,currentColor)]"
                  checked={checked}
                  disabled={!decidable}
                  onChange={() => onToggle(item.id)}
                  aria-label={`Approve ${item.title}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{item.title}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <MetaPill>{ITEM_STATE_LABEL[item.state]}</MetaPill>
                    {item.facts["hitScore"] != null ? (
                      <MetaPill>HIT {String(item.facts["hitScore"])}</MetaPill>
                    ) : null}
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
                  {item.exceptionReasons.length > 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {item.exceptionReasons.map((reason) => EXCEPTION_LABEL[reason]).join(". ")}.
                    </p>
                  ) : null}
                </div>
              </div>
            </li>
          );
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
          <MetaPill>
            {payload["clientVisible"] ? "Client will see this" : "Internal only"}
          </MetaPill>
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
