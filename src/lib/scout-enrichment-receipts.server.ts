/**
 * Receipts for provider answers that could not be stored (server only).
 *
 * A paid lookup may succeed while the database write fails, most obviously
 * while the `scout_people` table does not exist yet. The answer is still
 * trustworthy: the server heard it from the provider. So the server keeps the
 * answer itself, scoped to the workspace, the company and the person, and
 * hands the browser nothing but an opaque receipt id. Saving again presents
 * the receipt, and the stored address is the provider's answer, never
 * anything the browser states.
 *
 * Two honest limits, stated rather than hidden:
 *   1. A receipt lives in this server process for RECEIPT_TTL_MINUTES. It is
 *      not durable. A deploy, an idle worker or an expiry loses it.
 *   2. When a receipt is gone, there is no free retry. The caller is told
 *      that plainly instead of being offered a button that would either
 *      forge a verification or spend another credit without asking.
 */

import type { ProviderEmailAnswer } from "@/domain/scout-people-persistence";

export const RECEIPT_TTL_MINUTES = 30;
const MAX_RECEIPTS = 500;

export interface EnrichmentReceipt {
  id: string;
  organizationId: string;
  prospectId: string;
  /** The workspace-scoped identity of the person this answer belongs to. */
  identity: string;
  answer: ProviderEmailAnswer;
  expiresAt: string;
}

const receipts = new Map<string, EnrichmentReceipt>();

function sweep(nowMs: number): void {
  for (const [id, receipt] of receipts) {
    if (new Date(receipt.expiresAt).getTime() <= nowMs) receipts.delete(id);
  }
  while (receipts.size > MAX_RECEIPTS) {
    const oldest = receipts.keys().next();
    if (oldest.done) break;
    receipts.delete(oldest.value);
  }
}

export function issueReceipt(input: {
  organizationId: string;
  prospectId: string;
  identity: string;
  answer: ProviderEmailAnswer;
  now?: string;
}): EnrichmentReceipt {
  const nowMs = new Date(input.now ?? new Date().toISOString()).getTime();
  sweep(nowMs);
  const receipt: EnrichmentReceipt = {
    id: crypto.randomUUID(),
    organizationId: input.organizationId,
    prospectId: input.prospectId,
    identity: input.identity,
    answer: input.answer,
    expiresAt: new Date(nowMs + RECEIPT_TTL_MINUTES * 60_000).toISOString(),
  };
  receipts.set(receipt.id, receipt);
  return receipt;
}

/**
 * The answer behind a receipt, only for the workspace and company it was
 * issued to. Reading it does not consume it: a failed save may be retried.
 */
export function readReceipt(input: {
  id: string;
  organizationId: string;
  prospectId: string;
  now?: string;
}): EnrichmentReceipt | null {
  const nowMs = new Date(input.now ?? new Date().toISOString()).getTime();
  sweep(nowMs);
  const receipt = receipts.get(input.id);
  if (!receipt) return null;
  if (receipt.organizationId !== input.organizationId) return null;
  if (receipt.prospectId !== input.prospectId) return null;
  return receipt;
}

export function consumeReceipt(id: string): void {
  receipts.delete(id);
}

/** Tests only: start from an empty server. */
export function clearReceipts(): void {
  receipts.clear();
}
