/**
 * Quietly record that this person opened a room.
 *
 * Presence is a courtesy signal for People & access, never a gate. It is
 * throttled per room so normal navigation writes at most one row every few
 * minutes, and every failure is silent: nothing in the product depends on it.
 */

import { useEffect } from "react";

import { recordModuleOpened } from "@/data/supabase/member-activity";

const THROTTLE_MS = 5 * 60 * 1000;

/** Last write per organization/person/room, for this browser tab. */
const written = new Map<string, number>();

export function usePresence(input: {
  organizationId: string | null | undefined;
  userId: string | null | undefined;
  appKey: string | null | undefined;
}) {
  const { organizationId, userId, appKey } = input;

  useEffect(() => {
    if (!organizationId || !userId || !appKey) return;
    const key = `${organizationId}:${userId}:${appKey}`;
    const last = written.get(key) ?? 0;
    if (Date.now() - last < THROTTLE_MS) return;
    written.set(key, Date.now());
    void recordModuleOpened({ organizationId, userId, appKey });
  }, [organizationId, userId, appKey]);
}
