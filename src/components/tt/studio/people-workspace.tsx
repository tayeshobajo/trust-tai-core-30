import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Users,
  ExternalLink,
  MessageSquare,
  BookOpen,
  Copy,
  Check,
  ShieldCheck,
} from "lucide-react";
import { StudioShell, StudioState } from "./studio-shell";
import { listOrganizationContacts } from "@/data/supabase/contacts";
import { CONFIDENCE_LABEL, SENIORITY_LABEL, type Person } from "@/domain/people";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { WorkspaceIdentity } from "@/lib/workspace";
function profileUrl(raw: string | undefined) {
  try {
    const u = new URL(raw ?? "");
    return ["https:", "http:"].includes(u.protocol) &&
      (u.hostname === "linkedin.com" || u.hostname.endsWith(".linkedin.com"))
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function PeopleWorkspace({ identity }: { identity: WorkspaceIdentity }) {
  const canRead = identity.apps.some((a) => a.appId === "scout" || a.appId === "clients");
  const q = useQuery({
    queryKey: ["studio-workspace", "people", identity.organizationId],
    queryFn: () => listOrganizationContacts(identity.organizationId),
    enabled: canRead,
    retry: false,
  });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [intro, setIntro] = useState<Person | null>(null);
  const [reason, setReason] = useState("");
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  const rows = (q.data ?? [])
    .filter((p) =>
      `${p.fullName} ${p.roleTitle ?? ""} ${p.note ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .filter(
      (p) =>
        filter === "all" ||
        (filter === "linkedin" ? Boolean(profileUrl(p.linkedinUrl)) : p.seniority === filter),
    );
  const selected = rows.find((p) => p.id === selectedId) ?? rows[0] ?? null;
  function openIntro(person: Person) {
    setIntro(person);
    setReason("");
    setDraft("");
    setMessage("");
  }
  return (
    <StudioShell
      identity={identity}
      section="People"
      description="Find the people already in your world. Start with a real reason to connect."
      search={search}
      onSearch={setSearch}
      searchLabel="Search workspace people"
      action={
        <Link className="sv-button" to="/modules/studio/audience">
          Newsletter audience
          <ArrowRight />
        </Link>
      }
    >
      <div className="sw-people-layout">
        <div>
          <section className="sw-people-banner">
            <span className="sw-line-icon">
              <Users />
            </span>
            <div>
              <span className="sw-kicker">PEOPLE IN YOUR WORLD</span>
              <h2>Good conversations start with people.</h2>
              <p>
                Browse existing workspace contacts by name or role. No LinkedIn activity is scraped
                and no match score is invented.
              </p>
            </div>
          </section>
          <div className="sw-toolbar">
            <div className="sw-filter">
              {[
                ["all", "All people"],
                ["founder", "Founders"],
                ["operations", "Operations"],
                ["linkedin", "With LinkedIn"],
              ].map(([id, name]) => (
                <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id!)}>
                  {name}
                </button>
              ))}
            </div>
          </div>
          {!canRead ? (
            <StudioState title="Your contact directory stays protected">
              Your current app access does not include Scout or Clients. The newsletter audience
              remains available through the existing Studio reader.
            </StudioState>
          ) : q.isPending ? (
            <StudioState title="Reading workspace people…" />
          ) : q.isError ? (
            <StudioState title="People could not be read" onRetry={() => void q.refetch()}>
              {q.error.message}
            </StudioState>
          ) : !rows.length ? (
            <StudioState
              title={
                search || filter !== "all"
                  ? "No people match this view"
                  : "Your workspace contact list is empty"
              }
            >
              People already recorded in Scout and Clients can appear here. External discovery by
              themes or geography is not connected.
            </StudioState>
          ) : (
            <div className="sw-person-list">
              {rows.map((person) => (
                <article
                  key={person.id}
                  className={`sv-card sw-person-row ${selected?.id === person.id ? "is-selected" : ""}`}
                >
                  <button
                    className="sw-person-select"
                    onClick={() => setSelectedId(person.id)}
                    aria-pressed={selected?.id === person.id}
                  >
                    <span className="sw-avatar">
                      {person.fullName
                        .split(/\s/)
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join("")}
                    </span>
                    <span>
                      <strong>{person.fullName}</strong>
                      <span>{person.roleTitle || "Role not recorded"}</span>
                      <small>{SENIORITY_LABEL[person.seniority]} · Workspace contact</small>
                    </span>
                  </button>
                  <div className="sw-person-actions">
                    {profileUrl(person.linkedinUrl) && (
                      <a
                        className="sv-button"
                        href={profileUrl(person.linkedinUrl)!}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View LinkedIn
                        <ExternalLink />
                      </a>
                    )}
                    <button className="sv-button sw-intro-button" onClick={() => openIntro(person)}>
                      <MessageSquare />
                      Draft intro
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          <p className="sw-quiet-note">
            {q.isSuccess ? `${q.data.length} records returned by the shared contact reader. ` : ""}
            This is not a curated match list. Search and filters apply only to returned records.
          </p>
        </div>
        <aside className="sw-person-aside">
          {selected ? (
            <section className="sv-card">
              <span className="sw-kicker">
                <BookOpen />
                ON RECORD
              </span>
              <div className="sw-person-heading">
                <span className="sw-avatar">
                  {selected.fullName
                    .split(/\s/)
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")}
                </span>
                <div>
                  <h2>{selected.fullName}</h2>
                  <p>{selected.roleTitle || "Role not recorded"}</p>
                </div>
              </div>
              <h3>What we actually know</h3>
              <dl>
                <div>
                  <dt>Role</dt>
                  <dd>{SENIORITY_LABEL[selected.seniority]}</dd>
                </div>
                <div>
                  <dt>Record confidence</dt>
                  <dd>{CONFIDENCE_LABEL[selected.confidence]}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{selected.sourceId || "Not recorded"}</dd>
                </div>
                <div>
                  <dt>LinkedIn</dt>
                  <dd>
                    {profileUrl(selected.linkedinUrl)
                      ? selected.linkedinConfirmed
                        ? "Confirmed profile link"
                        : "Stored link, not confirmed"
                      : "No profile link on record"}
                  </dd>
                </div>
              </dl>
              {selected.note && (
                <>
                  <h3>Saved context</h3>
                  <p className="sw-person-note">{selected.note}</p>
                </>
              )}
              <h3>A useful first conversation</h3>
              <p>
                Start with something you’ve genuinely noticed or a question you can explain. Add
                that context yourself before using an introduction.
              </p>
              <button className="sv-button sv-primary" onClick={() => openIntro(selected)}>
                <MessageSquare />
                Draft an introduction
              </button>
            </section>
          ) : (
            <section className="sv-card">
              <Users />
              <h2>People, with context.</h2>
              <p>
                Choose a workspace contact to see the role, source, and context already on record.
              </p>
            </section>
          )}
          <section className="sv-card sw-learning-note">
            <ShieldCheck />
            <span className="sw-kicker">NASHVILLE-FIRST DISCOVERY</span>
            <h2>Find people who share your world.</h2>
            <p>
              LinkedIn theme matching and Nashville-area recommendations are not connected. Local
              suggestions need a source with verified location and interest data. Recent-post
              retrieval and sending introductions are also unavailable.
            </p>
            <Link className="sw-text-button" to="/modules/studio/audience">
              View the newsletter audience
              <ArrowRight />
            </Link>
          </section>
        </aside>
      </div>
      <Dialog
        open={Boolean(intro)}
        onOpenChange={(o) => {
          if (!o) setIntro(null);
        }}
      >
        <DialogContent className="sv-dialog">
          <DialogHeader>
            <DialogTitle>Draft an introduction to {intro?.fullName}</DialogTitle>
            <DialogDescription>
              A local writing template. Nothing is saved, sent, or based on fetched social activity.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setDraft(
                `Hi ${intro?.fullName.split(" ")[0]},\n\n${reason.trim()}\n\nIf this is relevant to your work, I’d welcome a conversation.\n\nTrust,\n${identity.name}`,
              );
            }}
          >
            <label>
              Your real reason for connecting
              <textarea
                required
                rows={4}
                value={reason}
                maxLength={4000}
                onChange={(e) => setReason(e.target.value)}
                aria-label="Your real reason for connecting"
                placeholder="What would make this conversation useful to both of you?"
              />
            </label>
            <button className="sv-button sv-primary" disabled={!reason.trim()}>
              Prepare a draft
            </button>
          </form>
          {draft && (
            <>
              <label>
                Introduction draft
                <textarea
                  aria-label="Introduction draft"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={8}
                />
              </label>
              <button
                className="sv-button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(draft);
                    setMessage(
                      "Copied. Review the recipient and wording before using it elsewhere.",
                    );
                  } catch {
                    setMessage("Copy was unavailable. Select and copy the draft text manually.");
                  }
                }}
              >
                <Copy />
                Copy draft
              </button>
              {message && (
                <p role="status" className="sw-quiet-note">
                  {message}
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </StudioShell>
  );
}
