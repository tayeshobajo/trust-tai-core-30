import type { Opportunity, Submission } from "./rfps";

function wallTime(instant: number, zone: string): string {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value]),
  );
  return `${values["year"]}-${values["month"]}-${values["day"]}T${values["hour"]}:${values["minute"]}`;
}

/** Choose the later instant for a repeated DST minute; nonexistent times stay unknown. */
function latestZonedInstant(local: string, zone: string): number | null {
  const nominal = Date.parse(`${local}:00Z`);
  const matches = new Set<number>();
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    const probe = nominal + hours * 3600000;
    const offset = Date.parse(`${wallTime(probe, zone)}:00Z`) - probe;
    const candidate = nominal - offset;
    if (wallTime(candidate, zone) === local) matches.add(candidate);
  }
  return matches.size ? Math.max(...matches) : null;
}

export function recordedDeadlinePassed(o: Opportunity, now: Date): boolean {
  const date = o.deadline_date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const day = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== date) return false;
  if (!Number.isFinite(now.getTime())) return false;
  // Without a zone, retain the row until its calendar day has ended everywhere
  // (UTC−12). This is a display boundary, not an invented source timezone.
  if (!o.deadline_timezone) return now.getTime() >= day + 36 * 3600000;
  if (o.deadline_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(o.deadline_time)) return false;
  try {
    if (!o.deadline_time) return wallTime(now.getTime(), o.deadline_timezone).slice(0, 10) > date;
    const end = latestZonedInstant(`${date}T${o.deadline_time}`, o.deadline_timezone);
    return end !== null && now.getTime() >= end;
  } catch {
    return false; // Invalid/unrecognized timezone is uncertainty, not expiry.
  }
}

export function hiddenPastRfpIds(
  rows: Opportunity[],
  submissions: Submission[],
  now: Date,
): Set<string> {
  const recorded = new Set(submissions.map((s) => s.opportunity_id));
  return new Set(
    rows
      .filter(
        (o) =>
          o.kind === "rfp" &&
          !recorded.has(o.id) &&
          !["submitted", "awarded", "declined"].includes(o.stage) &&
          recordedDeadlinePassed(o, now),
      )
      .map((o) => o.id),
  );
}

export function safeSourceLink(value: string): string | null {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
