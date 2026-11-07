import { it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeStudioCurrentMember } from "./studio-research-current-member.server";
import { COORDINATOR } from "./studio-research-coordinator-contracts";
const user = "11111111-1111-4111-8111-111111111111";
function fixture() {
  const rows: Record<string, unknown> = {
    organization_memberships: { status: "active", role: "owner" },
    organization_app_settings: { enabled: true },
    member_app_access: { access_level: "work" },
    organization_role_app_access: null,
  };
  const calls: { table: string; filters: Record<string, string> }[] = [];
  let failed = "";
  const from = vi.fn((table: string) => {
    const entry = { table, filters: {} as Record<string, string> };
    calls.push(entry);
    const q = {
      select: () => q,
      eq: (k: string, v: string) => {
        entry.filters[k] = v;
        return q;
      },
      maybeSingle: async () => ({
        data: rows[table],
        error: failed === table ? { message: "private database detail" } : null,
      }),
    };
    return q;
  });
  return {
    rows,
    calls,
    from,
    fail: (s: string) => {
      failed = s;
    },
    check: makeStudioCurrentMember({ from } as unknown as Pick<SupabaseClient, "from">),
  };
}
it("reads exact current subject/organization/Studio scope on every operation", async () => {
  const f = fixture();
  await f.check(user, COORDINATOR.organizationId);
  expect(f.calls).toHaveLength(4);
  for (const c of f.calls) expect(c.filters["organization_id"]).toBe(COORDINATOR.organizationId);
  expect(f.calls[0]!.filters["user_id"]).toBe(user);
  expect(f.calls.find((c) => c.table === "member_app_access")!.filters["user_id"]).toBe(user);
  for (const c of f.calls.slice(1)) expect(c.filters["app_key"]).toBe("studio");
  f.rows["organization_memberships"] = { status: "revoked", role: "owner" };
  await expect(f.check(user, COORDINATOR.organizationId)).rejects.toThrow(
    "studio_current_access_rejected",
  );
});
it.each([null, { status: "inactive", role: "owner" }, { status: "active", role: "invented" }])(
  "rejects missing/revoked/unknown membership %j",
  async (row) => {
    const f = fixture();
    f.rows["organization_memberships"] = row;
    await expect(f.check(user, COORDINATOR.organizationId)).rejects.toThrow();
  },
);
it.each(["hidden", "view", "invalid"])(
  "rejects insufficient/malformed member access %s",
  async (level) => {
    const f = fixture();
    f.rows["member_app_access"] = { access_level: level };
    await expect(f.check(user, COORDINATOR.organizationId)).rejects.toThrow();
  },
);
it("rejects disabled organization even for owner", async () => {
  const f = fixture();
  f.rows["organization_app_settings"] = { enabled: false };
  await expect(f.check(user, COORDINATOR.organizationId)).rejects.toThrow();
});
it.each([
  "organization_memberships",
  "organization_app_settings",
  "member_app_access",
  "organization_role_app_access",
])("fails closed without disclosing %s errors", async (table) => {
  const f = fixture();
  f.fail(table);
  await expect(f.check(user, COORDINATOR.organizationId)).rejects.toThrow(
    /^studio_current_access_rejected$/,
  );
});
it("rejects foreign tenant and malformed subject before querying", async () => {
  const f = fixture();
  await expect(f.check(user, user)).rejects.toThrow();
  await expect(f.check("invalid", COORDINATOR.organizationId)).rejects.toThrow();
  expect(f.from).not.toHaveBeenCalled();
});
