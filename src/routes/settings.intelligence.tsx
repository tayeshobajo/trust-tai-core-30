/**
 * Settings, Intelligence freshness.
 *
 * A suite-wide audit: per room, is the intelligence layer reading it now,
 * only partly, or not at all? Read-only, derived on read, and honest about
 * rooms that contributed nothing.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { SectionHeading } from "@/components/tt/primitives";
import { useSettingsIdentity } from "@/components/tt/settings/shell";
import { contextBlocks } from "@/data/intelligence/derive";
import {
  auditIntelligenceFreshness,
  CURRENT_WINDOW_DAYS,
  FRESHNESS_LABEL,
  type AppFreshness,
  type FreshnessStatus,
} from "@/data/intelligence/freshness";
import { loadSuiteSnapshot } from "@/data/intelligence/service";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings/intelligence")({
  component: IntelligenceFreshnessSettings,
});

const TONE: Record<FreshnessStatus, string> = {
  current: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  partial: "border-amber-500/30 bg-amber-500/10 text-amber-700",
  missing: "border-border bg-muted text-muted-foreground",
};

/** The secret-free shape of /api/public/intelligence/status. */
interface RuntimeStatusPayload {
  configured: boolean;
  provider: "openai" | "lovable" | null;
  model: string | null;
  capabilities: { webSearch: boolean; structuredOutput: boolean; streaming: boolean };
  checkedAt: string;
}

/**
 * Reasoning provider readiness, server-derived. One provider serves every
 * room — Comms, Scout, Roadmap, Steward, Studio, Conductor — so this is the
 * first thing to check when any room's reasoning fails.
 */
function RuntimeStatusPanel() {
  const status = useQuery({
    queryKey: ["settings", "intelligence-runtime-status"],
    queryFn: async (): Promise<RuntimeStatusPayload> => {
      const response = await fetch("/api/public/intelligence/status", { cache: "no-store" });
      if (!response.ok) throw new Error("The runtime status probe failed.");
      return (await response.json()) as RuntimeStatusPayload;
    },
    retry: false,
    staleTime: 30_000,
  });

  const chip =
    status.isPending || !status.data
      ? { label: "checking…", tone: TONE.missing }
      : status.data.configured
        ? { label: "operational", tone: TONE.current }
        : { label: "not configured", tone: TONE.partial };

  return (
    <section aria-label="Reasoning provider" className="mb-6 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[15px] font-medium text-foreground">Reasoning provider</span>
        <span
          className={cn(
            "rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]",
            chip.tone,
          )}
        >
          {chip.label}
        </span>
        {status.data?.provider ? (
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">
            {status.data.provider} · {status.data.model ?? "—"} · checked{" "}
            {stamp(status.data.checkedAt)}
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-[13px] text-muted-foreground">
        {status.error
          ? "The status probe itself failed, so provider health cannot be confirmed from here."
          : status.data?.configured
            ? "One provider serves every room's reasoning — Comms drafts, Scout reads, Roadmap and Studio generation, Steward and Conductor."
            : "No reasoning provider is configured, so drafting and reads fail closed. Add OPENAI_API_KEY, or rely on LOVABLE_API_KEY, in the deployment's server environment (Settings → Secrets)."}
      </p>
    </section>
  );
}

function stamp(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function Row({ app }: { app: AppFreshness }) {
  return (
    <li className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[15px] font-medium text-foreground">{app.label}</span>
        <span
          className={cn(
            "rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]",
            TONE[app.status],
          )}
        >
          {FRESHNESS_LABEL[app.status]}
        </span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {app.ageDays === null ? "no signal" : `${app.ageDays}d old`}
        </span>
      </div>

      <p className="mt-2 text-[13px] text-muted-foreground">{app.because}</p>

      <dl className="mt-3 grid gap-3 sm:grid-cols-4">
        {[
          { label: "Context blocks", value: String(app.blockCount) },
          { label: "Activity rows", value: String(app.eventCount) },
          { label: "Latest context", value: stamp(app.latestContextAt) },
          { label: "Latest event", value: stamp(app.latestEventAt) },
        ].map((item) => (
          <div key={item.label}>
            <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {item.label}
            </dt>
            <dd className="mt-1 truncate text-[13px] text-foreground">{item.value}</dd>
          </div>
        ))}
      </dl>

      {app.latestEventName ? (
        <p className="mt-2 font-mono text-[11px] text-muted-foreground">
          Latest sequence: {app.latestEventName}
        </p>
      ) : null}
    </li>
  );
}

function IntelligenceFreshnessSettings() {
  const identity = useSettingsIdentity();
  const audit = useQuery({
    queryKey: ["settings", "intelligence-freshness", identity.organizationId],
    queryFn: async () => {
      const snapshot = await loadSuiteSnapshot(identity.organizationId);
      return auditIntelligenceFreshness({
        blocks: contextBlocks(snapshot),
        events: [...snapshot.events, ...snapshot.opsActivities],
        withheld: snapshot.withheld,
        now: snapshot.now,
      });
    },
    retry: false,
  });

  return (
    <div className="tt-surface p-6">
      <SectionHeading
        eyebrow="Organization"
        title="Intelligence freshness"
        description={`Which rooms the intelligence layer is actually reading. CURRENT means context and activity inside the last ${CURRENT_WINDOW_DAYS} days.`}
      />

      <RuntimeStatusPanel />

      {audit.isPending ? (
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          Reading every room…
        </p>
      ) : audit.error ? (
        <p role="alert" className="text-sm text-destructive">
          {(audit.error as Error).message}
        </p>
      ) : audit.data ? (
        <>
          <p className="mb-4 text-[13px] text-muted-foreground">
            {audit.data.current} current · {audit.data.partial} partial · {audit.data.missing}{" "}
            missing · read at {stamp(audit.data.generatedAt)}
          </p>
          <ul className="space-y-3">
            {audit.data.apps.map((app) => (
              <Row key={app.appId} app={app} />
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
