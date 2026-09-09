/**
 * Smart Import, the server side.
 *
 * Two jobs, both bounded: fetch the text of a public source, and ask the
 * shared intelligence runtime what companies that text names. Scout does not
 * own a model here; the runtime boundary does. When no provider answers, the
 * deterministic delimited reader answers instead, so a CSV still imports.
 */

import {
  extractJsonObject,
  ProviderCallFailedError,
  ProviderNotConfiguredError,
  runtimeModelCaller,
} from "@/lib/intelligence-runtime.server";
import type { createLovableAiGatewayRunIdFetch } from "@/lib/ai-gateway.server";
import {
  readLink,
  SMART_IMPORT_INSTRUCTIONS,
  SMART_IMPORT_TEXT_LIMIT,
  verifyExtraction,
  type VerifiedExtraction,
} from "@/data/scout/smart-import";
import { parseDelimitedRows, looksLikeHeader } from "@/data/scout/watchlist";
import type { ExtractedCompany } from "@/domain/scout-smart-import";
import { normalizeWebsiteUrl } from "@/lib/website-url";

/** Nothing larger is pulled into memory or handed to a model. */
const MAX_SOURCE_BYTES = 2_000_000;

export class SourceUnreadableError extends Error {}

/**
 * Fetch a public link as text. A Google Sheet or Doc is read through its
 * export address, which only answers when the file is genuinely shared: a
 * private file returns a sign-in page, and we say so rather than importing it.
 */
export async function fetchSourceText(rawLink: string): Promise<{ text: string; label: string }> {
  const read = readLink(rawLink);
  if (!read.readable) throw new SourceUnreadableError(read.because);

  let response: Response;
  try {
    response = await fetch(read.url, { redirect: "follow" });
  } catch {
    throw new SourceUnreadableError("That link could not be reached. Nothing was staged.");
  }

  if (!response.ok) {
    throw new SourceUnreadableError(
      read.kind === "web"
        ? `That page could not be read (${response.status}). Nothing was staged.`
        : "That Google file is not shared publicly, so Scout cannot read it. Share it with anyone who has the link, or export it and upload the file.",
    );
  }

  const type = (response.headers.get("Content-Type") ?? "").toLowerCase();
  if (type.includes("text/html") && read.kind !== "web") {
    throw new SourceUnreadableError(
      "That Google file asked Scout to sign in, so it is not shared publicly. Share it with anyone who has the link, or export it and upload the file.",
    );
  }
  if (!/^(text\/|application\/(json|csv))/.test(type) && type) {
    throw new SourceUnreadableError(
      "That link is not a readable text document. Nothing was staged.",
    );
  }

  const body = await response.text();
  if (body.length > MAX_SOURCE_BYTES) {
    throw new SourceUnreadableError("That source is too large to read in one pass.");
  }

  const text = read.kind === "web" ? stripMarkup(body) : body;
  if (!text.trim()) {
    throw new SourceUnreadableError("Nothing readable was found at that link.");
  }
  return { text, label: rawLink.trim() };
}

/** Reduce a page to its readable text. No parsing beyond that is claimed. */
export function stripMarkup(html: string): string {
  if (!/<[a-z!/]/i.test(html)) return html;
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface ExtractionOutcome extends VerifiedExtraction {
  /** True when the delimited reader answered because no provider did. */
  deterministic: boolean;
  /**
   * False when no intelligence provider answered at all. A deterministic read
   * is never presented as an AI read, and an empty deterministic read after a
   * provider failure is reported as a failure, not as "nothing found".
   */
  providerAnswered: boolean;
  provider: string;
  model: string;
}

/**
 * Read companies out of source text. Verified against the text before it
 * leaves this function: an untraceable row never reaches a person.
 */
export async function extractCompanies(input: {
  token: string;
  organizationId: string;
  text: string;
  gateway?: ReturnType<typeof createLovableAiGatewayRunIdFetch> | undefined;
}): Promise<ExtractionOutcome> {
  const text = input.text.slice(0, SMART_IMPORT_TEXT_LIMIT);

  let callModel;
  try {
    callModel = await runtimeModelCaller({
      token: input.token,
      organizationId: input.organizationId,
      room: "scout",
      purpose: "import",
    });
  } catch (error) {
    if ((error as Error).message === "forbidden") throw error;
    return {
      ...deterministicExtraction(text),
      deterministic: true,
      providerAnswered: false,
      provider: "none",
      model: "none",
    };
  }

  try {
    const { raw, provider, model } = await callModel({
      instructions: SMART_IMPORT_INSTRUCTIONS,
      input: text,
      webSearch: false,
      ...(input.gateway ? { gateway: input.gateway } : {}),
    });
    const verified = verifyExtraction(extractJsonObject(raw), text);
    if (verified.companies.length === 0) {
      // A model that found nothing in an obviously delimited list should not
      // be the last word: fall back to the reader that can read columns.
      const fallback = deterministicExtraction(text);
      if (fallback.companies.length > 0) {
        return { ...fallback, deterministic: true, providerAnswered: true, provider, model };
      }
    }
    return { ...verified, deterministic: false, providerAnswered: true, provider, model };
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError || error instanceof ProviderCallFailedError) {
      return {
        ...deterministicExtraction(text),
        deterministic: true,
        providerAnswered: false,
        provider: "none",
        model: "none",
      };
    }
    throw error;
  }
}

/**
 * The no-model path. Only honest for delimited or one-per-line text, so it
 * returns nothing at all for prose rather than inventing companies from it.
 */
export function deterministicExtraction(text: string): VerifiedExtraction {
  const rows = parseDelimitedRows(text);
  const body = looksLikeHeader(rows[0]) ? rows.slice(1) : rows;
  const companies: ExtractedCompany[] = [];

  for (const row of body) {
    if (row.fields.length === 0) continue;
    // Prose lines are long and sentence-shaped; this reader does not read them.
    if (row.fields.length === 1 && (row.raw.split(/\s+/).length > 8 || /[.!?]\s/.test(row.raw))) {
      continue;
    }
    let site: string | null = null;
    const names: string[] = [];
    for (const field of row.fields) {
      const url = normalizeWebsiteUrl(field);
      if (url && !site) site = url;
      else names.push(field);
    }
    const name =
      names.join(" ").trim() ||
      (site ? site.replace(/^https?:\/\//i, "").replace(/^www\./i, "") : "");
    if (!/[a-z]/i.test(name) || name.trim().length < 2) continue;

    companies.push({
      name,
      websiteUrl: site,
      websiteConfidence: site ? "observed" : "inferred",
      note: null,
      because: "Read from this line of the list.",
      excerpt: row.raw,
    });
  }

  return { companies, dropped: [] };
}
