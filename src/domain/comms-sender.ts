/**
 * Who is actually writing.
 *
 * Tai's standards apply to everyone in the workspace. Tai's name does not.
 * A message written by a salesperson closes with the salesperson's name, and
 * only a message Tai writes closes with Tai's. Signing someone else's words
 * with Tai's name is not a voice rule, it is a false statement about who
 * spoke, so it is settled here rather than inside the voice checker.
 */

export interface SenderProfile {
  /** The signed-in author. */
  id: string;
  /** The name the message closes with. */
  name: string;
  email?: string;
}

/** The first name a signature uses: "Tayo Shobajo" closes as "Tayo". */
export function signatureName(fullName: string): string {
  const clean = fullName.trim().replace(/,+\s*$/, "");
  if (!clean) return "";
  const given = clean.includes(",") ? clean.slice(clean.indexOf(",") + 1).trim() : clean;
  const token = given.split(/\s+/)[0] ?? "";
  return token.replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}'-]+$/gu, "");
}

/**
 * The exact closing for this sender. The form is Trust Tai's, the name is
 * theirs. With no known sender there is no honest signature, so there is
 * none: the caller keeps the draft unsigned rather than borrowing a name.
 */
export function signoffFor(sender: SenderProfile | null | undefined): string | null {
  const name = signatureName(sender?.name ?? "");
  if (!name) return null;
  return `Trust,\n${name}`;
}

/** A person's own words, for the evidence packet. Never another person's. */
export function senderEvidence(sender: SenderProfile | null | undefined) {
  return {
    name: sender?.name?.trim() || null,
    signsAs: signatureName(sender?.name ?? "") || null,
    note: "This message is written by this person and closes with their name, not with anyone else's.",
  };
}
