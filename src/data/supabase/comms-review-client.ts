/**
 * The browser's way into message review.
 *
 * Every call carries the signed-in session token to the review endpoint,
 * which authenticates it again server-side and reads under RLS. Nothing here
 * sends a message; there is no send call in this file.
 */

import { supabase } from "@/integrations/trust-tai/supabase";

import type { DraftKind } from "@/domain/comms-draft-kind";
import type { ProposalSections } from "@/domain/comms-proposal";

import type { ObligationCoverage } from "@/domain/comms-obligations";
import type { ReviewLesson } from "@/domain/comms-lessons";
import type {
  ApprovalReading,
  ReviewFinding,
  ReviewRun,
  ReviewSession,
  ReviewVersion,
} from "@/domain/comms-review";

const URL = "/api/public/comms/review";

export interface ReviewStateView {
  session: ReviewSession;
  versions: ReviewVersion[];
  currentVersion: ReviewVersion | null;
  sources: { id: string; label: string; status: string; statusNote: string; charCount: number }[];
  latestRun: ReviewRun | null;
  findings: ReviewFinding[];
  obligations: ObligationCoverage;
  approval: ApprovalReading;
  readiness: { ready: boolean; blockers: string[] };
  approvalScopeNote: string;
  fingerprint: string;
  runIsCurrent: boolean;
  coverageNote: string;
  /** Lessons kept from earlier human decisions in this workspace. */
  lessons: { available: boolean; note: string; lessons: ReviewLesson[] };
}

async function token(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const value = data.session?.access_token;
  if (!value) throw new Error("Your session has expired. Sign in again.");
  return value;
}

async function call<T>(init: RequestInit, url: string = URL): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await token()}`,
      ...(init.headers ?? {}),
    },
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload["error"] === "string" ? payload["error"] : "That could not be completed.",
    );
  }
  return payload as T;
}

const post = <T>(body: Record<string, unknown>) =>
  call<T>({ method: "POST", body: JSON.stringify(body) });

export function listReviews(organizationId: string, offset = 0) {
  return call<{
    sessions: ReviewSession[];
    total: number;
    capped: boolean;
    offset?: number;
    hasMore?: boolean;
  }>(
    { method: "GET" },
    `${URL}?organizationId=${encodeURIComponent(organizationId)}&offset=${Math.max(0, Math.trunc(offset))}`,
  ).then((payload) => ({
    rows: payload.sessions,
    total: payload.total,
    capped: payload.capped,
    offset: payload.offset ?? offset,
    /* An older server that does not answer this reads as "nothing more to
       show" only when the page was short; a full page stays open. */
    hasMore: payload.hasMore ?? payload.sessions.length >= 50,
  }));
}


export function loadReview(organizationId: string, sessionId: string) {
  return call<ReviewStateView>(
    { method: "GET" },
    `${URL}?organizationId=${encodeURIComponent(organizationId)}&sessionId=${encodeURIComponent(sessionId)}`,
  );
}

export interface CreateReviewFields {
  organizationId: string;
  title: string;
  situation: string;
  goal: string;
  recipientName: string;
  recipientEmail: string;
  subject: string;
  body: string;
  /** Message, email or proposal. Recorded when the workspace can store it. */
  kind?: DraftKind;
  /**
   * The sections a proposal was written as. When present the server renders
   * the words from these; what is typed here never stands in for them.
   */
  sections?: ProposalSections;
  sources: { label?: string; filename?: string; mediaType?: string; text?: string }[];
}

export function createReview(fields: CreateReviewFields) {
  return post<{
    sessionId: string;
    versionId: string;
    kindPersisted?: boolean;
    structurePersisted?: boolean;
  }>({
    action: "create",
    ...fields,
  });
}

export function reviseDraft(input: {
  organizationId: string;
  sessionId: string;
  subject: string;
  body: string;
  sections?: ProposalSections;
}) {
  return post<{ version: ReviewVersion; structurePersisted: boolean }>({
    action: "revise",
    ...input,
  });
}

export function runReview(input: { organizationId: string; sessionId: string; versionId: string }) {
  return post<{ runId: string }>({ action: "run", ...input });
}

export function decideFinding(input: {
  organizationId: string;
  findingId: string;
  state: "accepted" | "kept" | "edited" | "open";
}) {
  return post<{ ok: true }>({ action: "finding", ...input });
}

/** Keep one decided finding as a lesson for this workspace. */
export function keepLesson(input: {
  organizationId: string;
  findingId: string;
  lesson: string;
}) {
  return post<ReviewLesson>({ action: "lesson.keep", ...input });
}

/** Stop using a kept lesson. The record of it stays. */
export function revokeLesson(input: { organizationId: string; lessonId: string }) {
  return post<{ ok: true }>({ action: "lesson.revoke", ...input });
}

export function approveReview(input: {
  organizationId: string;
  sessionId: string;
  versionId: string;
  runId?: string;
  reason?: string;
}) {
  return post<{ id: string }>({ action: "approve", ...input });
}

export interface SendReadinessView {
  ready: boolean;
  code: string | null;
  message: string;
  blockers: string[];
  configured: boolean;
}

/**
 * Whether this message could be sent right now — asked without sending it.
 * The server decides; this only shows the answer. Sending still happens on
 * the queue, by a person.
 */
export function sendReadiness(organizationId: string, draftId: string) {
  return call<SendReadinessView>(
    { method: "GET" },
    `/api/public/comms/send?organizationId=${encodeURIComponent(organizationId)}&draftId=${encodeURIComponent(draftId)}`,
  );
}
