/**
 * Ask for one piece of work to be prepared (server route).
 *
 * This is the connectable edge of the preparation contract. It is a route, not
 * a helper: a room's own event handler, or a person's own request, arrives
 * here with a bearer token and everything that follows is the normal sequence
 * with the real database behind it.
 *
 * It sits under /api/public so a room's worker can reach it without the site
 * session, and it therefore proves the caller itself: no bearer token, no run.
 * Nothing about the caller's claim is trusted beyond the token: the workspace,
 * the owner and the source are all read back off the record.
 *
 * Every job is off until an authorised person switches it on, so a correctly
 * authenticated call in a workspace that has decided nothing prepares nothing
 * and says so. Nothing here sends, publishes, prices or approves anything.
 */

import { createFileRoute } from "@tanstack/react-router";

import { jobSpec, type PreparationJobId } from "@/domain/preparation-jobs";
import { prepareForEvent } from "@/lib/preparation-events.server";
import { SubjectUnreadable } from "@/lib/preparation-readers.server";
import { PreparationAccessDenied } from "@/lib/preparation-runner.server";
import { PreparationStoreUnavailable } from "@/lib/preparation-store.server";
import { subjectReader } from "@/lib/preparation-subjects.server";
import { registerPreparationReaders } from "@/lib/preparation-wiring.server";

const JOB_IDS = new Set<string>([
  "enquiry_qualification_packet",
  "conversation_summary",
  "milestone_status_draft",
]);

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() || null : null;
}

export const Route = createFileRoute("/api/public/preparation/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        registerPreparationReaders();

        const token = bearer(request);
        if (!token) {
          return Response.json(
            { error: "You are not signed in, so nothing was prepared." },
            { status: 401 },
          );
        }

        let body: {
          organizationId?: unknown;
          jobId?: unknown;
          subjectRef?: unknown;
          triggerEventId?: unknown;
        };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ error: "That request could not be read." }, { status: 400 });
        }

        const organizationId = typeof body.organizationId === "string" ? body.organizationId : "";
        const jobId = typeof body.jobId === "string" ? body.jobId : "";
        const subjectRef = typeof body.subjectRef === "string" ? body.subjectRef : "";
        if (!organizationId || !JOB_IDS.has(jobId) || !subjectRef) {
          return Response.json(
            { error: "A workspace, a known job and a subject are all needed." },
            { status: 400 },
          );
        }

        if (!subjectReader(jobId as PreparationJobId)) {
          return Response.json(
            {
              status: "could_not_finish",
              because: `${jobSpec(jobId as PreparationJobId).label} is not connected to its source yet, so nothing was prepared.`,
              persisted: false,
            },
            { status: 501 },
          );
        }

        try {
          const output = await prepareForEvent(jobId as PreparationJobId, {
            token,
            organizationId,
            subjectRef,
            ...(typeof body.triggerEventId === "string"
              ? { triggerEventId: body.triggerEventId }
              : {}),
          });

          if (!output) {
            return Response.json({
              status: "not_enabled",
              because: `${jobSpec(jobId as PreparationJobId).label} is not turned on in this workspace, so nothing was prepared.`,
              persisted: false,
            });
          }

          return Response.json({
            key: output.key,
            status: output.status,
            because: output.because ?? null,
            summary: output.summary,
            suggestions: output.suggestions,
            figures: output.figures,
            evidenceRefs: output.evidenceRefs,
            ownerLabel: output.ownerLabel,
            attempts: output.attempts,
            persisted: output.persisted === true,
          });
        } catch (error) {
          if (error instanceof PreparationAccessDenied) {
            return Response.json({ error: error.message }, { status: 403 });
          }
          if (error instanceof SubjectUnreadable) {
            return Response.json({ error: error.message, persisted: false }, { status: 502 });
          }
          if (error instanceof PreparationStoreUnavailable) {
            return Response.json({ error: error.message, persisted: false }, { status: 503 });
          }
          return Response.json(
            { error: "Nothing was prepared and nothing was recorded." },
            { status: 500 },
          );
        }
      },
    },
  },
});
