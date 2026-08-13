/**
 * Provenance details for one person.
 *
 * Where this record came from, how sure Scout is, and when each part of it was
 * last touched. It asserts nothing on its own — every line is read straight
 * off the stored record, and anything unknown says so.
 */

import {
  CONFIDENCE_LABEL,
  EMAIL_STATUS_LABEL,
  SENIORITY_LABEL,
  type Person,
} from "@/domain/people";

function when(iso?: string): string {
  if (!iso) return "Not recorded";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Line({
  label,
  value,
  url,
}: {
  label: string;
  value: string;
  url?: string | undefined;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-border/70 py-2 last:border-b-0">
      <span className="tt-eyebrow">{label}</span>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-[13px] text-foreground underline decoration-border underline-offset-4 hover:text-royal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {value}
        </a>
      ) : (
        <span className="text-[13px] text-muted-foreground">{value}</span>
      )}
    </div>
  );
}

export function PersonProvenance({ person }: { person: Person }) {
  const actor = person.provenance.actor;

  return (
    <details className="group mt-2">
      <summary className="tt-eyebrow cursor-pointer list-none underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Provenance
        <span className="ml-2 text-muted-foreground group-open:hidden">show</span>
        <span className="ml-2 hidden text-muted-foreground group-open:inline">hide</span>
      </summary>

      <div className="mt-2 rounded-lg border border-border bg-background px-4 py-1">
        <Line
          label="Source"
          value={person.sourceId === "manual" ? "Entered by hand" : person.sourceId.replace(/-/g, " ")}
          {...(person.sourceUrl ? { url: person.sourceUrl } : {})}
        />
        <Line label="Confidence" value={CONFIDENCE_LABEL[person.confidence]} />
        <Line label="Role read as" value={SENIORITY_LABEL[person.seniority]} />
        <Line
          label="Email state"
          value={
            person.email
              ? `${EMAIL_STATUS_LABEL[person.emailStatus]} · ${person.emailCheckedAt ? `checked ${when(person.emailCheckedAt)}` : "never checked"}${person.emailCheckedBy ? ` by ${person.emailCheckedBy}` : ""}`
              : "No address on record"
          }
        />
        <Line
          label="First observed"
          value={`${when(person.provenance.observedAt)} · ${actor.label ?? (actor.type === "user" ? "Trust Tai member" : actor.type)}`}
        />
        <Line label="Last updated" value={when(person.updatedAt)} />
        {person.note ? <Line label="Note" value={person.note} /> : null}
      </div>
    </details>
  );
}
