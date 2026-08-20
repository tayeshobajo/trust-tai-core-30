import { INTELLIGENCE_PATTERNS as P } from "../src/data/intelligence/canon/patterns";
const map = new Map<string,string[]>();
for (const p of P) {
  const req = p.triggers.filter(t=>!t.optional).map(t=>`${t.observationKind}${t.minMagnitude?">="+t.minMagnitude:""}`).sort().join("+");
  map.set(req, [...(map.get(req)??[]), `${p.id}(${p.domain})`]);
}
for (const [k,v] of map) console.log((v.length>1?"DUP ":"    ")+k+" -> "+v.join(", "));
