#!/usr/bin/env npx tsx
/**
 * R3/R4: Resolve a project context packet, freshness-check it, and (when
 * fresh enough) dispatch a bounded task to a Paperclip agent WITH the packet
 * embedded in the issue description + packet audit written to
 * execution_bindings.business_outputs (§21: what did the agent know).
 *
 * Usage:
 *   npx tsx scripts/runtime/dispatch.ts packet <projectId> [agentId]
 *   npx tsx scripts/runtime/dispatch.ts task <projectId> <agentId> <title> <descFile|->
 *
 * Freshness states (§13): Current | Needs review | Blocked by conflict.
 * Blocked → refuse dispatch, print conflict for Tai. Needs review → dispatch
 * proceeds only with --allow-review flag (human acknowledged staleness).
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { db, audit, ORG_ID, newId } from "./lib/runtime";
import { buildProjectContextPacket, contextHealth } from "../../src/data/projects/context-packet";
import {
  toProjectRow, toKnowledgeRow, toDecisionRow, toBlockerRow, toWorkRow,
  toAssetRow, toConnectionRow, toThinkingRow, type Row,
} from "../../src/lib/context-packet.server";
import { assignPaperclipTask } from "../../src/lib/steward-agents.server";
import { paperclipClient } from "../../src/lib/paperclip-client.server";

async function loadPacket(projectId: string, agentId?: string) {
  const supabase = db();
  const scoped = (table: string) =>
    supabase.from(table).select("*").eq("organization_id", ORG_ID).eq("project_id", projectId);

  const { data: projectRow } = await supabase
.from("projects")
.select("*")
.eq("organization_id", ORG_ID)
.eq("id", projectId)
.maybeSingle();
  if (!projectRow) throw new Error("project not found");

  const [knowledge, work, blockers, decisions, assets, connections, thinking] = await Promise.all([
    scoped("project_knowledge"),
    scoped("project_work_items"),
    scoped("project_blockers"),
    scoped("project_decisions"),
    scoped("project_assets"),
    scoped("project_connections"),
    scoped("project_thinking_sources"),
  ]);

  let agent: Parameters<typeof buildProjectContextPacket>[0]["agent"];
  if (agentId) {
    const { data: definition } = await supabase
.from("agent_effectiveness")
.select("*")
.eq("organization_id", ORG_ID)
.eq("agent_id", agentId)
.maybeSingle();
    const row = (definition ?? null) as Row | null;
    agent = {
      agentId,
      responsibility: row ? String(row["responsibility"] ?? ""): "",
      requiredContext: (row?.["required_context"] as string[]) ?? [],
      escalationRules: (row?.["escalation_rules"] as string[]) ?? [],
      evidenceExpected: (row?.["evidence_expected"] as string[]) ?? [],
    };
  }

  const project = toProjectRow(projectRow as Row);
  const packet = buildProjectContextPacket({
    project,
...(project.origin.subjectLabel ? { company: project.origin.subjectLabel }: {}),
    roadmap: project.origin.roadmapId
      ? { roadmapId: project.origin.roadmapId,...(project.origin.milestoneId ? { milestoneId: project.origin.milestoneId }: {}) }
: {},
    knowledge: ((knowledge.data ?? []) as Row[]).map(toKnowledgeRow),
    decisions: ((decisions.data ?? []) as Row[]).map(toDecisionRow),
    blockers: ((blockers.data ?? []) as Row[]).map(toBlockerRow),
    work: ((work.data ?? []) as Row[]).map(toWorkRow),
    assets: ((assets.data ?? []) as Row[]).map(toAssetRow),
    connections: ((connections.data ?? []) as Row[]).map(toConnectionRow),
    thinking: ((thinking.data ?? []) as Row[]).map(toThinkingRow),
...(agent ? { agent }: {}),
  });

  const hasDesignWork = packet.approvedAssets.some(
    (a) => a.assetType === "mockup" || a.assetType === "design_reference",
  );
  return { packet, health: contextHealth(packet, hasDesignWork) };
}

/** §13 freshness from packet state + source recency. */
function freshness(
  packet: ReturnType<typeof buildProjectContextPacket>,
  health: { level: string; reasons: string[] },
): {
  state: "Current" | "Needs review" | "Blocked by conflict";
  reasons: string[];
} {
  const reasons: string[] = [];
  if (packet.conflicts.length > 0) {
    return {
      state: "Blocked by conflict",
      reasons: packet.conflicts.map((c) => `Kept: "${c.kept}" vs source: "${c.alsoClaims}" (about ${c.about})`),
    };
  }
  if (health.level !== "strong") reasons.push(...health.reasons);
  return { state: reasons.length === 0 ? "Current": "Needs review", reasons };
}

/** §13 unresolved ingest-time conflict blocks dispatch entirely. */
async function hasUnresolvedIngestConflict(projectId: string): Promise<string[]> {
  const { data } = await db()
.from("intelligence_audit")
.select("action, subject, after_state, occurred_at")
.eq("organization_id", ORG_ID)
.eq("project_id", projectId)
.eq("action", "ingest.conflict_flagged")
.order("occurred_at", { ascending: false })
.limit(20);
  return (data ?? []).map((r) => String(r.subject));
}

function packetToPrompt(p: ReturnType<typeof buildProjectContextPacket>): string {
  const lines: string[] = [];
  lines.push(`## PROJECT: ${p.project.name}${p.project.company ? ` (${p.project.company})`: ""}`);
  if (p.project.outcome) lines.push(`Outcome: ${p.project.outcome}`);
  if (p.project.owner) lines.push(`Owner: ${p.project.owner}`);
  lines.push(`State: ${p.project.state}`);
  if (p.confirmedDecisions.length) {
    lines.push("\n## CONFIRMED KNOWLEDGE, decisions");
    p.confirmedDecisions.forEach((d) => lines.push(`- [${d.sourceLabel ?? d.authority}] ${d.statement}`));
  }
  if (p.requirements.length) {
    lines.push("\n## CONFIRMED REQUIREMENTS");
    p.requirements.forEach((r) => lines.push(`- ${r.statement}`));
  }
  if (p.constraints.length) {
    lines.push("\n## CONSTRAINTS");
    p.constraints.forEach((c) => lines.push(`- ${c.statement}`));
  }
  if (p.approvedAssets.length) {
    lines.push("\n## APPROVED ASSETS");
    p.approvedAssets.forEach((a) => lines.push(`- ${a.title} (${a.assetType} v${a.version})`));
  }
  if (p.connectedSystems.length) {
    lines.push("\n## CONNECTED BUILD ENVIRONMENT");
    p.connectedSystems.forEach((c) => lines.push(`- ${c.type}: ${c.label} [${c.status}]${c.lastSyncedAt ? ` synced ${c.lastSyncedAt}`: ""}`));
  }
  if (p.currentWork.length) {
    lines.push("\n## ACTIVE WORK");
    p.currentWork.forEach((w) => lines.push(`- ${w.title} (${w.status})`));
  }
  if (p.activeBlockers.length) {
    lines.push("\n## BLOCKERS");
    p.activeBlockers.forEach((b) => lines.push(`- ${b.reason}`));
  }
  if (p.openQuestions.length) {
    lines.push("\n## OPEN QUESTIONS");
    p.openQuestions.forEach((q) => lines.push(`- ${q.statement}`));
  }
  if (p.agentBoundaries) {
    lines.push("\n## AGENT RESPONSIBILITY");
    lines.push(p.agentBoundaries.responsibility || "(none defined)");
    if (p.agentBoundaries.evidenceExpected.length) {
      lines.push("\n## EXPECTED EVIDENCE");
      p.agentBoundaries.evidenceExpected.forEach((e) => lines.push(`- ${e}`));
    }
    if (p.agentBoundaries.mustNotChange.length) {
      lines.push("\n## DO NOT");
      p.agentBoundaries.mustNotChange.forEach((m) => lines.push(`- ${m}`));
    }
  }
  return lines.join("\n");
}

/** §21 packet audit snapshot → execution_bindings.business_outputs. */
function packetAudit(p: ReturnType<typeof buildProjectContextPacket>, knowledgeRows: { id: string; sourceReference?: string | null; section: string }[], decisionRows: { id: string }[], assetRows: { id: string }[], sourceIds: string[]) {
  return {
    context_packet: {
      version: 1,
      generated_at: p.generatedAt,
      project_id: p.project.id,
      knowledge_ids_used: knowledgeRows.filter((k) => k.section !== "open_question").map((k) => k.id),
      asset_ids_used: assetRows.map((a) => a.id),
      decision_ids_used: decisionRows.map((d) => d.id),
      source_ids_used: sourceIds,
      connection_state_used: p.connectedSystems.map((c) => `${c.type}:${c.status}`),
      conflicts_at_dispatch: p.conflicts.length,
    },
  };
}

const [cmd, projectId, a3, a4] = process.argv.slice(2);
const allowReview = process.argv.includes("--allow-review");

if (cmd === "packet") {
  const { packet, health } = await loadPacket(projectId, a3);
  const flagged = await hasUnresolvedIngestConflict(projectId);
  const f0 = freshness(packet, health);
  const f = flagged.length > 0
    ? { state: "Blocked by conflict" as const, reasons: [...f0.reasons,...flagged.map((s) => `Unresolved source conflict: ${s}`)] }
: f0;
  console.log("=== FRESHNESS ===");
  console.log(JSON.stringify(f, null, 1));
  console.log("=== HEALTH ===");
  console.log(JSON.stringify(health, null, 1));
  console.log("=== PACKET ===");
  console.log(packetToPrompt(packet));
} else if (cmd === "task") {
  const agentId = a3!;
  const descFile = a4 ?? "-";
  const description = descFile === "-" ? readFileSync(0, "utf8"): readFileSync(resolve(descFile), "utf8");
  const supabase = db();

  const { packet, health } = await loadPacket(projectId, agentId);
  const flaggedConflicts = await hasUnresolvedIngestConflict(projectId);
  const f0 = freshness(packet, health);
  const f = flaggedConflicts.length > 0
    ? { state: "Blocked by conflict" as const, reasons: [...f0.reasons,...flaggedConflicts.map((s) => `Unresolved source conflict: ${s}`)] }
: f0;
  if (f.state === "Blocked by conflict") {
    console.error("DISPATCH REFUSED, conflict requires a human decision:");
    f.reasons.forEach((r) => console.error(` - ${r}`));
    process.exit(3);
  }
  if (f.state === "Needs review" && !allowReview) {
    console.error("DISPATCH HELD, packet needs review (pass --allow-review after human ack):");
    f.reasons.forEach((r) => console.error(` - ${r}`));
    process.exit(4);
  }

  // capability gate (§14): agent must be enabled
  const { data: agentRow } = await supabase
.from("execution_agents")
.select("name, capabilities, enabled")
.eq("organization_id", ORG_ID)
.eq("paperclip_agent_id", agentId)
.eq("enabled", true)
.maybeSingle();
  if (!agentRow) {
    console.error(`DISPATCH REFUSED, agent ${agentId} not enabled/registered`);
    process.exit(5);
  }

  const taskKey = newId();
  const fullDescription = `${description}\n\n---\n# PROJECT CONTEXT PACKET (resolved ${packet.generatedAt})\n\n${packetToPrompt(packet)}`;

  const res = await assignPaperclipTask({
    organizationId: ORG_ID,
    agentId,
    title: `[${packet.project.name}] ${process.env.TASK_TITLE ?? "Project task"}`,
    description: fullDescription,
    sourceEntityId: taskKey,
    sourceEntityType: "project_task",
    sourceApp: "steward",
  });

  // §21 audit: what the agent knew at dispatch
  const knowledgeRows = ((await supabase.from("project_knowledge").select("id, section, source_reference").eq("organization_id", ORG_ID).eq("project_id", projectId).neq("review_state", "superseded").then((r) => r.data ?? [])) as { id: string; section: string; source_reference?: string | null }[]);
  const decisionRows = ((await supabase.from("project_decisions").select("id").eq("organization_id", ORG_ID).eq("project_id", projectId).then((r) => r.data ?? [])) as { id: string }[]);
  const assetRows = ((await supabase.from("project_assets").select("id").eq("organization_id", ORG_ID).eq("project_id", projectId).eq("status", "approved").then((r) => r.data ?? [])) as { id: string }[]);
  const sourceIds = [...new Set(knowledgeRows.map((k) => k.source_reference).filter((s): s is string => Boolean(s)))];

  await supabase.from("execution_bindings").update({
    business_outputs: packetAudit(packet, knowledgeRows, decisionRows, assetRows, sourceIds),
  }).eq("id", res.bindingId);

  await audit({
    projectId,
    action: "context_packet.dispatched",
    subject: `packet v1 for agent ${agentRow.name}`,
    afterState: f.state,
  });

  // wake agent (corrected client sends {})
  const wake = await paperclipClient.triggerHeartbeat(agentId);
  console.log(JSON.stringify({...res, freshness: f.state, wakeRun: (wake as { id?: string }).id ?? null, packetSections: packetToPrompt(packet).split("\n## ").length - 1 }, null, 1));
} else {
  console.error("usage: dispatch.ts packet <projectId> [agentId] | dispatch.ts task <projectId> <agentId> <title> <descFile|->");
  process.exit(1);
}
