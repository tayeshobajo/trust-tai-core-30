/**
 * Foundation contract for the Steward migration.
 *
 * Conversations and commitments are canonical shared truth, so they must not
 * be named after the room that happens to write them first, and no new public
 * SECURITY DEFINER helper may be introduced: the suite already has a hardened
 * private.is_org_member(uuid).
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const sql = readFileSync("docs/steward-v1-schema.sql", "utf8");
const service = readFileSync("src/data/supabase/steward-service.ts", "utf8");

describe("canonical table names", () => {
  it("creates public.conversations and public.commitments", () => {
    expect(sql).toContain("create table if not exists public.conversations");
    expect(sql).toContain("create table if not exists public.commitments");
  });

  it("does not create steward-prefixed copies of canonical truth", () => {
    expect(sql).not.toMatch(/steward_conversations|steward_commitments/);
    expect(service).not.toMatch(/steward_conversations|steward_commitments/);
  });

  it("does not duplicate projects, people or tasks", () => {
    expect(sql).not.toMatch(/create table[^;]*steward_(tasks|projects|people|contacts|clients)/);
    // Canonical work is referenced, never copied.
    expect(sql).toContain("references public.projects(id)");
    expect(sql).toContain("references public.decisions(id)");
  });

  it("keeps only specialised Steward context under the steward_ prefix", () => {
    const created = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
    expect(created).toEqual([
      "conversations",
      "commitments",
      "steward_role_memory",
      "steward_beliefs",
    ]);
  });
});

describe("security posture", () => {
  it("introduces no public SECURITY DEFINER helper", () => {
    expect(sql).not.toMatch(/security\s+definer/i);
    expect(sql).not.toContain("steward_is_member");
  });

  it("reuses the hardened private.is_org_member in every policy", () => {
    const policies = [...sql.matchAll(/create policy[\s\S]*?;/g)].map((m) => m[0]);
    expect(policies.length).toBeGreaterThan(0);
    for (const policy of policies) expect(policy).toContain("private.is_org_member(organization_id)");
  });

  it("enables row level security on every new table", () => {
    const created = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
    for (const table of created) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
      expect(sql).toContain(`grant all on public.${table} to service_role`);
    }
  });

  it("grants nothing to anon", () => {
    expect(sql).not.toMatch(/to anon/);
  });

  it("pairs every update policy with using and with check", () => {
    const updates = [...sql.matchAll(/create policy[^;]*for update[\s\S]*?;/g)].map((m) => m[0]);
    expect(updates).toHaveLength(3);
    for (const policy of updates) {
      expect(policy).toContain("using (");
      expect(policy).toContain("with check (");
    }
  });

  it("grants no delete, and keeps the belief ledger append only", () => {
    expect(sql).not.toMatch(/grant[^;]*delete[^;]*to authenticated/);
    expect(sql).toContain("grant select, insert on public.steward_beliefs to authenticated");
  });
});

describe("source agnosticism", () => {
  it("keeps the canonical tables free of Fathom-only semantics", () => {
    const canonical = sql.slice(0, sql.indexOf("steward role memory"));
    expect(canonical).not.toMatch(/fathom_/i);
    expect(canonical).toContain("source_provider");
    expect(canonical).toContain("source_app");
  });
});
