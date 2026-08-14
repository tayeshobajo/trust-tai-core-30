/**
 * The approved event sources, in the order Comms trusts them.
 *
 * Ingestion reads this list and nothing else. Nothing is registered yet: until
 * a calendar feed, a provider key, or a manual import exists, Comms says the
 * events room has no source rather than showing invented events.
 *
 * Adding a compliant source later is one file: implement `EventProvider` and
 * register it here.
 */

import type { EventProvider, EventProviderInfo } from "@/domain/comms-integrations";

export const EVENT_PROVIDERS: EventProvider[] = [];

export function getEventProvider(id: string): EventProvider | null {
  return EVENT_PROVIDERS.find((provider) => provider.id === id && provider.approved) ?? null;
}

export function eventProviderInfo(): EventProviderInfo[] {
  return EVENT_PROVIDERS.map(({ id, label, description, kind, approved }) => ({
    id,
    label,
    description,
    kind,
    approved,
  }));
}

/** Which approved sources can actually run right now. */
export async function availableEventProviders(): Promise<string[]> {
  const checks = await Promise.all(
    EVENT_PROVIDERS.map(async (provider) => ({
      id: provider.id,
      ok: provider.approved && (await provider.available().catch(() => false)),
    })),
  );
  return checks.filter((check) => check.ok).map((check) => check.id);
}
