/**
 * The approved people sources, in the order Scout trusts them.
 *
 * Ingestion reads this list and nothing else: a source that is not registered
 * and approved here cannot reach Supabase. Adding a compliant vendor later is
 * one file, implement `PeopleProvider` and register it.
 */

import type { PeopleProvider, PeopleProviderInfo } from "@/domain/people";

import { enrichmentProvider } from "./enrichment";
import { websitePeopleProvider } from "./website-people";

export const PEOPLE_PROVIDERS: PeopleProvider[] = [websitePeopleProvider, enrichmentProvider];

export function getPeopleProvider(id: string): PeopleProvider | null {
  return PEOPLE_PROVIDERS.find((provider) => provider.id === id && provider.approved) ?? null;
}

export function peopleProviderInfo(): PeopleProviderInfo[] {
  return PEOPLE_PROVIDERS.map(({ id, label, description, kind, approved, baseConfidence }) => ({
    id,
    label,
    description,
    kind,
    approved,
    baseConfidence,
  }));
}

/** Which approved sources can actually run right now. */
export async function availablePeopleProviders(): Promise<string[]> {
  const checks = await Promise.all(
    PEOPLE_PROVIDERS.map(async (provider) => ({
      id: provider.id,
      ok: provider.approved && (await provider.available().catch(() => false)),
    })),
  );
  return checks.filter((check) => check.ok).map((check) => check.id);
}
