/**
 * Pulse feedback — teaching, never truth.
 *
 * Accept / Not now / Not useful say how prominently Pulse should frame a
 * signal for this organization. They never touch a project, roadmap,
 * conversation or prospect. If `pulse_signal_feedback` is not applied in the
 * backend yet, the actions degrade to session memory and the page keeps
 * working exactly as before.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";
import { signalKindOf, type PulseFeedback, type PulseFeedbackKind } from "@/domain/pulse";

const TABLE = "pulse_signal_feedback";

/** Session fallback so an unapplied schema never loses a person's action. */
const session = new Map<ID, PulseFeedback[]>();

function remember(organizationId: ID, entry: PulseFeedback) {
  const list = session.get(organizationId) ?? [];
  session.set(organizationId, [...list, entry]);
}

export const pulseFeedback = {
  async list(organizationId: ID): Promise<PulseFeedback[]> {
    const local = session.get(organizationId) ?? [];
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select("signal_id, signal_kind, kind, created_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(400);
      if (error) return local;
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      const remote = rows.map((row) => ({
        signalId: String(row["signal_id"] ?? ""),
        signalKind: String(row["signal_kind"] ?? ""),
        kind: String(row["kind"] ?? "accepted") as PulseFeedbackKind,
        at: String(row["created_at"] ?? new Date().toISOString()),
      }));
      return [...remote, ...local];
    } catch {
      return local;
    }
  },

  async record(input: {
    organizationId: ID;
    userId: ID;
    signalId: ID;
    kind: PulseFeedbackKind;
    /** Carried so learning can be read per rule family later. */
    signalTitle?: string;
  }): Promise<PulseFeedback> {
    const entry: PulseFeedback = {
      signalId: input.signalId,
      signalKind: signalKindOf(input.signalId),
      kind: input.kind,
      at: new Date().toISOString(),
    };
    remember(input.organizationId, entry);
    try {
      await supabase.from(TABLE).insert({
        organization_id: input.organizationId,
        user_id: input.userId,
        signal_id: entry.signalId,
        signal_kind: entry.signalKind,
        kind: entry.kind,
        signal_title: input.signalTitle ?? null,
      });
    } catch {
      /* Session memory already holds it. */
    }
    return entry;
  },
};
