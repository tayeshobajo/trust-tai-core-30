import { publishQueuedItem } from "../../src/lib/content-publish.server";
const out = await publishQueuedItem({
  token: process.env.TRUST_TAI_SUPABASE_SERVICE_KEY!,
  organizationId: "ee683a64-e045-4226-a8ff-4ae6590d6789",
  itemId: "citm_da7jlq4nmtn2yer2",
});
console.log(JSON.stringify(out, null, 1));
