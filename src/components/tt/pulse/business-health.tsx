/**
 * "Is the business healthy", on Pulse.
 *
 * White cards on the pale canvas, one metric each. A metric that could not be
 * read says so in words where the number would be, so a missing source can
 * never be mistaken for a good result.
 */

import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { loadBusinessHealth } from "@/data/pulse/business-health";
import type { HealthMetric } from "@/domain/business-health";
import type { WorkspaceIdentity } from "@/lib/workspace";

function money(cents: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function valueText(metric: HealthMetric): string {
  if (metric.reading.state === "unavailable") return "Unavailable";
  const { value } = metric.reading;
  if (metric.unit === "money_cents") return money(value);
  if (metric.unit === "days") return `${value} ${value === 1 ? "day" : "days"}`;
  return String(value);
}

function MetricCard({ metric }: { metric: HealthMetric }) {
  const unavailable = metric.reading.state === "unavailable";
  return (
    <article className="rounded-2xl border border-border bg-card p-5">
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
        {metric.label}
      </h3>
      <p className="mt-2 text-[20px] font-semibold text-foreground">{valueText(metric)}</p>
      {metric.reading.state === "measured" && metric.reading.denominator ? (
        <p className="mt-1 text-[13px] text-muted-foreground">
          out of {metric.reading.denominator.value} {metric.reading.denominator.label}
        </p>
      ) : null}
      {unavailable && metric.reading.state === "unavailable" ? (
        <p className="mt-1 text-[13px] text-warning-foreground">{metric.reading.because}</p>
      ) : null}
      <p className="mt-3 text-[13px] text-muted-foreground">{metric.question}</p>
      <dl className="mt-3 space-y-1 text-[12px] text-muted-foreground">
        <div>
          <dt className="inline font-medium">Source: </dt>
          <dd className="inline">{metric.source}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Period: </dt>
          <dd className="inline">{metric.period}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Read: </dt>
          <dd className="inline">{metric.readAt ? metric.readAt.slice(0, 16).replace("T", " ") : "Never"}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Target: </dt>
          <dd className="inline">{metric.target === null ? (metric.targetBecause ?? "None set") : metric.target}</dd>
        </div>
      </dl>
      <Link
        to={metric.drilldownHref}
        className="mt-3 inline-block text-[13px] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Open {metric.drilldownLabel}
      </Link>
    </article>
  );
}

export function BusinessHealth({ identity }: { identity: WorkspaceIdentity }) {
  const health = useQuery({
    queryKey: ["business-health", identity.organizationId],
    queryFn: () => loadBusinessHealth(identity.organizationId),
    retry: false,
  });

  return (
    <section aria-labelledby="business-health" className="space-y-4">
      <div>
        <h2 id="business-health" className="text-[18px] font-semibold text-foreground">
          Is the business healthy
        </h2>
        <p className="text-[13px] text-muted-foreground">
          Measured from the rooms that own each record. A source we could not read is shown as
          unavailable, never as zero.
        </p>
      </div>

      {health.isError ? (
        <p className="rounded-2xl border border-border bg-card p-5 text-[14px] text-warning-foreground">
          These measurements could not be read:{" "}
          {health.error instanceof Error ? health.error.message : "the read failed."}
        </p>
      ) : health.data ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {health.data.metrics.map((metric) => (
            <MetricCard key={metric.id} metric={metric} />
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border border-border bg-card p-5 text-[14px] text-muted-foreground">
          Reading the measurements.
        </p>
      )}
    </section>
  );
}
