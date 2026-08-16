import { it } from "vitest";
import { emptySnapshot } from "@/data/intelligence/derive";
import { answerQuestion } from "@/data/intelligence/conductor";
it("probe", () => {
  const a = answerQuestion({ snapshot: emptySnapshot("org-x","2026-08-26T09:00:00.000Z"), question: "our pipeline is thin, how do we find more qualified companies" } as any);
  console.log(JSON.stringify({ actions: a.proposedActions.map(x=>({id:x.id,op:x.operation,app:x.appId,payload:x.payload})), graph: !!a.actionGraph, res: a.inputResolutions }, null, 1));
});
