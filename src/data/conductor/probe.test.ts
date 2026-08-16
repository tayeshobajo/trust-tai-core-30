import { it } from "vitest";
import { emptySnapshot } from "@/data/intelligence/derive";
import { engineRead } from "@/data/intelligence/engine";
import { actionsForRead } from "@/data/intelligence/engine/propose";
const ORG="org-x", NOW="2026-08-26T09:00:00.000Z";
it("probe", () => {
  const snapshot: any = {
    ...emptySnapshot(ORG, NOW),
    relationships: [1,2,3].map((i)=>({ id:`rel-${i}`, organizationId:ORG, fullName:`P${i}`, stage:"in_conversation", source:"scout_handoff", lastTouchAt:"2026-06-01T09:00:00.000Z", responseDueAt:"2026-07-01T09:00:00.000Z", observed:[], inferred:[], decided:[], metadata:{}, createdAt:"2026-06-01T09:00:00.000Z", updatedAt:"2026-06-01T09:00:00.000Z" })),
  };
  const r: any = engineRead(snapshot);
  console.log(JSON.stringify({ hyp: r.hypotheses.map((h:any)=>({id:h.id,conf:h.confidence})), recs: r.recommendations.map((x:any)=>x.id), acts: actionsForRead(r.recommendations)  }, null, 1));
});
