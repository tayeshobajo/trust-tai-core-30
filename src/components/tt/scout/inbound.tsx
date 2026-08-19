/**
 * Website-origin visual language.
 *
 * A company that came to us is a different kind of object from one we went
 * looking for, and Tai should feel that within a second. The treatment is a
 * royal keyline, a monospace INBOUND mark, and an Ambient Identity Wash — one
 * atmospheric region per surface, never a coloured card.
 */

import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Quote } from "lucide-react";

import { MetaPill, SectionHeading } from "@/components/tt/primitives";
import { filledLanes } from "@/data/scout/inbound";
import {
  STATED_LANE_LABEL,
  STATED_LANE_ORDER,
  answerAnchorId,
  type FounderSignalPacket,
} from "@/domain/stated";

import { cn } from "@/lib/utils";

/** The unmistakable-but-quiet mark. Use beside a company name. */
export function InboundBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-royal/30 bg-royal/8 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-royal",
        className,
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-royal" />
      Inbound · TrustTai.com
    </span>
  );
}


/** The Ambient Identity Wash for an inbound surface. Light entering the page. */
export function InboundWash({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-royal/20 bg-card">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[180px]"
        style={{
          background:
            "linear-gradient(180deg, color-mix(in oklab, var(--royal, #1d54c1) 6%, transparent) 0%, transparent 100%)",
        }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}

function percent(value?: number | null): string {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
}

/**
 * The origin rail: where this company came from, and how complete their own
 * account was. Facts only — no judgment, that belongs to Tai.
 */
export function InboundOriginRail({
  packet,
  channel,
}: {
  packet: FounderSignalPacket;
  channel: string;
}) {
  const submitted = packet.statedAt ? new Date(packet.statedAt) : null;
  return (
    <InboundWash>
      <div className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <InboundBadge />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            TrustTai.com · Build My Roadmap
          </span>
        </div>

        <p className="mt-3 max-w-reading text-[15px] text-foreground">
          This company came to us. They completed the roadmap conversation on the website
          {submitted && !Number.isNaN(submitted.getTime())
            ? ` on ${submitted.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}`
            : ""}
          .
        </p>

        <dl className="mt-4 grid gap-3 sm:grid-cols-4">
          {[
            { label: "Channel", value: channel },
            { label: "Landed on", value: packet.attribution.landingPath || "—" },
            { label: "Coverage", value: percent(packet.understanding.objectiveCoverage) },
            {
              label: "Research consent",
              value:
                packet.understanding.authorizesResearch === true
                  ? "Given"
                  : packet.understanding.authorizesResearch === false
                    ? "Withheld"
                    : "Not asked",
            },
          ].map((item) => (
            <div key={item.label}>
              <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {item.label}
              </dt>
              <dd className="mt-1 truncate text-[13px] text-foreground">{item.value}</dd>
            </div>
          ))}
        </dl>

        {packet.submissionRowId ? (
          <Link
            to="/modules/website/submissions/$submissionId"
            params={{ submissionId: packet.submissionRowId }}
            className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-royal hover:underline"
          >
            Read the full conversation
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        ) : null}
      </div>
    </InboundWash>
  );
}

/** What they said, lane by lane, exactly as they said it. */
export function StatedPanel({ packet }: { packet: FounderSignalPacket }) {
  const lanes = filledLanes(packet, STATED_LANE_ORDER);
  if (lanes.length === 0) return null;

  return (
    <div className="tt-surface p-5">
      <SectionHeading
        eyebrow="Stated"
        title="What they told us"
        description="Their own words, unedited. Stated truth is testimony, not evidence: it never changes the fit score."
      />
      <div className="space-y-4">
        {lanes.map(({ lane, statements }) => (
          <div key={lane}>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {STATED_LANE_LABEL[lane]}
            </p>
            <ul className="mt-2 space-y-1.5">
              {statements.map((statement, index) => (
                <li
                  key={`${lane}-${index}`}
                  className="border-l-2 border-royal/25 pl-3 text-[14px] text-foreground"
                >
                  {statement}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The conversation itself, so any claim can be traced to a sentence. */
export function StatedTranscript({ packet }: { packet: FounderSignalPacket }) {
  const answered = packet.transcript.filter((turn) => !turn.skipped && turn.answerText.trim());
  if (answered.length === 0) return null;

  return (
    <div className="tt-surface p-5">
      <SectionHeading
        eyebrow="Conversation"
        title="The intake, in full"
        description="Every question we asked and every answer they gave."
      />
      <ol className="space-y-4">
        {answered.map((turn, index) => (
          <li key={index} className="rounded-xl border border-border bg-card px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <MetaPill>{turn.modality === "voice" ? "Spoken" : "Typed"}</MetaPill>
              <p className="text-[13px] text-muted-foreground">{turn.questionText}</p>
            </div>
            <p className="mt-2 flex gap-2 text-[14px] text-foreground">
              <Quote className="mt-1 h-3.5 w-3.5 shrink-0 text-royal" aria-hidden />
              <span>{turn.answerText}</span>
            </p>
            {packet.submissionRowId ? (
              <Link
                to="/modules/website/submissions/$submissionId"
                params={{ submissionId: packet.submissionRowId }}
                hash={answerAnchorId(turn.questionId, index)}
                className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-royal hover:underline"
              >
                Open this answer on the website record
                <ArrowUpRight className="h-3 w-3" aria-hidden />
              </Link>
            ) : null}
          </li>
        ))}
      </ol>

    </div>
  );
}
