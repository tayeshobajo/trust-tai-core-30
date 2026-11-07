/** Server-only DTO boundary. Unregistered; synthetic mode only, no credentials in UI payloads. */
import { z } from "zod";
import { authorizeStudioResearch } from "./studio-research-access.server";
import { approvedSourceUrl } from "./studio-research-source-evidence.server";
import { COORDINATOR, type Approval } from "./studio-research-coordinator-contracts";
import type { createManualResearchComposition } from "./studio-research-composition.server";
import type { createStudioCoordinatorHandlers } from "./studio-research-coordinator-studio.server";
import type { CoordinatorStore } from "./studio-research-coordinator-store.server";
import type { ManualView } from "@/domain/studio-manual-research";
type Composed = Extract<
  Awaited<ReturnType<typeof createManualResearchComposition>>,
  { available: true }
>;
const ids = z
  .object({ organizationId: z.literal(COORDINATOR.organizationId), requestId: z.string().uuid() })
  .strict();
const queue = ids
  .extend({
    topic: z.string().trim().min(3).max(1200),
    approvedUrls: z.array(z.string().url()).min(1).max(3),
  })
  .strict();
const review = ids
  .extend({
    decision: z.enum(["use", "edit", "save", "skip"]),
    editedText: z.string().min(1).max(5000).optional(),
  })
  .strict();
export function createManualResearchController(
  d: {
    mode: "offline-synthetic" | "production";
    composition: Awaited<ReturnType<typeof createManualResearchComposition>>;
    issuer: ReturnType<typeof createStudioCoordinatorHandlers>;
    ledger: CoordinatorStore;
    prepare(request: Request, input: unknown): Promise<{ status: string }>;
    loadApproval(org: string, id: string): Promise<Approval | null>;
  },
  authorize = authorizeStudioResearch,
) {
  if (
    d.mode !== "offline-synthetic" ||
    !d.composition.available ||
    !d.composition.usesStore(d.ledger)
  )
    return { available: false as const };
  const composition: Composed = d.composition;
  async function owned(request: Request, i: z.infer<typeof ids>, work: boolean) {
    const auth = await authorize(request, i.organizationId, work);
    const a = await d.loadApproval(i.organizationId, i.requestId);
    if (
      !a ||
      a.approvedBy !== auth.user.id ||
      a.request.organizationId !== i.organizationId ||
      a.request.requestId !== i.requestId
    )
      throw Error("request_not_owned");
    return a;
  }
  function view(id: string, state: string): ManualView {
    const job = d.ledger.read(id);
    const status: ManualView["status"] =
      state === "approved" || state === "queued"
        ? "queued"
        : state === "collecting" || state === "running"
          ? "started"
          : state === "ready"
            ? "ready"
            : state === "reviewed"
              ? "reviewed"
              : state === "failed"
                ? "failed"
                : state === "cancel_requested"
                  ? "result_acceptance_blocked"
                  : state === "cancelled"
                    ? "stopped"
                    : state === "delivery_uncertain"
                      ? "delivery_uncertain"
                      : "uncertain";
    return {
      requestId: id,
      status,
      executionStop: job?.data.stopReceipt ? "confirmed" : "unverified",
      ...(job?.data.result
        ? {
            brief: {
              research: job.data.result.research,
              people: job.data.result.people,
              draft: null,
            },
          }
        : {}),
      ...(job?.data.review ? { decision: job.data.review.decision } : {}),
    };
  }
  return {
    available: true as const,
    async handle(
      request: Request,
      operation: "queue" | "start" | "read" | "cancel" | "review" | "reconcile",
      raw: unknown,
    ): Promise<ManualView> {
      if (request.method !== "POST") throw Error("method_invalid");
      if (operation === "queue") {
        const input = queue.parse(raw);
        if (new Set(input.approvedUrls).size !== input.approvedUrls.length)
          throw Error("source_invalid");
        input.approvedUrls.forEach((u) => approvedSourceUrl(u, input.approvedUrls));
        await authorize(request, input.organizationId, true);
        const prepared = await d.prepare(request, {
          organizationId: input.organizationId,
          requestId: input.requestId,
          topic: input.topic,
        });
        if (prepared.status !== "prepared")
          return {
            requestId: input.requestId,
            status: prepared.status === "uncertain" ? "uncertain" : "failed",
            executionStop: "unverified",
          };
        await d.issuer.approve(request, {
          organizationId: input.organizationId,
          requestId: input.requestId,
          approvedUrls: input.approvedUrls,
        });
        return { requestId: input.requestId, status: "queued", executionStop: "unverified" };
      }
      if (operation === "review") {
        const input = review.parse(raw);
        await owned(request, input, true);
        const result = await composition.review(request, input.requestId, {
          decision: input.decision,
          ...(input.editedText ? { editedText: input.editedText } : {}),
        });
        return view(input.requestId, result.state);
      }
      const input = ids.parse(raw),
        a = await owned(request, input, operation !== "read");
      if (operation === "reconcile")
        return view(
          input.requestId,
          (await composition.reconcileResult(request, input.requestId)).state,
        );
      if (operation === "start") {
        if (d.ledger.read(input.requestId) && d.ledger.read(input.requestId)!.state !== "approved")
          return view(input.requestId, (await composition.read(request, input.requestId)).state);
        const issued = await d.issuer.approve(request, { ...input, approvedUrls: a.approvedUrls });
        return view(
          input.requestId,
          (await composition.run(request, { approval: issued.approval, grant: issued.attestation }))
            .state,
        );
      }
      if (operation === "cancel") {
        if (!d.ledger.read(input.requestId)) {
          await d.issuer.cancel(request, input);
          return {
            requestId: input.requestId,
            status: "result_acceptance_blocked",
            executionStop: "unverified",
          };
        }
        return view(input.requestId, (await composition.cancel(request, input.requestId)).state);
      }
      if (!d.ledger.read(input.requestId)) {
        const stored = await d.issuer.read(request, input);
        return {
          requestId: input.requestId,
          status:
            stored.status === "result_acceptance_blocked"
              ? "result_acceptance_blocked"
              : stored.status === "coordinator_waiting" && stored.phase === "approved"
                ? "queued"
                : "uncertain",
          executionStop: "unverified",
        };
      }
      return view(input.requestId, (await composition.read(request, input.requestId)).state);
    },
  };
}
