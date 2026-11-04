import { useEffect, useRef, useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import {
  correspondencePageSchema,
  type Correspondence,
  type CorrespondenceReader,
} from "@/domain/roadmap-correspondence";
import { channelLabels } from "@/domain/roadmap-relationship-workspace";

export interface LoadedConversationPreview {
  organizationId: string;
  roadmapId: string;
  subject: string;
  text: string;
  at: string;
}
const key = (e: Correspondence) => JSON.stringify([e.channel, e.sourceAccountRef, e.sourceEventId]);
const day = (s: string) =>
  new Date(s).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
const time = (s: string) =>
  new Date(s).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }) +
  " UTC";
const labels = {
  sent: "Sent · delivery unconfirmed",
  received: "Received",
  draft: "Draft · unsent",
  bounce: "Bounced · delivery failed",
  team_outbound_copy: "Team outbound copy · account SENT unverified",
};
export function RelationshipConversation({
  organizationId,
  roadmapId,
  relationshipId,
  read,
  onPreview,
}: {
  organizationId: string;
  roadmapId: string;
  relationshipId?: string;
  read: CorrespondenceReader;
  onPreview?: (preview: LoadedConversationPreview | null, roadmapId: string) => void;
}) {
  const scope = `${organizationId}:${roadmapId}:${relationshipId ?? ""}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const requestEpoch = useRef(0);
  const [state, setState] = useState<{
    scope: string;
    events: Correspondence[];
    cursor: string | null;
    loading: boolean;
    error: boolean;
  }>({ scope, events: [], cursor: null, loading: true, error: false });
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState("all");
  const notify = useRef(onPreview);
  notify.current = onPreview;
  function validate(input: unknown) {
    const p = correspondencePageSchema.parse(input);
    if (
      p.organizationId !== organizationId ||
      p.roadmapId !== roadmapId ||
      (relationshipId && p.relationshipId !== relationshipId) ||
      p.events.some(
        (e) =>
          e.organizationId !== organizationId ||
          e.roadmapId !== roadmapId ||
          (relationshipId && e.relationshipId !== relationshipId),
      )
    )
      throw new Error("Conversation scope changed");
    return p;
  }
  useEffect(() => {
    let active = true;
    requestEpoch.current += 1;
    setState({ scope, events: [], cursor: null, loading: true, error: false });
    setQuery("");
    setChannel("all");
    notify.current?.(null, roadmapId);
    read(organizationId, roadmapId)
      .then((input) => {
        if (!active || currentScope.current !== scope) return;
        const p = validate(input);
        const seen = new Map<string, Correspondence>();
        for (const e of p.events) {
          const old = seen.get(key(e));
          if (old && JSON.stringify(old) !== JSON.stringify(e))
            throw new Error("Conflicting event");
          seen.set(key(e), e);
        }
        const rows = [...seen.values()];
        setState({ scope, events: rows, cursor: p.nextCursor, loading: false, error: false });
        const latest = [...rows]
          .filter((e) => e.kind !== "draft")
          .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))[0];
        if (latest)
          notify.current?.(
            {
              organizationId,
              roadmapId,
              subject: latest.subject,
              text: latest.bodyText.replace(/\s+/g, " ").slice(0, 180),
              at: latest.occurredAt,
            },
            roadmapId,
          );
      })
      .catch(() => {
        if (active && currentScope.current === scope) {
          setState({ scope, events: [], cursor: null, loading: false, error: true });
          notify.current?.(null, roadmapId);
        }
      });
    return () => {
      active = false;
      requestEpoch.current += 1;
    };
    // The read contract and all selected-scope values are dependencies; page validation uses that same scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, organizationId, roadmapId, relationshipId, read, attempt]);
  async function loadMore() {
    if (state.scope !== scope || !state.cursor || state.loading || state.error) return;
    const cursor = state.cursor;
    const epoch = requestEpoch.current;
    setState((s) => ({ ...s, loading: true }));
    try {
      const p = validate(await read(organizationId, roadmapId, cursor));
      if (currentScope.current !== scope || epoch !== requestEpoch.current) return;
      if (p.nextCursor === cursor) throw new Error("Pagination did not advance");
      const rows = new Map(state.events.map((e) => [key(e), e]));
      for (const e of p.events) {
        const old = rows.get(key(e));
        if (old && JSON.stringify(old) !== JSON.stringify(e)) throw new Error("Conflicting event");
        rows.set(key(e), e);
      }
      setState({
        scope,
        events: [...rows.values()],
        cursor: p.nextCursor,
        loading: false,
        error: false,
      });
    } catch {
      if (currentScope.current === scope && epoch === requestEpoch.current) {
        setState({ scope, events: [], cursor: null, loading: false, error: true });
        notify.current?.(null, roadmapId);
      }
    }
  }
  const scoped = state.scope === scope;
  const events = scoped ? state.events : [];
  const visible = events
    .filter(
      (e) =>
        (channel === "all" || (channel === "draft" ? e.kind === "draft" : e.channel === channel)) &&
        `${e.subject} ${e.bodyText}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort(
      (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || key(a).localeCompare(key(b)),
    );
  const messages = visible.filter((e) => e.kind !== "draft"),
    drafts = visible.filter((e) => e.kind === "draft");
  let previousDay = "";
  return (
    <section className="rw-conversation" aria-label="Reviewed team conversation">
      <div className="rw-message-tools">
        <label>
          <Search size={14} />
          <input
            aria-label="Search loaded messages"
            placeholder="Search loaded messages…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="Conversation channel"
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
        >
          <option value="all">All channels</option>
          {Object.entries(channelLabels).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
          <option value="draft">Unsent prepared copy</option>
        </select>
      </div>
      <p className="rw-coverage">
        Approved imported history · search covers loaded messages only.{" "}
        {state.cursor
          ? "More imported messages remain to load."
          : "Broader source history may be incomplete."}
      </p>
      <div className="rw-message-scroll" aria-live="polite">
        {!scoped || (state.loading && !events.length) ? (
          <p role="status" className="rw-empty">
            Reading reviewed conversations…
          </p>
        ) : null}
        {scoped && state.error ? (
          <div className="rw-empty" role="alert">
            <h3>Conversation unavailable</h3>
            <p>Previous text has been cleared. Check your current access and try again.</p>
            <button onClick={() => setAttempt((n) => n + 1)}>Retry conversations</button>
          </div>
        ) : null}
        {!state.error &&
          messages.map((e) => {
            const date = day(e.occurredAt),
              divider = date !== previousDay;
            previousDay = date;
            return (
              <div key={key(e)}>
                {divider ? (
                  <div className="rw-date-divider">
                    <span>{date}</span>
                  </div>
                ) : null}
                <MessageBubble event={e} />
              </div>
            );
          })}
        {drafts.length ? (
          <section className="rw-prepared">
            <h3>Unsent prepared copy</h3>
            <p>These records are drafts, not sent interactions.</p>
            {drafts.map((e) => (
              <MessageBubble key={key(e)} event={e} />
            ))}
          </section>
        ) : null}
        {scoped && !state.error && !state.loading && !visible.length ? (
          <div className="rw-empty">
            <h3>
              {events.length ? "No matching loaded messages" : "No approved messages imported yet"}
            </h3>
            <p>
              {events.length
                ? "Change the search, channel or load more imported messages."
                : "Source history remains unknown. Missing evidence does not establish that no outreach happened."}
            </p>
          </div>
        ) : null}
        {scoped && state.cursor && !state.error ? (
          <button className="rw-load-more" disabled={state.loading} onClick={() => void loadMore()}>
            {state.loading ? "Reading…" : "Load more imported messages"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
function MessageBubble({ event: e }: { event: Correspondence }) {
  const outgoing = e.kind === "sent";
  return (
    <article
      className={`rw-message ${outgoing ? "rw-outgoing" : "rw-incoming"} ${e.kind === "bounce" ? "rw-bounce" : ""}`}
    >
      <div className="rw-message-avatar" aria-hidden>
        {outgoing ? "↗" : e.kind === "bounce" ? "!" : "↙"}
      </div>
      <div className="rw-bubble">
        <p className="rw-message-meta">
          {outgoing
            ? "Outbound correspondence"
            : e.kind === "received"
              ? "Correspondent"
              : "Source event"}{" "}
          · {channelLabels[e.channel]} · {labels[e.kind]}
        </p>
        <h3>{e.subject || "No subject"}</h3>
        <pre>{e.bodyText}</pre>
        <footer>
          <time dateTime={e.occurredAt}>
            {e.timestampPrecision === "approximate" ? "Approximately " : ""}
            {time(e.occurredAt)}
          </time>
          <a
            href={e.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            aria-label={`Open original source for ${e.subject || "message"}`}
          >
            <ExternalLink size={12} />
            Source
          </a>
        </footer>
        <details>
          <summary>Message evidence</summary>
          <p>
            {e.bodyRepresentation === "reviewed_redacted_excerpt"
              ? "Reviewed excerpt; redactions or quoted-history removal. Not the complete original."
              : "Reviewed full text; provider-original formatting may differ."}
          </p>
          <p>
            {e.identityKind === "provider_id" ? "Provider event" : "Reviewed source receipt"}:{" "}
            {e.sourceEventId}
          </p>
          <p>
            Verified {day(e.verifiedAt)} · reviewed {day(e.review.reviewedAt)}
          </p>
        </details>
      </div>
    </article>
  );
}
