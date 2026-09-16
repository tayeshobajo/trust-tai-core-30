import { searchPeople, enrichmentStatus } from "@/lib/contact-enrichment.server";
const status = enrichmentStatus();
console.log("status", JSON.stringify(status));
try {
  const r = await searchPeople({
    companyName: "Acumen Technology",
    domain: "acumentechnology.com",
    roleFamilies: ["Operations", "Technology"],
    limit: 4,
  });
  console.log("provider", r.provider, "count", r.people.length);
  console.log(JSON.stringify(r.people.slice(0,4).map(p => ({
    fullName: p.fullName, title: p.title, id: p.providerPersonId,
    hasEmail: Boolean((p as Record<string, unknown>)["email"]),
  })), null, 2));
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.log("FAILED", e?.constructor?.name, msg.replace(/[A-Za-z0-9_-]{25,}/g, "[redacted]"));
}
