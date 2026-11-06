import {
  event,
  org,
  roadmapId,
  relationshipId,
  userId,
} from "@/domain/roadmap-correspondence.fixtures";
import type { Correspondence } from "@/domain/roadmap-correspondence";

export const mailRow = (i = 1) => ({
  id: `00000000-0000-4000-8001-${String(i).padStart(12, "0")}`,
  organization_id: org,
  relationship_id: relationshipId,
  provider: "gmail",
  provider_message_id: `synthetic-${i}`,
  direction: "inbound",
  occurred_at: "2026-11-05T12:00:00Z",
  mailbox: "team@example.test",
  source: "gmail",
  fetched_at: "2026-11-06T12:00:00Z",
  sent_at: null,
  subject: "Synthetic reply",
  body_text: `SYNTHETIC PRIVATE ${i}`,
  snippet: "Synthetic snippet",
});
export const reviewedRow = (e: Correspondence = event, i = 1) => ({
  event_key: i.toString(16).padStart(64, "0"),
  event_payload: e,
});
const pick = (row: object, keys: string[]) =>
  Object.fromEntries(keys.map((key) => [key, (row as Record<string, unknown>)[key]]));
export const reviewedMetadata = (row: ReturnType<typeof reviewedRow>) => ({
  ...pick(row.event_payload, [
    "organizationId",
    "roadmapId",
    "relationshipId",
    "channel",
    "kind",
    "occurredAt",
    "sourceAccountRef",
    "sourceEventId",
    "identityKind",
    "timestampPrecision",
    "review",
  ]),
  event_key: row.event_key,
  rowOrganizationId: row.event_payload.organizationId,
  rowRoadmapId: row.event_payload.roadmapId,
  rowRelationshipId: row.event_payload.relationshipId,
});
export function testState() {
  return {
    reviewed: [] as ReturnType<typeof reviewedRow>[],
    mail: [] as ReturnType<typeof mailRow>[],
    mappings: [
      { id: roadmapId, organization_id: org, relationship_id: relationshipId as string | null },
    ],
    reads: [] as {
      table: string;
      columns: string;
      filters: [string, unknown][];
      range?: [number, number];
    }[],
    authCalls: 0,
    denied: false,
    loseAccess: false,
    changeMapping: false,
    changeUser: false,
    memberOverride: null as string | null,
    roleOverride: null as string | null,
    orgEnabled: true,
    membershipRole: "member",
    loseCommsAccess: false,
    permissionError: false,
    errorTable: "",
    truncateTable: "",
    countOverride: null as number | null,
    corruptBody: false,
    countChanges: false,
  };
}
export type TestState = ReturnType<typeof testState>;
export function fakeClient(state: TestState) {
  return {
    from(table: string) {
      const record: TestState["reads"][number] = { table, columns: "", filters: [] };
      state.reads.push(record);
      let limit = Infinity;
      const result = () => {
        if (
          [
            "organization_memberships",
            "organization_app_settings",
            "member_app_access",
            "organization_role_app_access",
          ].includes(table)
        ) {
          const data =
            table === "organization_memberships"
              ? { status: "active", role: state.membershipRole }
              : table === "organization_app_settings"
                ? { enabled: state.orgEnabled }
                : {
                    access_level:
                      table === "member_app_access"
                        ? state.loseCommsAccess && state.authCalls > 1
                          ? "hidden"
                          : state.memberOverride
                        : state.roleOverride,
                  };
          return { data, error: state.permissionError ? {} : null, count: 1 };
        }
        let rows: unknown[] =
          table === "roadmaps"
            ? state.mappings.map((r) =>
                state.changeMapping && state.authCalls > 1 ? { ...r, relationship_id: null } : r,
              )
            : table === "roadmap_correspondence_events"
              ? state.reviewed.map((r) =>
                  record.columns === "event_key, event_payload" ? r : reviewedMetadata(r),
                )
              : table === "comms_messages"
                ? state.mail.map((r) =>
                    record.columns.includes("body_text")
                      ? state.corruptBody
                        ? { ...r, relationship_id: org }
                        : r
                      : pick(r, [
                          "id",
                          "organization_id",
                          "relationship_id",
                          "provider",
                          "provider_message_id",
                          "direction",
                          "occurred_at",
                          "mailbox",
                          "source",
                          "fetched_at",
                          "sent_at",
                        ]),
                  )
                : [];
        const selected = record.filters.find(([key]) => key === "in:id" || key === "in:event_key");
        if (selected) {
          const key = selected[0].slice(3);
          rows = rows.filter((r) =>
            (selected[1] as string[]).includes((r as Record<string, string>)[key]!),
          );
        }
        const count =
          state.countOverride ??
          rows.length + (state.countChanges && (record.range?.[0] ?? 0) > 0 ? 1 : 0);
        const [from, to] = record.range ?? [0, limit - 1];
        rows = rows.slice(from, to + 1);
        if (state.truncateTable === table) rows = rows.slice(0, Math.max(0, rows.length - 1));
        return { data: rows, count, error: state.errorTable === table ? {} : null };
      };
      const q = {
        select(columns: string) {
          record.columns = columns;
          return q;
        },
        eq(key: string, value: unknown) {
          record.filters.push([key, value]);
          return q;
        },
        in(key: string, values: unknown[]) {
          record.filters.push([`in:${key}`, values]);
          return q;
        },
        order() {
          return q;
        },
        limit(n: number) {
          limit = n;
          return q;
        },
        range(from: number, to: number) {
          record.range = [from, to];
          return q;
        },
        async maybeSingle() {
          const r = result();
          return { ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data };
        },
        then(resolve: (r: unknown) => unknown) {
          return Promise.resolve(result()).then(resolve);
        },
      };
      return q;
    },
  };
}
export { event, org, roadmapId, relationshipId, userId };
