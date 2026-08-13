/**
 * Read a roadmap subject's validated identity.
 *
 * Scout already stores what a company's own website declared, under the
 * prospect's `metadata.identity`. Studio reuses that record rather than making
 * a fresh guess, and returns null the moment nothing validated exists.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import { readCompanyIdentity } from "@/lib/company-identity";
import { validatedBrand, type RoadmapBrand } from "@/data/roadmap-brand";
import type { Roadmap } from "@/domain/roadmap";

export async function readRoadmapBrand(roadmap: Roadmap): Promise<RoadmapBrand | null> {
  if (!roadmap.prospectId) return null;

  const { data, error } = await supabase
    .from("prospects")
    .select("metadata, observed, inferred, provenance")
    .eq("id", roadmap.prospectId)
    .maybeSingle();

  // Identity is decoration. A failed read never blocks a composition.
  if (error || !data) return null;

  const row = data as Record<string, unknown>;
  return validatedBrand(
    readCompanyIdentity({
      metadata: row["metadata"],
      provenance: row["provenance"],
      inferred: row["inferred"],
      observed: Array.isArray(row["observed"]) ? (row["observed"] as unknown[]) : [],
    }),
  );
}
