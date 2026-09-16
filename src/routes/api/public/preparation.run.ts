/**
 * Ask for one piece of work to be prepared (server route).
 *
 * This is the connectable edge of the preparation contract. It is a route, not
 * a helper: an event handler in a room, or a person's own request, arrives
 * here with a bearer token, and everything that follows is the runner's normal
 * sequence with the real database behind it.
 *
 * It sits under /api/public so a room's own worker can reach it without the
 * site session, and it therefore proves the caller itself: no bearer token, no
 * run. Every job is off until an authorised person switches it on, so a
 * correctly authenticated call to a workspace that has decided nothing still
 * prepares nothing, and says so.
 *
 * Nothing here sends, publishes, prices or approves anything.
 */

import { createFileRoute } from "@tanstack/react-router";

import { jobSpec, type PreparationJobId, type PreparationRequest } from "@/domain/preparation-jobs";
import { loadPreparationPolicy } from "@/lib/preparation-policy.server";
import { preparationStore, PreparationStoreUnavailable } from "@/lib/preparation-store.server";
import {
  PreparationAccessDenied,
  runPreparation,
} from "@/lib/preparation-runner.server";
import { subjectReader } from "@/lib/preparation-subjects.server";

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

        const reader = subjectReader(jobId as PreparationJobId);
        if (!reader) {
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
          const partial = {
            organizationId,
            jobId: jobId as PreparationJobId,
            subjectRef,
            ...(typeof body.triggerEventId === "string"
              ? { triggerEventId: body.triggerEventId }
              : {}),
          };
          const revision = await reader.currentRevision(
            { ...partial, inputRevision: "" } as PreparationRequest,
            token,
          );
          const prepRequest: PreparationRequest = { ...partial, inputRevision: revision };

          const policy = await loadPreparationPolicy({
            organizationId,
            configuredKeys: ["reasoning_provider"],
          });

          const output = await runPreparation({
            request: prepRequest,
            policy,
            store: preparationStore(),
            token,
            currentInputRevision: revision,
            verifySubject: (req) => reader.belongsToWorkspace(req, token),
            deterministic: () => reader.read(prepRequest, token),
            reloadPolicy: () =>
              loadPreparationPolicy({ organizationId, configuredKeys: ["reasoning_provider"] }),
            reloadRevision: () => reader.currentRevision(prepRequest, token),
          });

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
