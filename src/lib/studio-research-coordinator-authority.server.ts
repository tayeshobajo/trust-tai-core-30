/** Local verification adapter. No issuer, private key, credential minting or live route. */
import { verify, type KeyObject } from "node:crypto";
import { z } from "zod";
import { COORDINATOR, digest } from "./studio-research-coordinator-contracts";
import type { CoordinatorDeps } from "./studio-research-coordinator.server";
const grantSchema = z
  .object({
    version: z.literal(1),
    issuer: z.literal("studio-approved-task"),
    audience: z.literal("studio-research-coordinator"),
    subjectId: z.string().uuid(),
    organizationId: z.literal(COORDINATOR.organizationId),
    companyId: z.literal(COORDINATOR.companyId),
    agentId: z.literal(COORDINATOR.agentId),
    projectId: z.literal(COORDINATOR.projectId),
    requestId: z.string().uuid(),
    issueId: z.string().uuid(),
    approvalDigest: z.string().regex(/^[a-f0-9]{64}$/),
    issuedAt: z.number().finite(),
    expiresAt: z.number().finite(),
    actions: z
      .array(z.enum(["approve", "run", "read", "cancel", "review"]))
      .min(1)
      .max(5),
  })
  .strict();
export function verifySignedJson(key: KeyObject, token: unknown): unknown {
  if (
    key.type !== "public" ||
    key.asymmetricKeyType !== "ed25519" ||
    typeof token !== "string" ||
    token.length > 200000
  )
    throw Error("attestation_invalid");
  const parts = token.split(".");
  if (parts.length !== 2 || !parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p)))
    throw Error("attestation_invalid");
  const body = Buffer.from(parts[0]!, "base64url"),
    signature = Buffer.from(parts[1]!, "base64url");
  if (signature.length !== 64 || !verify(null, body, key, signature))
    throw Error("attestation_invalid");
  return JSON.parse(body.toString("utf8"));
}
/** authenticate must verify the actual session (e.g. existing getUser + active membership/work access).
 * Attestation is untrusted input until its signature verifies against an operator-pinned public key.
 * Installed Paperclip actor metadata alone cannot supply either prerequisite. */
export function createApprovalAuthority(options: {
  publicKey: KeyObject;
  now(): number;
  authenticate(
    context: unknown,
    organizationId: string,
    work: boolean,
  ): Promise<{ userId: string }>;
  attestation(context: unknown): unknown;
}): CoordinatorDeps["authority"] {
  return async (context, action, approval) => {
    try {
      const grant = grantSchema.parse(
        verifySignedJson(options.publicKey, options.attestation(context)),
      );
      const auth = await options.authenticate(
        context,
        approval.request.organizationId,
        action !== "read",
      );
      const now = options.now();
      if (
        auth.userId !== grant.subjectId ||
        auth.userId !== approval.approvedBy ||
        grant.organizationId !== approval.request.organizationId ||
        grant.requestId !== approval.request.requestId ||
        grant.issueId !== approval.issueId ||
        grant.approvalDigest !== digest(approval) ||
        grant.issuedAt > now ||
        grant.expiresAt <= now ||
        grant.expiresAt <= grant.issuedAt ||
        grant.expiresAt - grant.issuedAt > 900000 ||
        !grant.actions.includes(action)
      )
        return null;
      return {
        subjectId: grant.subjectId,
        organizationId: grant.organizationId,
        requestId: grant.requestId,
        approvalDigest: grant.approvalDigest,
        expiresAt: grant.expiresAt,
        actions: grant.actions,
      };
    } catch {
      return null;
    }
  };
}
