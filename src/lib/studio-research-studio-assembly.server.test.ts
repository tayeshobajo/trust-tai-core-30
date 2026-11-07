import { it, expect, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assembleOfflineStudio } from "./studio-research-studio-assembly.server";
import { COORDINATOR } from "./studio-research-coordinator-contracts";
it("concrete assembly needs no network to construct/check; rejects production mode", async () => {
  const studio = generateKeyPairSync("ed25519"),
    host = generateKeyPairSync("ed25519");
  const fetcher = vi.fn(async () => {
    throw Error("unexpected network");
  });
  const from = vi.fn(() => {
    throw Error("unexpected query");
  });
  const d = {
    mode: "offline-synthetic" as const,
    studioPrivateKey: studio.privateKey,
    coordinatorPublicKey: host.publicKey,
    serviceKey: "synthetic-service-key",
    bridgeKey: "pcp_synthetic",
    client: { from } as unknown as Pick<SupabaseClient, "from">,
    fetcher,
    now: () => 1000,
  };
  const auth = vi.fn(async () => ({ user: { id: "11111111-1111-4111-8111-111111111111" } }));
  const a = assembleOfflineStudio(
    d,
    auth as unknown as Parameters<typeof assembleOfflineStudio>[1],
  );
  expect(
    await a.application(new Request("https://preview/manual", { method: "POST" }), {
      operation: "check",
      organizationId: COORDINATOR.organizationId,
    }),
  ).toEqual({ status: "available" });
  expect(fetcher).not.toHaveBeenCalled();
  expect(from).not.toHaveBeenCalled();
  expect(() => assembleOfflineStudio({ ...d, mode: "production" as never })).toThrow(
    "studio_assembly_unavailable",
  );
  auth.mockRejectedValue(Error("revoked"));
  await expect(
    a.application(new Request("https://preview/manual", { method: "POST" }), {
      operation: "queue",
      organizationId: COORDINATOR.organizationId,
      requestId: "11111111-1111-4111-8111-111111111111",
      topic: "Example source",
      approvedUrls: ["https://example.org/source"],
    }),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
