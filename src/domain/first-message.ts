/**
 * The first message, prepared not sent.
 *
 * A prepared draft is a starting point a person edits, never an automated
 * outbound. It says only what is on record: this person's name, the title and
 * company someone confirmed, and, when a governed brief exists, why now and
 * one genuinely useful bridge. Nothing is invented, nothing is claimed.
 */

export const FIRST_MESSAGE_KIND = "scout_first_message";

export interface FirstMessagePerson {
  fullName: string;
  roleTitle?: string | undefined;
  companyName?: string | undefined;
}

export interface FirstMessageDevelopmentRead {
  whyNow?: string | undefined;
  bridge?: { label: string; idea: string } | undefined;
  firstMovePosture?: string | undefined;
}

export interface FirstMessageContent {
  subject: string;
  body: string;
}

/** The name a person is greeted by. Never a guess beyond the first word. */
export function greetingName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? "";
  return first || fullName.trim();
}

/**
 * Compose the opening draft from what is on record. Pure and deterministic:
 * the same person and the same brief always produce the same words.
 */
export function composeFirstMessage(input: {
  person: FirstMessagePerson;
  /** The company this conversation is about, when Scout knows it. */
  companyName?: string | undefined;
  development?: FirstMessageDevelopmentRead | undefined;
}): FirstMessageContent {
  const first = greetingName(input.person.fullName);
  const company = input.person.companyName?.trim() || input.companyName?.trim() || "";
  const title = input.person.roleTitle?.trim() || "";
  const development = input.development;

  const subject = company ? `A thought about ${company}`: `Hello, ${first}`;

  const lines: string[] = [`Hi ${first},`, ""];

  if (title && company) {
    lines.push(`I saw you're ${title} at ${company}.`);
  } else if (company) {
    lines.push(`I came across ${company} and wanted to reach out directly.`);
  } else {
    lines.push("I wanted to reach out directly rather than through anything automated.");
  }

  if (development?.whyNow?.trim()) {
    lines.push(development.whyNow.trim());
  }

  if (development?.bridge) {
    lines.push(`${development.bridge.label}: ${development.bridge.idea}`);
  }

  lines.push(
    development?.firstMovePosture?.trim() ||
      "No pitch attached, if it's useful, I'd welcome a short conversation.",
  );

  lines.push("", ", ");

  return { subject, body: lines.join("\n") };
}
