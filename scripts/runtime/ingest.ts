#!/usr/bin/env npx tsx
/**
 * R1: Ingestion, external source → normalized doc → knowledge extraction →
 * project_knowledge (needs_review, provenance kept), incremental (§8),
 * honest sync_state (§4), audit every mutation (§20).
 *
 * Usage:
 *   npx tsx scripts/runtime/ingest.ts <projectId> <sourceId> <file|->   # file path or stdin
 *   npx tsx scripts/runtime/ingest.ts status <projectId>                # source states
 *
 * Dedup strategy (no schema change): knowledge rows are keyed by
 * source_reference (source id) + runtime content-hash prefix embedded in
 * source_label is NOT used (that must stay the human source title). Instead
 * we compare candidate bodies against existing rows for the same source:
 * identical body → skip; new → insert; near-conflict → surface, never write.
 */
import { readFileSync } from "fs";
import { resolve, basename } from "path";
import { db, audit, ORG_ID, sha256 } from "./lib/runtime";
import { normalizeDocument, type NormalizedDocument } from "./lib/normalize";

// Reuse the product's own extraction cues, single extraction brain.
import { parseThinkingImport } from "../../src/data/projects/thinking-import";

async function loadSource(projectId: string, sourceId: string) {
  const { data, error } = await db()
.from("project_thinking_sources")
.select("*")
.eq("organization_id", ORG_ID)
.eq("project_id", projectId)
.eq("id", sourceId)
.maybeSingle();
  if (error || !data) throw new Error(`source not found: ${error?.message ?? sourceId}`);
  return data as Record<string, string | boolean | null>;
}

async function ingest(projectId: string, sourceId: string, rawPath: string) {
  const raw = rawPath === "-" ? readFileSync(0, "utf8"): readFileSync(resolve(rawPath), "utf8");
  const source = await loadSource(projectId, sourceId);
  const { data: inputDecisions } = await db()
.from("project_decisions")
.select("question, answer, status")
.eq("organization_id", ORG_ID)
.eq("project_id", projectId);
  const provider = (source.source_type as NormalizedDocument["provider"]) ?? "other";
  const title = String(source.title ?? "thinking room");

  const doc = normalizeDocument({ source_id: sourceId, provider, title, raw });

  // §4 honest state: a transcript/export was genuinely provided.
  await db()
.from("project_thinking_sources")
.update({ sync_state: "imported", last_reviewed_at: new Date().toISOString() })
.eq("id", sourceId);
  await audit({
    projectId,
    projectName: undefined,
    action: "source.imported",
    subject: title,
    beforeState: String(source.sync_state ?? ""),
    afterState: "imported",
  });

  // §8 incremental: existing rows for this source
  const { data: existing } = await db()
.from("project_knowledge")
.select("id, section, body, review_state")
.eq("organization_id", ORG_ID)
.eq("project_id", projectId)
.eq("source_reference", sourceId);
  const existingBodies = new Map(
    (existing ?? []).map((r) => [String(r.body).trim().toLowerCase(), r as { id: string; review_state: string }]),
  );

  // Extraction over the normalized document (§5), assistant voice only, // Tai's prompts are questions, not knowledge; extracting them pollutes
  // open questions with transcript noise.
  const seen = new Set<string>();
  const candidates: { section: string; body: string; confidence: number; msgIndex: number }[] = [];
  const docText = doc.messages.filter((m) => m.role === "assistant").map((m) => m.body).join("\n");
  const allParsed = parseThinkingImport(docText);
  for (const c of allParsed) {
    const key = `${c.section}:${c.body.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({...c, msgIndex: -1 });
  }

  let inserted = 0;
  let skipped = 0;
  const conflicts: { existing: string; incoming: string }[] = [];

  for (const c of candidates) {
    const bodyKey = c.body.trim().toLowerCase();
    const dupe = existingBodies.get(bodyKey);
    if (dupe) {
      skipped++;
      continue;
    }
    // §9 conflict surface (never overwrite): same section + shared 6+ word
    // prefix with different tail → flag for human.
    const near = (existing ?? []).find(
      (r) =>
        r.section === c.section &&
        !r.review_state.includes("superseded") &&
        String(r.body).trim().toLowerCase() !== bodyKey &&
        sharePrefix(String(r.body), c.body, 6),
    );
    if (near) {
      conflicts.push({ existing: String(near.body), incoming: c.body });
      continue; // do not write; human decides
    }
    // §9 human-decision outranks source: a candidate DECISION that negates a
    // confirmed decision or answered project decision is surfaced, not written.
    if (c.section === "decision") {
      const negates = (inputDecisions ?? []).some(
        (d) => String(d.answer ?? "").length > 0 && contradicts(String(d.answer), c.body),
      ) || (existing ?? []).some(
        (r) => r.section === "decision" && r.review_state === "confirmed" && contradicts(String(r.body), c.body),
      );
      if (negates) {
        conflicts.push({ existing: "confirmed project decision", incoming: c.body });
        await audit({
          projectId,
          action: "ingest.conflict_flagged",
          subject: `Confirmed decision vs source: ${c.body.slice(0, 180)}`,
          afterState: "awaiting human",
        });
        continue;
      }
    }
    await db().from("project_knowledge").insert({
      organization_id: ORG_ID,
      project_id: projectId,
      section: c.section,
      body: c.body,
      origin: "thinking_room",
      review_state: "needs_review",
      source_reference: sourceId,
      source_label: title,
      confidence: c.confidence,
      captured_at: new Date().toISOString(),
    });
    await audit({
      projectId,
      action: "knowledge.detected",
      subject: c.body.slice(0, 200),
      afterState: "needs_review",
    });
    inserted++;
  }

  console.log(
    JSON.stringify(
      {
        source: title,
        provider,
        messages: doc.messages.length,
        contentHash: doc.content_hash.slice(0, 16),
        candidates: candidates.length,
        inserted,
        skippedUnchanged: skipped,
        conflictsFlagged: conflicts.length,
        conflicts,
      },
      null,
      1,
    ),
  );
}

/**
 * Polarity-aware overlap: statements contradict when they share meaningful
 * topic words but carry opposing negation. Conservative by design, when
 * unsure, it does not flag (a missed flag is reviewable; a false block is
 * dispatch friction).
 */
function contradicts(confirmed: string, incoming: string): boolean {
  const negCues = ["no ", "not ", "never ", "must not", "should not", "avoid"];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ");
  const a = norm(confirmed), b = norm(incoming);
  const aNeg = negCues.some((c) => a.includes(c));
  const bNeg = negCues.some((c) => b.includes(c));
  if (aNeg === bNeg) return false;
  const wordsA = new Set(a.split(/\s+/).filter((w) => w.length > 4 && !STOP.has(w)));
  const wordsB = b.split(/\s+/).filter((w) => w.length > 4 && !STOP.has(w));
  let shared = 0;
  for (const w of wordsB) if (wordsA.has(w)) shared++;
  return shared >= 2;
}
const STOP = new Set(["decision", "should", "would", "could", "clients", "client", "every", "there", "about", "which", "through"]);

function sharePrefix(a: string, b: string, words: number): boolean {
  const aw = a.toLowerCase().split(/\s+/).slice(0, words).join(" ");
  const bw = b.toLowerCase().split(/\s+/).slice(0, words).join(" ");
  return aw.length > 10 && aw === bw;
}

async function status(projectId: string) {
  const { data } = await db()
.from("project_thinking_sources")
.select("id, title, source_type, sync_state, last_reviewed_at")
.eq("organization_id", ORG_ID)
.eq("project_id", projectId);
  console.log(JSON.stringify(data ?? [], null, 1));
}

const [cmd, a, b, c] = process.argv.slice(2);
if (cmd === "status") await status(a!);
else if (cmd && a && b) await ingest(cmd, a, b ?? c ?? "-");
else {
  console.error("usage: ingest.ts <projectId> <sourceId> <file|-> | ingest.ts status <projectId>");
  process.exit(1);
}
