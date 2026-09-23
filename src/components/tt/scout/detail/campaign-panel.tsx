import { useState } from "react";
import { Link } from "@tanstack/react-router";

import { workEmailState, type ScoutPerson } from "@/domain/scout-people";
import {
  CAMPAIGN_PLACEHOLDERS,
  QUEUE_LABEL,
  campaignKey,
  dedupeRecipients,
  queueStateFor,
  recipientEligibility,
  renderTemplate,
  type CampaignRecipientInput,
  type QueueState,
} from "@/domain/scout-campaign";

export interface PreparedResult {
  relationshipId: string | null;
  draftId: string | null;
  reviewState: string | null;
  because?: string;
}

interface QueueRow {
  person: ScoutPerson;
  state: QueueState;
  note?: string;
  relationshipId?: string | null;
}

function toRecipient(p: ScoutPerson, company: string, now: string, accepted: boolean): CampaignRecipientInput {
  return {
    personId: p.persistedId ?? null,
    fullName: p.fullName,
    title: p.title ?? null,
    company,
    workEmail: p.workEmail ?? null,
    emailState: workEmailState(p, now),
    acceptedUnverified: accepted,
  };
}

/**
 * Outreach campaign for one Scout company. Prepares one Comms draft per chosen
 * saved person through the normal handoff. It never sends: each draft waits in
 * the queue for review and a person's own approval in Comms.
 */
export function CampaignPanel(props: {
  people: ScoutPerson[];
  companyName: string;
  prospectId: string;
  onPrepare: (person: ScoutPerson, template: { subject: string; body: string; campaignKey: string }) => Promise<PreparedResult>;
  onSaveRecord: (input: {
    campaignKey: string;
    name: string;
    subject: string;
    body: string;
    recipients: { scoutPersonId: string; relationshipId: string | null; draftId: string | null; blockedReason: string | null }[];
  }) => Promise<{ stored: boolean; because?: string }>;
}) {
  const now = new Date().toISOString();
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("Quick question, {first_name}");
  const [body, setBody] = useState("Hi {first_name},\n\nAs {title} at {company}, …\n\nTai");
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [recordNote, setRecordNote] = useState<string | null>(null);

  const rows = props.people.map((p) => {
    const r = toRecipient(p, props.companyName, now, accepted[p.key] === true);
    return { p, r, eligibility: recipientEligibility(r) };
  });

  async function prepare() {
    if (!name.trim()) return;
    setBusy(true);
    setRecordNote(null);
    const key = campaignKey(props.prospectId, name);
    const picked = rows.filter((x) => chosen[x.p.key]);
    const unique = new Set(dedupeRecipients(picked.map((x) => x.r)));
    const next: QueueRow[] = [];
    const record: { scoutPersonId: string; relationshipId: string | null; draftId: string | null; blockedReason: string | null }[] = [];
    for (const x of picked) {
      if (!unique.has(x.r)) continue;
      if (!x.eligibility.ok) {
        next.push({ person: x.p, state: "blocked", note: x.eligibility.because });
        continue;
      }
      const rendered = renderTemplate({ subject, body }, x.r);
      if (!rendered.ok) {
        next.push({ person: x.p, state: "blocked", note: rendered.because });
        record.push({ scoutPersonId: x.r.personId!, relationshipId: null, draftId: null, blockedReason: rendered.because });
        continue;
      }
      next.push({ person: x.p, state: "drafting" });
      setQueue([...next]);
      try {
        const result = await props.onPrepare(x.p, { subject: rendered.subject, body: rendered.body, campaignKey: key });
        next[next.length - 1] = {
          person: x.p,
          state: result.draftId ? queueStateFor(result.reviewState) : "failed",
          relationshipId: result.relationshipId,
          ...(result.because ? { note: result.because } : {}),
        };
        record.push({ scoutPersonId: x.r.personId!, relationshipId: result.relationshipId, draftId: result.draftId, blockedReason: null });
      } catch (error) {
        next[next.length - 1] = { person: x.p, state: "failed", note: error instanceof Error ? error.message : "Could not prepare." };
      }
    }
    setQueue(next);
    const saved = await props.onSaveRecord({ campaignKey: key, name: name.trim(), subject, body, recipients: record });
    setRecordNote(saved.stored ? "Campaign saved." : saved.because ?? null);
    setBusy(false);
  }

  const anyChosen = rows.some((x) => chosen[x.p.key]);

  return (
    <section className="rounded-2xl border border-border bg-card p-5 space-y-4" aria-labelledby="campaign-title">
      <div>
        <h2 id="campaign-title" className="text-base font-semibold text-foreground">Outreach campaign</h2>
        <p className="text-sm text-muted-foreground">
          One template, one Comms draft per person. Nothing is sent until you approve each draft in Comms.
        </p>
      </div>

      <div className="grid gap-3">
        <label className="text-sm text-foreground">
          Campaign name
          <input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q4 introduction" />
        </label>
        <label className="text-sm text-foreground">
          Subject
          <input className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="text-sm text-foreground">
          Message
          <textarea rows={6} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <p className="text-xs text-muted-foreground">
          Placeholders: {CAMPAIGN_PLACEHOLDERS.map((p) => `{${p}}`).join(" ")}. A placeholder that can't be filled blocks that draft.
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">Recipients</legend>
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No saved people yet. Find people first.</p>}
        {rows.map(({ p, r, eligibility }) => (
          <div key={p.key} className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={chosen[p.key] === true} onChange={(e) => setChosen({ ...chosen, [p.key]: e.target.checked })} />
              <span className="text-foreground">{p.fullName}</span>
              <span className="text-muted-foreground">{p.title ?? "Title not recorded"}</span>
            </label>
            <span className="text-xs text-muted-foreground">
              {r.workEmail ?? "No work email"}
              {eligibility.ok ? " · Ready" : ` · ${eligibility.because}`}
            </span>
            {r.emailState === "found_unverified" && (
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input type="checkbox" checked={accepted[p.key] === true} onChange={(e) => setAccepted({ ...accepted, [p.key]: e.target.checked })} />
                I accept this unverified address
              </label>
            )}
          </div>
        ))}
      </fieldset>

      <button
        type="button"
        disabled={busy || !anyChosen || !name.trim()}
        onClick={() => void prepare()}
        className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {busy ? "Preparing drafts…" : "Prepare drafts"}
      </button>

      {queue.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">Send queue</h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {queue.map((q) => (
              <li key={q.person.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="text-foreground">{q.person.fullName}</span>
                <span className="text-xs text-muted-foreground">
                  {QUEUE_LABEL[q.state]}
                  {q.note ? ` · ${q.note}` : ""}
                </span>
                {q.relationshipId && (
                  <Link to="/modules/comms/relationships/$relationshipId" params={{ relationshipId: q.relationshipId }} className="text-xs text-primary underline">
                    Review and approve in Comms
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {recordNote && <p className="text-xs text-muted-foreground">{recordNote}</p>}
    </section>
  );
}
