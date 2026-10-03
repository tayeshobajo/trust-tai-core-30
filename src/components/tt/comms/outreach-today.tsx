import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WorkspaceIdentity } from "@/lib/workspace";
import { chicagoDay, ZONE } from "@/domain/outreach-today/live";
import { outreachKey, readOutreachToday } from "@/data/supabase/outreach-today-live";
export function OutreachToday({ identity }: { identity: WorkspaceIdentity }) {
  const [day, setDay] = useState(() => chicagoDay());
  const query = useQuery({ queryKey: outreachKey(identity.organizationId, identity.userId, day), queryFn: () => readOutreachToday(identity.organizationId, identity.userId, day), retry: false, enabled: !!day });
  return <section aria-labelledby="outreach-today-title" className="rounded-xl border border-border bg-card p-4 space-y-3">
    <h2 id="outreach-today-title" className="font-medium">Outreach Today</h2>
    <label className="flex flex-wrap items-center gap-2 text-sm">Reporting date ({ZONE})
      <input aria-label="Outreach reporting date" type="date" value={day} onChange={e => setDay(e.target.value)} className="min-h-11 max-w-full rounded border border-border bg-background px-2" />
    </label>
    <p className="text-sm text-muted-foreground">Live outbound observations for {day || "a date you select"}. These are stored message records, not proof of acceptance or delivery. Coverage is partial: only member-visible records are shown.</p>
    <p className="text-sm">Qualified campaign sends: Unknown. Remaining: Unknown. Account-wide coverage: Unknown.</p>
    {!day ? <p>Select a reporting date.</p> : query.isPending ? <p role="status">Reading outbound metadata…</p> : query.isError ? <p role="alert">Could not read outbound metadata. Counts and coverage remain unknown.</p> : query.data ? <>
      <p className="text-sm">{query.data.rows.length} validated observations in this read. This is not your total outreach count.</p>
      {query.data.truncated && <p role="status">Read limit reached. Older observations for this date may be missing.</p>}
      {query.data.rejected > 0 && <p role="status">Some records were withheld because metadata was invalid or conflicting. Coverage remains partial.</p>}
      {query.data.rows.length === 0 ? <p>No validated member-visible observations in this read. This does not establish that no outreach occurred.</p> : <ul className="divide-y divide-border">{query.data.rows.map(row => <li key={row.key} className="py-3 text-sm break-words">
        <p>{row.from} · {new Date(row.at).toLocaleString("en-US", { timeZone: ZONE })} ({ZONE})</p>
        <p>Campaign: Unassigned / unverified. Relationship: {row.relationship ? "Assigned" : "Unassigned"}. Thread: {row.thread ? "Assigned" : "Unassigned"}. Delivery: Unconfirmed.</p>
        <details><summary className="min-h-11 cursor-pointer py-3">Observation metadata</summary><p>Mailbox: {row.mailbox ?? "Unknown"}. Original timestamp: {row.at}</p></details>
      </li>)}</ul>}
    </> : null}
    <button type="button" disabled={!day || query.isFetching} onClick={() => void query.refetch()} className="min-h-11 rounded border border-border px-3 text-sm disabled:opacity-50">Refresh observations</button>
  </section>;
}
