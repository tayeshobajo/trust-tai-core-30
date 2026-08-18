/**
 * Settings, Diagnostics.
 *
 * Deployment metadata so a stale build is obvious. Metadata only: no secret,
 * key, or token is read or rendered here.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { SectionHeading } from "@/components/tt/primitives";
import { useSettingsIdentity } from "@/components/tt/settings/shell";
import { getRuntimeDiagnostics } from "@/data/diagnostics.functions";
import { PAPERCLIP_MODE_LABEL } from "@/domain/paperclip-connection";
import { readBuildInfo } from "@/lib/build-info";

export const Route = createFileRoute("/settings/diagnostics")({
  component: DiagnosticsSettings,
});

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <dt className="tt-eyebrow">{label}</dt>
      <dd className="mt-1 font-mono text-sm text-foreground">{value}</dd>
      {note ? <dd className="mt-1 text-xs text-muted-foreground">{note}</dd> : null}
    </div>
  );
}

function DiagnosticsSettings() {
  const identity = useSettingsIdentity();
  const build = readBuildInfo();
  const runtime = useQuery({
    queryKey: ["settings", "diagnostics", identity.organizationId],
    queryFn: () => getRuntimeDiagnostics({ data: { organizationId: identity.organizationId } }),
    retry: false,
  });

  const data = runtime.data;
  const pending = runtime.isPending;
  const unknown = "—";

  return (
    <div className="tt-surface p-6">
      <SectionHeading
        eyebrow="Organization"
        title="Diagnostics"
        description="What this deployment is actually running, and which sources are answering. Metadata only, no credentials."
      />

      <dl className="grid gap-4 sm:grid-cols-2">
        <Row
          label="Build commit"
          value={build.commitSha ?? unknown}
          note={
            build.commitSha
              ? "Short SHA of the deployed build."
              : "The deployment did not provide VITE_BUILD_SHA."
          }
        />
        <Row
          label="Built at"
          value={build.builtAt ?? unknown}
          note={build.builtAt ? undefined : "The deployment did not provide VITE_BUILD_TIME."}
        />
        <Row label="Build mode" value={build.mode} />
        <Row
          label="Supabase"
          value={pending ? "…" : data ? (data.supabase.reachable ? "Reachable" : "Unreachable") : unknown}
          {...(data?.supabase.detail ? { note: data.supabase.detail } : {})}
        />
        <Row
          label="Paperclip mode"
          value={pending ? "…" : data ? PAPERCLIP_MODE_LABEL[data.paperclip.mode] : unknown}
          note={
            data
              ? data.paperclip.boardKeyConfigured
                ? "Board key configured on this deployment."
                : "No board key configured on this deployment."
              : undefined
          }
        />
        <Row
          label="Last successful reconciliation"
          value={pending ? "…" : (data?.paperclip.lastSuccessAt ?? unknown)}
          note={
            data && data.paperclip.consecutiveFailures !== null
              ? `${data.paperclip.consecutiveFailures} consecutive sweep failure${
                  data.paperclip.consecutiveFailures === 1 ? "" : "s"
                }.`
              : undefined
          }
        />
        <Row label="Server time" value={pending ? "…" : (data?.serverTime ?? unknown)} />
      </dl>
    </div>
  );
}
