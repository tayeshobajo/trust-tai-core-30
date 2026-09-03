#!/usr/bin/env npx tsx
/**
 * ACCEPTANCE RUN 2026-08-18, full loop via REAL app code paths, no code changes.
 *
 * Steps: assign (assignPaperclipTask) → wake (triggerHeartbeat) → poll run
 * → comments → Tai reply (postTaiNoteToIssue). Reconciliation is deliberately
 * NOT called here, the launchd 5-min sweep owns convergence.
 *
 * Usage:
 *   npx tsx scripts/qa/acceptance-run.ts assign     # step 1+2: assign + wake
 *   npx tsx scripts/qa/acceptance-run.ts poll       # step 3: run status + comments
 *   npx tsx scripts/qa/acceptance-run.ts reply      # step 4: Tai reply (if needed)
 *   npx tsx scripts/qa/acceptance-run.ts verify     # step 6: binding state (read-only)
 */
import { readFileSync, existsSync, writeFileSync } from "fs";
import { resolve } from "path";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) {
      const key = line.slice(0, i).trim();
      const val = line.slice(i + 1).trim();
      if (key && !process.env[key]) process.env[key] = val;
    }
  }
}

const STATE_FILE = resolve(process.cwd(), ".acceptance-state.json");
const ORG = "ee683a64-e045-4226-a8ff-4ae6590d6789";
const COMMS_AGENT = "239a7269-6309-4547-bd54-67e4e3798b85";
const TASK_KEY = "b31ca1fc-9049-4558-b4dc-4083fd2f2721";

type State = { issueId?: string; bindingId?: string; runId?: string };
const load = (): State => (existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")): {});
const save = (s: State) => writeFileSync(STATE_FILE, JSON.stringify(s, null, 1));

const cmd = process.argv[2];

if (cmd === "assign") {
  const { assignPaperclipTask } = await import("../../src/lib/steward-agents.server");
  const res = await assignPaperclipTask({
    organizationId: ORG,
    agentId: COMMS_AGENT,
    title: "Acceptance run: post a progress summary and close",
    description:
      "Bounded acceptance task (human-in-the-loop test, 2026-08-18).\n\n" +
      "1. Post ONE comment on this issue: a 2-3 sentence status summary in your own words confirming you received and understood this task.\n" +
      "2. Set this issue's status to done.\n\nNo other writes. No external calls. This is a smoke acceptance of the Trust Tai <-> Paperclip loop.",
    sourceEntityId: TASK_KEY,
    sourceEntityType: "task",
    sourceApp: "steward",
  });
  console.log(JSON.stringify(res, null, 1));
  save({...load(), issueId: res.issueId, bindingId: res.bindingId });

  const { paperclipClient } = await import("../../src/lib/paperclip-client.server");
  const wake = await paperclipClient.triggerHeartbeat(COMMS_AGENT);
  console.log("WAKE:", JSON.stringify(wake).slice(0, 240));
  save({...load(), runId: (wake as { id?: string }).id });
} else if (cmd === "poll") {
  const s = load();
  const { paperclipClient } = await import("../../src/lib/paperclip-client.server");
  const [comments, runs] = await Promise.all([
    paperclipClient.getIssueComments(s.issueId!),
    fetch(`${process.env.PAPERCLIP_API_URL}/api/companies/aaa4eceb-44fb-4492-823c-65d3d90c5519/heartbeat-runs?agentId=${COMMS_AGENT}&limit=3`, {
      headers: { Authorization: `Bearer ${process.env.PAPERCLIP_BOARD_KEY}` },
    }).then((r) => r.json() as Promise<Array<{ id: string; status: string; startedAt: string | null; finishedAt: string | null }>>),
  ]);
  console.log("RUNS:", JSON.stringify(runs?.map((r) => ({ id: r.id.slice(0, 8), status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt })), null, 1));
  console.log("COMMENTS:", comments.length);
  for (const c of comments.slice(-5)) {
    console.log("---", (c as { id: string; authorType?: string; createdAt?: string }).id.slice(0, 8), (c as { createdAt?: string }).createdAt ?? "");
    console.log(((c as { body: string }).body ?? "").slice(0, 400));
  }
} else if (cmd === "reply") {
  const s = load();
  const { postTaiNoteToIssue } = await import("../../src/lib/steward-agents.server");
  const res = await postTaiNoteToIssue({
    issueId: s.issueId!,
    note: "Acknowledged, carry on and close it out when done.",
    taiName: "Tai",
  });
  console.log("REPLY POSTED:", JSON.stringify(res));
} else if (cmd === "verify") {
  const s = load();
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.TRUST_TAI_SUPABASE_URL!, process.env.TRUST_TAI_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
  const { data: b } = await sb.from("execution_bindings").select("id,status,result_summary,updated_at").eq("id", s.bindingId!).single();
  console.log("BINDING:", JSON.stringify(b, null, 1));
  const { data: ss } = await sb.from("paperclip_sync_state").select("last_success_at,last_error,consecutive_failures,updated_at").eq("organization_id", ORG).eq("resource_type", "agents").single();
  console.log("SYNC_STATE:", JSON.stringify(ss, null, 1));
} else {
  console.error("usage: assign|poll|reply|verify");
  process.exit(1);
}
