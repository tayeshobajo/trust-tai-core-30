/**
 * Steward semantic interpretation endpoint.
 *
 * POST, reason across all stored turns and persist the exact-transcript reading.
 * No task is created automatically. Interpretation is not confirmation: only a person, in the room,
 * turns a signal into workspace truth.
 *
 * Security: this path bypasses site auth, so the handler authenticates every
 * request against a Trust Tai access token and an active organization
 * membership before any transcript or model call is touched. The model key
 * never leaves the server.
 */

import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { IntelligenceCase } from "@/domain/intelligence-canon";
import type { WithheldSource } from "@/domain/signals";
import type { Belief, Commitment, NormalizedConversation } from "@/domain/steward";
import type { MemoryBelief } from "@/domain/steward-memory";
import type { MemoryContext } from "@/domain/steward-semantic";

import { meetingProcessingDenial } from "@/data/steward/processing-access";
import { loadMeetingReading, saveMeetingReading } from "@/data/steward/reading-store";
import { transcriptDigest, MEETING_PROCESS_VERSION } from "@/data/steward/meeting-process";
import { proposeStateChanges } from "@/data/steward/continuity";
import {
  outcomeRecordsFromBeliefs,
  resolveMemory,
  suppressedPatterns,
} from "@/data/steward/learning";

import { toMemoryBelief } from "@/data/steward/memory-encoding";
import { describeKnownPeople, resolveKnownPeople } from "@/data/steward/known-people";
import { flagMemoryConflicts, selectRelevantMemory } from "@/data/steward/memory-context";
import {
  interpretConversation,
  InterpretationUnavailableError,
} from "@/lib/steward-interpret.server";
import {
  createLovableAiGatewayRunIdFetch,
  getLovableAiGatewayRunId,
} from "@/lib/ai-gateway.server";
import { runtimeModelCaller } from "@/lib/intelligence-runtime.server";
import { trustTaiSupabaseKey, trustTaiSupabaseUrl } from "@/lib/trust-tai-backend.server";

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

function clientFor(token: string): SupabaseClient {
  const key = trustTaiSupabaseKey();
  return createClient(trustTaiSupabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}`, apikey: key } },
  });
}

/**
 * Beliefs Steward already holds, read as the caller so RLS still decides.
 * Memory being unreadable is never fatal: the meeting is still worth reading.
 */
async function readBeliefs(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<MemoryBelief[]> {
  try {
    const { data, error } = await supabase
      .from("steward_beliefs")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(400);
    if (error) return [];
    const beliefs = (data ?? []).map(
      (row) =>
        ({
          id: String(row["id"] ?? ""),
          organizationId,
          subjectKey: String(row["subject_key"] ?? ""),
          subjectLabel: String(row["subject_label"] ?? row["subject_key"] ?? ""),
          statement: String(row["statement"] ?? ""),
          tier: String(row["tier"] ?? "observed"),
          authority: String(row["authority"] ?? "source"),
          ...(row["supersedes_id"] ? { supersedesId: String(row["supersedes_id"]) } : {}),
          evidence: Array.isArray(row["evidence"]) ? row["evidence"] : [],
          recordedBy: String(row["recorded_by_name"] ?? "A person"),
          recordedAt: String(row["created_at"] ?? ""),
        }) as Belief,
    );
    return resolveMemory(beliefs.map(toMemoryBelief));
  } catch {
    return [];
  }
}

/**
 * The case ledger for this workspace, read as the caller. It is where human
 * corrections live, and corrections outrank inference. When the ledger cannot
 * be read (not migrated, no permission), the source is recorded as withheld:
 * unknown stays unknown, it never becomes an empty fact.
 */
async function readCases(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<{ cases: IntelligenceCase[]; withheld: WithheldSource[] }> {
  try {
    const { data, error } = await supabase
      .from("intelligence_cases")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return {
      cases: ((data ?? []) as Record<string, unknown>[]).map((row) => {
        const optional = (key: string) =>
          typeof row[key] === "string" && (row[key] as string).length > 0
            ? { [key]: row[key] as string }
            : {};
        return {
          id: String(row["id"] ?? ""),
          organizationId: String(row["organization_id"] ?? ""),
          patternId: String(row["pattern_id"] ?? ""),
          patternVersion: Number(row["pattern_version"] ?? 1),
          entities: [],
          evidenceRefs: [],
          hypothesis: String(row["hypothesis"] ?? ""),
          humanDecision: String(row["human_decision"] ?? ""),
          decidedBy: String(row["decided_by"] ?? ""),
          decidedAt: String(row["decided_at"] ?? ""),
          diagnosisVerdict: (typeof row["diagnosis_verdict"] === "string"
            ? row["diagnosis_verdict"]
            : "unknown") as IntelligenceCase["diagnosisVerdict"],
          ...(optional("correction") as { correction?: string }),
          ...(optional("lesson") as { lesson?: string }),
          createdAt: String(row["created_at"] ?? ""),
        } satisfies IntelligenceCase;
      }),
      withheld: [],
    };
  } catch {
    return { cases: [], withheld: [{ appId: "intelligence_cases", reason: "not_connected" }] };
  }
}

/** Canonical memory, read as the caller. Unavailable is reported, never faked. */

async function readMemory(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<{ memory: MemoryContext; commitments: Commitment[] }> {
  try {
    const { data, error } = await supabase
      .from("commitments")
      .select("id, statement, owner_name, owner_email, status, conversation_id, source_key")
      .eq("organization_id", organizationId)
      .limit(301);
    if (error) throw new Error(error.message);

    if ((data?.length ?? 0) > 300)
      throw new Error(
        "Existing commitment read is capped; duplicate reconciliation is incomplete.",
      );
    const board = await supabase
      .from("steward_tasks")
      .select("id,title,status,owner_label")
      .eq("organization_id", organizationId)
      .eq("task_visibility", "business")
      .limit(1001);
    if (board.error || (board.data?.length ?? 0) > 1000)
      throw new Error(
        "Existing business task read is unavailable or capped; duplicate reconciliation is incomplete.",
      );
    const rows = data ?? [];
    const commitments = rows.map((row) => ({
      id: String(row["id"] ?? ""),
      organizationId,
      conversationId: String(row["conversation_id"] ?? ""),
      ownerName: String(row["owner_name"] ?? ""),
      what: String(row["statement"] ?? ""),
      status: String(row["status"] ?? "open"),
      sourceKey: String(row["source_key"] ?? ""),
      evidence: [],
      createdAt: "",
      updatedAt: "",
    })) as Commitment[];

    /*
     * Canonical people before Steward's own registry only. Role memory is
     * human-recorded and still outranks a directory row; members and contacts
     * exist so Steward stops claiming it knows nobody about people the rest of
     * Trust Tai has already met. Each read is tolerant: an unavailable source
     * contributes nothing rather than failing the interpretation.
     */
    const [roleResult, membershipResult, contactsResult, projectsResult] = await Promise.all([
      supabase
        .from("steward_role_memory")
        .select("name, email, title, pod, responsibilities")
        .eq("organization_id", organizationId)
        .limit(100),
      supabase
        .from("organization_memberships")
        .select("user_id, status")
        .eq("organization_id", organizationId)
        .limit(200),
      supabase
        .from("contacts")
        .select("full_name, email, role_title")
        .eq("organization_id", organizationId)
        .limit(200),
      supabase.from("projects").select("id, name").eq("organization_id", organizationId).limit(100),
    ]);

    const memberIds = ((membershipResult.data ?? []) as Record<string, unknown>[])
      .filter((row) => String(row["status"] ?? "active") === "active")
      .map((row) => String(row["user_id"] ?? ""))
      .filter(Boolean);
    const profilesResult =
      memberIds.length > 0
        ? await supabase
            .from("profiles")
            .select("id, full_name, email, job_title")
            .in("id", memberIds)
        : { data: [] as Record<string, unknown>[] };

    const roleMemory = ((roleResult.data ?? []) as Record<string, unknown>[]).map((row) => {
      const title = [row["title"], row["pod"]].filter(Boolean).join(" · ");
      const responsibilities = Array.isArray(row["responsibilities"])
        ? (row["responsibilities"] as string[]).slice(0, 4).join(", ")
        : "";
      return {
        name: String(row["name"] ?? ""),
        email: (row["email"] as string | null) ?? null,
        title: [title, responsibilities].filter(Boolean).join("-"),
      };
    });

    const members = ((profilesResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
      name: String(row["full_name"] ?? ""),
      email: (row["email"] as string | null) ?? null,
      title: (row["job_title"] as string | null) ?? null,
    }));

    const contacts = ((contactsResult.data ?? []) as Record<string, unknown>[]).map((row) => ({
      name: String(row["full_name"] ?? ""),
      email: (row["email"] as string | null) ?? null,
      title: (row["role_title"] as string | null) ?? null,
    }));

    const known = resolveKnownPeople({ roleMemory, members, contacts });
    const people = known.map((person) => ({
      name: person.name,
      ...(person.title ? { title: person.title } : {}),
    }));

    const projects = (projectsResult.data ?? [])
      .map((row) => ({ id: String(row["id"] ?? ""), label: String(row["name"] ?? "") }))
      .filter((project) => project.id.length > 0 && project.label.length > 0);

    return {
      commitments,
      memory: {
        available: true,
        because: describeKnownPeople(known),

        openCommitments: [
          ...(board.data ?? []).map((task) => ({
            id: task.id,
            statement: task.title,
            ownerName: task.owner_label ?? "",
            status: task.status,
          })),
          ...commitments.map((commitment) => ({
            id: commitment.id,
            statement: commitment.what,
            ownerName: commitment.ownerName,
            status: commitment.status,
          })),
        ],
        people,
        projects,
      },
    };
  } catch (error) {
    return {
      commitments: [],
      memory: {
        available: false,
        because:
          error instanceof Error
            ? `Canonical memory could not be read (${error.message}), so Steward interpreted from the meeting alone.`
            : "Canonical memory could not be read, so Steward interpreted from the meeting alone.",
        openCommitments: [],
        people: [],
        projects: [],
      },
    };
  }
}

export const Route = createFileRoute("/api/public/steward/interpret")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) return Response.json({ error: "Sign in to use Steward." }, { status: 401 });

        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }

        const organizationId = String(body["organization_id"] ?? "");
        const supabase = clientFor(token);
        const accessDenial = await meetingProcessingDenial(supabase, organizationId);
        if (accessDenial) return accessDenial;

        const conversationId =
          typeof body["conversation_id"] === "string" ? body["conversation_id"] : null;
        const stored = conversationId
          ? await supabase
              .from("conversations")
              .select("*")
              .eq("id", conversationId)
              .eq("organization_id", organizationId)
              .maybeSingle()
          : null;
        if (conversationId && (stored?.error || !stored?.data))
          return Response.json(
            { error: "This meeting is unavailable in your workspace." },
            { status: 403 },
          );
        const conversation = stored?.data
          ? (stored.data.transcript as NormalizedConversation)
          : (body["conversation"] as NormalizedConversation | undefined);
        if (!conversation || !Array.isArray(conversation.segments)) {
          return Response.json(
            { error: "No conversation was sent to interpret." },
            { status: 400 },
          );
        }

        const digest = await transcriptDigest(conversation);
        const runKey = `meeting-reasoning:${conversationId}:${MEETING_PROCESS_VERSION}:${digest}`;
        if (conversationId) {
          try {
            const prior = await loadMeetingReading(
              supabase,
              organizationId,
              conversationId,
              runKey,
            );
            if (prior) return Response.json(prior);
          } catch (error) {
            return Response.json(
              { error: error instanceof Error ? error.message : "Saved reasoning unavailable" },
              { status: 503 },
            );
          }
        }
        const { memory, commitments } = await readMemory(supabase, organizationId);
        if (conversationId && !memory.available)
          return Response.json(
            {
              error:
                memory.because + " Resolve existing-work access before processing this meeting.",
            },
            { status: 503 },
          );
        const beliefs = await readBeliefs(supabase, organizationId);
        /* Human corrections for the shared retrieval bundle. Unreadable is withheld. */
        const ledger = await readCases(supabase, organizationId);
        /* Readings people keep calling context stop being raised. Countable, never hidden. */
        const suppressed = suppressedPatterns(outcomeRecordsFromBeliefs(beliefs));
        const relevant = selectRelevantMemory({
          beliefs,
          conversation,
          people: memory.people,
          projects: memory.projects,
          suppressedPatterns: suppressed,
        });
        const memoryWithBeliefs: MemoryContext = {
          ...memory,
          people: relevant.people,
          projects: relevant.projects,
          decided: relevant.decided,
          inferred: relevant.inferred,
        };

        const initialRunId = getLovableAiGatewayRunId(request);
        const gateway = createLovableAiGatewayRunIdFetch(initialRunId);

        try {
          /* Interpretation reasons through the runtime boundary, fail-closed. */
          const callModel = await runtimeModelCaller({
            token,
            organizationId,
            room: "steward",
            purpose: "meeting_interpretation",
          });
          const run = await interpretConversation(
            {
              conversation,
              memory: memoryWithBeliefs,
              commitments,
              gateway,
              initialRunId,
              organizationId,
              cases: ledger.cases,
              withheld: ledger.withheld,
            },
            callModel,
          );

          /* Continuity and conflict are proposals for a person, never writes. */
          const stateChanges = proposeStateChanges({ signals: run.signals, commitments });
          const conflicts = flagMemoryConflicts({ signals: run.signals, beliefs });
          const result = {
            run,
            stateChanges,
            conflicts,
            /* Exactly what memory was consulted, so the reading can be audited. */
            memoryUsed: relevant.used,
            memoryConsidered: relevant.consideredCount,
            suppressedCount: suppressed.length,
          };
          if (conversationId) {
            const latestAccess = await meetingProcessingDenial(supabase, organizationId);
            if (latestAccess) return latestAccess;
            const current = await supabase
              .from("conversations")
              .select("transcript")
              .eq("organization_id", organizationId)
              .eq("id", conversationId)
              .single();
            if (
              current.error ||
              (await transcriptDigest(current.data.transcript as NormalizedConversation)) !== digest
            )
              throw new Error(
                "The meeting transcript changed during reasoning. Review the current source before retrying.",
              );
            const user = await supabase.auth.getUser(token);
            if (!user.data.user) throw new Error("Sign in again before saving this review.");
            const saved = await saveMeetingReading(supabase, {
              org: organizationId,
              meeting: conversationId,
              actor: user.data.user.id,
              key: runKey,
              digest,
              version: MEETING_PROCESS_VERSION,
              result,
            });
            return Response.json(saved);
          }
          return Response.json(result);
        } catch (error) {
          if (error instanceof InterpretationUnavailableError) {
            return Response.json({ error: error.message }, { status: 503 });
          }
          return Response.json(
            { error: error instanceof Error ? error.message : String(error) },
            { status: 500 },
          );
        }
      },
    },
  },
});
