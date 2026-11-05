import { blankOpportunity, type OpportunityInput } from "./rfps";
export const MAX_SOURCE_TEXT = 16000;
export interface IntakeSource {
  text: string;
  title?: string;
  url?: string;
  fileName?: string;
  sha256?: string;
  warning?: string;
}
/** Conservative labeled-field extraction, never inferred eligibility or submission state. */
export function reviewSource(source: IntakeSource): OpportunityInput {
  const text = source.text.replace(/\r/g, "").trim();
  const lines = text
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
  const labeled = (pattern: RegExp) =>
    lines.map((x) => x.match(pattern)?.[1]?.trim()).find(Boolean) || "";
  const title =
    source.title ||
    labeled(/^(?:opportunity title|project title|title)\s*:\s*(.+)$/i) ||
    lines.find((x) => x.length > 8 && x.length <= 180) ||
    source.fileName?.replace(/\.[^.]+$/, "") ||
    "";
  const issuer = labeled(/^(?:issuing organization|issued by|issuer|funder)\s*:\s*(.+)$/i);
  const cycle = labeled(
    /^(?:solicitation (?:id|number)|rfp (?:number|no\.?|id)|application cycle)\s*:\s*(.+)$/i,
  );
  const deadline = labeled(
    /^(?:deadline|due date|submission deadline)\s*:\s*(\d{4}-\d{2}-\d{2})\s*$/i,
  );
  const provenance = source.url
    ? `Source URL: ${source.url}`
    : `Source document: ${source.fileName}\nSHA-256: ${source.sha256}`;
  return {
    ...blankOpportunity,
    title: title.slice(0, 240),
    source_name: issuer.slice(0, 240),
    cycle: cycle.slice(0, 120),
    source_url: source.url || "",
    source_file_sha256: source.sha256 || "",
    kind: /\bgrants?\b/i.test(title) ? "grant" : "rfp",
    deadline_date: deadline,
    next_action: "Review the source, requirements and eligibility.",
    source_evidence: `${provenance}\nExtracted text for review (not verified facts):\n${text.slice(0, MAX_SOURCE_TEXT)}${text.length > MAX_SOURCE_TEXT ? "\n[Excerpt truncated; consult original source.]" : ""}${source.warning ? "\nExtraction note: " + source.warning : ""}`,
  };
}
