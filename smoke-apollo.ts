import { searchPeople } from "@/lib/contact-enrichment.server";
const r = await searchPeople({
  companyName: "Acumen Technology",
  domain: "acumentechnology.com",
  roleFamilies: ["Operations", "Technology"],
  limit: 4,
});
console.log("provider", r.provider, "count", r.people.length);
for (const p of r.people.slice(0,4)) console.log(`- ${p.fullName} | ${p.title ?? "no title"} | ${p.providerPersonId ?? "no id"} | email in search: ${Boolean((p as Record<string,unknown>)["email"])}`);
