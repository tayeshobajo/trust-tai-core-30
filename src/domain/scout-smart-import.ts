/**
 * Scout Smart Import, the contract.
 *
 * A person hands Scout a source: a file, a link, or some text. Scout reads it
 * and says which companies it found, where in the source it found them, and
 * which parts it had to infer. Nothing here is durable: an extraction is a
 * proposal a person reviews, and only an explicit save writes anything.
 */

/** Where the text came from. The label is shown, never stored. */
export type SmartImportKind = "file" | "link" | "text";

export interface SmartImportSource {
  kind: SmartImportKind;
  /** File name, link, or "pasted text". Shown on the staged banner. */
  label: string;
}

/** Observed = read literally from the source. Inferred = Scout's reading. */
export type ExtractionConfidence = "observed" | "inferred";

export interface ExtractedCompany {
  name: string;
  websiteUrl: string | null;
  /** Whether the website was literally in the source or inferred from it. */
  websiteConfidence: ExtractionConfidence;
  /** Anything the source said about them that a person might want. */
  note: string | null;
  /** One sentence: why Scout believes this is a company in this source. */
  because: string;
  /** Verbatim snippet from the source. Must actually appear in it. */
  excerpt: string;
}

export const SMART_IMPORT_LEAD =
  "Scout reads what you give it and shows you what it found. Nothing is saved until you save it.";

export const SMART_IMPORT_LINK_HELP =
  "A public Google Sheet, Google Doc or web page. Private Google files cannot be read yet.";

export const SMART_IMPORT_FILE_HELP =
  "CSV, TSV, text and Markdown. Spreadsheet workbooks: export as CSV first.";

/** The stages the reading pass reports, in order. */
export type SmartImportStageName = "reading" | "extracting" | "checking" | "done" | "error";

export interface SmartImportStage {
  stage: SmartImportStageName;
  message: string;
  companies?: ExtractedCompany[];
  /** True when the deterministic delimited reader answered instead of a model. */
  deterministic?: boolean;
  /** False when no intelligence provider answered at all. */
  providerAnswered?: boolean;
}
