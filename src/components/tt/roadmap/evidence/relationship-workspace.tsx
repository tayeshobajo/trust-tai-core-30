import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  FileText,
  Filter,
  History,
  Layers,
  ListFilter,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Send,
  ShieldCheck,
  StickyNote,
  UserRound,
} from "lucide-react";
import type { Roadmap } from "@/domain/roadmap";
import {
  canonicalOutreachHolds,
  evidenceHolds,
  messagePlainText,
  projectEvidence,
  type EvidenceRecord,
} from "@/domain/roadmap-evidence";
import {
  attachLinkedIn,
  conversationEvents,
  linkedInApproximate,
} from "@/domain/roadmap-conversation";
import type { LinkedInEvidence } from "@/domain/roadmap-evidence";
import type { StandingReview } from "@/domain/roadmap-followup";
import { editHistory } from "@/domain/roadmap-tracker-edit";
import {
  channelLabels,
  healthLabels,
  latestRelationshipActivity,
  outreachBlocked,
  recordKey,
  relationshipHealth,
  relationshipMetrics,
  relationshipNextAction,
  relationshipSnippet,
  safeRoadmapUrl,
} from "@/domain/roadmap-relationship-workspace";
import { verifiedRoadmapCovers } from "@/data/roadmap-verified-covers";
import { CanonicalRead, type EvidenceWorkspaceProps } from "./workspace";
import {
  RelationshipConversation,
  type LoadedConversationPreview,
} from "./relationship-conversation";
import "./relationship-workspace.css";

export interface RelationshipWorkspaceProps extends EvidenceWorkspaceProps {
  userId?: string;
  canWork?: boolean;
  now?: Date;
  standingReviews?: Record<string, StandingReview>;
  linkedIn?: LinkedInEvidence;
  onCreateRoadmap?: () => void;
  onReviewImports?: () => void;
  onLegacyRoadmaps?: () => void;
  renderUpdate?: (
    roadmap: Roadmap,
    field: "nextAction" | "followUpDate",
    onDirtyChange: (dirty: boolean) => void,
  ) => ReactNode;
}
type Tab = "conversation" | "details" | "roadmap" | "actions" | "activity";
const tabs: { key: Tab; label: string; icon: typeof Mail }[] = [
  { key: "conversation", label: "Conversation", icon: MessageSquare },
  { key: "details", label: "Details", icon: FileText },
  { key: "roadmap", label: "Roadmap", icon: Layers },
  { key: "actions", label: "Actions & Evidence", icon: ShieldCheck },
  { key: "activity", label: "Activity", icon: History },
];
const getSelection = () =>
  typeof window === "undefined" ? null : new URL(window.location.href).searchParams.get("evidence");
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase();
const when = (s: string) =>
  new Date(s).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }) + " UTC";
const date = (s: string) =>
  new Date(s + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
export function RelationshipRoadmapWorkspace(props: RelationshipWorkspaceProps) {
  const identityScope = `${props.organizationId}:${props.userId ?? "reader"}`;
  const now = props.now ?? new Date();
  const [selection, setSelection] = useState({ scope: identityScope, key: getSelection() });
  const selected = selection.scope === identityScope ? selection.key : null;
  const [wide, setWide] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("needs_action");
  const [sort, setSort] = useState("follow_up");
  const [advanced, setAdvanced] = useState(false);
  const [boundOnly, setBoundOnly] = useState(false);
  const [tabState, setTabState] = useState<{ scope: string; value: Tab }>({
    scope: "",
    value: "conversation",
  });
  const [editField, setEditField] = useState<"nextAction" | "followUpDate">("nextAction");
  const [preview, setPreview] = useState<LoadedConversationPreview | null>(null);
  const [draft, setDraft] = useState({ scope: "", text: "" });
  const [editorState, setEditorState] = useState({ scope: "", dirty: false });
  const editorDirty = editorState.scope.startsWith(identityScope + ":") && editorState.dirty;
  useEffect(() => {
    const m = window.matchMedia("(min-width: 720px)");
    const update = () => setWide(m.matches);
    update();
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    setPreview(null);
    setDraft({ scope: "", text: "" });
    setQuery("");
  }, [identityScope]);
  useEffect(() => {
    const pop = () => {
      if (editorDirty) {
        const u = new URL(window.location.href);
        if (selected) u.searchParams.set("evidence", selected);
        window.history.replaceState(null, "", u);
        return;
      }
      setSelection({ scope: identityScope, key: getSelection() });
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [identityScope, editorDirty, selected]);
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
      ).map((r) => {
        const attached = attachLinkedIn(r, props.linkedIn);
        const summary =
          props.conversationSummary?.organizationId === props.organizationId
            ? props.conversationSummary.records.find((x) => x.roadmapId === r.native?.id)
            : undefined;
        return summary ? { ...attached, importedActivity: summary } : attached;
      }),
    [
      props.roadmaps,
      props.organizationId,
      props.loading,
      props.readError,
      props.review,
      props.bindings,
      props.publication,
      props.history,
      props.coverage,
      props.linkedIn,
      props.conversationSummary,
    ],
  );
  const health = (r: EvidenceRecord) =>
    relationshipHealth(r, now, props.standingReviews?.[recordKey(r)]);
  const metrics = relationshipMetrics(records, now, props.standingReviews);
  const visible = records
    .filter((r) => {
      const h = health(r);
      if (boundOnly && !r.native) return false;
      if (filter === "needs_action" && (h.health === "on_track" || h.health === "inactive"))
        return false;
      if (filter === "mine" && (!props.userId || r.native?.ownerUserId !== props.userId))
        return false;
      if (
        ["attention", "approaching", "on_track", "not_assessed"].includes(filter) &&
        h.health !== filter
      )
        return false;
      return `${r.name} ${r.review?.recipient.name ?? ""} ${r.review?.recipient.email ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase());
    })
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : health(a).rank - health(b).rank ||
          (health(a).date ?? "9999").localeCompare(health(b).date ?? "9999") ||
          a.name.localeCompare(b.name),
    );
  const selectedRecord = selected
    ? records.find((r) => recordKey(r) === selected || r.key === selected)
    : undefined;
  const initialKey =
    wide && !selected && !props.loading && !props.readError && visible[0]
      ? recordKey(visible[0])
      : null;
  useEffect(() => {
    if (!initialKey) return;
    const url = new URL(window.location.href);
    url.searchParams.set("evidence", initialKey);
    window.history.replaceState(null, "", url);
    setSelection({ scope: identityScope, key: initialKey });
  }, [initialKey, identityScope]);
  const active = selectedRecord ?? (!selected && wide ? visible[0] : undefined);
  const activeScope = active ? `${identityScope}:${active.key}` : "";
  const tab = tabState.scope === activeScope ? tabState.value : "conversation";
  const onEditorDirty = useCallback(
    (dirty: boolean) =>
      setEditorState((s) =>
        s.scope === activeScope && s.dirty === dirty ? s : { scope: activeScope, dirty },
      ),
    [activeScope],
  );
  const changeTab = (value: Tab) => setTabState({ scope: activeScope, value });
  const navigate = (r: EvidenceRecord | null) => {
    const u = new URL(window.location.href);
    if (r) u.searchParams.set("evidence", recordKey(r));
    else u.searchParams.delete("evidence");
    window.history.pushState(null, "", u);
    setSelection({ scope: identityScope, key: r ? recordKey(r) : null });
  };
  const onPreview = useCallback(
    (p: LoadedConversationPreview | null) =>
      setPreview(p?.organizationId === props.organizationId ? p : null),
    [props.organizationId],
  );
  const update = (field: "nextAction" | "followUpDate") => {
    if (active && !selected) navigate(active);
    setEditField(field);
    changeTab("actions");
  };
  const isUnavailable = Boolean(props.loading || props.readError);
  const activeHealth = active ? health(active) : undefined;
  const source = active
    ? safeRoadmapUrl(active.publication?.url ?? active.review?.public_roadmap_url)
    : undefined;
  const canUpdate = Boolean(
    active?.native && props.canWork && props.renderUpdate && activeHealth?.state !== "inactive",
  );
  const mine = records.filter((r) => props.userId && r.native?.ownerUserId === props.userId).length;
  const needs = records.filter((r) => !["on_track", "inactive"].includes(health(r).health)).length;
  return (
    <div className={`rw-workspace ${selected ? "rw-has-selection" : ""}`}>
      <div className="rw-hero">
        <div className="rw-breadcrumb">
          Workspace <span>/</span> Roadmaps
        </div>
        <header className="rw-title">
          <div>
            <h1>Roadmaps</h1>
            <p>Every relationship. Every next step.</p>
          </div>
          <button
            className="rw-primary"
            onClick={props.onCreateRoadmap}
            disabled={!props.onCreateRoadmap || !props.canWork}
          >
            <Plus size={18} />
            Create Roadmap
          </button>
        </header>
      </div>
      <section className="rw-metrics" aria-label="Roadmap metrics">
        {[
          {
            label: "Total Roadmaps",
            value: metrics.total,
            note: "Saved canonical records",
            kind: "total",
            icon: true,
          },
          {
            label: "Needs Attention",
            value: metrics.attention,
            note: "Known holds / due dates",
            kind: "attention",
          },
          {
            label: "Approaching Due",
            value: metrics.approaching,
            note: "Assigned dates · next 7 days",
            kind: "approaching",
          },
          {
            label: "On Track",
            value: metrics.onTrack,
            note: "Current evidence review required",
            kind: "on_track",
          },
          {
            label: "Not Assessed",
            value: metrics.unassessed,
            note: "Health still unverified",
            kind: "not_assessed",
          },
        ].map((m) => (
          <button
            key={m.kind}
            className={`rw-metric rw-health-${m.kind}`}
            disabled={isUnavailable}
            onClick={() => setFilter(m.kind === "total" ? "all" : m.kind)}
            aria-label={`${m.label}: ${isUnavailable || m.value === null ? "unknown" : m.value}`}
          >
            {m.icon ? <Layers size={23} /> : <span className="rw-health-dot" />}
            <span>
              <strong>{isUnavailable || m.value === null ? "—" : m.value}</strong>
              <span>{m.label}</span>
              <small>{m.note}</small>
            </span>
            {!m.icon ? <ChevronRight size={17} /> : null}
          </button>
        ))}
      </section>
      <div className="rw-toolbar">
        <nav aria-label="Queue filters">
          {[
            { key: "needs_action", label: "Needs Action", count: needs },
            { key: "all", label: "All Roadmaps", count: records.length },
            { key: "mine", label: "My Assignments", count: props.userId ? mine : null },
          ].map((f) => (
            <button
              key={f.key}
              className={filter === f.key ? "rw-selected" : ""}
              aria-pressed={filter === f.key}
              disabled={f.key === "mine" && !props.userId}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              <span>{isUnavailable || f.count === null ? "—" : f.count}</span>
            </button>
          ))}
          <button disabled title="Following is unavailable: there is no saved follow list.">
            Following <span>—</span>
          </button>
        </nav>
        <label className="rw-search">
          <Search size={17} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search roadmaps or contacts…"
            aria-label="Search roadmaps or contacts"
          />
        </label>
        <button
          className="rw-filter-button"
          aria-expanded={advanced}
          onClick={() => setAdvanced(!advanced)}
        >
          <Filter size={16} />
          Filter
        </button>
      </div>
      {advanced ? (
        <div className="rw-filter-options">
          <label>
            <input
              type="checkbox"
              checked={boundOnly}
              onChange={(e) => setBoundOnly(e.target.checked)}
            />
            Saved records only
          </label>
          <span>Search covers company/contact identities, not unloaded messages.</span>
          <details>
            <summary>Health rules</summary>
            <p>
              Overdue dates and holds require attention. A future date alone is not On Track. On
              Track requires a current evidence review, reviewer, source, expiry, owner, next action
              and no newer correspondence. Archived records stay closed.
            </p>
          </details>
        </div>
      ) : null}
      <p className="rw-inventory-scope">
        {isUnavailable
          ? "Inventory coverage is not available yet."
          : `${metrics.total} saved records · ${metrics.sourceOnly} public-source identities still need binding. Active-queue metrics are partial; history is incomplete.`}
      </p>
      {props.conversationSummaryFailed ? (
        <p role="alert" className="rw-alert">
          Conversation status read failed. Latest correspondence remains unknown until its reviewed
          history is read.
        </p>
      ) : null}
      {editorDirty ? (
        <p className="rw-alert" role="status">
          Finish, discard or check the saved update before leaving this relationship.
        </p>
      ) : null}
      <div className="rw-panes">
        <aside className="rw-queue" aria-label="Roadmap relationship queue">
          <header>
            <div>
              <h2>
                {filter === "needs_action"
                  ? "Needs Action"
                  : filter === "mine"
                    ? "My Assignments"
                    : filter === "all"
                      ? "All Roadmaps"
                      : (healthLabels[filter as keyof typeof healthLabels] ?? "Roadmaps")}
              </h2>
              <p>
                {isUnavailable
                  ? "Reading authorized inventory…"
                  : `${visible.length} observed identities in this view`}
              </p>
            </div>
            <label>
              Sort:{" "}
              <select
                aria-label="Sort roadmap queue"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                <option value="follow_up">Next Follow-up</option>
                <option value="name">Company name</option>
              </select>
              <ChevronDown size={13} />
            </label>
          </header>
          <div className="rw-queue-scroll">
            {props.loading ? (
              <div role="status" className="rw-empty">
                Reading your roadmap inventory…
              </div>
            ) : props.readError ? (
              <div role="alert" className="rw-empty">
                <h3>Inventory unavailable</h3>
                <p>Previous private text has been cleared.</p>
                <button onClick={props.onRetry}>Retry canonical read</button>
              </div>
            ) : (
              visible.map((r) => {
                const h = health(r);
                const loaded =
                  preview?.organizationId === props.organizationId &&
                  preview.roadmapId === r.native?.id
                    ? preview
                    : null;
                const snippet = loaded?.text ?? relationshipSnippet(r);
                const latest = latestRelationshipActivity(r);
                return (
                  <button
                    className={`rw-queue-item rw-health-${h.health} ${active?.key === r.key ? "rw-active" : ""}`}
                    key={r.key}
                    disabled={editorDirty && active?.key !== r.key}
                    onClick={() => navigate(r)}
                    aria-current={active?.key === r.key ? "true" : undefined}
                    aria-label={`Open ${r.name}`}
                  >
                    <span className="rw-health-dot" />
                    <span className="rw-company-avatar">{initials(r.name)}</span>
                    <span className="rw-queue-copy">
                      <strong>{r.name}</strong>
                      <span>
                        {snippet ??
                          (latest
                            ? `${channelLabels[latest.channel]} ${latest.kind} · preview not loaded`
                            : "Correspondence unknown · open to review")}
                      </span>
                      {!r.native ? <small>Public source · identity binding pending</small> : null}
                    </span>
                    <span className="rw-queue-date">
                      <span className="rw-status-pill">
                        {h.state === "overdue"
                          ? "Overdue"
                          : h.state === "due_today"
                            ? "Due today"
                            : h.state === "upcoming"
                              ? `Due in ${h.days} day${h.days === 1 ? "" : "s"}`
                              : h.health === "attention"
                                ? "On hold"
                                : h.healthLabel}
                      </span>
                      <time>
                        {h.date
                          ? date(h.date)
                          : h.state === "inactive"
                            ? "Closed"
                            : "Not scheduled"}
                      </time>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                );
              })
            )}
            {!isUnavailable && !visible.length ? (
              <div className="rw-empty">
                <h3>No roadmaps match</h3>
                <p>Change the filter or search.</p>
                <button
                  onClick={() => {
                    setFilter("all");
                    setQuery("");
                    setBoundOnly(false);
                  }}
                >
                  Reset view
                </button>
              </div>
            ) : null}
          </div>
        </aside>
        <section className="rw-selected-relationship" aria-label="Selected roadmap workspace">
          {active && !isUnavailable ? (
            <>
              <header className="rw-company-heading">
                <button
                  className="rw-mobile-back"
                  disabled={editorDirty}
                  onClick={() => navigate(null)}
                >
                  <ArrowLeft size={17} />
                  All roadmaps
                </button>
                <div className="rw-selected-company">
                  <span className="rw-company-avatar">{initials(active.name)}</span>
                  <div>
                    <h2>{active.name}</h2>
                    <p>
                      Roadmap <span>•</span>{" "}
                      {active.publication ? "Published reference" : "Publication unknown"}
                    </p>
                  </div>
                  <span className={`rw-status-pill rw-health-${activeHealth!.health}`}>
                    {activeHealth!.healthLabel}
                  </span>
                  <details className="rw-tools-menu">
                    <summary aria-label="Roadmap tools">
                      <MoreHorizontal size={18} />
                    </summary>
                    <button
                      onClick={props.onReviewImports}
                      disabled={!props.onReviewImports || editorDirty}
                    >
                      Existing tracker / import review
                    </button>
                    <button
                      onClick={props.onLegacyRoadmaps}
                      disabled={!props.onLegacyRoadmaps || editorDirty}
                    >
                      Existing roadmap tools
                    </button>
                  </details>
                </div>
              </header>
              <nav className="rw-tabs" aria-label="Relationship tabs" role="tablist">
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    role="tab"
                    aria-selected={tab === t.key}
                    aria-controls="relationship-tab-panel"
                    id={`relationship-tab-${t.key}`}
                    tabIndex={tab === t.key ? 0 : -1}
                    disabled={editorDirty && t.key !== "actions"}
                    onClick={() => changeTab(t.key)}
                    onKeyDown={(event) => {
                      if (
                        editorDirty ||
                        !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
                      )
                        return;
                      event.preventDefault();
                      const index = tabs.findIndex((item) => item.key === t.key);
                      const next =
                        event.key === "Home"
                          ? tabs[0]
                          : event.key === "End"
                            ? tabs[tabs.length - 1]
                            : tabs[
                                (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
                                  tabs.length
                              ];
                      if (next) {
                        changeTab(next.key);
                        event.currentTarget.parentElement
                          ?.querySelector<HTMLButtonElement>(`#relationship-tab-${next.key}`)
                          ?.focus();
                      }
                    }}
                  >
                    <t.icon size={14} />
                    {t.label}
                  </button>
                ))}
              </nav>
              <div
                id="relationship-tab-panel"
                role="tabpanel"
                aria-labelledby={`relationship-tab-${tab}`}
                className={`rw-tab-panel rw-tab-${tab}`}
              >
                {tab === "conversation" ? (
                  active.native && props.readConversations ? (
                    <RelationshipConversation
                      key={`${identityScope}:${active.native.id}`}
                      organizationId={props.organizationId}
                      roadmapId={active.native.id}
                      {...(active.native.relationshipId
                        ? { relationshipId: active.native.relationshipId }
                        : {})}
                      read={props.readConversations}
                      onPreview={onPreview}
                    />
                  ) : (
                    <SuppliedConversation record={active} />
                  )
                ) : null}
                {tab === "details" ? (
                  <>
                    <div className="rw-inline-summary">
                      <RelationshipSummary
                        record={active}
                        now={now}
                        review={props.standingReviews?.[recordKey(active)]}
                      />
                    </div>
                    {active.native && props.readCanonical ? (
                      <CanonicalRead
                        key={`${identityScope}:${active.native.id}`}
                        organizationId={props.organizationId}
                        roadmapId={active.native.id}
                        read={props.readCanonical}
                      />
                    ) : (
                      <div className="rw-empty">
                        <h3>
                          {active.native
                            ? "Canonical reader unavailable"
                            : "Canonical relationship not bound"}
                        </h3>
                        <p>
                          {active.native
                            ? "The saved record exists; its authenticated relationship reader is not connected in this preview."
                            : "Verify the source identity before linking, editing or importing."}
                        </p>
                      </div>
                    )}
                    <p className="rw-capability-note">
                      Contact identity, publication and workflow status are separate. No recipient
                      identity is inferred from a greeting.
                    </p>
                  </>
                ) : null}
                {tab === "roadmap" ? <RoadmapPanel record={active} /> : null}
                {tab === "actions" ? (
                  <div className="rw-actions-panel">
                    <h3>Actions & Evidence</h3>
                    {canUpdate && active.native ? (
                      props.renderUpdate!(active.native, editField, onEditorDirty)
                    ) : (
                      <p>Record editing is unavailable for this identity or your current access.</p>
                    )}
                    <EvidencePanel record={active} />
                    <p className="rw-capability-note">
                      Internal notes and health overrides are unavailable until their reviewed,
                      persisted operations exist. An override must retain reason, evidence, reviewer
                      and expiry; it cannot dismiss an outreach hold.
                    </p>
                  </div>
                ) : null}
                {tab === "activity" ? <ActivityPanel record={active} /> : null}
              </div>
              <div className={`rw-pinned-step rw-health-${activeHealth!.health}`}>
                <CalendarDays size={22} />
                <div>
                  <strong>Next Step: {relationshipNextAction(active)}</strong>
                  <p>
                    {activeHealth!.date
                      ? `Assigned follow-up: ${date(activeHealth!.date)} · UTC`
                      : "No confirmed follow-up date. Agree on the next action and schedule it."}
                  </p>
                </div>
                <span className="rw-status-pill">{activeHealth!.label}</span>
              </div>
              <div className="rw-composer">
                <Paperclip size={18} aria-hidden />
                <textarea
                  aria-label={`Prepare local reply for ${active.name}`}
                  rows={1}
                  placeholder={
                    outreachBlocked(active)
                      ? "Outreach on hold · review evidence first"
                      : "Prepare a local reply…"
                  }
                  disabled={outreachBlocked(active)}
                  value={draft.scope === activeScope ? draft.text : ""}
                  onChange={(e) => setDraft({ scope: activeScope, text: e.target.value })}
                />
                <button
                  aria-label="Schedule follow-up"
                  disabled={!canUpdate}
                  onClick={() => update("followUpDate")}
                >
                  <CalendarDays size={18} />
                </button>
                <button
                  className="rw-primary"
                  disabled
                  title="Sending is unavailable in Roadmaps; no outbound action is wired."
                >
                  <Send size={16} />
                  Send
                </button>
                <p>
                  {outreachBlocked(active)
                    ? "Outreach hold remains active. "
                    : "Local prepared copy only; switching clears it. Not saved or sent. "}
                  Sending and attachments are unavailable here.
                </p>
              </div>
            </>
          ) : (
            <div className="rw-empty">
              <h2>{selected ? "Roadmap unavailable" : "Select a roadmap"}</h2>
              <p>
                {selected
                  ? "This identity is not present in your current authorized inventory."
                  : "Choose a relationship to inspect its approved conversation and next step."}
              </p>
              {selected ? <button onClick={() => navigate(null)}>All roadmaps</button> : null}
            </div>
          )}
        </section>
        <aside className="rw-relationship-side" aria-label="Relationship summary">
          {active && !isUnavailable ? (
            <>
              <RelationshipSummary
                record={active}
                now={now}
                review={props.standingReviews?.[recordKey(active)]}
              />
              <section className="rw-quick-actions">
                <h3>Quick Actions</h3>
                <button
                  className="rw-action-primary"
                  disabled={!canUpdate}
                  onClick={() => update("nextAction")}
                >
                  <Pencil size={17} />
                  Record an Update
                </button>
                <button disabled={!canUpdate} onClick={() => update("followUpDate")}>
                  <CalendarDays size={17} />
                  Schedule Follow-up
                </button>
                <button
                  disabled
                  title="No supported persisted internal-note operation is available."
                >
                  <StickyNote size={17} />
                  Add Internal Note
                </button>
                <button
                  disabled
                  title="Requires a persisted reason, evidence, reviewer and expiry; no supported operation exists."
                >
                  <ShieldCheck size={17} />
                  Override Health (with evidence)
                </button>
                <button onClick={() => changeTab("actions")}>
                  <FileText size={17} />
                  View Evidence
                </button>
                <p>Unavailable actions are not saved or simulated.</p>
              </section>
            </>
          ) : (
            <div className="rw-summary-card">
              <h3>Relationship</h3>
              <p>Select a roadmap to see verified details.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
function RelationshipSummary({
  record: r,
  now,
  review,
}: {
  record: EvidenceRecord;
  now: Date;
  review?: StandingReview | undefined;
}) {
  const h = relationshipHealth(r, now, review),
    latest = latestRelationshipActivity(r),
    url = safeRoadmapUrl(r.publication?.url ?? r.review?.public_roadmap_url);
  return (
    <section className="rw-summary-card">
      <h3>Relationship</h3>
      <dl>
        <div>
          <dt>Health</dt>
          <dd>
            <span className={`rw-status-pill rw-health-${h.health}`}>{h.healthLabel}</span>
          </dd>
        </div>
        <div>
          <dt>Owner</dt>
          <dd>
            <UserRound size={14} />
            {r.owner}
          </dd>
        </div>
        <div>
          <dt>Next Follow-up</dt>
          <dd>
            <CalendarDays size={14} />
            {h.date ? `${date(h.date)} · ${h.label}` : "Not scheduled"}
          </dd>
        </div>
        <div>
          <dt>Last Correspondence</dt>
          <dd>
            <Mail size={14} />
            {latest ? when(latest.at) : "Unknown"}
          </dd>
        </div>
        <div>
          <dt>Channel</dt>
          <dd>
            <Mail size={14} />
            {latest ? channelLabels[latest.channel] : "Unknown"}
          </dd>
        </div>
        <div>
          <dt>Roadmap</dt>
          <dd>
            {url ? (
              <a href={url} target="_blank" rel="noopener noreferrer">
                Published reference
                <ArrowUpRight size={14} />
              </a>
            ) : (
              "Source not verified"
            )}
          </dd>
        </div>
      </dl>
      <details>
        <summary>Health basis</summary>
        <p>
          {h.standing === "good"
            ? `Reviewed by ${review?.reviewer}; valid through ${review?.validThrough}. Evidence: ${review?.sourceRef}`
            : h.holds.length
              ? "An existing hold requires review. This does not authorize outreach."
              : "Dates show scheduling only. A current evidence review has not established good standing."}
        </p>
      </details>
    </section>
  );
}
function EvidencePanel({ record: r }: { record: EvidenceRecord }) {
  return (
    <section className="rw-evidence">
      <h3>Holds & source coverage</h3>
      {evidenceHolds(r).length ? (
        <ul>
          {evidenceHolds(r).map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
      ) : (
        <p>No hold is recorded in this bounded view. Broader evidence may be incomplete.</p>
      )}
      {canonicalOutreachHolds(r).map((h, i) => (
        <p key={i}>
          {h.kind}: {h.source}
        </p>
      ))}
      <p>Binding: {r.binding}. Historical coverage is incomplete.</p>
      {r.native ? (
        <details>
          <summary>Canonical references</summary>
          <p>Roadmap {r.native.id}</p>
          <p>Relationship {r.native.relationshipId ?? "Unbound"}</p>
          <p>Saved revision {r.native.updatedAt}</p>
        </details>
      ) : null}
    </section>
  );
}
function RoadmapPanel({ record: r }: { record: EvidenceRecord }) {
  const url = safeRoadmapUrl(r.publication?.url ?? r.review?.public_roadmap_url),
    cover = verifiedRoadmapCovers[recordKey(r)];
  return (
    <section className="rw-roadmap-panel">
      <h3>Their roadmap</h3>
      {cover && cover.sourceUrl === url ? (
        <img src={cover.src} alt={cover.alt} loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <div className="rw-cover-fallback">
          <FileText size={30} />
          <span>Roadmap preview unavailable</span>
        </div>
      )}
      {url ? (
        <a className="rw-primary" href={url} target="_blank" rel="noopener noreferrer">
          Open published roadmap
          <ArrowUpRight size={15} />
        </a>
      ) : (
        <p>The public roadmap source is not verified for this saved identity.</p>
      )}
      <p>Publication does not establish delivery, acceptance or a sale.</p>
      {r.native ? (
        <>
          <h3>Saved roadmap</h3>
          <p>{r.native.objective}</p>
          <p>Workflow status: {r.native.status}</p>
          {r.native.pointB ? (
            <p>
              {r.native.pointB.statement} · {r.native.pointB.tier}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
function ActivityPanel({ record: r }: { record: EvidenceRecord }) {
  const entries = r.native ? editHistory(r.native) : [];
  const latest = latestRelationshipActivity(r);
  return (
    <section className="rw-activity">
      <h3>Activity</h3>
      {latest ? (
        <p>
          Latest observed {channelLabels[latest.channel]} {latest.kind}: {when(latest.at)} ·{" "}
          {latest.scope}. Broader history is incomplete.
        </p>
      ) : (
        <p>Correspondence activity is unknown.</p>
      )}
      {entries.length ? (
        <ol>
          {entries.map((e) => (
            <li key={e.id}>
              <strong>{when(e.at)}</strong>
              <p>Saved tracker update · {e.changes.length} field changes</p>
            </li>
          ))}
        </ol>
      ) : (
        <p>No saved tracker edit history is available in this record.</p>
      )}
    </section>
  );
}
function SuppliedConversation({ record: r }: { record: EvidenceRecord }) {
  const events = [...conversationEvents(r)].reverse();
  const prepared = r.review?.prepared_message;
  return (
    <section className="rw-conversation">
      <p className="rw-coverage">Supplied evidence only · not a complete interaction history.</p>
      <div className="rw-message-scroll">
        {events.length ? (
          events.map((event, i) => {
            const email = event.channel === "email" ? event.email : null;
            const linkedin = event.channel === "linkedin" ? event.linkedin : null;
            const outgoing =
              email?.message.type === "email_sent" || linkedin?.status === "sent_ui_verified";
            const source = safeRoadmapUrl(email?.message.source_url ?? linkedin?.profile_url);
            return (
              <article className={`rw-message ${outgoing ? "rw-outgoing" : "rw-incoming"}`} key={i}>
                <div className="rw-bubble">
                  <p className="rw-message-meta">
                    {email?.conflict
                      ? "Conflicting evidence · held"
                      : email?.message.type === "email_team_outbound_copy"
                        ? "Team outbound copy · account SENT unverified"
                        : outgoing
                          ? "Sent · delivery unconfirmed"
                          : "Received"}{" "}
                    · {channelLabels[event.channel]} · source coverage partial
                  </p>
                  <h3>{email?.message.subject ?? linkedin?.subject}</h3>
                  {email?.conflict ? (
                    <p>Conflicting message copies require review before display.</p>
                  ) : (
                    <pre>
                      {email
                        ? messagePlainText(email.message.body_exact, email.message.body_format)
                        : linkedin?.body}
                    </pre>
                  )}
                  <p>
                    {linkedin && linkedInApproximate(linkedin) ? "Approximately " : ""}
                    {when(event.at)}
                  </p>
                  {source ? (
                    <a
                      href={source}
                      target="_blank"
                      rel="noopener noreferrer"
                      referrerPolicy="no-referrer"
                    >
                      Open original source
                    </a>
                  ) : null}
                </div>
              </article>
            );
          })
        ) : (
          <div className="rw-empty">
            <h3>No approved conversation loaded</h3>
            <p>
              {r.native
                ? "A supported authenticated conversation reader is not connected to this preview."
                : "Canonical identity binding is required before reading imported messages."}
            </p>
          </div>
        )}
        {prepared ? (
          <section className="rw-prepared">
            <h3>Prepared copy · separate from sent history</h3>
            <p>
              Historical prepared text at this review snapshot. This is not a current draft or a
              send receipt; later channel activity may supersede it.
            </p>
            <h4>{prepared.subject}</h4>
            <pre>{prepared.body_markdown_exact}</pre>
          </section>
        ) : null}
      </div>
    </section>
  );
}
