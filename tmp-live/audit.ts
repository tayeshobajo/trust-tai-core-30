import { activePatterns, INTELLIGENCE_PATTERNS as ALL } from "../src/data/intelligence/canon/patterns";
const allPatterns = () => ALL;
import { DIAGNOSTIC_CHAINS } from "../src/data/intelligence/canon/chains";
const allChains = () => DIAGNOSTIC_CHAINS;
const emitted = new Set<string>();
const src = await Bun.file("src/data/intelligence/engine/observe.ts").text();
for (const m of src.matchAll(/kind:\s*"([a-z_]+)"/g)) emitted.add(m[1]!);
// website intel signals may add kinds
for (const f of ["src/data/website/intel.ts","src/data/intelligence/ops-signals.ts"]) {
  try { const t = await Bun.file(f).text(); for (const m of t.matchAll(/kind:\s*"([a-z_]+)"/g)) emitted.add(m[1]!); } catch {}
}
console.log("emitted kinds:", [...emitted].sort().join(", "));
const byDomain: Record<string, number> = {};
const dead: string[] = [];
for (const p of allPatterns()) {
  byDomain[p.domain] = (byDomain[p.domain] ?? 0) + 1;
  const req = p.triggers.filter(t=>!t.optional).map(t=>t.observationKind);
  const unmet = req.filter(k=>!emitted.has(k));
  if (unmet.length === req.length && req.length>0) dead.push(`${p.id} [${p.status}] requires none-emitted: ${req.join(",")}`);
  else if (unmet.length) console.log(`partial: ${p.id} missing required kinds ${unmet.join(",")}`);
  const optUn = p.triggers.filter(t=>t.optional).map(t=>t.observationKind).filter(k=>!emitted.has(k));
  if (optUn.length) console.log(`  optional-never-emitted ${p.id}: ${optUn.join(",")}`);
}
console.log("patterns total", allPatterns().length, "active", activePatterns().length, byDomain);
console.log("chains", allChains().length);
console.log("DEAD:\n" + dead.join("\n"));
// chain references
const chainIds = new Set(allChains().map(c=>c.id));
for (const p of allPatterns()) if (p.chainId && !chainIds.has(p.chainId)) console.log("bad chainId", p.id, p.chainId);
