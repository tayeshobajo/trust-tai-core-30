import { openCase, resolveCase, recordPatternOutcome, patternStanding, proposePatternRevision } from "../src/data/intelligence/canon/cases";
import { patternById } from "../src/data/intelligence/canon/patterns";
import { matchPatterns } from "../src/data/intelligence/canon/match";
const obs = [
  { id: "obs:reply_debt:0", kind: "reply_debt", statement: "1 relationship is past a date.", tier: "observed", sourceApps: ["comms"], magnitude: 1, occurredAt: new Date().toISOString() },
] as any;
const match = matchPatterns({ observations: obs })[0]!;
const now = "2026-08-20T19:00:00.000Z";
const c = openCase({ organizationId: "org-dev", match, entities: [], hypothesis: "Reply debt is real", humanDecision: "Answer the oldest thread", decidedBy: "user-dev", now });
console.log("openCase:", c.id, c.patternId, c.evidenceRefs);
const resolved = resolveCase(c, { outcome: "Replied", outcomeAt: now, verdict: "correct" });
console.log("resolveCase verdict:", resolved.diagnosisVerdict, "decision preserved:", resolved.humanDecision === c.humanDecision);
const mk = (i: number, result: any, correction?: string) => recordPatternOutcome({ organizationId: "org-dev", match, caseId: c.id, recommendation: "Answer oldest thread", decision: "accepted", result, resultBecause: "checked", decidedAt: now, recordedBy: "user-dev", now: `2026-08-2${i}T19:00:00.000Z`, ...(correction?{humanCorrection:correction}:{}) });
const one = [mk(1, "failure")];
console.log("1 outcome -> proposal:", proposePatternRevision(match.patternId, one));
const three = [mk(1,"failure"), mk(2,"failure"), mk(3,"failure")];
const p3 = proposePatternRevision(match.patternId, three);
console.log("3 outcomes -> proposal:", JSON.stringify(p3));
console.log("standing:", JSON.stringify(patternStanding(match.patternId, three)));
const before = JSON.stringify(patternById(match.patternId));
console.log("base pattern unchanged after proposal:", before === JSON.stringify(patternById(match.patternId)));
const mixed = [mk(1,"success"), mk(2,"success"), mk(3,"success", "This is not reply debt, the client replied by phone.")];
console.log("correction outranks results:", JSON.stringify(patternStanding(match.patternId, mixed).guidance));
console.log("proposal from correction:", JSON.stringify(proposePatternRevision(match.patternId, mixed)?.suggestion));
