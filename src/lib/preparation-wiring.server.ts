/**
 * The one place the three jobs are joined to the three rooms (server only).
 *
 * Keeping the registration here, rather than in each reader, means there is a
 * single file to read to know what is genuinely connected. A job missing from
 * this list is not prepared by anything, and the route says so instead of
 * inventing a subject.
 */

import { conversationReader, enquiryReader, milestoneReader } from "@/lib/preparation-readers.server";
import { registerSubjectReader } from "@/lib/preparation-subjects.server";

let registered = false;

/** Idempotent: calling it from several entry points registers one set. */
export function registerPreparationReaders(): void {
  if (registered) return;
  registerSubjectReader("enquiry_qualification_packet", enquiryReader);
  registerSubjectReader("conversation_summary", conversationReader);
  registerSubjectReader("milestone_status_draft", milestoneReader);
  registered = true;
}
