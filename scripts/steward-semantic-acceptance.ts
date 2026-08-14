import { fetchFathomConversation } from "@/lib/steward-fathom.server";
import { parseConversationLink } from "@/lib/conversation-source";
import { detectCandidates } from "@/data/steward/candidates";
import { interpretConversation } from "@/lib/steward-interpret.server";
import { dispositionCounts } from "@/domain/steward-semantic";
import { reviewableSignals } from "@/data/steward/interpretation";

const ref = parseConversationLink("https://fathom.video/calls/779145597")!;
const conversation = await fetchFathomConversation(ref);
const candidates = detectCandidates(conversation);
console.log("meeting:", conversation.title, "| segments:", conversation.segments.length, "| candidates:", candidates.length);

const run = await interpretConversation({
  conversation,
  memory: { available: false, because: "No workspace session in this environment.", openCommitments: [], people: [], projects: [] },
  commitments: [],
  candidates,
});
console.log("model:", run.provider, run.model);
console.log(dispositionCounts(run.signals));
for (const s of reviewableSignals(run.signals)) {
  console.log(`\n[${s.disposition}|${s.confidence}|${s.truthTier}] ${s.at} owner=${s.ownerName ?? "—"} due="${s.dueText ?? "—"}"`);
  console.log("  meaning:", s.normalizedMeaning);
  console.log("  why:", s.rationale);
  if (s.ambiguity) console.log("  unclear:", s.ambiguity);
  console.log("  said:", s.quote.slice(0, 140));
}
