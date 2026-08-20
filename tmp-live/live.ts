/* read-only live verification */
const SERVICE = process.env.TRUST_TAI_SUPABASE_SERVICE_KEY!;
const URLB = "okydosoacqdnursmmenf.supabase.co";
const realFetch = globalThis.fetch;
// @ts-ignore
globalThis.fetch = (input: any, init: any = {}) => {
  const url = typeof input === "string" ? input : input?.url ?? "";
  if (url.includes(URLB)) {
    const h = new Headers(init.headers ?? (input?.headers));
    h.set("apikey", SERVICE); h.set("Authorization", `Bearer ${SERVICE}`);
    const method = (init.method ?? input?.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") throw new Error("write blocked: " + method + " " + url);
    return realFetch(typeof input === "string" ? input : input.url, { ...init, method, headers: h });
  }
  return realFetch(input, init);
};

const { loadSuiteSnapshot } = await import("../src/data/intelligence/service");
const { observeBusiness } = await import("../src/data/intelligence/engine/observe");
const { matchPatterns, describeMatch, conciseLabel, MATCH_FLOOR, LABEL_THRESHOLD } = await import("../src/data/intelligence/canon/match");
const { chainById } = await import("../src/data/intelligence/canon/chains");
const { answerQuestion } = await import("../src/data/intelligence/conductor/answer");
const { deriveSignals } = await import("../src/data/intelligence/derive");
const { labelSignalsWithPatterns } = await import("../src/data/pulse/patterns");

const ORG = "ee683a64-e045-4226-a8ff-4ae6590d6789";
const snap = await loadSuiteSnapshot(ORG);
console.log("== SNAPSHOT ==", JSON.stringify({
  withheld: snap.withheld, candidates: snap.candidates.length, relationships: snap.relationships.length,
  roadmaps: snap.roadmaps.length, projects: snap.projects.length, events: snap.events.length,
  website: snap.websiteSubmissions?.length, decisions: snap.openDecisions.length,
}));
const obs = observeBusiness(snap);
console.log("== OBSERVATIONS ==", obs.length);
for (const o of obs) console.log(` - ${o.kind} [${o.tier}] mag=${o.magnitude ?? "-"} :: ${o.statement}`);
const matches = matchPatterns({ observations: obs });
const { canonDomainsForQuestion } = await import("../src/data/intelligence/canon/relevance");
console.log("== MATCHES (floor", MATCH_FLOOR, "label", LABEL_THRESHOLD, ") ==", matches.length);
for (const m of matches) {
  console.log(JSON.stringify({
    pattern: m.patternId, name: m.patternName, domain: m.domain, score: m.score, confidence: m.confidence,
    label: conciseLabel(m),
    matched: m.matched.map(e => ({ id: e.observationId, kind: e.observationKind, tier: e.tier })),
    missing: m.missingEvidence.map(e => e.inspect),
    competing: m.competingExplanations.map(c => c.explanation),
    chain: m.recommendedChainId, chainName: m.recommendedChainId ? chainById(m.recommendedChainId)?.name : null,
    nextMoves: m.possibleNextMoves.map(n => `${n.appId}: ${n.move}`),
  }, null, 1));
  console.log("   describe:", describeMatch(m));
}
console.log("== CONDUCTOR ==");
for (const q of ["What deserves my attention today?", "What is quietly getting worse?", "Why is delivery slow?", "Am I becoming the bottleneck?"]) {
  const a = answerQuestion({ snapshot: snap, question: q });
  console.log("\nQ:", q, "domains:", JSON.stringify(canonDomainsForQuestion(q)));
  console.log(JSON.stringify({ answer: a.answer, grounded: (a as any).grounded, nextMove: a.nextMove, evidence: a.evidence?.map((e:any)=>e.label) }, null, 1));
}
console.log("== PULSE ==");
const signals = deriveSignals(snap);
const labeled = labelSignalsWithPatterns(signals, matchPatterns({ observations: obs, limit: 5 }));
console.log("signals", signals.length, "labeled", labeled.length);

const same = signals.every((s,i)=>labeled[i]!.id===s.id && (labeled[i] as any).severity===(s as any).severity && JSON.stringify({...labeled[i],patternLabel:undefined})===JSON.stringify({...s,patternLabel:undefined}));
console.log("order+severity+content unchanged:", same);
console.log(JSON.stringify(labeled.map((s:any)=>({id:s.id,sev:s.severity,room:s.sourceApp,pattern:s.patternLabel??null})),null,1));
console.log("labels per room:", JSON.stringify(labeled.reduce((a:any,s:any)=>{if(s.patternLabel)a[s.sourceApp]=(a[s.sourceApp]??0)+1;return a;},{})));
console.log("new signals created:", labeled.length - signals.length);
