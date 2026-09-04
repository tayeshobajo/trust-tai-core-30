/**
 * The featured image boundary.
 *
 * Trust Tai has no canonical image provider connected. Two separate things
 * are needed before an article can carry a real featured image:
 *
 *   1. a generator, which the Lovable AI Gateway can be, and
 *   2. a durable public place to keep the result, so the address in the
 *      article still resolves in a year.
 *
 * This module reports which of those exist and refuses to invent the rest.
 * It never returns a URL it did not receive from a real store, and it never
 * generates in bulk: one controlled article at a time, on purpose.
 */

export interface ImageProviderStatus {
  /** True only when an image could really be produced AND durably stored. */
  ready: boolean;
  generatorConfigured: boolean;
  storeConfigured: boolean;
  /** Names what is missing, never any value of a secret. */
  because: string;
  missing: string[];
}

/** The bucket a featured image would live in. Must be public to be durable. */
export const IMAGE_BUCKET = "content-images";

export function imageProviderStatus(): ImageProviderStatus {
  const generatorConfigured = Boolean(process.env["LOVABLE_API_KEY"]);
  const storeConfigured = Boolean(
    process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"] && process.env["TRUST_TAI_IMAGE_BUCKET_PUBLIC"],
  );

  const missing: string[] = [];
  if (!generatorConfigured) missing.push("LOVABLE_API_KEY");
  if (!process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"]) missing.push("TRUST_TAI_SUPABASE_SERVICE_KEY");
  if (!process.env["TRUST_TAI_IMAGE_BUCKET_PUBLIC"]) {
    missing.push(`a public storage bucket named ${IMAGE_BUCKET}, confirmed by TRUST_TAI_IMAGE_BUCKET_PUBLIC`);
  }

  const ready = generatorConfigured && storeConfigured;
  return {
    ready,
    generatorConfigured,
    storeConfigured,
    missing,
    because: ready
      ? "A featured image can be produced and stored at a durable address."
      : generatorConfigured
        ? `An image could be generated, but there is nowhere durable to keep it, so no address would survive. Missing: ${missing.join(", ")}.`
        : `No image provider is connected. Missing: ${missing.join(", ")}.`,
  };
}

/**
 * Prepare one featured image.
 *
 * Deliberately unimplemented while the boundary is unconfigured: refusing is
 * the honest outcome, and a missing image stays the real reason an article is
 * an exception.
 */
export async function prepareFeaturedImage(): Promise<
  { ok: false; because: string; missing: string[] }
> {
  const status = imageProviderStatus();
  return { ok: false, because: status.because, missing: status.missing };
}
