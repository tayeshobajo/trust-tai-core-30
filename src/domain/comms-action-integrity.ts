/**
 * The action-integrity gate.
 *
 * A reviewer that only judges grammar and tone reads a message the way a
 * proofreader does. A person reads it the way the recipient will: line by
 * line, asking of each sentence "what am I being told I can do here, and is
 * that thing actually in front of me?".
 *
 * So for every sentence that promises an action, an artifact or a reference,
 * this module asks whether the outgoing message really carries it:
 *
 *   - "You can choose a time that works for both of you here:" followed only
 *     by the name of the session, with no address to go to.
 *   - "I've attached invoice 481" with nothing staged on the draft.
 *   - "See the details below:" and then the message ends.
 *   - "Call me at" with no number after it.
 *
 * Two honesty rules hold throughout.
 *
 * This product stores plain text bodies; there is no rich-anchor
 * representation to inspect. Visible http and https addresses are therefore
 * the only link targets that can be verified, and a label that merely looks
 * like a link ("Strategic Clarity Session With Tai - Tai Shobajo") is never
 * treated as one. If a richer representation is ever stored, it should be
 * inspected here rather than flattened before review.
 *
 * And unknown stays unknown. Attachment state is only verifiable for a review
 * bound to a real draft; on an unbound review `attachments` is null and no
 * finding ever claims there is no attachment. Nothing here invents a URL, a
 * number, an address or a filename.
 */

export type ActionIntegrityProblem =
  | "missing_link"
  | "missing_attachment"
  | "missing_below"
  | "missing_destination";

export interface ActionIntegrityFinding {
  kind: "action_integrity";
  problem: ActionIntegrityProblem;
  /** Blocks approval: the recipient cannot do what the words tell them to. */
  severity: "must_fix";
  /** Exact words copied from the draft. */
  excerpt: string;
  why: string;
  suggestion: string | null;
}

/** One staged file, as the draft records it. Metadata only, never bytes. */
export interface StagedFile {
  filename: string;
  mimeType: string;
}

export interface OutboundFacts {
  body: string;
  subject?: string | null;
  /**
   * The files really staged on the outgoing draft, or null when attachment
   * state could not be verified. Null is not "none".
   */
  attachments: StagedFile[] | null;
  channel?: string | null;
}

/* ------------------------------------------------------------- utilities */

/** A real, usable link target. Only http and https can be verified. */
const URL_PATTERN = /https?:\/\/[^\s<>()\[\]"']{4,}/i;

const hasUrl = (text: string): boolean => URL_PATTERN.test(text);

/** Words that close a message rather than carry content. */
const SIGN_OFF =
  /^(?:thanks|thank you|many thanks|best|best wishes|kind regards|warm regards|regards|cheers|sincerely|speak soon|talk soon|all the best)\b[\s\S]*$/i;

/** Whether anything meaningful follows a promise made at this offset. */
function nothingUseful(body: string, afterIndex: number): boolean {
  const rest = body
    .slice(afterIndex)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^[-–—_*=]+$/.test(line));
  if (rest.length === 0) return true;
  /* A sign-off and a name are not the details that were promised. */
  return rest.every((line) => SIGN_OFF.test(line) || /^[A-Z][\w'’.-]*(?: [A-Z][\w'’.-]*){0,3}$/.test(line));
}

/** The sentence or line the match sits in, quoted exactly from the draft. */
function lineAt(body: string, index: number): string {
  const start = body.lastIndexOf("\n", index) + 1;
  const end = body.indexOf("\n", index);
  return body.slice(start, end === -1 ? body.length : end).trim();
}

/* -------------------------------------------------------- 1. link promise */

/**
 * Wording that tells the recipient to act at a target. Each pattern binds an
 * action verb to the target word, so the bare word "here" in ordinary prose
 * ("we're happy to help here if needed") never matches.
 */
const LINK_PROMISES: RegExp[] = [
  /\b(?:you can |please |feel free to )?(?:choose|pick|select|grab|book|schedule|reserve|claim)\b[^.\n]*\bhere\b\s*[:.]?/gi,
  /\b(?:click|tap|follow|use|open)\b[^.\n]*\b(?:here|this link|the link|the button|below)\b\s*[:.]?/gi,
  /\b(?:complete|fill (?:in|out)|submit|sign up|register|apply|download|view|watch|read)\b[^.\n]*\b(?:here|this link|the link|below)\b\s*[:.]?/gi,
  /\b(?:see|find)\b[^.\n]*\b(?:the link|link)\b[^.\n]*/gi,
  /\b(?:here(?:'s| is) (?:the|my) (?:link|booking link|calendar|scheduling link))\b[^.\n]*/gi,
  /\b(?:book(?:ing)?|schedul(?:e|ing)|calendar|meeting) link\b[^.\n]*/gi,
];

function linkFinding(facts: OutboundFacts): ActionIntegrityFinding | null {
  if (hasUrl(facts.body)) return null;

  for (const pattern of LINK_PROMISES) {
    pattern.lastIndex = 0;
    const match = pattern.exec(facts.body);
    if (!match) continue;
    const excerpt = lineAt(facts.body, match.index) || match[0].trim();
    return {
      kind: "action_integrity",
      problem: "missing_link",
      severity: "must_fix",
      excerpt,
      why: "These words tell the recipient they can act, but the outgoing message carries no address for them to go to. What follows is a label, not a link, so the recipient has nothing to click.",
      suggestion:
        "Paste the real address into the message so it is visible in the text, or reword the sentence so it does not promise an action target. No address is supplied here.",
    };
  }
  return null;
}

/* --------------------------------------------------- 2. attachment promise */

const ATTACHMENT_PROMISE =
  /(?:\b(?:i(?:'ve| have)?\s+)?attach(?:ed|ing)\b[^.\n]*|\bsee attached\b[^.\n]*|\bplease find attached\b[^.\n]*|\bis attached\b[^.\n]*|\battached (?:you'?ll find|is|are|please find)\b[^.\n]*)/i;

function attachmentFinding(facts: OutboundFacts): ActionIntegrityFinding | null {
  /* Unverifiable attachment state never becomes a claim that there is none. */
  if (facts.attachments === null) return null;
  if (facts.attachments.length > 0) return null;

  const match = ATTACHMENT_PROMISE.exec(facts.body);
  if (!match) return null;
  const excerpt = lineAt(facts.body, match.index) || match[0].trim();
  return {
    kind: "action_integrity",
    problem: "missing_attachment",
    severity: "must_fix",
    why: "This says a file is attached, and no file is staged on the outgoing message. The recipient would open it looking for something that is not there.",
    excerpt,
    suggestion:
      "Attach the file before approval, or remove the sentence. Nothing is attached on your behalf.",
  };
}

/* -------------------------------------------------------- 3. below promise */

const BELOW_PROMISE =
  /\b(?:see|find|use|review|check|read)\b[^.\n]*\b(?:below|following|that follows)\b\s*[:.]?|\b(?:the |my |our )?(?:details|steps|information|instructions|options|times|notes|breakdown|dates)\b[^.\n]{0,24}\bbelow\b\s*[:.]?/gi;

function belowFinding(facts: OutboundFacts): ActionIntegrityFinding | null {
  BELOW_PROMISE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BELOW_PROMISE.exec(facts.body)) !== null) {
    const lineEnd = facts.body.indexOf("\n", match.index + match[0].length);
    const after = lineEnd === -1 ? facts.body.length : lineEnd;
    if (!nothingUseful(facts.body, after)) continue;
    const excerpt = lineAt(facts.body, match.index) || match[0].trim();
    return {
      kind: "action_integrity",
      problem: "missing_below",
      severity: "must_fix",
      excerpt,
      why: "This points the recipient at something further down, and nothing follows it. The message ends where the promised content should be.",
      suggestion:
        "Add the content this sentence promises, or reword it so it does not point anywhere. Nothing is written in for you.",
    };
  }
  return null;
}

/* --------------------------------------------------- 4. destination promise */

/** A promise of a concrete destination, with the text that follows it. */
const DESTINATION_PROMISES: RegExp[] = [
  /\b(?:call|ring|phone|text|whatsapp) (?:me|us|him|her|them|[A-Z][a-z]+) (?:on|at)\b\s*[:.]?/g,
  /\b(?:e-?mail|write to|send it to|send them to|reach (?:me|us|him|her|them)) (?:me |us |him |her |them |[A-Z][a-z]+ )?(?:at|on)\b\s*[:.]?/g,
  /\b(?:the|my|our) (?:address|number|details) (?:is|are) below\b\s*[:.]?/gi,
];

const PHONE = /(?:\+?\d[\d\s().-]{6,}\d)/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;

function destinationFinding(facts: OutboundFacts): ActionIntegrityFinding | null {
  for (const pattern of DESTINATION_PROMISES) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(facts.body)) !== null) {
      const after = facts.body.slice(match.index + match[0].length);
      const sameLine = after.split("\n")[0] ?? "";
      const next = after.split("\n").slice(0, 3).join("\n");
      const supplied =
        PHONE.test(sameLine) ||
        EMAIL.test(sameLine) ||
        hasUrl(sameLine) ||
        (sameLine.trim().length === 0 && (PHONE.test(next) || EMAIL.test(next)));
      if (supplied) continue;
      const excerpt = lineAt(facts.body, match.index) || match[0].trim();
      return {
        kind: "action_integrity",
        problem: "missing_destination",
        severity: "must_fix",
        excerpt,
        why: "This promises the recipient somewhere to reach you, and no number, address or link actually follows it.",
        suggestion:
          "Write in the real number or address, or reword the sentence. No contact detail is supplied here.",
      };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ gate */

/**
 * The deterministic action-integrity findings for one outgoing message.
 * Empty is the normal answer: a message that promises nothing, or one whose
 * promises are really backed, raises nothing at all.
 */
export function actionIntegrityFindings(facts: OutboundFacts): ActionIntegrityFinding[] {
  const findings = [
    linkFinding(facts),
    attachmentFinding(facts),
    belowFinding(facts),
    destinationFinding(facts),
  ].filter((finding): finding is ActionIntegrityFinding => finding !== null);
  /* Never quote words the person did not write. */
  return findings.filter((finding) => facts.body.includes(finding.excerpt));
}

/**
 * A stable stand-in for the staged file set, for the review fingerprint.
 * Empty when nothing is staged, so a review with no attachments keeps exactly
 * the fingerprint it had before this gate existed.
 */
export function attachmentStamp(
  files: { filename: string; mimeType: string; size?: number; path?: string }[] | null,
): string {
  if (!files || files.length === 0) return "";
  return files
    .map((file) => `${file.filename}|${file.mimeType}|${file.size ?? ""}|${file.path ?? ""}`)
    .sort()
    .join(";");
}
