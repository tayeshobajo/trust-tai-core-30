import { beforeEach, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { assembleLinuxPreviewStudio } from "./studio-research-studio-assembly.server";
import { STUDIO_TRIAL_REQUEST_ID, STUDIO_TRIAL_SOURCE } from "@/domain/studio-research-trial";
import { TRIAL_POLICY_SHA256, trialConfigSchema } from "./studio-research-trial.server";
import { COORDINATOR } from "./studio-research-coordinator-contracts";
const h = vi.hoisted(() => ({ application: vi.fn() }));
vi.mock("./studio-research-app.server", () => ({ makeStudioApplication: () => h.application }));
beforeEach(() => h.application.mockReset());
it("expired connection is settlement-only; exact authorized settlement operations still reach existing application", async () => {
  const trial = trialConfigSchema.parse({policyDigest:TRIAL_POLICY_SHA256,requestId:STUDIO_TRIAL_REQUEST_ID,source:STUDIO_TRIAL_SOURCE,subjectId:"11111111-1111-4111-8111-111111111111",notBefore:1000,expiresAt:61000});
  let subject = trial.subjectId;
  const authorize = vi.fn(async () => ({user:{id:subject}}));
  const keys = generateKeyPairSync("ed25519");
  const fetcher = vi.fn(async () => {throw Error("unexpected_network")});
  const app = assembleLinuxPreviewStudio({mode:"linux-public-preview",trial,studioPrivateKey:keys.privateKey,coordinatorPublicKey:keys.publicKey,serviceKey:"synthetic",bridgeKey:"pcp_synthetic",fetcher,client:{} as never,now:()=>62000},authorize as never);
  expect((await app.receiptHandler(new Request("https://cmd.trusttai.com/api/studio/research/coordinator/"+trial.requestId+"/authority",{method:"POST"}))).status).toBe(410);
  const request = new Request("https://cmd.trusttai.com/_serverFn/manual",{method:"POST"});
  expect(await app.application(request,{operation:"check",organizationId:COORDINATOR.organizationId})).toEqual({status:"available",launchAllowed:false});
  expect(h.application).not.toHaveBeenCalled();
  for (const operation of ["read","cancel","reconcile","review"] as const) {
    const input = {operation,organizationId:COORDINATOR.organizationId,requestId:trial.requestId,...(operation === "review" ? {decision:"use"} : {})};
    h.application.mockResolvedValue({status:"ok",view:{requestId:trial.requestId,status:"ready",executionStop:"unverified"}});
    await expect(app.application(request,input)).resolves.toMatchObject({status:"ok"});
    expect(h.application).toHaveBeenLastCalledWith(request,input);
  }
  const calls = h.application.mock.calls.length;
  for(const operation of ["queue","start"]){
    const input={operation,organizationId:COORDINATOR.organizationId,requestId:trial.requestId,...(operation==="queue"?{topic:"IANA trial",approvedUrls:[trial.source]}:{})};
    await expect(app.application(request,input)).rejects.toThrow("trial_expired");
  }
  await expect(app.application(request,{operation:"read",organizationId:COORDINATOR.organizationId,requestId:"22222222-2222-4222-8222-222222222222"})).rejects.toThrow("trial_scope_rejected");
  subject="33333333-3333-4333-8333-333333333333";
  await expect(app.application(request,{operation:"check",organizationId:COORDINATOR.organizationId})).rejects.toThrow("trial_scope_rejected");
  await expect(app.application(request,{operation:"read",organizationId:COORDINATOR.organizationId,requestId:trial.requestId})).rejects.toThrow("trial_scope_rejected");
  expect(h.application).toHaveBeenCalledTimes(calls);
  expect(fetcher).not.toHaveBeenCalled();
});
