/**
 * The browser's way into message review.
 *
 * Every call carries the signed-in session token to the review endpoint,
 * which authenticates it again server-side and reads under RLS. Nothing here
 * sends a message; there is no send call in this file.
 */

import { supabase } from "@/integrations/trust-tai/supabase";

import type { ObligationCoverage } from "@/domain/comms-obligations";
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
  fingerprint: string;
  runIsCurrent: boolean;
  coverageNote: string;
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

export function listReviews(organizationId: string) {
  return call<{ sessions: ReviewSession[] }>(
    { method: "GET" },
    `${URL}?organizationId=${encodeURIComponent(organizationId)}`,
  ).then((payload) => payload.sessions);
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
  sources: { label?: string; filename?: string; mediaType?: string; text?: string }[];
}

export function createReview(fields: CreateReviewFields) {
  return post<{ sessionId: string; versionId: string }>({ action: "create", ...fields });
}

export function reviseDraft(input: {
  organizationId: string;
  sessionId: string;
  subject: string;
  body: string;
}) {
  return post<ReviewVersion>({ action: "revise", ...input });
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

export function approveReview(input: {
  organizationId: string;
  sessionId: string;
  versionId: string;
  runId?: string;
  reason?: string;
}) {
  return post<{ id: string }>({ action: "approve", ...input });
}
