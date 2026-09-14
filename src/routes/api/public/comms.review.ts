/**
 * Comms review endpoint.
 *
 * A raw HTTP route, so it authenticates every request itself: a caller must
 * present a valid Trust Tai access token, and every read and write is made
 * with that token so RLS and the workspace boundary still apply.
 *
 * Nothing here sends a message. Approving records a decision; there is no
 * delivery path on the other side of it yet, by design.
 */

import { createFileRoute } from "@tanstack/react-router";

import { readDraftKind } from "@/domain/comms-draft-kind";

import {
  approveVersion,
  createReviewForDraft,
  createReviewSession,
  decideFinding,
  listReviews,
  loadReview,
  reviewForDraft,
  reviseDraft,
  ReviewFailure,
  runReview,
  type ReviewFailureCode,
  type SourceInput,
} from "@/lib/comms-review.server";
import { runtimeProviderStatus } from "@/lib/intelligence-runtime.server";

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

/** Where each typed failure belongs on the wire. */
const STATUS: Record<ReviewFailureCode, number> = {
  access_denied: 403,
  approval_forbidden: 403,
  not_found: 404,
  stale_version: 409,
  provider_not_configured: 503,
  provider_call_failed: 502,
  review_unreadable: 502,
  not_ready: 409,
  server_not_configured: 503,
  write_failed: 500,
};

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function sourcesOf(value: unknown): SourceInput[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    return {
      ...(textOf(row["label"]) ? { label: textOf(row["label"]) } : {}),
      ...(textOf(row["filename"]) ? { filename: textOf(row["filename"]) } : {}),
      ...(textOf(row["mediaType"]) ? { mediaType: textOf(row["mediaType"]) } : {}),
      ...(textOf(row["text"]) ? { text: textOf(row["text"]) } : {}),
    } satisfies SourceInput;
  });
}

export const Route = createFileRoute("/api/public/comms/review")({
  server: {
    handlers: {
      /** Provider readiness, or one review, or the list. Never a key. */
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const organizationId = url.searchParams.get("organizationId") ?? "";
        const sessionId = url.searchParams.get("sessionId") ?? "";

        if (!organizationId) {
          const status = runtimeProviderStatus();
          return Response.json({
            configured: status.configured,
            provider: status.provider,
            model: status.model,
          });
        }

        const token = bearer(request);
        if (!token) return Response.json({ error: "Sign in to open a review." }, { status: 401 });

        const draftId = url.searchParams.get("draftId") ?? "";

        try {
          if (draftId) {
            return Response.json(await reviewForDraft(token, { organizationId, draftId }));
          }
          if (sessionId) {
            return Response.json(await loadReview(token, { organizationId, sessionId }));
          }
          return Response.json({ sessions: await listReviews(token, organizationId) });
        } catch (error) {
          return failure(error);
        }
      },

      POST: async ({ request }) => {
        const token = bearer(request);
        if (!token) return Response.json({ error: "Sign in to use review." }, { status: 401 });

        let body: Record<string, unknown> = {};
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }

        const action = textOf(body["action"]);
        const organizationId = textOf(body["organizationId"]);
        if (!organizationId) {
          return Response.json({ error: "A workspace is required." }, { status: 400 });
        }

        try {
          switch (action) {
            case "create": {
              const draftBody = textOf(body["body"]).trim();
              if (!draftBody) {
                return Response.json(
                  { error: "Paste the reply you mean to send before asking for a review." },
                  { status: 400 },
                );
              }
              return Response.json(
                await createReviewSession(token, {
                  organizationId,
                  title: textOf(body["title"]),
                  situation: textOf(body["situation"]),
                  goal: textOf(body["goal"]),
                  recipientName: textOf(body["recipientName"]),
                  recipientEmail: textOf(body["recipientEmail"]),
                  subject: textOf(body["subject"]),
                  body: draftBody,
                  sources: sourcesOf(body["sources"]),
                  ...(readDraftKind(body["kind"]) ? { kind: readDraftKind(body["kind"])! } : {}),
                }),
              );
            }
            case "bind": {
              const channel = textOf(body["channel"]);
              const allowed = ["email_gmail", "email_resend", "linkedin_manual"] as const;
              const chosen = allowed.find((candidate) => candidate === channel);
              if (!chosen) {
                return Response.json(
                  { error: "Name the way this message would be sent." },
                  { status: 400 },
                );
              }
              return Response.json(
                await createReviewForDraft(token, {
                  organizationId,
                  draftId: textOf(body["draftId"]),
                  channel: chosen,
                  ...(textOf(body["integrationId"])
                    ? { integrationId: textOf(body["integrationId"]) }
                    : {}),
                  ...(textOf(body["situation"]) ? { situation: textOf(body["situation"]) } : {}),
                  ...(textOf(body["goal"]) ? { goal: textOf(body["goal"]) } : {}),
                  sources: sourcesOf(body["sources"]),
                }),
              );
            }
            case "revise": {
              return Response.json(
                await reviseDraft(token, {
                  organizationId,
                  sessionId: textOf(body["sessionId"]),
                  subject: textOf(body["subject"]),
                  body: textOf(body["body"]),
                }),
              );
            }
            case "run": {
              return Response.json(
                await runReview(token, {
                  organizationId,
                  sessionId: textOf(body["sessionId"]),
                  versionId: textOf(body["versionId"]),
                }),
              );
            }
            case "finding": {
              const state = textOf(body["state"]);
              const allowed = ["accepted", "kept", "edited", "open"] as const;
              const chosen = allowed.find((candidate) => candidate === state);
              if (!chosen) {
                return Response.json({ error: "Unknown decision." }, { status: 400 });
              }
              await decideFinding(token, {
                organizationId,
                findingId: textOf(body["findingId"]),
                state: chosen,
              });
              return Response.json({ ok: true });
            }
            case "approve": {
              return Response.json(
                await approveVersion(token, {
                  organizationId,
                  sessionId: textOf(body["sessionId"]),
                  versionId: textOf(body["versionId"]),
                  ...(textOf(body["runId"]) ? { runId: textOf(body["runId"]) } : {}),
                  ...(textOf(body["reason"]) ? { reason: textOf(body["reason"]) } : {}),
                }),
              );
            }
            default:
              return Response.json({ error: "Unknown action." }, { status: 400 });
          }
        } catch (error) {
          return failure(error);
        }
      },
    },
  },
});

function failure(error: unknown): Response {
  if (error instanceof ReviewFailure) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: STATUS[error.code] },
    );
  }
  const message = error instanceof Error ? error.message : "That could not be completed.";
  return Response.json({ error: message }, { status: 400 });
}
