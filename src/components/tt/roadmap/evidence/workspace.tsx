import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronRight,
  FileText,
  Link2,
  Mail,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { TTButton, TTInput } from "@/components/tt/primitives";
import type { Roadmap } from "@/domain/roadmap";
import {
  evidenceHolds,
  deliveryFailures,
  messagePlainText,
  observedSends,
  projectEvidence,
  savedDrafts,
  type EvidenceRecord,
  type ReviewManifest,
  type ReviewedBinding,
  type PublicationObservation,
  type PartialInteractionHistory,
  type PartialCoverage,
  roadmapSendVerified,
} from "@/domain/roadmap-evidence";
import { cn } from "@/lib/utils";

import type {
  CanonicalEvidence,
  CanonicalEvidenceReader,
} from "@/domain/roadmap-canonical-evidence";

export interface EvidenceWorkspaceProps {
  conversationSummary?: import("@/domain/roadmap-correspondence-summary").ConversationSummary;
  conversationSummaryFailed?: boolean;
  readConversations?: import("@/domain/roadmap-correspondence").CorrespondenceReader;
  readCanonical?: CanonicalEvidenceReader;
  roadmaps: Roadmap[];
  organizationId: string;
  loading?: boolean;
  readError?: boolean;
  review?: ReviewManifest | undefined;
  bindings?: ReviewedBinding[];
  history?: PartialInteractionHistory;
  coverage?: PartialCoverage;
  publication?: PublicationObservation;
  onRetry?: () => void;
}
const date = (value: string) =>
  new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }) + " UTC";
const safeUrl = (url: string) => {
  try {
    return new URL(url).protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
};
function SourceLink({ url, children }: { url: string; children: React.ReactNode }) {
  const href = safeUrl(url);
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-10 items-center gap-1.5 text-royal underline underline-offset-4 break-all"
    >
      {children}
      <ArrowUpRight size={13} aria-hidden="true" />
    </a>
  ) : (
    <span>Source link unavailable</span>
  );
}
function Badge({
  children,
  tone = "quiet",
}: {
  children: React.ReactNode;
  tone?: "quiet" | "blue" | "hold";
}) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium",
        tone === "blue"
          ? "border-royal/20 bg-royal/5 text-royal"
          : tone === "hold"
            ? "border-warning/25 bg-warning/5 text-foreground"
            : "border-border bg-background text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
function States({ record }: { record: EvidenceRecord }) {
  const row = record.review;
  return (
    <div className="flex flex-wrap gap-1.5">
      <Badge tone={row?.prepared_message ? "blue" : "quiet"}>
        {savedDrafts(record).length
          ? "Mailbox draft saved"
          : observedSends(record)
            ? "Sent copy recorded"
            : row?.prepared_message
              ? "Copy prepared"
              : "Copy unknown"}
      </Badge>
      <Badge>
        {observedSends(record)
          ? "No new send authorized"
          : row?.prepared_message
            ? "Send approval held"
            : "Send approval unknown"}
      </Badge>
      {deliveryFailures(record).length ? (
        <Badge tone="hold">Bounced · permanent failure</Badge>
      ) : observedSends(record) ? (
        <Badge>Delivery unconfirmed</Badge>
      ) : null}
      <Badge tone={row?.roadmap_status.published || record.publication ? "blue" : "quiet"}>
        {row?.roadmap_status.published || record.publication
          ? "Published proposal"
          : "Publication unknown"}
      </Badge>
      {roadmapSendVerified(record) ? <Badge tone="blue">Roadmap send verified</Badge> : null}
      <Badge tone={observedSends(record) ? "blue" : "quiet"}>
        {observedSends(record)
          ? `${observedSends(record)} verified sent message${observedSends(record) === 1 ? "" : "s"}`
          : "Send history incomplete"}
      </Badge>
    </div>
  );
}

export function RoadmapEvidenceWorkspace({
  roadmaps,
  organizationId,
  review,
  bindings,
  history,
  coverage,
  loading,
  readError,
  publication,
  onRetry,
  readCanonical,
}: EvidenceWorkspaceProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const opener = useRef<HTMLButtonElement | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const records = useMemo(
    () =>
      projectEvidence(
        readError || loading ? [] : roadmaps,
        organizationId,
        review,
        bindings,
        publication,
        history,
        coverage,
      ),
    [
      roadmaps,
      organizationId,
      review,
      bindings,
      readError,
      loading,
      publication,
      history,
      coverage,
    ],
  );
  const visible = records.filter(
    (r) =>
      `${r.name} ${r.review?.recipient.name ?? ""} ${r.review?.recipient.email ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "all" ||
        (filter === "canonical" && !!r.native) ||
        (filter === "review" && r.binding === "pending") ||
        (filter === "sent" && observedSends(r) > 0) ||
        (filter === "bounced" && deliveryFailures(r).length > 0) ||
        (filter === "drafts" && savedDrafts(r).length > 0) ||
        (filter === "prepared" && !!r.review?.prepared_message)),
  );
  const active = records.find((r) => r.key === selected);
  const nativeCount = records.filter((r) => r.native).length;
  return (
    <section aria-label="Roadmap evidence inventory" className="min-w-0 space-y-6">
      <header className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_260px]">
          <div>
            <p className="tt-eyebrow text-royal">Trust Tai · Roadmaps</p>
            <h1 className="mt-4 max-w-xl font-display text-3xl leading-tight sm:text-4xl">
              Every roadmap.
              <br />
              <span className="text-muted-foreground">A clear next move.</span>
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-muted-foreground">
              See what’s prepared, what’s published and what was actually sent. Open a roadmap to
              inspect the evidence behind it.
            </p>
          </div>
          <aside className="self-end rounded-xl border border-border bg-background p-4 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <ShieldCheck size={16} className="text-royal" aria-hidden="true" /> Evidence coverage
            </div>
            <p className="mt-2 leading-6 text-muted-foreground">
              Historical interactions are still being reconciled. Missing evidence stays unknown.
            </p>
            {review ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Selected batch checked {date(review.mailbox_coverage.checked_at)}
              </p>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                Historical message evidence has not been connected to this view.
              </p>
            )}
          </aside>
        </div>
        <dl className="grid grid-cols-2 border-t border-border lg:grid-cols-4">
          {[
            [
              publication ? String(publication.entries.length) : "Pending",
              "Published library",
              "Public proposals, not sends",
            ],
            [
              loading ? "Reading…" : readError ? "Unavailable" : String(nativeCount),
              "Saved in CMD",
              "Existing canonical records",
            ],
            [
              review ? String(review.rows.length) : "Pending",
              "Selected review batch",
              "Identity reconciliation required",
            ],
            ["Incomplete", "Historical send coverage", "No global total asserted"],
          ].map(([value, title, hint]) => (
            <div
              key={title}
              className="border-b border-r border-border px-5 py-5 last:border-r-0 lg:border-b-0"
            >
              <dd className="font-display text-2xl tracking-tight">{value}</dd>
              <dt className="mt-1 text-sm font-medium">{title}</dt>
              <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
            </div>
          ))}
        </dl>
      </header>
      {publication ? (
        <p className="text-xs text-muted-foreground">
          <SourceLink url={publication.sourceUrl}>Published library source</SourceLink> · Observed{" "}
          {new Date(publication.checkedAt).toLocaleDateString("en-US", { timeZone: "UTC" })}. These
          counts overlap; do not add them.
        </p>
      ) : null}
      {review ? (
        <div className="rounded-xl border border-warning/25 bg-warning/5 px-5 py-4 text-sm leading-6">
          <strong className="font-medium">Review evidence · no import applied.</strong>{" "}
          {review.rows.filter((r) => r.canonical_mapping_required).length} source identities await
          review. Prepared copy reflects the snapshot at{" "}
          {date(review.updated_at ?? review.created_at)}; later mailbox drafts may differ.
        </div>
      ) : null}
      {history ? (
        <p className="rounded-xl border border-border bg-card p-4 text-xs leading-6 text-muted-foreground">
          <strong className="font-medium text-foreground">Partial interaction history.</strong>{" "}
          {history.coverage} Each entry preserves its supplied content-safety notice and source
          link.
        </p>
      ) : null}
      {readError ? (
        <div role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm">
          Saved roadmaps could not be read. Source review does not establish their identities.{" "}
          {onRetry ? (
            <TTButton variant="quiet" onClick={onRetry}>
              Read saved roadmaps again
            </TTButton>
          ) : null}
        </div>
      ) : null}
      {loading ? <p role="status">Reading saved roadmaps…</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter evidence inventory">
          {[
            ["all", "All evidence"],
            ["canonical", "Saved in CMD"],
            ["review", "Identity review"],
            ["prepared", "Prepared copy"],
            ["drafts", "Current drafts"],
            ["bounced", "Bounced"],
            ["sent", "Sent messages"],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id!)}
              className={cn(
                "min-h-10 rounded-full border px-3 text-xs transition-colors",
                filter === id
                  ? "border-royal bg-royal text-white"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="relative block w-full sm:w-64">
          <Search
            className="absolute left-3 top-3 text-muted-foreground"
            size={16}
            aria-hidden="true"
          />
          <span className="sr-only">Search roadmap evidence</span>
          <TTInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Company, person or email"
            className="h-10 pl-9"
          />
        </label>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <p>{visible.length} visible records · identities may overlap</p>
        <p>Source facts stay separate</p>
      </div>
      <ul className="grid gap-3 xl:grid-cols-2">
        {visible.map((record) => (
          <li key={record.key} className="min-w-0">
            <button
              type="button"
              onClick={(event) => {
                opener.current = event.currentTarget;
                setSelected(record.key);
              }}
              aria-label={`Inspect ${record.name}`}
              className="group h-full w-full rounded-xl border border-border bg-card p-5 text-left shadow-sm transition hover:border-royal/40 focus-visible:outline-2 focus-visible:outline-royal"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="tt-eyebrow text-muted-foreground">
                    {record.binding === "pending"
                      ? "Source identity · review pending"
                      : "Canonical CMD record"}
                  </p>
                  <h2 className="mt-2 break-words font-display text-lg">{record.name}</h2>
                </div>
                <ChevronRight
                  size={18}
                  className="mt-5 shrink-0 text-muted-foreground group-hover:text-royal"
                  aria-hidden="true"
                />
              </div>
              <div className="mt-4">
                <States record={record} />
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 text-xs">
                <div>
                  <dt className="text-muted-foreground">Contact</dt>
                  <dd className="mt-1 break-words">
                    {record.review?.recipient.verification_status === "verified_named_direct"
                      ? `${record.review.recipient.name} · verified`
                      : record.review
                        ? "Direct recipient held"
                        : "Verification unknown"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Owner</dt>
                  <dd className="mt-1 break-words">{record.owner}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Next action</dt>
                  <dd className="mt-1 line-clamp-2 leading-5">{record.nextAction}</dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
                <span>Follow-up: {record.followUp ?? "Not scheduled"}</span>
                <span>
                  {evidenceHolds(record).length
                    ? `${evidenceHolds(record).length} review holds`
                    : "Evidence coverage pending"}
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>
      {!loading && !visible.length ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {query || filter !== "all"
            ? "No records match this search and filter."
            : "No saved records are available. Reconcile source identities before adding roadmaps."}
        </p>
      ) : null}
      <Dialog
        open={Boolean(active)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent
          className="flex max-h-[94dvh] w-[calc(100%-1rem)] max-w-4xl flex-col gap-0 overflow-hidden rounded-2xl p-0"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
        >
          {active ? (
            <EvidenceDetail
              key={active.key}
              record={active}
              review={review}
              organizationId={organizationId}
              readCanonical={readCanonical}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function EvidenceDetail({
  record,
  review,
  organizationId,
  readCanonical,
}: {
  record: EvidenceRecord;
  organizationId: string;
  readCanonical?: CanonicalEvidenceReader | undefined;
  review?: ReviewManifest | undefined;
}) {
  const [tab, setTab] = useState<"interactions" | "prepared" | "provenance">("interactions");
  const row = record.review;
  const prepared = row?.prepared_message;
  return (
    <>
      <div className="shrink-0 border-b border-border px-5 py-6 sm:px-8">
        <p className="tt-eyebrow text-royal">Roadmap dossier</p>
        <DialogTitle className="mt-3 pr-8 font-display text-2xl sm:text-3xl">
          {record.name}
        </DialogTitle>
        <DialogDescription className="mt-2">
          {record.binding === "pending"
            ? "Source evidence · canonical identity remains unbound"
            : "Saved roadmap · evidence coverage remains incomplete"}
        </DialogDescription>
        <div className="mt-4">
          <States record={record} />
        </div>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-8 sm:px-8">
        {record.native && readCanonical ? (
          <CanonicalRead
            key={record.native.id}
            organizationId={organizationId}
            roadmapId={record.native.id}
            read={readCanonical}
          />
        ) : null}
        {deliveryFailures(record).map((failure) => (
          <section
            key={failure.provider_message_id}
            role="alert"
            className="my-4 rounded-xl border border-warning/40 p-4 text-sm"
          >
            <h3 className="font-medium">Delivery failed · {failure.smtp_status}</h3>
            <p>{failure.reason}</p>
            <p>{date(failure.occurred_at)} · Email delivery notification</p>
            <p>
              Sent is verified; delivery failed. Do not resend without a corrected contact and
              separate approval.
            </p>
            <p className="break-all text-xs">Provider message: {failure.provider_message_id}</p>
            <SourceLink url={failure.source_url}>Open delivery failure source</SourceLink>
          </section>
        ))}
        <dl className="grid gap-4 border-b border-border py-5 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Owner</dt>
            <dd className="mt-1">{record.owner}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Contact verification</dt>
            <dd className="mt-1 break-all">
              {row?.recipient.name ?? "Unknown"}
              <br />
              {row?.recipient.email ?? "No verified direct address"}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Follow-up</dt>
            <dd className="mt-1">{record.followUp ?? "Not scheduled"}</dd>
          </div>
          <div className="sm:col-span-3">
            <dt className="text-xs text-muted-foreground">Next action</dt>
            <dd className="mt-1 leading-6">{record.nextAction}</dd>
          </div>
        </dl>
        {evidenceHolds(record).length ? (
          <div className="my-5 rounded-xl border border-warning/25 bg-warning/5 p-4 text-sm">
            <h3 className="font-medium">Before the next move</h3>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {evidenceHolds(record).map((hold) => (
                <li key={hold}>{hold}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div
          className="flex flex-wrap gap-2 border-b border-border py-3"
          role="group"
          aria-label="Dossier sections"
        >
          {(
            [
              ["interactions", "Interactions", Mail],
              ["prepared", "Prepared copy", FileText],
              ["provenance", "Sources & holds", Link2],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-pressed={tab === id}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-lg px-3 text-xs",
                tab === id ? "bg-royal/10 text-royal" : "text-muted-foreground",
              )}
            >
              <Icon size={15} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
        <div className="pt-5" aria-live="polite">
          {tab === "interactions" ? (
            <div className="space-y-5">
              <p className="text-xs text-muted-foreground">
                Sent-message counts describe this partial conversation. They do not establish how
                many roadmaps were delivered.
              </p>
              <div>
                <h3 className="font-display text-xl">The conversation, with receipts.</h3>
                <p className="mt-3 text-xs font-medium">Reviewed scope &amp; remaining unknowns</p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {record.coverage?.coverage_note ??
                    row?.outreach_status.coverage_caveat ??
                    "Messages have not been linked to this canonical roadmap. This is not evidence that no conversations occurred."}
                </p>
              </div>
              {!record.messages.length ? (
                <div className="rounded-xl border border-dashed border-border p-6 text-sm">
                  <p className="font-medium">No verified messages in this view yet.</p>
                  <p className="mt-2 text-muted-foreground">
                    Historical coverage is pending. Prepared copy lives in its own section.
                  </p>
                </div>
              ) : null}
              {record.messages.map((item, i) => (
                <article
                  key={`${item.message.provider_message_id}:${i}`}
                  className="overflow-hidden rounded-xl border border-border"
                >
                  <header className="space-y-2 bg-secondary/50 p-4 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 font-medium">
                        {item.message.type !== "email_received" ? (
                          <ArrowUpRight size={15} />
                        ) : (
                          <ArrowDownLeft size={15} />
                        )}
                        {item.message.type === "email_sent"
                          ? "Sent"
                          : item.message.type === "email_team_outbound_copy"
                            ? "Team outbound copy · account SENT unverified"
                            : "Received"}{" "}
                        · Email {item.conflict ? "· conflicting evidence" : "· verified source"}
                      </span>
                      <time dateTime={item.message.sent_at}>{date(item.message.sent_at)}</time>
                    </div>
                    <p className="break-all">
                      From {item.message.from_header ?? item.message.from} →{" "}
                      {item.message.to_header ?? item.message.to.join(", ")}
                    </p>
                    {item.message.cc_header ? (
                      <p className="break-all">Cc {item.message.cc_header}</p>
                    ) : null}
                    <h4 className="text-base font-medium">{item.message.subject}</h4>
                  </header>
                  <div className="p-4 sm:p-5">
                    {item.message.content_safety ? (
                      <p className="mb-3 text-xs text-muted-foreground">
                        {item.message.content_safety}
                      </p>
                    ) : null}
                    {item.message.body_format === "text/html" ? (
                      <p className="mb-3 text-xs text-muted-foreground">
                        Readable text from original HTML. Images, tracking and active content are
                        disabled; exact source is retained below.
                      </p>
                    ) : null}
                    <pre className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-sans text-sm leading-7">
                      {messagePlainText(item.message.body_exact, item.message.body_format)}
                    </pre>
                    {item.message.body_format === "text/html" ? (
                      <details className="mt-4 border-t border-border pt-3">
                        <summary className="min-h-10 cursor-pointer text-xs text-royal">
                          Inspect exact original source
                        </summary>
                        <pre className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-xs leading-6">
                          {item.message.body_exact}
                        </pre>
                      </details>
                    ) : null}
                    {item.alternateText?.map((alt, index) => (
                      <details key={index} className="mt-4 border-t border-border pt-3">
                        <summary className="min-h-10 cursor-pointer text-xs text-royal">
                          Inspect sanitized historical representation
                        </summary>
                        <p className="text-xs text-muted-foreground">{alt.note}</p>
                        <pre className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-xs leading-6">
                          {alt.text}
                        </pre>
                      </details>
                    ))}
                  </div>
                  <footer className="space-y-1 border-t border-border p-4 text-xs text-muted-foreground">
                    <p className="break-all">Mailbox provenance: {item.mailboxes.join(", ")}</p>
                    <p className="break-all">
                      Provider message: {item.message.provider_message_id}
                    </p>
                    <p>
                      {item.message.verification ??
                        `Source verified at ${item.message.verified_at}`}
                    </p>
                    <p>
                      {deliveryFailures(record).some(
                        (f) => f.provider_thread_id === item.message.provider_thread_id,
                      )
                        ? "Delivery failed · see verified notification above"
                        : "Delivery confirmation: unknown"}
                    </p>
                    <div className="flex flex-wrap gap-3">
                      {item.sources.map((url, index) => (
                        <SourceLink key={url} url={url}>
                          Open source {index + 1}
                        </SourceLink>
                      ))}
                    </div>
                  </footer>
                </article>
              ))}
            </div>
          ) : null}
          {tab === "prepared" ? (
            <div className="space-y-4">
              <h3 className="font-display text-xl">Prepared copy & mailbox drafts</h3>
              {prepared ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    {observedSends(record) && !savedDrafts(record).length
                      ? "Earlier prepared copy is retained below for provenance. This is not a current unsent draft; inspect the verified sent body in Interactions."
                      : savedDrafts(record).length
                        ? "Mailbox draft verified in this snapshot. It remains unsent and needs user review."
                        : "No mailbox draft existed at this snapshot. Later draft IDs have not been reconciled here."}{" "}
                    This text is not a send receipt.
                  </p>
                  {savedDrafts(record).map((draft) => (
                    <div
                      key={draft.provider_draft_id}
                      className="rounded-xl border border-royal/20 bg-royal/5 p-4 text-xs leading-6"
                    >
                      <p className="font-medium">Gmail draft saved · DRAFT only</p>
                      <p>
                        Saved {date(draft.saved_message_timestamp)} · Verified{" "}
                        {date(draft.verified_at)}
                      </p>
                      <p className="break-all">
                        Draft: {draft.provider_draft_id}
                        <br />
                        Message: {draft.provider_message_id}
                        <br />
                        Thread: {draft.provider_thread_id}
                      </p>
                      <p>
                        {draft.to.length
                          ? "Addressed to the verified recipient."
                          : "To is empty · recipient verification remains held."}
                      </p>
                      <h4 className="mt-3 font-medium">{draft.subject}</h4>
                      <pre className="my-3 whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-sans text-sm">
                        {draft.body_plain_text_content_only}
                      </pre>
                      <SourceLink url={draft.source_url}>Open mailbox drafts</SourceLink>
                      <p className="text-muted-foreground">
                        Source opens Gmail; match the exact draft ID and subject above. This is not
                        a send receipt.
                      </p>
                    </div>
                  ))}
                  <div className="rounded-xl border border-border p-5">
                    <p className="mb-3 text-xs font-medium">
                      Prepared-copy archive · current mailbox receipts are shown separately above or
                      in Interactions
                    </p>
                    <p className="text-xs text-muted-foreground break-all">
                      From {prepared.from}
                      <br />
                      To {prepared.to.join(", ") || "Recipient held"}
                    </p>
                    <h4 className="mt-3 text-base font-medium">{prepared.subject}</h4>
                    <pre className="mt-5 whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-sans text-sm leading-7">
                      {prepared.body_markdown_exact}
                    </pre>
                    <pre className="mt-5 whitespace-pre-wrap font-sans text-xs leading-6 text-muted-foreground">
                      {prepared.signature_text_exact}
                    </pre>
                    {prepared.body_scope ? (
                      <p className="mt-4 text-xs text-muted-foreground">
                        {prepared.body_scope} Automatic signature remains in Gmail; remote headshot
                        is not loaded here.
                      </p>
                    ) : null}
                    {prepared.footer ? (
                      <p className="mt-4 whitespace-pre-wrap text-xs">{prepared.footer}</p>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {observedSends(record)
                      ? "Send receipt recorded. No new send authorization."
                      : `Approval: held in this snapshot. ${prepared.footer_status}.`}
                  </p>
                </>
              ) : (
                <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                  {observedSends(record)
                    ? "This source contains a previous send, not a new prepared message. Do not duplicate it."
                    : "Prepared copy has not been supplied for this saved record."}
                </p>
              )}
            </div>
          ) : null}
          {tab === "provenance" ? (
            <div className="space-y-5 text-sm">
              <h3 className="font-display text-xl">Know where each fact came from.</h3>
              {record.native ? (
                <div>
                  <p>
                    Canonical ID:{" "}
                    <span className="break-all font-mono text-xs">{record.native.id}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Lifecycle: {record.native.status}. This does not establish send approval or a
                    sale.
                  </p>
                  <a
                    className="inline-flex min-h-11 items-center text-royal underline"
                    href={`/modules/roadmap/${record.native.id}?view=evidence`}
                  >
                    Open saved roadmap and evidence
                  </a>
                </div>
              ) : (
                <p>Canonical binding pending. No native roadmap was created from this source.</p>
              )}
              {!row && record.publication ? (
                <SourceLink url={record.publication.url}>
                  Open observed published proposal
                </SourceLink>
              ) : null}
              {row ? (
                <>
                  <SourceLink url={row.public_roadmap_url}>
                    Open published proposed roadmap
                  </SourceLink>
                  <p className="text-xs text-muted-foreground">{row.roadmap_status.verification}</p>
                  <h4 className="font-medium">Recipient evidence</h4>
                  <p>{row.recipient.disposition}</p>
                  <ul className="space-y-1 text-xs">
                    {row.recipient.source_refs.map((url) => (
                      <li key={url}>
                        <SourceLink url={url}>{url}</SourceLink>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground">
                    Checked {date(row.evidence_checked_at)}
                  </p>
                </>
              ) : null}
              {review && row ? (
                <>
                  <h4 className="font-medium">Snapshot scope</h4>
                  <p className="text-xs leading-6 text-muted-foreground">{review.scope}</p>
                  <ul className="list-disc space-y-2 pl-4 text-xs text-muted-foreground">
                    {review.global_holds.map((hold) => (
                      <li key={hold}>{hold}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              <p className="rounded-xl bg-secondary p-4 text-xs leading-6">
                Sales, acceptance and payment require their own evidence. Interest, a published
                proposal and a sent email do not establish any of them.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

export function CanonicalRead({
  organizationId,
  roadmapId,
  read,
}: {
  organizationId: string;
  roadmapId: string;
  read: CanonicalEvidenceReader;
}) {
  const [result, setResult] = useState<CanonicalEvidence | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setResult(null);
    setFailed(false);
    read(organizationId, roadmapId).then(
      (value) => {
        if (active) setResult(value);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [organizationId, roadmapId, read, attempt]);
  return (
    <section
      aria-label="Current canonical read"
      className="my-4 rounded-xl border border-border p-4 text-sm"
    >
      {failed ? (
        <div role="alert">
          Current canonical read unavailable. Coverage remains unknown.{" "}
          <button className="underline" onClick={() => setAttempt((n) => n + 1)}>
            Retry canonical read
          </button>
        </div>
      ) : result ? (
        <>
          <p>Current canonical status: {result.canonical.status}</p>
          <p>Saved revision: {date(result.canonical.updated_at)}</p>
          <p className="mt-2 text-muted-foreground">
            Mailbox coverage unknown. This status read contains no message bodies; reviewed imports
            are shown separately in the conversation.
          </p>
        </>
      ) : (
        <p role="status">Reading current canonical status…</p>
      )}
    </section>
  );
}
