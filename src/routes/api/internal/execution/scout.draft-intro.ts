/**
 * POST /api/internal/execution/scout/draft-intro
 *
 * The Scout agent drafts, it never sends. A draft produced here lands in
 * `comms_drafts` as `needs_human_review` and waits for a person. There is no
 * path from this handler to comms-send, Resend, or any provider.
 *
 * Capability: scout.draft_intro (granted by a human on execution_agents;
 * nothing here grants anything).
 *
 * Every draft body passes the deterministic Voice DNA check
 * (src/data/voice-policy.ts). Mechanical repairs are applied; blocking
 * violations refuse the draft with a 422 and the violation list.
 */

import { createFileRoute } from "@tanstack/react-router";

import {
  assertExecutionKey,
  completeBinding,
  executionAgentId,
  recordBinding,
  trustTaiServiceRoleClient,
  validateAgent,
} from "@/lib/execution-bridge.server";
import { paperclipClient } from "@/lib/paperclip-client.server";
import { checkVoice } from "@/data/voice-policy";
import {
  considerAutoSend,
  SCOUT_FIRST_INTRO_MESSAGE_TYPE,
} from "@/lib/comms-autosend.server";
import { composeWorldCard, worldCardForStorage, worldCardSummary } from "@/data/world-card";
import { evaluateScoutFit, storedEvaluation, withOverride } from "@/data/scout-fit-evaluator";
import { gapIntelFromMetadata } from "@/data/scout-opportunity-gap";
import { checkIntroTruth } from "@/domain/world-card";
import {
  decideAction,
  decideVerdictForStorage,
  historyFromTouches,
  shouldDraft,
  type TouchFact,
} from "@/domain/tai-decide";
import { buildDimensionalRecord } from "@/domain/dimensional-record";
import {
  composeScoutRetrieval,
  draftIntroPrincipleScope,
  scoutRetrievalPacket,
} from "@/lib/scout-retrieval";
import { readRetrievalPrinciples } from "@/lib/organizational-principles.server";

interface DraftIntroPayload {
  prospect_id?: unknown;
  template_id?: unknown;
  draft_body?: unknown;
  draft_subject?: unknown;
  idempotency_key?: unknown;
}

export const Route = createFileRoute("/api/internal/execution/scout/draft-intro")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          assertExecutionKey(request);
          const agentId = executionAgentId(request);
          const agent = await validateAgent(agentId, "scout.draft_intro");
          const paperclipAgent = await paperclipClient.getAgent(agent.paperclip_agent_id);

          const body = (await request.json()) as DraftIntroPayload;
          const prospectId = typeof body.prospect_id === "string" ? body.prospect_id.trim() : "";
          const templateId = typeof body.template_id === "string" ? body.template_id.trim() : "";
          const draftBodyOverride =
            typeof body.draft_body === "string" && body.draft_body.trim() ? body.draft_body : null;
          const draftSubjectOverride =
            typeof body.draft_subject === "string" && body.draft_subject.trim()
              ? body.draft_subject.trim()
              : null;
          const idempotencyKey =
            typeof body.idempotency_key === "string" && body.idempotency_key.trim()
              ? body.idempotency_key.trim()
              : `scout.draft_intro:${prospectId}:${templateId}:${crypto.randomUUID()}`;

          if (!prospectId || !templateId) {
            return Response.json(
              { error: "prospect_id and template_id are required." },
              { status: 400 },
            );
          }

          const supabase = trustTaiServiceRoleClient();

          // Org-pinned loads. The agent row pins organization_id; anything
          // outside that organization simply does not exist here.
          const { data: prospect, error: prospectError } = await supabase
            .from("prospects")
            .select(
              "id, organization_id, company_name, website_url, status, observed, inferred, suggested, metadata",
            )
            .eq("id", prospectId)
            .eq("organization_id", agent.organization_id)
            .maybeSingle();
          if (prospectError) throw new Error(prospectError.message);
          if (!prospect) {
            return Response.json(
              { error: "Prospect not found in this organization." },
              { status: 404 },
            );
          }

          const { data: template, error: templateError } = await supabase
            .from("scout_intro_templates")
            .select("id, organization_id, name, subject, body, active")
            .eq("id", templateId)
            .eq("organization_id", agent.organization_id)
            .maybeSingle();
          if (templateError) throw new Error(templateError.message);
          if (!template) {
            return Response.json(
              { error: "Template not found in this organization." },
              { status: 404 },
            );
          }
          if (!template.active) {
            return Response.json({ error: "Template is not active." }, { status: 409 });
          }

          const rawBody = draftBodyOverride ?? template.body;
          const subject = draftSubjectOverride ?? template.subject ?? null;
          if (!rawBody || !rawBody.trim()) {
            return Response.json({ error: "The draft body is empty." }, { status: 400 });
          }

          /* ---------------------------------------- World Card + DECIDE.
             Before anything is written, compose what is honestly known and
             predict what Tai would DO. A non-writing verdict ends the
             request here with the verdict on record; no draft exists. */

          const prospectMetadata =
            prospect.metadata && typeof prospect.metadata === "object" ? prospect.metadata : {};

          const evaluation = withOverride(
            storedEvaluation(prospectMetadata) ??
              evaluateScoutFit({
                observed: prospect.observed,
                inferred: prospect.inferred,
                suggested: prospect.suggested,
                scoreable: Array.isArray(prospect.observed) && prospect.observed.length > 0,
                icpVersion: null,
                intel: gapIntelFromMetadata(prospectMetadata),
              }),
            prospectMetadata,
          );

          const worldCard = composeWorldCard({
            metadata: prospectMetadata,
            observed: prospect.observed,
            evaluation,
          });

          /* Learned principles for this DECIDE/draft read: the primary
             consumer. Domain relationship_nurture; the milestone_event
             context is claimed only when the World Card actually observed
             a recent change (see draftIntroPrincipleScope). Composed
             through the same retrieval lane every Scout read uses, so an
             active or strengthened principle outranks inference here, and
             a provisional, challenged or retired one never appears.
             Best-effort by contract: an unreadable principles store never
             blocks DECIDE or the draft, it is simply absent. */
          const principleScope = draftIntroPrincipleScope(worldCard);
          const principles = await readRetrievalPrinciples(
            supabase,
            agent.organization_id,
            principleScope,
          );
          const principleRetrieval = scoutRetrievalPacket(
            composeScoutRetrieval({
              organizationId: agent.organization_id,
              subject: prospect.company_name,
              principles,
            }),
            prospect.company_name,
          );
          const learnedPrinciples = (
            (principleRetrieval["humanCorrections"] as { id: string; lesson: string }[]) ?? []
          ).map((entry) => ({ id: entry.id, lesson: entry.lesson }));

          // Relationship history, when a relationship already carries this
          // prospect. The same row is reused further down for the draft.
          const { data: existingRel, error: relReadError } = await supabase
            .from("comms_relationships")
            .select("id, stage, metadata")
            .eq("organization_id", agent.organization_id)
            .eq("prospect_id", prospect.id)
            .maybeSingle();
          if (relReadError) throw new Error(relReadError.message);

          let touches: TouchFact[] = [];
          if (existingRel) {
            const { data: touchRows, error: touchError } = await supabase
              .from("comms_touches")
              .select("direction, occurred_at")
              .eq("organization_id", agent.organization_id)
              .eq("relationship_id", existingRel.id)
              .order("occurred_at", { ascending: false })
              .limit(100);
            if (touchError) throw new Error(touchError.message);
            touches = (touchRows ?? []).map((row) => ({
              direction: row.direction === "inbound" ? ("inbound" as const) : ("outbound" as const),
              occurredAt: row.occurred_at,
            }));
          }

          const { data: peopleRows, error: peopleError } = await supabase
            .from("scout_people")
            .select("id, full_name, work_email, email_status")
            .eq("organization_id", agent.organization_id)
            .eq("prospect_id", prospect.id);
          if (peopleError && !/does not exist|relation/i.test(peopleError.message)) {
            throw new Error(peopleError.message);
          }
          const people = peopleRows ?? [];
          const verifiedOwnerEmail = people.some(
            (person) => Boolean(person.work_email) && person.email_status === "verified",
          );
          const anyEmailRoute = people.some((person) => Boolean(person.work_email));

          const decision = decideAction({
            worldCard,
            fit: {
              light: evaluation.light,
              score: evaluation.score,
              scoreable: evaluation.scoreable,
            },
            gap: evaluation.opportunityGap?.gap ?? "unknown",
            contact: { verifiedOwnerEmail, anyEmailRoute },
            history: historyFromTouches(existingRel?.stage ?? null, touches),
          });
          const decisionStored = decideVerdictForStorage(decision);
          const decidedAt = new Date().toISOString();

          // The card and the verdict persist on the prospect either way, so
          // the next look at this company starts from what was decided.
          const nextProspectMetadata = {
            ...prospectMetadata,
            world_card: worldCardForStorage(worldCard),
            last_decide: { ...decisionStored, decided_at: decidedAt },
          };
          const { error: metadataError } = await supabase
            .from("prospects")
            .update({ metadata: nextProspectMetadata, updated_at: decidedAt })
            .eq("id", prospect.id)
            .eq("organization_id", agent.organization_id);
          if (metadataError) throw new Error(metadataError.message);

          if (existingRel) {
            const relMetadata =
              existingRel.metadata && typeof existingRel.metadata === "object"
                ? existingRel.metadata
                : {};
            await supabase
              .from("comms_relationships")
              .update({
                metadata: { ...relMetadata, world_card: worldCardForStorage(worldCard) },
                updated_at: decidedAt,
              })
              .eq("id", existingRel.id)
              .eq("organization_id", agent.organization_id);
          }

          if (!shouldDraft(decision)) {
            // NO ACTION is a successful outcome. The verdict is recorded and
            // the request ends cleanly with no draft anywhere. The
            // dimensional record is the judgment memory's entry for this
            // decision (four-memories model): no words exist here, so the
            // voice and truth dimensions honestly stay null.
            const dimensional = buildDimensionalRecord({
              register: "scout_intro",
              decideAction: decision.action,
              relationshipStage: existingRel?.stage ?? null,
              confidence: decision.confidence,
              escalated: decision.action === "escalate_to_tai",
              now: decidedAt,
            });
            await supabase.from("activities").insert({
              organization_id: agent.organization_id,
              app_key: "scout",
              event_type: "relationship.decide",
              entity_type: "prospect",
              entity_id: prospect.id,
              summary: `DECIDE read ${prospect.company_name} and chose ${decision.action} (${decision.outcome}).`,
              payload: {
                ...decisionStored,
                prospect_id: prospect.id,
                relationship_id: existingRel?.id ?? null,
                world_card_summary: worldCardSummary(worldCard),
                learned_principles: learnedPrinciples,
                principle_scope: principleScope,
                dimensional,
              },
              occurred_at: decidedAt,
            });
            return Response.json({
              decided: true,
              drafted: false,
              action: decision.action,
              outcome: decision.outcome,
              rationale: decision.rationale,
              confidence: decision.confidence,
              escalation: decision.escalation,
              prospect_id: prospect.id,
              world_card_summary: worldCardSummary(worldCard),
            });
          }

          /* ------------------------------------------- truth discipline.
             SEE, CONNECT, OFFER, LEAVE ROOM: the words about the prospect
             must be traceable to World Card evidence. Phase A heuristic;
             its limits are documented on checkIntroTruth. */
          const truth = checkIntroTruth(rawBody, worldCard);
          if (!truth.passes) {
            return Response.json(
              {
                error:
                  "The draft makes claims the World Card evidence does not back, so it was refused.",
                truth_violations: truth.violations,
                action: decision.action,
              },
              { status: 422 },
            );
          }

          // Deterministic Voice DNA pass. Mechanical repairs are applied to
          // the stored text; blocking violations refuse the draft outright.
          const verdict = checkVoice(rawBody, { register: "warm_intro" });
          if (!verdict.passes) {
            return Response.json(
              { error: "The draft violates the voice policy.", violations: verdict.violations },
              { status: 422 },
            );
          }

          const binding = await recordBinding({
            organizationId: agent.organization_id,
            sourceApp: "scout",
            sourceEntityType: "prospect",
            sourceEntityId: prospect.id,
            paperclipCompanyId: paperclipAgent.companyId,
            paperclipAgentId: agent.paperclip_agent_id,
            objective: `Draft an intro to ${prospect.company_name} for human review.`,
            expectedOutcome: "A comms draft awaiting human review. Nothing is sent.",
            idempotencyKey,
            businessOutputs: {
              prospect_id: prospect.id,
              template_id: template.id,
            },
          });

          // Find or create the relationship carrying this prospect in Comms.
          // The same seam the Scout handoff uses: one relationship per
          // prospect per organization. The DECIDE read above already loaded
          // any existing row.
          let relationshipId = existingRel?.id ?? null;
          if (!relationshipId) {
            const { data: createdRel, error: createRelError } = await supabase
              .from("comms_relationships")
              .insert({
                organization_id: agent.organization_id,
                prospect_id: prospect.id,
                full_name: prospect.company_name,
                company_name: prospect.company_name,
                source: "scout",
                stage: "ready_to_reach",
                next_action: `Review the Scout intro draft for ${prospect.company_name}.`,
                metadata: {
                  scout_draft_intro: {
                    prospect_id: prospect.id,
                    created_by_agent: agent.paperclip_agent_id,
                  },
                  world_card: worldCardForStorage(worldCard),
                },
              })
              .select("id")
              .maybeSingle();
            if (createRelError) throw new Error(createRelError.message);
            if (!createdRel) throw new Error("Relationship insert returned no row.");
            relationshipId = createdRel.id;
          }

          // One live intro per relationship. Without this, a retrying agent
          // stacks duplicate drafts in the approval column.
          const { data: liveDraft, error: liveDraftError } = await supabase
            .from("comms_drafts")
            .select("id, review_state")
            .eq("organization_id", agent.organization_id)
            .eq("relationship_id", relationshipId)
            .eq("register", "scout_intro")
            .in("review_state", ["needs_human_review", "approved", "sending", "sent"])
            .limit(1)
            .maybeSingle();
          if (liveDraftError) throw new Error(liveDraftError.message);
          if (liveDraft) {
            await completeBinding(binding.id, {
              status: "completed",
              resultSummary: `Intro already drafted for ${prospect.company_name} (${liveDraft.review_state}); nothing new created.`,
              businessOutputs: { draft_id: liveDraft.id, duplicate: true },
            });
            return Response.json(
              {
                error: "An intro draft already exists for this prospect.",
                draft_id: liveDraft.id,
                review_state: liveDraft.review_state,
              },
              { status: 409 },
            );
          }

          const { data: draft, error: draftError } = await supabase
            .from("comms_drafts")
            .insert({
              organization_id: agent.organization_id,
              relationship_id: relationshipId,
              intent: "introduce",
              register: "scout_intro",
              subject,
              body: verdict.text,
              review_state: "needs_human_review",
              rationale: {
                source: "scout_agent",
                template_id: template.id,
                template_name: template.name,
                prospect_id: prospect.id,
                agent_id: agent.paperclip_agent_id,
                voice_checked: true,
                voice_flags: verdict.violations,
                idempotency_key: idempotencyKey,
                // The gate snapshot the learning loop and the auto-send
                // orchestrator both read. The deterministic checkVoice is a
                // clean pass with no confidence score; message_type keys the
                // graduated authority (distinct from the draft register).
                gate_verdict: "pass",
                gate_reasons: verdict.violations.map((flag) => flag.ruleId),
                gate: {
                  message_type: SCOUT_FIRST_INTRO_MESSAGE_TYPE,
                  verdict: "pass",
                  grade: null,
                  confidence: null,
                },
                // The DECIDE verdict and World Card reference travel with
                // the draft, so the reviewer and the learning loop both see
                // why the engine chose to write at all.
                decide: { ...decisionStored, decided_at: decidedAt },
                // The learned principles that were in front of this read,
                // with the scope they were filtered to, so the reviewer and
                // the learning loop see exactly what colored the draft.
                learned_principles: learnedPrinciples,
                principle_scope: principleScope,
                world_card: {
                  composed_at: worldCard.composedAt,
                  evaluator_version: worldCard.evaluatorVersion,
                  summary: worldCardSummary(worldCard),
                },
                truth_check: { passes: truth.passes, violations: truth.violations },
                // Judgment-memory entry for this draft (four-memories model).
                // Voice and truth passed to get here; judgment and outcome
                // stay null until a review and a result exist. This is a
                // dimensional log, never a licence to mimic phrasing: the
                // standard is that the decision reads as what Tai would do,
                // not that recognizable language appears.
                dimensional: buildDimensionalRecord({
                  register: "scout_intro",
                  decideAction: decision.action,
                  relationshipStage: existingRel?.stage ?? null,
                  confidence: decision.confidence,
                  voice: "pass",
                  truth: "pass",
                  now: decidedAt,
                }),
                // The exact words the engine drafted, kept so a later human
                // approval can be compared against them for edit-learning.
                drafted_body: verdict.text,
              },
            })
            .select("id")
            .maybeSingle();
          if (draftError) throw new Error(draftError.message);
          if (!draft) throw new Error("Draft insert returned no row.");

          // A prospect an agent drafted for is, at minimum, on its way to
          // Comms. Only the untouched 'discovered' state is advanced;
          // human-decided states are never overwritten.
          let prospectStatus = prospect.status;
          if (prospect.status === "discovered") {
            const { error: statusError } = await supabase
              .from("prospects")
              .update({ status: "ready_for_comms", updated_at: new Date().toISOString() })
              .eq("id", prospect.id)
              .eq("organization_id", agent.organization_id)
              .eq("status", "discovered");
            if (statusError) throw new Error(statusError.message);
            prospectStatus = "ready_for_comms";
          }

          // Graduated auto-send. The Scout agent still never sends: this runs
          // with the server's own service role, and only ever sends when the
          // graduation gate, the confident pass and the never-replied-before
          // failsafe ALL hold. Any hold leaves the draft exactly as it is —
          // needs_human_review — which is the existing behaviour. It can never
          // break the draft path (it swallows its own errors into a hold).
          const autoSend = await considerAutoSend(supabase, {
            organizationId: agent.organization_id,
            draftId: draft.id,
            relationshipId,
            gate: {
              verdict: "pass",
              confidence: null,
              grade: null,
              hardOverride: false,
              reasons: verdict.violations.map((flag) => flag.ruleId),
            },
          });
          const reviewState =
            autoSend.attempted && autoSend.state === "sent" ? "sent" : "needs_human_review";

          await completeBinding(binding.id, {
            status: "completed",
            resultSummary:
              reviewState === "sent"
                ? `Drafted and auto-sent an intro to ${prospect.company_name} under graduated authority.`
                : `Drafted an intro to ${prospect.company_name}; waiting for human review.`,
            businessOutputs: {
              draft_id: draft.id,
              relationship_id: relationshipId,
              prospect_id: prospect.id,
              template_id: template.id,
              review_state: reviewState,
              auto_sent: reviewState === "sent",
              auto_send_hold: autoSend.hold ?? null,
            },
          });

          return Response.json({
            decided: true,
            drafted: true,
            action: decision.action,
            decide_confidence: decision.confidence,
            draft_id: draft.id,
            relationship_id: relationshipId,
            prospect_id: prospect.id,
            prospect_status: prospectStatus,
            review_state: reviewState,
            voice_flags: verdict.violations,
            auto_sent: reviewState === "sent",
            ...(autoSend.hold ? { auto_send_hold: autoSend.hold } : {}),
            message_type: SCOUT_FIRST_INTRO_MESSAGE_TYPE,
          });
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "Intro draft failed." },
            { status: 400 },
          );
        }
      },
    },
  },
});
