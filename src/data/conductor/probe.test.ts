import { it } from "vitest";
import { emptySnapshot } from "@/data/intelligence/derive";
import { engineRead } from "@/data/intelligence/engine";
import { actionsForRead } from "@/data/intelligence/engine/propose";
it("probe", () => {
  const r = engineRead({ snapshot: emptySnapshot("org-x","2026-08-26T09:00:00.000Z") } as any);
  console.log(JSON.stringify({ obs: r.observations?.map((o:any)=>o.kind), hyp: r.hypotheses?.map((h:any)=>({id:h.id,c:h.confidence?.level ?? h.confidence})), recs: r.recommendations?.map((x:any)=>x.id), acts: actionsForRead(r).map((a:any)=>a.operation) }, null, 1));
});
