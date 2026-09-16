import { enrichWorkEmail } from "@/lib/contact-enrichment.server";
try {
  const r = await enrichWorkEmail({
    fullName: "Keith",
    companyName: "Acumen Technology",
    domain: "acumentechnology.com",
    providerPersonId: "5b284b74a6da98c36b579569",
  });
  console.log(JSON.stringify(r, null, 2));
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.log("FAILED", (e as { name?: string })?.name, (e as { status?: number })?.status, msg.slice(0, 300));
}
