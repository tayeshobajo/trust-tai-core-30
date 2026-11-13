/** Explicit platform translation, never general URL normalization or forwarded-header trust.
 * Input is the Request API's URL string, not necessarily the original HTTP request-target.
 * Raw spellings already normalized by the platform cannot be recovered here.
 */
export const CALLBACK_EXTERNAL_BASE =
  "https://okydosoacqdnursmmenf.supabase.co/functions/v1/studio-research-coordinator";
export const CALLBACK_RUNTIME_BASE =
  "http://okydosoacqdnursmmenf.supabase.co/studio-research-coordinator";
const fixedTrial = "6e04eb1f-720b-4b43-86a7-7330207a94aa";
const paths = [
  "/diagnostic",
  ...["authority", "admission", "result"].map((op) => `/${fixedTrial}/${op}`),
];
/** Exact string checks reject visible ports, credentials, fragments, queries, escapes and dot segments.
 * The runtime HTTP representation is a platform-internal identity only; clients still use HTTPS.
 */
export function callbackDestinationMatches(
  observedUrl: string,
  method: string,
  canonicalDestination: string,
): boolean {
  if (method !== "POST") return false;
  const suffix = paths.find((path) => canonicalDestination === CALLBACK_EXTERNAL_BASE + path);
  if (!suffix) return false;
  return observedUrl === canonicalDestination || observedUrl === CALLBACK_RUNTIME_BASE + suffix;
}
