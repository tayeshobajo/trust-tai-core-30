/**
 * followup-engine. Supabase Edge Function.
 *
 * The Relationships production line's "Follow up" station. A daily sweep that
 * keeps relationships alive without Tai remembering to. For every relationship
 * we have reached out to and heard nothing back:
 *
 *   1. If they replied after our last outbound -> stop (mark replied).
 *   2. If day >= 4 and touch 1 not drafted -> draft follow-up 1.
 *   3. If day >= 10 and touch 2 not drafted -> draft follow-up 2.
 *   4. After touch 2 with continued silence -> mark cold.
 *
 * Cadence (Tai, 2026-09-20): day 4 / day 10, then cold. Two touches.
 *
 * Doctrine — this function NEVER SENDS. It writes:
 *   - comms_reminders (reason_code=no_reply_after_days), the "follow-ups due" record
 *   - comms_drafts (review_state per Jev gate), which sit in Tai's approval queue
 *   - comms_followup_state, the idempotency + cadence ledger
 * Tai's approval is the send. The Jev gate runs on every drafted body.
 *
 * Auth mirrors the comms/scout bridges: X-Execution-Key against TRUST_TAI_EXECUTION_KEY.
 * The sweep itself uses the service-role client (it is a system job, not a user).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { gateDraft } from "../_shared/voice-gate.ts";
import {
  decideFollowup,
  type FollowupDecision,
} from "../_shared/followup-cadence.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXECUTION_KEY = Deno.env.get("TRUST_TAI_EXECUTION_KEY");

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function assertExecutionKey(req: Request): void {
  const header = req.headers.get("X-Execution-Key");
  if (!EXECUTION_KEY || !header || header !== EXECUTION_KEY) {
    throw Object.assign(new Error("Invalid execution key"), { status: 401 });
  }
}

interface RelationshipRow {
  id: string;
  organization_id: string;
  full_name: string | null;
  company_name: string | null;
  stage: string | null;
}

interface FollowupStateRow {
  relationship_id: string;
  last_touch_no: number;
  state: string;
}

/**
 * The greeting name actually used in the body. Handles "First Last", the
 * "Last, First" export format, and non-person names (companies) by falling back
 * to a nameless greeting. The gate checks the body contains THIS string, so the
 * composer and the gate must agree on it.
 */
function greetingName(fullName: string | null): string | null {
  const raw = (fullName ?? "").trim();
  if (!raw) return null;
  // "Cromer, Amy" -> "Amy"; otherwise first whitespace token.
  const first = raw.includes(",")
    ? raw.split(",")[1]?.trim().split(/\s+/)[0]
    : raw.split(/\s+/)[0];
  if (!first) return null;
  // Reject obvious non-person tokens (company handles): require a leading capital
  // letter and letters only. If it does not look like a personal first name, we
  // greet without a name rather than fabricate one.
  if (!/^[A-Z][a-z'’-]+$/.test(first)) return null;
  return first;
}

/** Compose the follow-up body. Deliberately spare — restraint reads as real. */
function composeFollowup(
  rel: RelationshipRow,
  touchNo: number,
  lastOutboundAt: Date,
): { subject: string; body: string; register: string; intent: string; greeting: string | null } {
  const greeting = greetingName(rel.full_name);
  const name = greeting ?? "there";
  // Two touches. A follow-up has no fresh observation to lead with, so the only
  // true anchor is our own earlier note. Own that plainly, leave air, stop early.
  // Underwritten, no "circling back", no manufactured urgency. Both are DRAFTS.
  if (touchNo === 1) {
    return {
      subject: "One more note",
      body:
        `${name}, sent you a note a little while back and it may have landed at a busy time. ` +
        `If now is not the right moment, that is completely fine. ` +
        `Leaving it here in case it is useful.`,
      register: "warm_professional",
      intent: "follow_up",
      greeting,
    };
  }
  return {
    subject: "Leaving this here",
    body:
      `${name}, I will stop here so I am not filling your inbox. ` +
      `If it becomes useful down the line, a reply picks it right back up. ` +
      `Either way, good to have come across your work.`,
    register: "warm_professional",
    intent: "follow_up",
    greeting,
  };
}

async function runSweep(dryRun: boolean) {
  const now = new Date();

  // 1. Every relationship with an outbound message, its last outbound time, and
  //    whether any inbound arrived after it. This is the safety-critical read:
  //    reply detection keys on comms_messages (real mail), NOT comms_touches.
  const { data: outbound, error: obErr } = await supabase
    .from("comms_messages")
    .select("relationship_id, direction, occurred_at, organization_id")
    .in("direction", ["outbound", "inbound"])
    .not("relationship_id", "is", null)
    .order("occurred_at", { ascending: false });
  if (obErr) throw Object.assign(new Error(obErr.message), { status: 500 });

  // Fold messages into per-relationship: last outbound, last inbound.
  const perRel = new Map<
    string,
    { orgId: string; lastOut: Date | null; lastIn: Date | null }
  >();
  for (const m of outbound ?? []) {
    const relId = (m as { relationship_id: string }).relationship_id;
    const when = new Date((m as { occurred_at: string }).occurred_at);
    const dir = (m as { direction: string }).direction;
    const orgId = (m as { organization_id: string }).organization_id;
    const cur = perRel.get(relId) ?? { orgId, lastOut: null, lastIn: null };
    if (dir === "outbound" && (!cur.lastOut || when > cur.lastOut)) cur.lastOut = when;
    if (dir === "inbound" && (!cur.lastIn || when > cur.lastIn)) cur.lastIn = when;
    perRel.set(relId, cur);
  }

  const relIds = [...perRel.keys()];
  if (relIds.length === 0) return { swept: 0, drafted: 0, replied: 0, cold: 0, results: [] };

  // 2. Existing follow-up state (idempotency ledger) + relationship details.
  const { data: states } = await supabase
    .from("comms_followup_state")
    .select("relationship_id, last_touch_no, state")
    .in("relationship_id", relIds);
  const stateByRel = new Map<string, FollowupStateRow>();
  for (const s of (states ?? []) as FollowupStateRow[]) stateByRel.set(s.relationship_id, s);

  const { data: rels } = await supabase
    .from("comms_relationships")
    .select("id, organization_id, full_name, company_name, stage")
    .in("id", relIds);
  const relById = new Map<string, RelationshipRow>();
  for (const r of (rels ?? []) as RelationshipRow[]) relById.set(r.id, r);

  let drafted = 0;
  let repliedCount = 0;
  let coldCount = 0;
  const results: Array<Record<string, unknown>> = [];

  for (const relId of relIds) {
    const agg = perRel.get(relId)!;
    const rel = relById.get(relId);
    if (!rel || !agg.lastOut) continue; // need a known relationship + an outbound anchor

    const existing = stateByRel.get(relId);
    // If a prior state already terminal (replied/cold), skip unless a NEW outbound
    // reset the anchor after it. Simplest correct rule: a fresh outbound after the
    // last touch reopens the cadence. We approximate reopen by lastTouchNo from state
    // only when state is active; terminal states stay terminal until a human reopens.
    if (existing && (existing.state === "replied" || existing.state === "cold")) {
      results.push({ relId, action: "skip_terminal", state: existing.state });
      continue;
    }

    const repliedAfter = !!agg.lastIn && !!agg.lastOut && agg.lastIn > agg.lastOut;

    const decision: FollowupDecision = decideFollowup({
      lastOutboundAt: agg.lastOut,
      repliedAfterLastOutbound: repliedAfter,
      lastTouchNo: existing?.last_touch_no ?? 0,
      currentState: (existing?.state as "active" | "replied" | "cold") ?? "active",
      now,
    });

    if (decision.action === "none") {
      // Keep the ledger's next_due_at fresh so the board can show what is coming.
      if (!dryRun) {
        await supabase.from("comms_followup_state").upsert(
          {
            organization_id: rel.organization_id,
            relationship_id: relId,
            last_touch_no: existing?.last_touch_no ?? 0,
            state: "active",
            anchor_outbound_at: agg.lastOut.toISOString(),
            next_due_at: decision.nextDueAt?.toISOString() ?? null,
            last_swept_at: now.toISOString(),
            updated_at: now.toISOString(),
          },
          { onConflict: "organization_id,relationship_id" },
        );
      }
      results.push({ relId, action: "none", days: decision.daysSinceOutbound });
      continue;
    }

    if (decision.action === "mark_replied" || decision.action === "mark_cold") {
      const terminal = decision.action === "mark_replied" ? "replied" : "cold";
      if (terminal === "replied") repliedCount++;
      else coldCount++;
      if (!dryRun) {
        await supabase.from("comms_followup_state").upsert(
          {
            organization_id: rel.organization_id,
            relationship_id: relId,
            last_touch_no: existing?.last_touch_no ?? 0,
            state: terminal,
            anchor_outbound_at: agg.lastOut.toISOString(),
            next_due_at: null,
            last_swept_at: now.toISOString(),
            notes: decision.reason,
            updated_at: now.toISOString(),
          },
          { onConflict: "organization_id,relationship_id" },
        );
      }
      results.push({ relId, action: decision.action, reason: decision.reason });
      continue;
    }

    // draft_touch_1 | draft_touch_2 — the acting path.
    const touchNo = decision.touchNo!;
    const composed = composeFollowup(rel, touchNo, agg.lastOut);
    const gate = await gateDraft(composed.body, {
      // Gate checks the body contains the greeting we actually used, not the raw
      // DB name (which may be "Last, First" or a company). Nameless greeting = no
      // recipient check.
      recipient: composed.greeting ?? undefined,
      messageType: "ongoing",
    });
    const reviewState = gate.allow ? "needs_human_review" : "needs_redraft";

    if (!dryRun) {
      // The reminder — the durable "this follow-up is due" record.
      await supabase.from("comms_reminders").insert({
        organization_id: rel.organization_id,
        relationship_id: relId,
        reason_code: "no_reply_after_days",
        reason_text: decision.reason,
        evidence: [
          {
            kind: "last_outbound",
            at: agg.lastOut.toISOString(),
            days: decision.daysSinceOutbound,
            touch_no: touchNo,
          },
        ],
        due_at: now.toISOString(),
        state: "pending",
        created_by: null,
      });

      // The gated draft — lands in Tai's approval queue, never sent.
      await supabase.from("comms_drafts").insert({
        organization_id: rel.organization_id,
        relationship_id: relId,
        intent: composed.intent,
        register: composed.register,
        subject: composed.subject,
        body: composed.body,
        review_state: reviewState,
        rationale: {
          source: "followup_engine",
          touch_no: touchNo,
          days_since_outbound: decision.daysSinceOutbound,
          written_at: now.toISOString(),
          gate: gate.audit,
          gate_verdict: gate.verdict,
          gate_reasons: gate.reasons,
        },
        evidence: [
          { kind: "last_outbound", at: agg.lastOut.toISOString(), touch_no: touchNo },
        ],
        created_by: null,
      });

      // Advance the ledger so the sweep never re-drafts this touch.
      await supabase.from("comms_followup_state").upsert(
        {
          organization_id: rel.organization_id,
          relationship_id: relId,
          last_touch_no: touchNo,
          state: "active",
          anchor_outbound_at: agg.lastOut.toISOString(),
          next_due_at: decision.nextDueAt?.toISOString() ?? null,
          last_swept_at: now.toISOString(),
          notes: decision.reason,
          updated_at: now.toISOString(),
        },
        { onConflict: "organization_id,relationship_id" },
      );
    }

    drafted++;
    results.push({
      relId,
      action: decision.action,
      touch_no: touchNo,
      review_state: reviewState,
      gate_verdict: gate.verdict,
      gate_grade: gate.grade,
      gate_confidence: gate.confidence,
      gate_reasons: gate.reasons,
    });
  }

  return {
    swept: relIds.length,
    drafted,
    replied: repliedCount,
    cold: coldCount,
    dryRun,
    results,
  };
}

Deno.serve(async (req: Request) => {
  try {
    assertExecutionKey(req);
    const url = new URL(req.url);
    // ?dry=1 reports what WOULD happen without writing. Safe to run anytime.
    const dryRun = url.searchParams.get("dry") === "1";
    const summary = await runSweep(dryRun);
    return json(summary);
  } catch (e) {
    const status = (e as { status?: number }).status ?? 500;
    return json({ error: (e as Error).message }, status);
  }
});
