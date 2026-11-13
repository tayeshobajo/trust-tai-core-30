/** Concrete Studio application operations. No host runtime, secret lookup, or automatic activation. */
import { z } from "zod";
import { manualActionSchema, parseManualView, type ManualReply } from "@/domain/studio-manual-wire";
import { manualSourceUrls } from "@/domain/studio-manual-research";
import { authorizeStudioResearch } from "./studio-research-access.server";
import { makeStudioRemoteActions } from "./studio-research-remote-actions.server";
import type { createStudioCoordinatorHandlers } from "./studio-research-coordinator-studio.server";
import type { prepareManualResearchRequest } from "./studio-research-manual-intake.server";
import { COORDINATOR } from "./studio-research-coordinator-contracts";
import { classifyStudioPreviewOrigin } from "./studio-research-preview-origin.server";

type Application = {
  issuer: ReturnType<typeof createStudioCoordinatorHandlers>;
  remote: ReturnType<typeof makeStudioRemoteActions>;
  prepare: (request: Request, input: unknown) => ReturnType<typeof prepareManualResearchRequest>;
};
const remoteState = z
  .object({
    requestId: z.string().uuid(),
    state: z.enum([
      "approved",
      "queued",
      "collecting",
      "running",
      "ready",
      "reviewed",
      "failed",
      "cancel_requested",
      "cancelled",
      "uncertain",
      "delivery_uncertain",
    ]),
    review: z
      .object({ decision: z.enum(["use", "edit", "save", "skip"]) })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();
export function makeStudioApplication(
  application?: Application,
  authorize = authorizeStudioResearch,
) {
  return async (request: Request, raw: unknown): Promise<ManualReply> => {
    const c = manualActionSchema.parse(raw);
    if (request.method !== "POST" || c.organizationId !== COORDINATOR.organizationId)
      throw Error("request_rejected");
    await authorize(request, c.organizationId, c.operation !== "check" && c.operation !== "read");
    if (!application) return { status: "unavailable", reason: "runtime_not_configured" };
    if (c.operation === "check") return { status: "available" };
    const ids = { organizationId: c.organizationId, requestId: c.requestId! };
    if (c.operation === "queue") {
      const approvedUrls = manualSourceUrls(c.approvedUrls!.join("\n"));
      const prepared = await application.prepare(request, { ...ids, topic: c.topic });
      if (prepared.status !== "prepared")
        return {
          status: "ok",
          view: {
            requestId: ids.requestId,
            status: prepared.status === "uncertain" ? "uncertain" : "failed",
            executionStop: "unverified",
          },
        };
      await application.issuer.approve(request, { ...ids, approvedUrls });
      return {
        status: "ok",
        view: { requestId: ids.requestId, status: "queued", executionStop: "unverified" },
      };
    }
    const state = remoteState.parse(
      await application.remote(request, {
        ...ids,
        operation: c.operation === "start" ? "run" : c.operation,
        ...(c.operation === "review"
          ? {
              review: {
                decision: c.decision,
                ...(c.editedText ? { editedText: c.editedText } : {}),
              },
            }
          : {}),
      }),
    );
    if (state.requestId !== ids.requestId) throw Error("request_mismatch");
    const statuses = {
      approved: "queued",
      queued: "queued",
      collecting: "started",
      running: "started",
      ready: "ready",
      reviewed: "reviewed",
      failed: "failed",
      cancel_requested: "result_acceptance_blocked",
      cancelled: "result_acceptance_blocked",
      uncertain: "uncertain",
      delivery_uncertain: "delivery_uncertain",
    } as const;
    const view: Record<string, unknown> = {
      requestId: ids.requestId,
      status: statuses[state.state],
      executionStop: "unverified",
    };
    // Remote state is not evidence of a durable accepted brief or whole-process stop.
    if (state.state === "ready" || state.state === "reviewed") {
      const stored = await application.issuer.read(request, ids);
      if (stored.status !== "review_ready") view["status"] = "delivery_uncertain";
      else {
        view["brief"] = { research: stored.result, people: stored.people, draft: null };
        if (state.state === "reviewed" && state.review) view["decision"] = state.review.decision;
      }
    }
    const parsed = parseManualView(view);
    if (parsed.brief?.research.requestId && parsed.brief.research.requestId !== ids.requestId)
      throw Error("result_mismatch");
    return { status: "ok", view: parsed };
  };
}
// Reject other deployments before importing startup or reading any runtime secrets.
export async function studioManualApplication(
  request: Request,
  raw: unknown,
): Promise<ManualReply> {
  const command = manualActionSchema.parse(raw);
  const diagnosticCheck = command.operation === "check" && request.method === "POST" && command.organizationId === COORDINATOR.organizationId;
  const origin = classifyStudioPreviewOrigin(request);
  if (origin !== "production")
    return { status: "unavailable", reason: "runtime_not_configured", ...(diagnosticCheck ? { diagnostic: `origin_${origin}` } : {}) };
  const { loadStudioPreviewAssembly } = await import("./studio-research-preview-startup.server");
  let stage = "assembly_unavailable";
  const configured = loadStudioPreviewAssembly(undefined, undefined, value => { stage = value; });
  const reply = await (configured?.application ?? makeStudioApplication())(request, raw);
  return !configured && diagnosticCheck && reply.status === "unavailable" ? { ...reply, diagnostic: stage } : reply;
}
export async function studioReceiptApplication(request: Request): Promise<Response> {
  if (classifyStudioPreviewOrigin(request) !== "production")
    return Response.json(
      { error: "runtime_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  const { loadStudioPreviewAssembly } = await import("./studio-research-preview-startup.server");
  const configured = loadStudioPreviewAssembly();
  if (configured) return configured.receiptHandler(request);
  return Response.json(
    { error: "runtime_unavailable" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
