/**
 * Pulse → Conductor handoff.
 *
 * Pulse identifies and routes; the Conductor interprets and governs. When a
 * person asks for the deeper read on one signal, Pulse hands over a pointer —
 * the signal's id, the room that owns it, the lineage it belongs to, and a
 * plainly worded question — and nothing else. No business state is copied:
 * the Conductor re-reads the suite for itself.
 */

import type { PulseSeverity, PulseSignal } from "@/domain/pulse";

/** The only context that crosses the boundary. All of it is a pointer. */
export interface ConductorHandoff {
  /** The signal a person was looking at, so the read can be specific. */
  signal: string;
  /** The room that owns the change, e.g. "projects". */
  app: string;
  /** Human lineage, e.g. "Spartan Security › Houston Security Search Visibility". */
  entity?: string;
  /** The question the Conductor should answer first. */
  ask: string;
  /**
   * The routed request this signal is about, when it is one. A pointer into
   * the shared activity ledger — never a copy of the request itself.
   */
  route?: string;
}

/** The rooms whose signals can be carried into a specific Business Read. */
export const HANDOFF_ROOMS = ["projects", "comms", "roadmap", "scout", "ops"] as const;

/** A routed-work signal, whose governed step belongs to Projects, not Ops. */
export function isRoutedWorkSignal(signal: Pick<PulseSignal, "id">): boolean {
  return signal.id.startsWith("route:");
}

/**
 * The routed request a signal is about, when it is one. The Conductor needs
 * the key to name the ask; it still re-reads the ledger for everything else.
 */
export function routeKeyOf(signal: Pick<PulseSignal, "id">): string | undefined {
  return isRoutedWorkSignal(signal) ? signal.id.slice("route:".length) || undefined : undefined;
}

/** Can this signal open a read the Conductor can make specific? */
export function canOpenInConductor(signal: Pick<PulseSignal, "sourceApp">): boolean {
  return (HANDOFF_ROOMS as readonly string[]).includes(signal.sourceApp);
}

const SEVERITY_ASK: Record<PulseSeverity, string> = {
  act_now: "What is stopping this from moving, and what is the smallest next step?",
  evaluate: "What decision does this need from me, and what does it rest on?",
  watch_closely: "Is this getting worse, and what would make it need me?",
  good_to_know: "What does this mean for the business, if anything?",
};

/**
 * The question Pulse hands the Conductor. It names the signal and the lineage
 * so the read is about this thing, and asks for interpretation rather than
 * action — the Conductor still decides what, if anything, may be proposed.
 */
export function handoffQuestion(signal: PulseSignal): string {
  if (isRoutedWorkSignal(signal)) {
    /* Ops and Studio answer for themselves. The only ask this house can settle
     * is whether it is still waiting, so that is what the Conductor is asked. */
    return `${signal.title} (${signal.entityPath}). Should this house still be waiting on it, or should the ask be taken back?`;
  }
  const where = signal.entityPath && signal.entityPath !== signal.sourceAppLabel
    ? ` (${signal.entityPath}, in ${signal.sourceAppLabel})`
    : ` (in ${signal.sourceAppLabel})`;
  return `${signal.title}${where}. ${SEVERITY_ASK[signal.severity]}`;
}

/** Build the search params for /modules/conductor from one Pulse signal. */
export function conductorHandoff(signal: PulseSignal): ConductorHandoff {
  const route = routeKeyOf(signal);
  return {
    signal: signal.id,
    app: signal.sourceApp,
    ...(signal.entityPath ? { entity: signal.entityPath } : {}),
    ask: handoffQuestion(signal),
    ...(route ? { route } : {}),
  };
}

/** Read a handoff back off a URL. Anything missing simply means "no context". */
export function readHandoff(search: Record<string, unknown>): ConductorHandoff | undefined {
  const signal = typeof search["signal"] === "string" ? search["signal"] : "";
  const ask = typeof search["ask"] === "string" ? search["ask"] : "";
  if (!signal || !ask) return undefined;
  const app = typeof search["app"] === "string" ? search["app"] : "";
  const entity = typeof search["entity"] === "string" ? search["entity"] : "";
  const route = typeof search["route"] === "string" ? search["route"] : "";
  return { signal, app, ask, ...(entity ? { entity } : {}), ...(route ? { route } : {}) };
}
