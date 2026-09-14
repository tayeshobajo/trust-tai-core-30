/**
 * Scout Outreach: found by Scout, written in your voice, sent by your hand.
 *
 * Three columns. Ready prospects get a draft made from a human-authored
 * template; the draft lands in `comms_drafts` as `needs_human_review` exactly
 * like the agent seam (scout.draft-intro.ts), but here it is inserted by the
 * signed-in person through the browser client, so RLS applies as them.
 * Approve & send is the ONLY send trigger, and it reuses the same
 * `comms-send` edge function call path the Comms queue uses.
 */

import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/tt/app-shell";
import { PageHeader, TTButton, TonePill } from "@/components/tt/primitives";
import { ScoutTabs } from "@/components/tt/scout-tabs";
import { TTSelect } from "@/components/tt/settings/pieces";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import {
  listScoutIntroTemplates,
  type ScoutIntroTemplate,
} from "@/data/supabase/scout-intro-templates";
import { listActivityTargets } from "@/data/supabase/activity-targets";
import { checkVoice } from "@/data/voice-policy";
import { supabase } from "@/integrations/trust-tai/supabase";
import { cn } from "@/lib/utils";
import type { WorkspaceIdentity } from "@/lib/workspace";

const TITLE = "Outreach · Scout · Trust Tai OS";
const DESCRIPTION =
  "The Scout outreach pipeline: ready prospects, intro drafts awaiting approval, and sent intros.";

export const Route = createFileRoute("/modules/scout/outreach")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OutreachRoute,
});

function OutreachRoute() {
  return (
    <WorkspaceGate appId="scout">
      {(identity) => (
        <AppShell identity={identity}>
          <OutreachView identity={identity} />
        </AppShell>
      )}
    </WorkspaceGate>
  );
}

/* ------------------------------------------------------------------ data */

interface ProspectCard {
  id: string;
  company: string;
  domain: string;
  fitScore: number | null;
  fitReason: string | null;
}

interface DraftCardData {
  id: string;
  relationshipId: string;
  subject: string | null;
  body: string;
  templateName: string | null;
  recipient: string;
  company: string | null;
  email: string | null;
  createdAt: string;
}

interface SentCardData {
  id: string;
  recipient: string;
  company: string | null;
  email: string | null;
  sentAt: string | null;
  replied: boolean;
}

type Row = Record<string, unknown>;

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function toDomain(websiteUrl: unknown): string {
  return String(websiteUrl ?? "")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");
}

/** Prospects marked ready that do not already carry a live scout intro draft. */
async function fetchReady(organizationId: string): Promise<ProspectCard[]> {
  const { data, error } = await supabase
    .from("prospects")
    .select("id, company_name, website_url, fit_score, inferred, status")
    .eq("organization_id", organizationId)
    .eq("status", "ready_for_comms")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];

  // A prospect whose relationship already holds a scout intro draft (waiting,
  // approved, or sent) has left the ready column.
  const ids = rows.map((row) => String(row["id"]));
  const { data: rels } = await supabase
    .from("comms_relationships")
    .select("id, prospect_id")
    .eq("organization_id", organizationId)
    .in("prospect_id", ids);
  const relRows = (rels ?? []) as Row[];
  const relIds = relRows.map((rel) => String(rel["id"]));
  const drafted = new Set<string>();
  if (relIds.length > 0) {
    const { data: drafts } = await supabase
      .from("comms_drafts")
      .select("relationship_id")
      .eq("organization_id", organizationId)
      .eq("register", "scout_intro")
      .in("review_state", ["needs_human_review", "approved", "sending", "sent"])
      .in("relationship_id", relIds);
    const relToProspect = new Map(relRows.map((rel) => [String(rel["id"]), String(rel["prospect_id"])]));
    for (const draft of (drafts ?? []) as Row[]) {
      const prospect = relToProspect.get(String(draft["relationship_id"]));
      if (prospect) drafted.add(prospect);
    }
  }

  return rows
    .filter((row) => !drafted.has(String(row["id"])))
    .map((row) => {
      const inferred =
        row["inferred"] && typeof row["inferred"] === "object" ? (row["inferred"] as Row) : {};
      return {
        id: String(row["id"]),
        company: String(row["company_name"] ?? ""),
        domain: toDomain(row["website_url"]),
        fitScore: typeof row["fit_score"] === "number" ? row["fit_score"] : null,
        fitReason: str(inferred["why_it_fits"]),
      };
    });
}

async function fetchDrafts(organizationId: string): Promise<DraftCardData[]> {
  const { data, error } = await supabase
    .from("comms_drafts")
    .select("id, relationship_id, subject, body, rationale, created_at")
    .eq("organization_id", organizationId)
    .eq("register", "scout_intro")
    .eq("review_state", "needs_human_review")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];
  return withRelationships(organizationId, rows, (row, rel) => ({
    id: String(row["id"]),
    relationshipId: String(row["relationship_id"]),
    subject: str(row["subject"]),
    body: String(row["body"] ?? ""),
    templateName: str(
      ((row["rationale"] ?? {}) as Row)["template_name"],
    ),
    recipient: str(rel?.["full_name"]) ?? "Unknown",
    company: str(rel?.["company_name"]),
    email: str(rel?.["email"]),
    createdAt: String(row["created_at"] ?? ""),
  }));
}

async function withRelationships<T>(
  organizationId: string,
  rows: Row[],
  build: (row: Row, rel: Row | null) => T,
): Promise<T[]> {
  if (rows.length === 0) return [];
  const relIds = [...new Set(rows.map((row) => String(row["relationship_id"])))];
  const { data: rels } = await supabase
    .from("comms_relationships")
    .select("id, full_name, company_name, email")
    .eq("organization_id", organizationId)
    .in("id", relIds);
  const relMap = new Map(((rels ?? []) as Row[]).map((rel) => [String(rel["id"]), rel]));
  return rows.map((row) => build(row, relMap.get(String(row["relationship_id"])) ?? null));
}

/**
 * Sent intros: scout intro drafts the person approved and sent, with a
 * Replied chip only when an inbound message actually exists after the send.
 * No open tracking exists in this schema, so no Opened chip is shown.
 */
async function fetchSent(organizationId: string): Promise<SentCardData[]> {
  const { data, error } = await supabase
    .from("comms_drafts")
    .select("id, relationship_id, updated_at")
    .eq("organization_id", organizationId)
    .eq("register", "scout_intro")
    .eq("review_state", "sent")
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];

  const relIds = [...new Set(rows.map((row) => String(row["relationship_id"])))];
  const repliedRels = new Set<string>();
  const { data: inbound, error: inboundError } = await supabase
    .from("comms_messages")
    .select("relationship_id, occurred_at")
    .eq("organization_id", organizationId)
    .eq("direction", "inbound")
    .in("relationship_id", relIds);
  if (!inboundError) {
    const sentAtByRel = new Map(rows.map((row) => [String(row["relationship_id"]), String(row["updated_at"] ?? "")]));
    for (const message of (inbound ?? []) as Row[]) {
      const relId = String(message["relationship_id"]);
      const sentAt = sentAtByRel.get(relId);
      if (sentAt && String(message["occurred_at"] ?? "") > sentAt) repliedRels.add(relId);
    }
  }

  return withRelationships(organizationId, rows, (row, rel) => ({
    id: String(row["id"]),
    recipient: str(rel?.["full_name"]) ?? "Unknown",
    company: str(rel?.["company_name"]),
    email: str(rel?.["email"]),
    sentAt: str(row["updated_at"]),
    replied: repliedRels.has(String(row["relationship_id"])),
  }));
}

/**
 * Insert the intro draft the same way scout.draft-intro.ts does, as the
 * signed-in human through the browser client: find or create the prospect's
 * relationship, run the deterministic voice check, land the draft in
 * needs_human_review. Nothing here sends.
 */
async function draftIntro(input: {
  organizationId: string;
  userId: string;
  prospect: ProspectCard;
  template: ScoutIntroTemplate;
}): Promise<void> {
  const { organizationId, prospect, template } = input;

  const verdict = checkVoice(template.body, { register: "warm_intro" });
  if (!verdict.passes) {
    throw new Error(
      `The draft violates the voice policy: ${verdict.violations.map((violation) => violation.because).join("; ")}`,
    );
  }

  const { data: existingRel, error: relError } = await supabase
    .from("comms_relationships")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("prospect_id", prospect.id)
    .maybeSingle();
  if (relError) throw new Error(relError.message);

  let relationshipId = (existingRel as Row | null)?.["id"] as string | undefined;
  if (!relationshipId) {
    const { data: createdRel, error: createRelError } = await supabase
      .from("comms_relationships")
      .insert({
        organization_id: organizationId,
        prospect_id: prospect.id,
        full_name: prospect.company,
        company_name: prospect.company,
        source: "scout",
        stage: "ready_to_reach",
        next_action: `Review the Scout intro draft for ${prospect.company}.`,
        metadata: {
          scout_draft_intro: { prospect_id: prospect.id, created_by_user: input.userId },
        },
      })
      .select("id")
      .maybeSingle();
    if (createRelError) throw new Error(createRelError.message);
    if (!createdRel) throw new Error("Relationship insert returned no row.");
    relationshipId = String((createdRel as Row)["id"]);
  }

  const { error: draftError } = await supabase.from("comms_drafts").insert({
    organization_id: organizationId,
    relationship_id: relationshipId,
    intent: "introduce",
    register: "scout_intro",
    subject: template.subject,
    body: verdict.text,
    review_state: "needs_human_review",
    rationale: {
      source: "human_ui",
      template_id: template.id,
      template_name: template.name,
      prospect_id: prospect.id,
      drafted_by: input.userId,
      voice_checked: true,
      voice_flags: verdict.violations,
    },
  });
  if (draftError) throw new Error(draftError.message);
}

/* --------------------------------------------- send path (same as queue) */

async function approveDraft(draftId: string, subject: string, body: string): Promise<void> {
  const { error } = await supabase
    .from("comms_drafts")
    .update({ subject, body, review_state: "approved", updated_at: new Date().toISOString() })
    .eq("id", draftId);
  if (error) throw new Error(error.message);
}

async function rejectDraft(draftId: string): Promise<void> {
  const { error } = await supabase
    .from("comms_drafts")
    .update({ review_state: "discarded", updated_at: new Date().toISOString() })
    .eq("id", draftId);
  if (error) throw new Error(error.message);
}

async function reopenDraft(draftId: string): Promise<void> {
  await supabase
    .from("comms_drafts")
    .update({ review_state: "needs_human_review", updated_at: new Date().toISOString() })
    .eq("id", draftId)
    .eq("review_state", "approved");
}

/** The one governed send path, shared with Comms: the app's own send endpoint. */
async function sendDraft(draftId: string, organizationId: string): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated.");

  const res = await fetch("/api/public/comms/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ organizationId, draftId }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "That message was not sent.");
  }
}

/* -------------------------------------------------------------- the view */

function OutreachView({ identity }: { identity: WorkspaceIdentity }) {
  const queryClient = useQueryClient();
  const [templateId, setTemplateId] = useState<string | null>(null);

  const ready = useQuery({
    queryKey: ["scout", "outreach", "ready", identity.organizationId],
    queryFn: () => fetchReady(identity.organizationId),
  });
  const drafts = useQuery({
    queryKey: ["scout", "outreach", "drafts", identity.organizationId],
    queryFn: () => fetchDrafts(identity.organizationId),
    refetchInterval: 30_000,
  });
  const sent = useQuery({
    queryKey: ["scout", "outreach", "sent", identity.organizationId],
    queryFn: () => fetchSent(identity.organizationId),
  });
  const templates = useQuery({
    queryKey: ["scout", "outreach", "templates", identity.organizationId],
    queryFn: () => listScoutIntroTemplates(identity.organizationId),
  });
  const cap = useQuery({
    queryKey: ["scout", "outreach", "cap", identity.organizationId],
    queryFn: async () => {
      const targets = await listActivityTargets(identity.organizationId);
      return targets.find((target) => target.stream === "scout_intros") ?? null;
    },
  });

  const activeTemplates = (templates.data ?? []).filter((template) => template.active);
  const selectedTemplate =
    activeTemplates.find((template) => template.id === templateId) ?? activeTemplates[0] ?? null;

  const invalidateAll = () =>
    queryClient.invalidateQueries({ queryKey: ["scout", "outreach"] });

  const draft = useMutation({
    mutationFn: (prospect: ProspectCard) => {
      if (!selectedTemplate) throw new Error("No active template. Add one in Settings → Outcomes.");
      return draftIntro({
        organizationId: identity.organizationId,
        userId: identity.userId,
        prospect,
        template: selectedTemplate,
      });
    },
    onSuccess: async () => {
      toast.success("Draft created, waiting for your review");
      await invalidateAll();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const approveAndSend = useMutation({
    mutationFn: async (input: { id: string; subject: string; body: string }) => {
      await approveDraft(input.id, input.subject, input.body);
      await sendDraft(input.id, identity.organizationId);
    },
    onSuccess: async () => {
      toast.success("Sent");
      await invalidateAll();
    },
    onError: async (error: Error, input) => {
      toast.error(error.message);
      await reopenDraft(input.id);
      await invalidateAll();
    },
  });

  const reject = useMutation({
    mutationFn: rejectDraft,
    onSuccess: async () => {
      toast.success("Draft rejected");
      await invalidateAll();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const sentThisWeek = countSentThisWeek(sent.data ?? []);
  const weeklyCap = cap.data?.targetCount ?? null;

  return (
    <div className="space-y-8">
      <PageHeader
        appId="scout"
        eyebrow="Trust Tai OS / Scout"
        title="Outreach"
        supporting="Found by Scout. Written in your voice. Sent by your hand."
        action={
          weeklyCap !== null ? (
            <div className="rounded-full border border-border bg-card px-4 py-2">
              <p className="text-sm text-muted-foreground">
                This week:{" "}
                <span className="font-medium text-foreground">
                  {sentThisWeek} of {weeklyCap}
                </span>
              </p>
            </div>
          ) : undefined
        }
      />

      <ScoutTabs active="outreach" />

      <div className="grid gap-6 lg:grid-cols-3">
        <ReadyColumn
          prospects={ready.data ?? []}
          loading={ready.isLoading}
          error={ready.error as Error | null}
          templates={activeTemplates}
          selectedTemplateId={selectedTemplate?.id ?? null}
          onSelectTemplate={setTemplateId}
          onDraft={(prospect) => draft.mutate(prospect)}
          drafting={draft.isPending}
        />
        <ApprovalColumn
          drafts={drafts.data ?? []}
          loading={drafts.isLoading}
          error={drafts.error as Error | null}
          onApprove={(id, subject, body) => approveAndSend.mutate({ id, subject, body })}
          onReject={(id) => reject.mutate(id)}
          busy={approveAndSend.isPending || reject.isPending}
        />
        <SentColumn sent={sent.data ?? []} loading={sent.isLoading} error={sent.error as Error | null} />
      </div>
    </div>
  );
}

function countSentThisWeek(sent: SentCardData[]): number {
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day).toISOString();
  return sent.filter((item) => item.sentAt !== null && item.sentAt >= weekStart).length;
}

/* ------------------------------------------------------------ ready column */

function fitTone(score: number | null): "good" | "active" | "neutral" {
  if (score === null) return "neutral";
  if (score >= 80) return "good";
  if (score >= 60) return "active";
  return "neutral";
}

function fitLabel(score: number | null): string {
  if (score === null) return "Fit unknown";
  if (score >= 80) return "Strong fit";
  if (score >= 60) return "Good fit";
  return "Medium fit";
}

function ReadyColumn({
  prospects,
  loading,
  error,
  templates,
  selectedTemplateId,
  onSelectTemplate,
  onDraft,
  drafting,
}: {
  prospects: ProspectCard[];
  loading: boolean;
  error: Error | null;
  templates: ScoutIntroTemplate[];
  selectedTemplateId: string | null;
  onSelectTemplate: (id: string) => void;
  onDraft: (prospect: ProspectCard) => void;
  drafting: boolean;
}) {
  return (
    <section className="tt-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="tt-title-card text-base">Ready for intro</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {prospects.length}
        </span>
      </div>

      {templates.length > 1 ? (
        <label className="mb-4 block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Template</span>
          <TTSelect
            value={selectedTemplateId ?? ""}
            onChange={(event) => onSelectTemplate(event.target.value)}
            className="h-9"
          >
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </TTSelect>
        </label>
      ) : templates.length === 0 ? (
        <p className="mb-4 text-xs text-muted-foreground">
          No active intro template.{" "}
          <Link to="/settings/outcomes" className="underline">
            Add one in Settings → Outcomes
          </Link>
          .
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Loading prospects…</p>
      ) : prospects.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No prospects are marked ready for comms right now.
        </p>
      ) : (
        <div className="space-y-3">
          {prospects.map((prospect) => (
            <article
              key={prospect.id}
              className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-royal/25"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-medium text-foreground">{prospect.company}</h3>
                  {prospect.domain ? (
                    <p className="text-xs text-muted-foreground">{prospect.domain}</p>
                  ) : null}
                </div>
                <TonePill tone={fitTone(prospect.fitScore)} dot>
                  {fitLabel(prospect.fitScore)}
                </TonePill>
              </div>

              {prospect.fitReason ? (
                <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
                  {prospect.fitReason}
                </p>
              ) : null}

              <div className="mt-4">
                <TTButton
                  size="sm"
                  onClick={() => onDraft(prospect)}
                  disabled={drafting || templates.length === 0}
                >
                  Draft intro
                </TTButton>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

/* --------------------------------------------------------- approval column */

function ApprovalColumn({
  drafts,
  loading,
  error,
  onApprove,
  onReject,
  busy,
}: {
  drafts: DraftCardData[];
  loading: boolean;
  error: Error | null;
  onApprove: (id: string, subject: string, body: string) => void;
  onReject: (id: string) => void;
  busy: boolean;
}) {
  return (
    <section className="tt-surface p-5">
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <h2 className="tt-title-card text-base">Awaiting your approval</h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {drafts.length}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Approve is the send. Nothing leaves without you.
        </p>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Loading drafts…</p>
      ) : drafts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No drafts waiting on you.</p>
      ) : (
        <div className="space-y-4">
          {drafts.map((draft) => (
            <DraftCard
              key={draft.id}
              draft={draft}
              busy={busy}
              onApprove={(subject, body) => onApprove(draft.id, subject, body)}
              onReject={() => onReject(draft.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function DraftCard({
  draft,
  busy,
  onApprove,
  onReject,
}: {
  draft: DraftCardData;
  busy: boolean;
  onApprove: (subject: string, body: string) => void;
  onReject: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [body, setBody] = useState(draft.body);

  // The deterministic voice check, re-run client-side on every edit.
  const verdict = checkVoice(body, { register: "warm_intro" });

  return (
    <article className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            {draft.recipient}
            {draft.company && draft.company !== draft.recipient ? ` · ${draft.company}` : ""}
          </h3>
          <p className="text-xs text-muted-foreground">{draft.email ?? "No email on record"}</p>
        </div>
        {draft.templateName ? (
          <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
            {draft.templateName}
          </span>
        ) : null}
      </div>

      {editing ? (
        <div className="mt-4 space-y-3">
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            aria-label="Draft subject"
            className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground"
          />
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={6}
            aria-label="Draft body"
            className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground"
          />
          <div className="flex gap-2">
            <TTButton size="sm" onClick={() => setEditing(false)}>
              Done
            </TTButton>
            <TTButton
              size="sm"
              variant="quiet"
              onClick={() => {
                setSubject(draft.subject ?? "");
                setBody(draft.body);
                setEditing(false);
              }}
            >
              Cancel
            </TTButton>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-lg bg-studio-paper px-4 py-3">
          <p className="text-sm font-medium text-foreground">{subject || "(no subject)"}</p>
          <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
            {body}
          </p>
        </div>
      )}

      <div className="mt-3">
        {verdict.violations.length === 0 ? (
          <TonePill tone="good" dot>
            Voice check passed
          </TonePill>
        ) : (
          <TonePill tone={verdict.passes ? "caution" : "risk"} dot>
            {verdict.passes
              ? `Voice flags: ${verdict.violations.length}`
              : verdict.violations[0]!.because}
          </TonePill>
        )}
      </div>

      {!editing ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <TTButton
            size="sm"
            onClick={() => onApprove(subject, body)}
            disabled={busy || !verdict.passes || !draft.email}
            title={!draft.email ? "No email address on the relationship yet" : undefined}
          >
            Approve &amp; send
          </TTButton>
          <TTButton size="sm" variant="secondary" onClick={() => setEditing(true)} disabled={busy}>
            Edit
          </TTButton>
          <TTButton size="sm" variant="quiet" onClick={onReject} disabled={busy}>
            Reject
          </TTButton>
        </div>
      ) : null}
    </article>
  );
}

/* -------------------------------------------------------------- sent column */

function formatSentDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "Today";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function SentColumn({
  sent,
  loading,
  error,
}: {
  sent: SentCardData[];
  loading: boolean;
  error: Error | null;
}) {
  return (
    <section className="tt-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="tt-title-card text-base">Sent</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {sent.length}
        </span>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Loading sent intros…</p>
      ) : sent.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing sent yet.</p>
      ) : (
        <div className="space-y-3">
          {sent.map((item) => (
            <article
              key={item.id}
              className={cn(
                "rounded-xl border p-4",
                item.replied ? "border-royal/30 bg-royal-wash" : "border-border bg-card",
              )}
            >
              <div>
                <h3 className="text-sm font-medium text-foreground">
                  {item.recipient}
                  {item.company && item.company !== item.recipient ? ` · ${item.company}` : ""}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {[item.email, formatSentDate(item.sentAt)].filter(Boolean).join(" · ")}
                </p>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                <TonePill tone="neutral">Sent</TonePill>
                {item.replied ? (
                  <TonePill tone="good" dot>
                    Replied
                  </TonePill>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
