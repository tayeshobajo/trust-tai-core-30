/**
 * Scout live acceptance harness — DEVELOPMENT/QA ONLY.
 *
 * Not part of the app bundle and not routable. It exercises the exact same
 * provider selection, request building, structured-output parsing, evidence
 * rules and de-duplication the live server boundary uses, without creating a
 * public unauthenticated route and without touching the database.
 *
 * Run: bun scripts/scout-live-qa.ts "IT companies in Nashville"
 */

import {
  acceptCandidates,
  discoveryEvaluation,
  type RawDiscoveryCandidate,
} from "../src/data/scout-candidate-validation";
import { buildDiscoveryRequestBody } from "../src/lib/scout-discovery-request";
import { selectScoutProvider } from "../src/lib/scout-provider.server";

const query = process.argv[2] ?? "IT companies in Nashville";
const limit = Number(process.argv[3] ?? 8);

const ICP = `Trust Tai ideal client profile (QA harness copy)
- Established B2B services or technology company
- Roughly 10-250 employees
- Has a real public website with services and contact information
- Operating in the United States
- Values long-term partnership over one-off project work
Hard disqualifier: consumer-only retail businesses.`;

const selected = selectScoutProvider();
if (!selected) {
  console.error("FAIL: no provider configured (neither OPENAI_API_KEY nor LOVABLE_API_KEY).");
  process.exit(1);
}

console.log(`provider=${selected.provider} model=${selected.model} endpoint=${selected.endpoint}`);

const body = buildDiscoveryRequestBody({
  model: selected.model,
  query,
  limit,
  icp: ICP,
  calibration: "",
});

const usesWebSearch = JSON.stringify((body as { tools: unknown }).tools).includes("web_search");
console.log(`web_search requested: ${usesWebSearch}`);

const response = await fetch(selected.endpoint, {
  method: "POST",
  headers: selected.headers,
  body: JSON.stringify(body),
});

if (!response.ok || !response.body) {
  console.error(`FAIL: provider returned ${response.status}: ${(await response.text()).slice(0, 800)}`);
  process.exit(1);
}

const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let raw = "";
let sawWebSearchCall = false;
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = String(event["type"] ?? "");
    if (type.includes("web_search")) sawWebSearchCall = true;
    if (type === "response.output_text.delta" && typeof event["delta"] === "string") {
      raw += event["delta"];
    }
    if (type === "response.failed" || type === "error") {
      console.error(`FAIL: provider run failed: ${JSON.stringify(event).slice(0, 600)}`);
      process.exit(1);
    }
  }
}

console.log(`web_search tool invoked in run: ${sawWebSearchCall}`);

let candidates: RawDiscoveryCandidate[] = [];
try {
  const parsed = JSON.parse(raw) as { candidates?: unknown };
  candidates = Array.isArray(parsed.candidates) ? (parsed.candidates as RawDiscoveryCandidate[]) : [];
} catch {
  console.error(`FAIL: structured output did not parse. First 400 chars: ${raw.slice(0, 400)}`);
  process.exit(1);
}
console.log(`structured output parsed: true, returned=${candidates.length}`);

const { accepted, rejected, duplicates } = acceptCandidates(candidates);
console.log(`accepted=${accepted.length} rejected=${rejected} duplicates=${duplicates}`);

const at = new Date().toISOString();
for (const { domain, candidate } of accepted.slice(0, 5)) {
  const evaluation = discoveryEvaluation(candidate, { icpVersion: 1, at });
  const unknownCriteria = (evaluation["criteria"] as Array<Record<string, unknown>>).filter(
    (c) => c["state"] === "missing",
  );
  console.log(
    [
      `- ${candidate.company_name} (${domain})`,
      `  light=${evaluation["light"]} score=${evaluation["score"]} confidence=${evaluation["confidence"]} evidence=${evaluation["evidenceCount"]} sources=${(candidate.source_urls ?? []).length}`,
      `  strongest: ${String(evaluation["strongestSignal"]).slice(0, 160)}`,
      `  unknown-criteria=${unknownCriteria.length} (must not be scored as mismatch)`,
    ].join("\n"),
  );
}

const everyHasDomainAndSource = accepted.every(
  ({ domain, candidate }) => Boolean(domain) && (candidate.source_urls ?? []).length > 0,
);
const uniqueDomains = new Set(accepted.map((a) => a.domain)).size === accepted.length;
console.log(`every accepted has root domain + source url: ${everyHasDomainAndSource}`);
console.log(`root domains unique: ${uniqueDomains}`);
console.log(accepted.length > 0 && everyHasDomainAndSource && uniqueDomains ? "PASS" : "FAIL");
