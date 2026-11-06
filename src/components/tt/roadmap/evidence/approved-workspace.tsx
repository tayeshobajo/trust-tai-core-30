import { CanonicalConversation } from "./canonical-conversation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Plus,
  Filter,
  LayoutGrid,
  List,
  LockKeyhole,
  Mail,
  Map,
  Search,
  Send,
  Sparkles,
  UserRound,
} from "lucide-react";
import {
  canonicalOutreachHolds,
  deliveryFailures,
  evidenceHolds,
  messagePlainText,
  projectEvidence,
  roadmapSendVerified,
  savedDrafts,
  type EvidenceRecord,
  type ObservedMessage,
  type LinkedInEvidence,
} from "@/domain/roadmap-evidence";
import { CanonicalRead, type EvidenceWorkspaceProps } from "./workspace";
import "./approved-workspace.css";
import { followUpState, type StandingReview } from "@/domain/roadmap-followup";
import { verifiedRoadmapCovers } from "@/data/roadmap-verified-covers";
import {
  attachLinkedIn,
  conversationEvents,
  linkedInApproximate,
  type LinkedInEvent,
} from "@/domain/roadmap-conversation";

const date = (value: string) =>
  new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }) + " UTC";
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
const slug = (record: EvidenceRecord) =>
  record.publication?.slug ?? record.review?.roadmap_slug ?? record.key;
function latestActivity(record: EvidenceRecord) {
  const imported = record.importedActivity?.latest;
  if (imported)
    return `${imported.channel === "email" ? "Email" : imported.channel === "linkedin_sales_navigator" ? "Sales Navigator" : "LinkedIn"} · ${date(imported.at)} · imported evidence`;
  const latest = conversationEvents(record)[0];
  if (!latest) return "Unknown · evidence incomplete";
  const approximate = latest.channel === "linkedin" && linkedInApproximate(latest.linkedin);
  return `${latest.channel === "email" ? "Email" : "LinkedIn"} · ${approximate ? "approximately " : ""}${date(latest.at)}`;
}
function RoadmapCover({ record, large = false }: { record: EvidenceRecord; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const cover = verifiedRoadmapCovers[slug(record)];
  const url = record.publication?.url ?? record.review?.public_roadmap_url;
  const verified = cover && cover.sourceUrl === url;
  return (
    <div className={large ? "rm-roadmap-art rm-cover" : "rm-company-art rm-cover"}>
      {verified && !failed ? (
        <img
          src={cover.src}
          alt={cover.alt}
          onError={() => setFailed(true)}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : (
        <>
          <FileText size={large ? 32 : 22} />
          <span>Roadmap preview unavailable</span>
        </>
      )}
    </div>
  );
}
function sourceUrl(url: string | undefined) {
  try {
    return url && new URL(url).protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}
function Source({
  url,
  children,
  className = "",
}: {
  url?: string | undefined;
  children: React.ReactNode;
  className?: string;
}) {
  const href = sourceUrl(url);
  return href ? (
    <a className={`rm-source ${className}`} href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <ArrowUpRight size={15} />
    </a>
  ) : (
    <span className="rm-muted">Source unavailable</span>
  );
}
function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
  return (
    <span className={`rm-pill rm-${tone}`}>
      <span />
      {children}
    </span>
  );
}
function communication(record: EvidenceRecord) {
  const holds = canonicalOutreachHolds(record);
  if (holds.some((h) => h.kind === "declined"))
    return {
      label: "Declined · suppressed",
      tone: "neutral",
      note: "History only; no further outreach",
    };
  if (holds.some((h) => h.kind === "permanent_email_bounce"))
    return { label: "Bounced", tone: "red", note: "Canonical delivery-failure hold" };
  const imported = record.importedActivity;
  if (imported) {
    const source =
      imported.latest.channel === "email"
        ? "Email"
        : imported.latest.channel === "linkedin_sales_navigator"
          ? "Sales Navigator"
          : "LinkedIn";
    return {
      label:
        imported.latest.kind === "bounce"
          ? "Bounced"
          : imported.latest.kind === "received"
            ? `${source} reply`
            : imported.latest.kind === "sent"
              ? `${source} sent`
              : imported.latest.kind === "draft" && !imported.hasSent
                ? "Draft · unsent"
                : "History on file",
      tone: imported.latest.kind === "bounce" ? "red" : "neutral",
      note:
        imported.latest.source === "stored_gmail"
          ? "Stored Comms email · broader history incomplete"
          : "Reviewed imported evidence · broader history incomplete",
    };
  }
  if (deliveryFailures(record).length)
    return { label: "Bounced", tone: "red", note: "Send verified; delivery failed" };
  if (record.linkedInEvents?.[0]?.status === "received_ui_verified")
    return {
      label: "LinkedIn reply",
      tone: "teal",
      note: "Received message verified in supplied evidence",
    };
  if (record.linkedIn)
    return {
      label: "LinkedIn sent",
      tone: "teal",
      note: "Sent history verified · email draft superseded",
    };
  if (record.coverage?.separate_user_evidenced_interaction)
    return {
      label: "Reply reported",
      tone: "teal",
      note: "User screenshot · provider SENT not verified",
    };
  if (savedDrafts(record).length)
    return { label: "Draft", tone: "amber", note: "Unsent · review holds" };
  if (roadmapSendVerified(record))
    return { label: "Email sent", tone: "neutral", note: "Source verified · delivery unconfirmed" };
  if (record.messages.length)
    return {
      label: "History on file",
      tone: "neutral",
      note: "Current roadmap delivery unverified",
    };
  if (record.review?.prepared_message)
    return { label: "Prepared", tone: "neutral", note: "No send established" };
  return { label: "Unknown", tone: "neutral", note: "Communication evidence unavailable" };
}
function nextStep(record: EvidenceRecord) {
  const holds = canonicalOutreachHolds(record);
  if (holds.some((h) => h.kind === "declined")) return "Retain history · do not contact";
  if (holds.some((h) => h.kind === "permanent_email_bounce"))
    return "Confirm corrected contact · outreach remains held";
  if (deliveryFailures(record).length) return "Confirm a new email address";
  if (record.publication?.identityHold) return "Resolve the identity hold";
  if (record.linkedInEvents?.[0]?.status === "received_ui_verified")
    return "Review the LinkedIn reply";
  if (record.linkedIn) return "Await LinkedIn reply · do not send email draft";
  if (record.review?.recipient.verification_status === "held_unverified_named_direct")
    return "Find the right contact";
  if (record.coverage?.separate_user_evidenced_interaction) return "Review the reported reply";
  if (
    record.nextAction &&
    record.nextAction !== "Review canonical identity and reconcile interaction evidence" &&
    record.nextAction !== "Next action unknown"
  )
    return record.nextAction;
  if (roadmapSendVerified(record)) return "Review the conversation";
  return record.nextAction === "Review canonical identity and reconcile interaction evidence"
    ? "Review identity & conversation"
    : record.nextAction || "Review the next step";
}
const getSelection = () =>
  typeof window === "undefined" ? null : new URL(window.location.href).searchParams.get("evidence");
export function ApprovedRoadmapWorkspace(
  props: EvidenceWorkspaceProps & {
    onCreateRoadmap?: () => void;
    onReviewImports?: () => void;
    linkedIn?: LinkedInEvidence;
    now?: Date;
    standingReviews?: Record<string, StandingReview>;
  },
) {
  const now = props.now ?? new Date();
  const status = (record: EvidenceRecord) =>
    followUpState(record, now, props.standingReviews?.[slug(record)]);
  const [selected, setSelected] = useState(getSelection);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [advanced, setAdvanced] = useState(false);
  const [grid, setGrid] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const records = useMemo(
    () =>
      projectEvidence(
        props.loading || props.readError ? [] : props.roadmaps,
        props.organizationId,
        props.review,
        props.bindings,
        props.publication,
        props.history,
        props.coverage,
      ).map((record) => {
        const result = attachLinkedIn(record, props.linkedIn);
        const summary =
          props.conversationSummary?.organizationId === props.organizationId
            ? props.conversationSummary.records.find((r) => r.roadmapId === record.native?.id)
            : undefined;
        return summary ? { ...result, importedActivity: summary } : result;
      }),
    [
      props.loading,
      props.readError,
      props.roadmaps,
      props.organizationId,
      props.review,
      props.bindings,
      props.publication,
      props.history,
      props.coverage,
      props.linkedIn,
      props.conversationSummary,
    ],
  );
  useEffect(() => {
    const onPop = () => setSelected(getSelection());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    if (selected) {
      heading.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }, [selected]);
  const navigate = (record: EvidenceRecord | null) => {
    const url = new URL(window.location.href);
    if (record) url.searchParams.set("evidence", slug(record));
    else url.searchParams.delete("evidence");
    window.history.pushState(null, "", url);
    setSelected(record ? slug(record) : null);
    if (!record) requestAnimationFrame(() => opener.current?.focus());
  };
  const active = records.find((record) => slug(record) === selected);
  const visible = records
    .filter((record) => {
      const follow = status(record);
      if (filter === "due" && !["overdue", "due_today"].includes(follow.state)) return false;
      if (filter === "upcoming" && follow.state !== "upcoming") return false;
      if (filter === "good" && follow.standing !== "good") return false;
      if (filter === "scheduling" && follow.state !== "needs_scheduling") return false;
      if (
        !`${record.name} ${record.review?.recipient.name ?? ""} ${record.review?.recipient.email ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase())
      )
        return false;
      if (filter === "draft") return savedDrafts(record).length > 0 && !record.linkedIn;
      if (filter === "linkedin")
        return Boolean(
          record.linkedInEvents?.length ||
          record.importedActivity?.latest.channel === "linkedin" ||
          record.importedActivity?.latest.channel === "linkedin_sales_navigator",
        );
      if (filter === "sent")
        return roadmapSendVerified(record) || Boolean(record.importedActivity?.hasSent);
      if (filter === "attention") return evidenceHolds(record).length > 0;
      if (filter === "bounce") return deliveryFailures(record).length > 0;
      if (filter === "bound") return Boolean(record.native);
      return true;
    })
    .sort(
      (a, b) =>
        status(a).rank - status(b).rank ||
        (status(a).date ?? "9999").localeCompare(status(b).date ?? "9999") ||
        a.name.localeCompare(b.name),
    );
  function open(record: EvidenceRecord, button: HTMLButtonElement) {
    opener.current = button;
    navigate(record);
  }
  return (
    <div className="rm-workspace">
      {props.conversationSummaryFailed && (
        <p role="alert">
          Conversation statuses could not be read. Coverage remains unknown; open a roadmap to retry
          its reviewed history.
        </p>
      )}
      <div className="rm-breadcrumb">
        <span>{active ? "Roadmaps" : "Workspace"}</span>
        <span>/</span>
        <span>{active?.name ?? "Roadmaps"}</span>
        <span className="rm-breadcrumb-note">
          {props.review ? "Private local evidence review" : "Your workspace"}
        </span>
      </div>
      {selected && !active ? (
        <section className="rm-empty">
          <h1 ref={heading} tabIndex={-1}>
            Roadmap unavailable
          </h1>
          <p>This identity is not present in the current authorized inventory.</p>
          <button className="rm-button" onClick={() => navigate(null)}>
            All roadmaps
          </button>
        </section>
      ) : active ? (
        <>
          <button className="rm-back" onClick={() => navigate(null)}>
            <ArrowLeft size={17} />
            All roadmaps
          </button>
          <div className="rm-detail-heading">
            <div>
              <h1 ref={heading} tabIndex={-1}>
                {active.name}
              </h1>
              <p>Every conversation. A clear next step.</p>
              <div className="rm-badges">
                <Pill tone="blue">
                  {active.publication || active.review?.roadmap_status.published
                    ? "Roadmap published"
                    : "Publication unknown"}
                </Pill>
                <Pill tone={communication(active).tone}>{communication(active).label}</Pill>
              </div>
            </div>
            <Source
              className="rm-button"
              url={active.publication?.url ?? active.review?.public_roadmap_url}
            >
              Open roadmap
            </Source>
          </div>
          <div className="rm-detail-layout">
            {active.native && props.readConversations && !props.review ? (
              <CanonicalConversation
                key={`${props.organizationId}:${active.native.id}`}
                organizationId={props.organizationId}
                roadmapId={active.native.id}
                read={props.readConversations}
              />
            ) : (
              <Conversation key={active.key} record={active} />
            )}
            <aside className="rm-context">
              <section className="rm-context-card">
                <RoadmapCover record={active} large />
                <p className="rm-muted">Their roadmap</p>
                <h3>{active.name}</h3>
                <Source url={active.publication?.url ?? active.review?.public_roadmap_url}>
                  Explore the published proposal
                </Source>
                <p className="rm-small">
                  Publication does not establish acceptance, delivery or a sale.
                </p>
              </section>
              <section className="rm-context-card">
                <h3>
                  <CalendarDays size={20} />
                  Next step
                </h3>
                <Pill
                  tone={
                    status(active).rank < 2
                      ? "red"
                      : status(active).standing === "good"
                        ? "teal"
                        : "amber"
                  }
                >
                  {status(active).label}
                </Pill>
                <p>{nextStep(active)}</p>
                <dl>
                  <dt>Owner</dt>
                  <dd>{active.owner || "Unassigned"}</dd>
                  <dt>Latest observed activity</dt>
                  <dd>{latestActivity(active)}</dd>
                  <dt>Follow-up</dt>
                  <dd>{active.followUp ?? "To be agreed"}</dd>
                </dl>
                <div className="rm-context-action">
                  <Send size={18} />
                  Review the conversation
                </div>
              </section>
              <section className="rm-context-card">
                <h3>
                  <UserRound size={20} />
                  Relationship
                </h3>
                <div className="rm-person">
                  <span className="rm-avatar">
                    {initials(active.review?.recipient.name || active.name)}
                  </span>
                  <div>
                    <strong>{active.review?.recipient.name ?? active.name}</strong>
                    <p>{active.review?.recipient.email ?? "Contact not verified"}</p>
                  </div>
                </div>
                <p className="rm-small">
                  {active.review?.recipient.verification_status ===
                  "official_business_route_user_approved_not_owner_direct"
                    ? "Approved business route · not owner-direct"
                    : (active.review?.recipient.disposition ?? "Identity review remains pending.")}
                </p>
              </section>
              <section className="rm-context-card">
                <h3>
                  <LockKeyhole size={20} />
                  Message visibility
                </h3>
                <p>{props.review ? "Private local review" : "Authorized Roadmaps team"}</p>
                <p className="rm-small">
                  Only separately approved roadmap correspondence can appear here. Source links open
                  in your own account; unrelated mailbox content is excluded.
                </p>
              </section>
              {active.native && props.readCanonical ? (
                <CanonicalRead
                  organizationId={props.organizationId}
                  roadmapId={active.native.id}
                  read={props.readCanonical}
                />
              ) : (
                <section className="rm-context-card">
                  <h3>Canonical identity</h3>
                  <p className="rm-small">
                    {active.native
                      ? `Saved roadmap · ${active.native.status}`
                      : "Binding pending. No canonical record has been created from this source."}
                  </p>
                </section>
              )}
              <details className="rm-context-card">
                <summary>
                  Holds & source coverage <ChevronDown size={16} />
                </summary>
                <ul>
                  {evidenceHolds(active).map((hold, index) => (
                    <li key={index}>{hold}</li>
                  ))}
                </ul>
                <p className="rm-small">
                  {active.coverage?.coverage_note ?? "Historical coverage is incomplete."}
                </p>
                {active.native ? (
                  <p className="rm-small">Canonical ID: {active.native.id}</p>
                ) : null}
              </details>
            </aside>
          </div>
        </>
      ) : (
        <>
          <div className="rm-page-heading">
            <div>
              <h1 ref={heading} tabIndex={-1}>
                Roadmaps
              </h1>
              <p>Every relationship. Every next step.</p>
            </div>
            <div className="rm-heading-actions">
              <button
                className="rm-button"
                onClick={() => {
                  if (props.onReviewImports) props.onReviewImports();
                  else {
                    setAdvanced(true);
                    setFilter("attention");
                  }
                }}
              >
                <FileText size={18} />
                Review imports
              </button>
              <button
                className="rm-button rm-primary-button"
                disabled={!props.onCreateRoadmap}
                title={
                  props.onCreateRoadmap
                    ? "Open existing roadmap creation workflow"
                    : "Creation is unavailable in the read-only local preview"
                }
                onClick={props.onCreateRoadmap}
              >
                <Plus size={18} />
                New roadmap
              </button>
            </div>
          </div>
          <div className="rm-notice">
            <Sparkles size={28} />
            <div>
              <strong>Keep the next conversation moving.</strong>
              <p>See what is ready, what was sent, and what needs you.</p>
            </div>
          </div>
          <section className="rm-followup-summary" aria-label="Follow-up queue">
            <div>
              <h2>Own the next follow-up</h2>
              <p>Assigned dates only · UTC · overdue first</p>
            </div>
            <div className="rm-followup-counts">
              {[
                ["due", "Due / overdue", records.filter((r) => status(r).rank < 2).length],
                [
                  "upcoming",
                  "Upcoming",
                  records.filter((r) => status(r).state === "upcoming").length,
                ],
                [
                  "good",
                  "Good standing",
                  records.filter((r) => status(r).standing === "good").length,
                ],
                [
                  "scheduling",
                  "Needs scheduling",
                  records.filter((r) => status(r).state === "needs_scheduling").length,
                ],
              ].map(([key, label, count]) => (
                <button
                  key={key}
                  aria-pressed={filter === key}
                  onClick={() => setFilter(String(key))}
                >
                  <strong>{props.loading || props.readError ? "—" : count}</strong>
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <details>
              <summary>How these statuses work</summary>
              <p>
                Overdue: assigned date before today. Due today: assigned date today. Upcoming:
                assigned date within the next 7 days. Needs scheduling: no valid assigned date. Good
                standing: a named, unexpired review of current evidence, no known holds, assigned
                owner and next action, and a future follow-up. New activity invalidates an older
                review. Scheduled alone is not good standing. No dates are generated automatically.
              </p>
            </details>
          </section>
          <div className="rm-toolbar">
            <div className="rm-tabs" aria-label="Roadmap filters">
              {[
                ["all", "All roadmaps"],
                ["draft", "Drafts to review"],
                ["sent", "Verified email sends"],
                ["linkedin", "LinkedIn activity"],
                ["attention", "Needs attention"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  aria-pressed={filter === key}
                  className={filter === key ? "active" : ""}
                  onClick={() => setFilter(key!)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="rm-tools">
              <label className="rm-search">
                <Search size={18} />
                <input
                  aria-label="Find a company or contact"
                  placeholder="Find a company or contact"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <button
                className="rm-button"
                aria-expanded={advanced}
                onClick={() => setAdvanced(!advanced)}
              >
                <Filter size={18} />
                Filter
              </button>
              <button
                className={`rm-icon-button ${!grid ? "active" : ""}`}
                aria-label="List view"
                aria-pressed={!grid}
                onClick={() => setGrid(false)}
              >
                <List size={20} />
              </button>
              <button
                className={`rm-icon-button ${grid ? "active" : ""}`}
                aria-label="Grid view"
                aria-pressed={grid}
                onClick={() => setGrid(true)}
              >
                <LayoutGrid size={20} />
              </button>
            </div>
          </div>
          {advanced ? (
            <div className="rm-extra-filters">
              <button aria-pressed={filter === "bounce"} onClick={() => setFilter("bounce")}>
                Delivery failures
              </button>
              <button aria-pressed={filter === "bound"} onClick={() => setFilter("bound")}>
                Canonical records
              </button>
              <button
                onClick={() => {
                  setFilter("all");
                  setQuery("");
                }}
              >
                Clear filters
              </button>
            </div>
          ) : null}
          {props.loading ? (
            <div className="rm-empty" role="status">
              Reading your roadmap inventory…
            </div>
          ) : null}
          {props.readError ? (
            <div className="rm-read-warning" role="status">
              Canonical read unavailable.{" "}
              {props.publication
                ? "Published source inventory is shown separately; bindings and live statuses remain unverified."
                : "No saved-record count is available."}
              {props.onRetry ? <button onClick={props.onRetry}>Retry canonical read</button> : null}
            </div>
          ) : null}
          <div
            className={`rm-table ${grid ? "rm-grid" : ""}`}
            role="table"
            aria-label="Roadmap inventory"
          >
            <div className="rm-table-head" role="row">
              <span role="columnheader">Company & roadmap</span>
              <span role="columnheader">Roadmap</span>
              <span role="columnheader">Conversation</span>
              <span role="columnheader">Next step</span>
              <span role="columnheader">Owner</span>
              <span />
            </div>
            {visible.map((record) => (
              <div className="rm-row" role="row" key={record.key}>
                <div className="rm-company" role="cell">
                  <RoadmapCover record={record} />
                  <div>
                    <button
                      className="rm-company-name"
                      onClick={(event) => open(record, event.currentTarget)}
                    >
                      {record.name}
                    </button>
                    <p>
                      {record.publication?.identityHold
                        ? "Identity review required"
                        : record.native
                          ? "Saved roadmap"
                          : "Published proposal · binding pending"}
                    </p>
                  </div>
                </div>
                <div role="cell" data-label="Roadmap">
                  <Pill
                    tone={
                      record.publication || record.review?.roadmap_status.published
                        ? "blue"
                        : "neutral"
                    }
                  >
                    {record.publication || record.review?.roadmap_status.published
                      ? "Published"
                      : "Unknown"}
                  </Pill>
                </div>
                <div role="cell" data-label="Conversation">
                  <Pill tone={communication(record).tone}>{communication(record).label}</Pill>
                  <span className="rm-sr-note">{communication(record).note}</span>
                  <p className="rm-small">Latest: {latestActivity(record)}</p>
                </div>
                <div className="rm-next" role="cell" data-label="Next step">
                  <Pill
                    tone={
                      status(record).rank < 2
                        ? "red"
                        : status(record).standing === "good"
                          ? "teal"
                          : "amber"
                    }
                  >
                    {status(record).label}
                  </Pill>
                  {status(record).standing === "good" ? (
                    <p className="rm-small">Good standing · reviewed</p>
                  ) : (
                    <p className="rm-small">
                      {status(record).standing === "held"
                        ? "Holds require review"
                        : "Standing not verified"}
                    </p>
                  )}
                  <span>{nextStep(record)}</span>
                  <p className="rm-small">Follow-up: {status(record).date ?? "Needs scheduling"}</p>
                </div>
                <div className="rm-owner" role="cell" data-label="Owner">
                  <span className="rm-avatar">
                    {record.owner && record.owner !== "Unknown" ? initials(record.owner) : "?"}
                  </span>
                  <span>{record.owner || "Unassigned"}</span>
                </div>
                <div role="cell">
                  <button
                    className="rm-row-open"
                    aria-label={`View ${record.name} details`}
                    onClick={(event) => open(record, event.currentTarget)}
                  >
                    View details
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {!props.loading && !visible.length ? (
            <div className="rm-empty">
              <h2>No roadmaps match this view</h2>
              <p>
                Try a different company, contact or filter. Missing evidence is not a zero send
                count.
              </p>
              <button
                className="rm-button"
                onClick={() => {
                  setFilter("all");
                  setQuery("");
                }}
              >
                Reset view
              </button>
            </div>
          ) : null}
          <div className="rm-inventory-note">
            <span>
              {visible.length} of {records.length} observed identities
            </span>
            <span>
              Publication, communication and canonical status are separate. History is incomplete.
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function Conversation({ record }: { record: EvidenceRecord }) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("all");
  const drafts = savedDrafts(record);
  const failures = deliveryFailures(record);
  const matches = (text: string) => text.toLowerCase().includes(query.toLowerCase());
  const messages = record.messages.filter((item) =>
    matches(
      `${item.message.subject} ${item.message.from} ${item.message.to.join(" ")} ${item.message.body_exact}`,
    ),
  );
  const events = conversationEvents(record).filter((event) =>
    event.channel === "email"
      ? matches(
          `${event.email.message.subject} ${event.email.message.from} ${event.email.message.to.join(" ")} ${event.email.message.body_exact}`,
        )
      : matches(`${event.linkedin.subject} ${event.linkedin.recipient} ${event.linkedin.body}`),
  );
  const linkedInMatches = events.filter((event) => event.channel === "linkedin");
  const reported = record.coverage?.separate_user_evidenced_interaction;
  const shownDrafts = drafts.filter((d) =>
    matches(`${d.subject} ${d.body_plain_text_content_only}`),
  );
  const shownFailures = failures.filter((f) => matches(f.reason));
  return (
    <section className="rm-conversation">
      <header>
        <div className="rm-conversation-title">
          <h2>The conversation</h2>
          <label className="rm-search">
            <Search size={17} />
            <input
              aria-label="Search conversation"
              placeholder="Search conversation…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        <div className="rm-conversation-tabs">
          {[
            ["all", "All activity"],
            ["email", "Email"],
            ["linkedin", "LinkedIn"],
            ["draft", "Drafts"],
            ["sources", "Sources"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={tab === key ? "active" : ""}
              aria-pressed={tab === key}
              onClick={() => setTab(key!)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      <div className="rm-timeline">
        {tab === "sources" ? (
          <div className="rm-source-summary">
            <h3>Evidence & provenance</h3>
            <p>
              {record.coverage?.coverage_note ??
                "Historical coverage remains incomplete. No global sent or delivery total is established."}
            </p>
            <Source url={record.publication?.url ?? record.review?.public_roadmap_url}>
              Published roadmap
            </Source>
            <p>
              {record.binding === "pending"
                ? "Canonical identity is unbound."
                : "Canonical identity is linked."}
            </p>
            <ul>
              {evidenceHolds(record).map((hold, index) => (
                <li key={index}>{hold}</li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            {tab === "all" && reported && matches(reported.reply_summary) ? (
              <article className="rm-event rm-reported">
                <div className="rm-event-header">
                  <Pill tone="teal">Reply reported · screenshot</Pill>
                  <time>{date(reported.reply_at_reported)}</time>
                </div>
                <div className="rm-event-body">
                  <p>{reported.reply_summary}</p>
                  <p>{reported.sender_context}</p>
                  <p className="rm-small">
                    Reported send: {date(reported.sent_at_reported)}. Exact message body and
                    provider IDs are not established.
                  </p>
                  <p className="rm-small">{reported.limits}</p>
                  <p className="rm-small">Library source: {reported.library_file_id}</p>
                </div>
              </article>
            ) : null}
            {(tab === "all" || tab === "email") &&
              shownFailures.map((f) => (
                <article className="rm-event rm-failure" key={f.provider_message_id}>
                  <div className="rm-event-header">
                    <Pill tone="red">Bounced</Pill>
                    <time>{date(f.occurred_at)}</time>
                  </div>
                  <div className="rm-event-body">
                    <h3>Delivery failed · {f.smtp_status}</h3>
                    <p>{f.reason}</p>
                    <p>
                      Sent is verified; delivery failed. Confirm a corrected contact and obtain
                      separate approval before any resend.
                    </p>
                    <Source url={f.source_url}>View original notification</Source>
                    <p className="rm-small">Provider message: {f.provider_message_id}</p>
                  </div>
                </article>
              ))}
            {events
              .filter((event) => tab === "all" || tab === event.channel)
              .map((event, index) =>
                event.channel === "email" ? (
                  <MessageCard item={event.email} key={`email:${index}`} />
                ) : (
                  <LinkedInCard event={event.linkedin} key={`linkedin:${index}`} />
                ),
              )}
            {(tab === "all" || tab === "draft") &&
              shownDrafts.map((draft) => (
                <article className="rm-event rm-draft" key={draft.provider_draft_id}>
                  <div className="rm-event-header">
                    <Pill tone="amber">
                      {record.linkedIn ? "Email draft · superseded" : "Unsent draft"}
                    </Pill>
                    <time>{date(draft.verified_at)}</time>
                  </div>
                  <div className="rm-event-body">
                    <h3>{draft.subject}</h3>
                    {record.linkedIn && (
                      <p role="note">
                        LinkedIn outreach already sent. This saved email draft is superseded; do not
                        send duplicate outreach.
                      </p>
                    )}
                    <p className="rm-small">
                      To: {draft.to.join(", ") || "Empty · recipient held"}
                    </p>
                    <details>
                      <summary>
                        Expand full draft <ChevronDown size={15} />
                      </summary>
                      <pre>{draft.body_plain_text_content_only}</pre>
                      <p className="rm-small">
                        Draft: {draft.provider_draft_id} · Message: {draft.provider_message_id}
                      </p>
                    </details>
                    <Source url={draft.source_url}>View original draft</Source>
                  </div>
                </article>
              ))}
            {(
              tab === "draft"
                ? !shownDrafts.length
                : tab === "linkedin"
                  ? !linkedInMatches.length
                  : !messages.length &&
                    !shownFailures.length &&
                    !(
                      tab === "all" &&
                      (shownDrafts.length ||
                        (reported && matches(reported.reply_summary)) ||
                        linkedInMatches.length)
                    )
            ) ? (
              <div className="rm-empty">
                <Mail size={28} />
                <h3>
                  {query
                    ? "No matching messages"
                    : tab === "draft"
                      ? "No current draft in this evidence"
                      : "No verified messages in this view yet"}
                </h3>
                <p>
                  {query
                    ? "Try another phrase or sender."
                    : "Missing evidence does not mean no conversation happened. Source coverage remains incomplete."}
                </p>
              </div>
            ) : null}
            {tab === "all" && !query ? (
              <div className="rm-publication-event">
                <Map size={18} />
                <span>
                  {record.publication || record.review?.roadmap_status.published
                    ? "Roadmap publication observed"
                    : "Publication not verified"}
                </span>
                {record.publication || record.review?.roadmap_status.published ? (
                  <Check size={15} />
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
      <footer className="rm-timeline-footer">
        Exact supplied message text · times in UTC · partial history · sent does not mean delivered
      </footer>
    </section>
  );
}
function LinkedInCard({ event }: { event: LinkedInEvent }) {
  const received = event.status === "received_ui_verified";
  return (
    <article className="rm-event">
      <div className="rm-event-header">
        <Pill tone="teal">{received ? "LinkedIn received" : "LinkedIn sent"}</Pill>
        <time>
          {linkedInApproximate(event) ? "Approximately " : ""}
          {date(event.observed_at ?? event.observed_send_time_utc_approx!)}
        </time>
      </div>
      <div className="rm-event-body">
        <h3>{event.subject}</h3>
        <p>
          {received ? "From" : "To"}: {event.recipient}
        </p>
        <details>
          <summary>
            Expand full LinkedIn message <ChevronDown size={15} />
          </summary>
          <pre>{event.body}</pre>
        </details>
        <p className="rm-small">
          LinkedIn {received ? "received" : "sent"}-history verified in supplied evidence. Delivery
          and read state unconfirmed. No provider message ID supplied. History may be incomplete.
        </p>
        <Source url={event.profile_url}>Verified LinkedIn profile</Source>
      </div>
    </article>
  );
}

function MessageCard({ item }: { item: ObservedMessage }) {
  const m = item.message;
  const received = m.type === "email_received";
  const text = messagePlainText(m.body_exact, m.body_format);
  return (
    <article className={`rm-event ${received ? "rm-received" : "rm-sent"}`}>
      <div className="rm-event-header">
        <span className="rm-mail-icon">{received ? <Mail size={19} /> : <Send size={19} />}</span>
        <Pill tone={received ? "teal" : "blue"}>
          {received
            ? "Received"
            : m.type === "email_team_outbound_copy"
              ? "Team outbound copy"
              : "Sent"}
        </Pill>
        <strong>{m.from}</strong>
        <time>{date(m.sent_at)}</time>
      </div>
      <div className="rm-event-body">
        <h3>{m.subject}</h3>
        <p className="rm-small">To: {m.to_header ?? m.to.join(", ")}</p>
        {item.conflict ? (
          <p role="alert">Conflicting observations · excluded from verified sends</p>
        ) : null}
        {m.content_safety ? <p className="rm-small">{m.content_safety}</p> : null}
        <pre className="rm-message-preview">
          {text.slice(0, 450)}
          {text.length > 450 ? "…" : ""}
        </pre>
        <details>
          <summary>
            Expand full message <ChevronDown size={15} />
          </summary>
          <pre>{text}</pre>
          {m.body_format === "text/html" ? (
            <details>
              <summary>Inspect original HTML as text</summary>
              <pre>{m.body_exact}</pre>
            </details>
          ) : null}
          <p className="rm-small">
            Mailbox: {item.mailboxes.join(", ")}
            <br />
            Message: {m.provider_message_id}
            <br />
            Thread: {m.provider_thread_id}
          </p>
          {item.alternateText?.map((alt, index) => (
            <details key={index}>
              <summary>Historical representation</summary>
              <p>{alt.note}</p>
              <pre>{alt.text}</pre>
            </details>
          ))}
        </details>
        <div className="rm-message-footer">
          {item.sources.map((url, index) => (
            <Source key={url} url={url}>
              View original email{index ? ` ${index + 1}` : ""}
            </Source>
          ))}
          <span>Email</span>
        </div>
      </div>
    </article>
  );
}
