import { useEffect, useMemo, useState } from "react";
import type { Correspondence, CorrespondenceReader } from "@/domain/roadmap-correspondence";
const channels = {
  email: "Email",
  linkedin: "LinkedIn",
  linkedin_sales_navigator: "Sales Navigator",
};
const kinds = {
  sent: "Sent · delivery unconfirmed",
  received: "Received",
  draft: "Draft · unsent",
  bounce: "Bounced · delivery failed",
  team_outbound_copy: "Team outbound copy · account SENT unverified",
};
const identity = (e: Correspondence) =>
  JSON.stringify([e.channel, e.sourceAccountRef, e.sourceEventId]);
const date = (s: string) => new Date(s).toLocaleString("en-US", { timeZone: "UTC" }) + " UTC";
export function CanonicalConversation({
  organizationId,
  roadmapId,
  read,
}: {
  organizationId: string;
  roadmapId: string;
  read: CorrespondenceReader;
}) {
  const scope = `${organizationId}:${roadmapId}`;
  const [state, setState] = useState<{
    scope: string;
    events: Correspondence[];
    cursor: string | null;
    loading: boolean;
    error: boolean;
  }>({ scope, events: [], cursor: null, loading: true, error: false });
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState(0);
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState("all");
  useEffect(() => {
    let active = true;
    setState({ scope, events: [], cursor: null, loading: true, error: false });
    read(organizationId, roadmapId).then(
      (page) => {
        if (active)
          setState({
            scope,
            events: page.events,
            cursor: page.nextCursor,
            loading: false,
            error: false,
          });
      },
      () => {
        if (active) setState({ scope, events: [], cursor: null, loading: false, error: true });
      },
    );
    return () => {
      active = false;
    };
  }, [scope, organizationId, roadmapId, read, attempt]);
  useEffect(() => {
    if (!load || state.scope !== scope || !state.cursor || state.loading) return;
    let active = true;
    const cursor = state.cursor;
    setState((s) => ({ ...s, loading: true }));
    read(organizationId, roadmapId, cursor).then(
      (page) => {
        if (!active) return;
        setState((s) => {
          const rows = new Map(s.events.map((e) => [identity(e), e]));
          for (const e of page.events) {
            const existing = rows.get(identity(e));
            if (existing && JSON.stringify(existing) !== JSON.stringify(e))
              return { scope, events: [], cursor: null, loading: false, error: true };
            rows.set(identity(e), e);
          }
          if (page.nextCursor === cursor)
            return { scope, events: [], cursor: null, loading: false, error: true };
          return {
            scope,
            events: [...rows.values()],
            cursor: page.nextCursor,
            loading: false,
            error: false,
          };
        });
      },
      () => {
        if (active) setState({ scope, events: [], cursor: null, loading: false, error: true });
      },
    );
    return () => {
      active = false;
    };
    // Each explicit load action captures one cursor; resets are handled by the scope effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, scope, read, attempt, organizationId, roadmapId]);
  const events = useMemo(
    () => (state.scope === scope ? state.events : []),
    [state.scope, state.events, scope],
  );
  const visible = useMemo(
    () =>
      events
        .filter(
          (e) =>
            (channel === "all" ||
              (channel === "draft" ? e.kind === "draft" : e.channel === channel)) &&
            `${e.subject} ${e.bodyText}`.toLowerCase().includes(query.toLowerCase()),
        )
        .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)),
    [events, channel, query],
  );
  const latest = [...events].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))[0];
  return (
    <section
      className="rm-conversation rm-reviewed-conversation"
      aria-label="Reviewed team conversation"
    >
      <header>
        <h2>The conversation</h2>
        <p>Reviewed roadmap correspondence · partial source coverage</p>
      </header>
      <p className="rm-small">
        Only approved imports appear here. Missing evidence does not mean no conversation happened.
        Drafts are unsent; a sent message does not establish delivery or a sale.
      </p>
      {state.error ? (
        <div className="rm-empty" role="alert">
          Reviewed conversations are unavailable. Previous message text has been cleared.
          <button
            className="rm-button"
            onClick={() => {
              setLoad(0);
              setAttempt((n) => n + 1);
            }}
          >
            Retry conversations
          </button>
        </div>
      ) : (
        <>
          <div className="rm-conversation-tabs">
            <input
              aria-label="Search reviewed conversation"
              placeholder="Search loaded messages…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label="Conversation channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
            >
              <option value="all">All channels</option>
              {Object.entries(channels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
              <option value="draft">Unsent drafts</option>
            </select>
          </div>
          {latest && (
            <p className="rm-small">
              Latest activity among loaded messages: {channels[latest.channel]} ·{" "}
              {date(latest.occurredAt)}
              {latest.timestampPrecision === "approximate" ? " (approximate)" : ""}.{" "}
              {state.cursor
                ? "More imported messages remain to load."
                : "Broader source history may be incomplete."}
            </p>
          )}
          <div className="rm-timeline">
            {visible.map((e) => (
              <article className="rm-event" key={identity(e)}>
                <div className="rm-event-header">
                  <strong>
                    {channels[e.channel]} · {kinds[e.kind]}
                  </strong>
                  <time dateTime={e.occurredAt}>
                    {e.timestampPrecision === "approximate" ? "Approximately " : ""}
                    {date(e.occurredAt)}
                  </time>
                </div>
                <div className="rm-event-body">
                  <h3>{e.subject || "No subject"}</h3>
                  <p className="rm-small">
                    {e.bodyRepresentation === "reviewed_redacted_excerpt"
                      ? "Reviewed excerpt · redactions or quoted-history removal; not the complete original"
                      : "Reviewed full message text"}
                  </p>
                  <details>
                    <summary>Expand full reviewed message</summary>
                    <pre>{e.bodyText}</pre>
                  </details>
                  <p className="rm-small">
                    {e.identityKind === "provider_id"
                      ? "Provider event"
                      : "Reviewed source receipt"}
                    : {e.sourceEventId}
                  </p>
                  <p className="rm-small">
                    Source verified {date(e.verifiedAt)} · reviewed {date(e.review.reviewedAt)}
                  </p>
                  <a
                    className="rm-source"
                    href={e.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                  >
                    Open original source
                  </a>
                </div>
              </article>
            ))}
            {!visible.length && !state.loading && (
              <div className="rm-empty">
                <h3>
                  {events.length
                    ? "No matching loaded messages"
                    : "No approved messages imported yet"}
                </h3>
                <p>
                  {events.length
                    ? "Change the filter, search phrase or load more messages."
                    : "Source history remains unknown. Existing emails and LinkedIn conversations have not been imported into this view."}
                </p>
              </div>
            )}
          </div>
          {(state.loading || state.scope !== scope) && (
            <p role="status">Reading reviewed conversations…</p>
          )}
          {state.cursor && (
            <button
              className="rm-button"
              disabled={state.loading}
              onClick={() => setLoad((n) => n + 1)}
            >
              Load more reviewed messages
            </button>
          )}
        </>
      )}
    </section>
  );
}
