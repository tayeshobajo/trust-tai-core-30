/**
 * Ledger status, said out loud, before anyone tries to save.
 *
 * A quiet line when the three Conductor tables are reachable; a plain,
 * unmistakable notice when they are missing or closed to this account.
 */

import { TTCard } from "@/components/tt/primitives";
import type { ConductorSchemaHealth } from "@/data/supabase/conductor-schema";

export interface SchemaStatusProps {
  health?: ConductorSchemaHealth;
  checking?: boolean;
}

export function SchemaStatus({ health, checking }: SchemaStatusProps) {
  if (checking && !health) {
    return <p className="text-xs text-[var(--tt-ink-muted)]">Checking the ledger…</p>;
  }
  if (!health) return null;

  if (health.ready) {
    return (
      <p className="text-xs text-[var(--tt-ink-muted)]">
        Ledger reachable, figures and corrections are saved to your workspace.
      </p>
    );
  }

  return (
    <TTCard className="space-y-2 border-[var(--tt-rule)] p-4">
      <h3 className="text-sm">The Conductor cannot record anything yet</h3>
      <p className="text-sm text-[var(--tt-ink-muted)]">{health.message}</p>
      <ul className="space-y-1 text-xs text-[var(--tt-ink-muted)]">
        {health.tables.map((table) => (
          <li key={table.table}>
            <span className="font-mono">{table.table}</span> · {table.status}
            {table.detail ? `: ${table.detail}` : ""}
          </li>
        ))}
      </ul>
    </TTCard>
  );
}
