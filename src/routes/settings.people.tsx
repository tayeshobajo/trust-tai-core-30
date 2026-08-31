import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";
import { browserOrigin, signInUrlFor } from "@/lib/auth-origin";
import { inviteEmailBody } from "@/lib/invite-email-template";


import { SectionHeading, TTButton, TTField, TTInput } from "@/components/tt/primitives";
import {
  Health,
  InfoTip,
  NotProvisioned,
  PersonChip,
  TTSelect,
} from "@/components/tt/settings/pieces";
import { AccessOverview } from "@/components/tt/settings/access-overview";
import { RoleAccessMatrix } from "@/components/tt/settings/role-access-matrix";
import { PermissionSummary } from "@/components/tt/settings/permission-summary";
import { useSettingsIdentity } from "@/components/tt/settings/shell";
import {
  cancelInvitation,
  createMemberWithPassword,
  deliverInvitationEmail,
  inviteMembers,
  listInvitationAudit,
  listInvitations,
  listMembers,
  parseEmails,
  readOrganizationApps,
  resendInvitation,
  resetMemberPassword,
  setMemberAppAccess,
  setMemberRole,
  setMemberStatus,
  type MemberProfile,
} from "@/data/supabase/settings-service";
import { ROLE_LABEL, normalizeRole, type WorkspaceRole } from "@/domain/access";
import { PASSWORD_HELP, validatePassword } from "@/domain/admin-password";
import { MEMBERSHIP_ROLES } from "@/data/supabase/schema";
import {
  APP_ACCESS_DESCRIPTION,
  APP_ACCESS_LABEL,
  APP_ACCESS_LEVELS,
  resolveAppAccess,
  roleDefaultAccess,
  type AppAccessLevel,
} from "@/domain/app-access";
import { APP_REGISTRY } from "@/domain/registry";

/* Only the roles the workspace database will actually accept are offered. */
const ASSIGNABLE_ROLES = MEMBERSHIP_ROLES as readonly WorkspaceRole[];

export const Route = createFileRoute("/settings/people")({
  component: PeopleSettings,
});


function whenText(value: string | null): string {
  if (!value) return "No activity recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No activity recorded";
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

type SortKey = "name" | "role" | "rooms" | "lastActive" | "status";

/** A sortable, explainable column header. Presentation only. */
function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  hint,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; direction: "asc" | "desc" };
  onSort: (key: SortKey) => void;
  hint?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      scope="col"
      className="tt-eyebrow px-4 py-2 font-normal"
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className="inline-flex items-center gap-1 uppercase tracking-[inherit] hover:text-foreground"
        >
          {label}
          <span aria-hidden className={active ? "text-royal" : "text-muted-foreground/50"}>
            {active ? (sort.direction === "asc" ? "\u2191" : "\u2193") : "\u2195"}
          </span>
        </button>
        {hint ? <InfoTip label={`About ${label}`}>{hint}</InfoTip> : null}
      </span>
    </th>
  );
}

function PeopleSettings() {
  const identity = useSettingsIdentity();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [bulkRole, setBulkRole] = useState<WorkspaceRole>("member");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNote, setBulkNote] = useState<string | null>(null);
  const [resendAllBusy, setResendAllBusy] = useState(false);
  const [resendAllNote, setResendAllNote] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({
    key: "name",
    direction: "asc",
  });
  const toggleSort = (key: SortKey) => {
    setPage(1);
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: key === "lastActive" ? "desc" : "asc" },
    );
  };


  const members = useQuery({
    queryKey: ["settings", "members", identity.organizationId],
    queryFn: () => listMembers(identity.organizationId),
  });
  const apps = useQuery({
    queryKey: ["settings", "org-apps", identity.organizationId],
    queryFn: () => readOrganizationApps(identity.organizationId),
  });
  const invitations = useQuery({
    queryKey: ["settings", "invitations", identity.organizationId],
    queryFn: () => listInvitations(identity.organizationId),
  });

  const pendingInvitations = useMemo(
    () => (invitations.data?.value ?? []).filter((row) => row.status === "pending"),
    [invitations.data?.value],
  );

  const orgEnabled = apps.data?.value ?? {};
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["settings"] });
    void queryClient.invalidateQueries({ queryKey: ["workspace"] });
  };

  const roleChange = useMutation({
    mutationFn: async (input: { member: MemberProfile; role: WorkspaceRole }) =>
      setMemberRole({
        organizationId: identity.organizationId,
        userId: input.member.userId,
        memberName: input.member.name,
        role: input.role,
        actorUserId: identity.userId,
      }),
    onSuccess: refresh,
  });

  const accessChange = useMutation({
    mutationFn: async (input: {
      member: MemberProfile;
      appId: string;
      appName: string;
      level: AppAccessLevel;
    }) =>
      setMemberAppAccess({
        organizationId: identity.organizationId,
        userId: input.member.userId,
        memberName: input.member.name,
        appId: input.appId,
        appName: input.appName,
        level: input.level,
        actorUserId: identity.userId,
      }),
    onSuccess: refresh,
  });

  const statusChange = useMutation({
    mutationFn: async (input: { member: MemberProfile; status: "active" | "deactivated" }) =>
      setMemberStatus({
        organizationId: identity.organizationId,
        userId: input.member.userId,
        memberName: input.member.name,
        status: input.status,
        actorUserId: identity.userId,
      }),
    onSuccess: refresh,
  });

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const all = members.data ?? [];
    const matches = term
      ? all.filter(
          (member) =>
            member.name.toLowerCase().includes(term) ||
            member.email.toLowerCase().includes(term) ||
            (member.jobTitle ?? "").toLowerCase().includes(term) ||
            ROLE_LABEL[member.role].toLowerCase().includes(term),
        )
      : all;

    const decorated = matches.map((member) => ({
      member,
      rooms: APP_REGISTRY.filter(
        (app) =>
          resolveAppAccess(app.id, {
            role: member.role,
            membershipActive: member.status === "active",
            organizationEnabled: orgEnabled[app.id] !== false,
            override: member.access[app.id],
          }).visible,
      ).length,
    }));

    const direction = sort.direction === "asc" ? 1 : -1;
    return [...decorated].sort((a, b) => {
      switch (sort.key) {
        case "role":
          return direction * ROLE_LABEL[a.member.role].localeCompare(ROLE_LABEL[b.member.role]);
        case "rooms":
          return direction * (a.rooms - b.rooms);
        case "lastActive":
          return (
            direction *
            ((a.member.lastActiveAt ? Date.parse(a.member.lastActiveAt) : 0) -
              (b.member.lastActiveAt ? Date.parse(b.member.lastActiveAt) : 0))
          );
        case "status":
          return direction * a.member.status.localeCompare(b.member.status);
        default:
          return direction * a.member.name.localeCompare(b.member.name);
      }
    });
  }, [members.data, search, sort, orgEnabled]);

  /* Pagination is presentation only: the same filtered, sorted truth, windowed. */
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = rows.slice(pageStart, pageStart + pageSize);

  /* Bulk selection never reaches beyond what this admin may actually change. */
  const eligibleOnPage = pageRows
    .map(({ member }) => member)
    .filter((member) => identity.canManage && member.userId !== identity.userId);
  const checkedSet = new Set(checkedIds);
  const checkedMembers = (members.data ?? []).filter(
    (member) => checkedSet.has(member.userId) && member.userId !== identity.userId,
  );
  const allOnPageChecked =
    eligibleOnPage.length > 0 && eligibleOnPage.every((member) => checkedSet.has(member.userId));

  const toggleChecked = (userId: string) =>
    setCheckedIds((previous) =>
      previous.includes(userId)
        ? previous.filter((id) => id !== userId)
        : [...previous, userId],
    );

  const togglePage = () =>
    setCheckedIds((previous) => {
      const ids = eligibleOnPage.map((member) => member.userId);
      return allOnPageChecked
        ? previous.filter((id) => !ids.includes(id))
        : Array.from(new Set([...previous, ...ids]));
    });

  const runBulk = async (action: { kind: "role" } | { kind: "status"; status: "active" | "deactivated" }) => {
    if (checkedMembers.length === 0) return;
    setBulkBusy(true);
    setBulkNote(null);
    let done = 0;
    const failures: string[] = [];
    for (const member of checkedMembers) {
      try {
        if (action.kind === "role") {
          await setMemberRole({
            organizationId: identity.organizationId,
            userId: member.userId,
            memberName: member.name,
            role: bulkRole,
            actorUserId: identity.userId,
          });
        } else {
          await setMemberStatus({
            organizationId: identity.organizationId,
            userId: member.userId,
            memberName: member.name,
            status: action.status,
            actorUserId: identity.userId,
          });
        }
        done += 1;
      } catch (error) {
        failures.push(`${member.name}: ${(error as Error).message}`);
      }
    }
    setBulkBusy(false);
    setBulkNote(
      failures.length === 0
        ? `Updated ${done} ${done === 1 ? "person" : "people"}.`
        : `Updated ${done}. ${failures[0] ?? ""}`,
    );
    if (failures.length === 0) setCheckedIds([]);
    refresh();
  };

  const selected = (members.data ?? []).find((member) => member.userId === selectedId) ?? null;
  const [deliveryById, setDeliveryById] = useState<Record<string, { delivered: boolean; because: string }>>({});
  const invitationAudit = useQuery({
    queryKey: ["settings", "invitation-audit", identity.organizationId],
    queryFn: () => listInvitationAudit(identity.organizationId),
    enabled: identity.canManage,
  });


  return (
    <>
      <AccessOverview
        members={members.data ?? []}
        pendingInvitations={pendingInvitations}
        invitationsProvisioned={invitations.data?.provisioned !== false}
        isPending={members.isPending}
      />

      <div className="tt-surface p-6">

        <SectionHeading
          eyebrow="Workspace"
          title="People &amp; access"
          description="Who is in this workspace, what authority they hold, and which rooms they can see. Access always fails closed."
        />

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <TTInput
            value={search}
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
            placeholder="Search people by name or email"
            aria-label="Search people"
            className="max-w-xs"
          />
          <span className="text-xs text-muted-foreground">
            {members.isPending ? "Reading members…" : `${rows.length} shown`}
          </span>
          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <label htmlFor="people-page-size">People per page</label>
            <TTSelect
              id="people-page-size"
              className="h-9 w-20"
              value={String(pageSize)}
              onChange={(event) => {
                setPage(1);
                setPageSize(Number(event.target.value));
              }}
            >
              {[10, 25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </TTSelect>
          </span>
        </div>

        {identity.canManage && checkedMembers.length > 0 ? (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-royal/30 bg-royal/5 px-4 py-3">
            <span className="text-sm text-foreground">
              {checkedMembers.length} selected
            </span>
            <TTSelect
              aria-label="Role to apply to selected people"
              className="h-9 w-40"
              value={bulkRole}
              onChange={(event) => setBulkRole(normalizeRole(event.target.value))}
            >
              {ASSIGNABLE_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </TTSelect>
            <TTButton
              variant="secondary"
              disabled={bulkBusy}
              onClick={() => void runBulk({ kind: "role" })}
            >
              Apply role
            </TTButton>
            <TTButton
              variant="secondary"
              disabled={bulkBusy}
              onClick={() => void runBulk({ kind: "status", status: "deactivated" })}
            >
              Suspend
            </TTButton>
            <TTButton
              variant="secondary"
              disabled={bulkBusy}
              onClick={() => void runBulk({ kind: "status", status: "active" })}
            >
              Reactivate
            </TTButton>
            <button
              type="button"
              className="text-[13px] text-muted-foreground hover:underline"
              onClick={() => setCheckedIds([])}
            >
              Clear selection
            </button>
            <span className="w-full text-xs text-muted-foreground">
              {bulkBusy
                ? "Applying, one person at a time so every change is recorded."
                : (bulkNote ?? "You are never included in a bulk change.")}
            </span>
          </div>
        ) : null}

        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[720px] text-left">
            <thead>
              <tr className="border-b border-border bg-secondary/50">
                {identity.canManage ? (
                  <th scope="col" className="w-10 px-4 py-2">
                    <input
                      type="checkbox"
                      className="size-4 accent-royal"
                      aria-label="Select everyone on this page"
                      checked={allOnPageChecked}
                      disabled={eligibleOnPage.length === 0}
                      onChange={togglePage}
                    />
                  </th>
                ) : null}
                <SortHeader label="Person" sortKey="name" sort={sort} onSort={toggleSort} />
                <SortHeader
                  label="Role"
                  sortKey="role"
                  sort={sort}
                  onSort={toggleSort}
                  hint="A role sets the ceiling. Room access can narrow it, never widen it."
                />
                <SortHeader
                  label="Rooms"
                  sortKey="rooms"
                  sort={sort}
                  onSort={toggleSort}
                  hint="How many rooms this person can actually see, after the organization switches and their overrides."
                />
                <SortHeader label="Last active" sortKey="lastActive" sort={sort} onSort={toggleSort} />
                <SortHeader
                  label="Status"
                  sortKey="status"
                  sort={sort}
                  onSort={toggleSort}
                  hint="A deactivated person keeps their history and loses every room immediately."
                />
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pageRows.map(({ member, rooms }) => {
                const selectable = identity.canManage && member.userId !== identity.userId;
                return (
                  <tr key={member.userId} className="align-middle">
                    {identity.canManage ? (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          className="size-4 accent-royal"
                          aria-label={`Select ${member.name}`}
                          checked={checkedSet.has(member.userId)}
                          disabled={!selectable}
                          onChange={() => toggleChecked(member.userId)}
                        />
                      </td>
                    ) : null}
                    <td className="px-4 py-3">
                      <PersonChip
                        name={member.name}
                        email={member.email}
                        avatarUrl={member.avatarUrl}
                        supporting={member.jobTitle ?? member.email}
                      />
                    </td>
                    <td className="px-4 py-3">
                      {selectable ? (
                        <TTSelect
                          aria-label={`Role for ${member.name}`}
                          className="h-9 w-40"
                          value={member.role}
                          onChange={(event) =>
                            roleChange.mutate({
                              member,
                              role: normalizeRole(event.target.value),
                            })
                          }
                        >
                          {ASSIGNABLE_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {ROLE_LABEL[role]}
                            </option>
                          ))}
                        </TTSelect>
                      ) : (
                        <span className="text-sm text-foreground">{ROLE_LABEL[member.role]}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {rooms === 0 ? "No rooms" : `${rooms} of ${APP_REGISTRY.length}`}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {whenText(member.lastActiveAt)}
                    </td>
                    <td className="px-4 py-3">
                      <Health tone={member.status === "active" ? "good" : "neutral"}>
                        {member.status === "active" ? "Active" : "Deactivated"}
                      </Health>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedId(selectedId === member.userId ? null : member.userId)
                        }
                        className="text-[13px] text-royal hover:underline"
                      >
                        {selectedId === member.userId ? "Close" : "Manage access"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!members.isPending && rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={identity.canManage ? 7 : 6}
                    className="px-4 py-8 text-center text-sm text-muted-foreground"
                  >
                    No one matches that search.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {rows.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-xs text-muted-foreground">
              Showing {pageStart + 1} to {Math.min(pageStart + pageSize, rows.length)} of{" "}
              {rows.length}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <TTButton
                variant="secondary"
                disabled={currentPage <= 1}
                onClick={() => setPage(Math.max(1, currentPage - 1))}
              >
                Previous
              </TTButton>
              <span className="text-xs text-muted-foreground">
                Page {currentPage} of {totalPages}
              </span>
              <TTButton
                variant="secondary"
                disabled={currentPage >= totalPages}
                onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
              >
                Next
              </TTButton>
            </div>
          </div>
        ) : null}


        {roleChange.error || accessChange.error || statusChange.error ? (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {
              ((roleChange.error ?? accessChange.error ?? statusChange.error) as Error)
                .message
            }
          </p>
        ) : null}
      </div>

      {selected ? (
        <MemberAccessPanel
          organizationId={identity.organizationId}
          actorUserId={identity.userId}
          member={selected}
          orgEnabled={orgEnabled}
          canManage={identity.canManage}
          isSelf={selected.userId === identity.userId}
          provisioned={apps.data?.provisioned ?? false}
          onLevel={(appId, appName, level) =>
            accessChange.mutate({ member: selected, appId, appName, level })
          }
          onStatus={(status) => statusChange.mutate({ member: selected, status })}
        />
      ) : null}

      {identity.canManage ? (
        <InvitePanel
          organizationId={identity.organizationId}
          organizationName={identity.organizationName}
          invitedByName={identity.name}
          actorUserId={identity.userId}
          onDone={refresh}
          onDelivery={(invitationId, result) =>
            setDeliveryById((previous) => ({ ...previous, [invitationId]: result }))
          }
        />

      ) : null}

      <div className="tt-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <SectionHeading
            title="Pending invitations"
            description="People invited but not yet signed in. An invitation grants nothing until it is accepted."
          />
          {identity.canManage && pendingInvitations.length > 0 ? (
            <button
              type="button"
              disabled={resendAllBusy}
              className="shrink-0 rounded-lg border border-border px-3 py-2 text-[13px] text-foreground transition-colors hover:bg-secondary disabled:opacity-60"
              onClick={() => {
                void (async () => {
                  setResendAllBusy(true);
                  setResendAllNote(null);
                  let sent = 0;
                  let failed = 0;
                  for (const invitation of pendingInvitations) {
                    try {
                      await resendInvitation({
                        organizationId: identity.organizationId,
                        invitationId: invitation.id,
                        email: invitation.email,
                        actorUserId: identity.userId,
                      });
                      const result = await deliverInvitationEmail({
                        organizationId: identity.organizationId,
                        invitationId: invitation.id,
                        email: invitation.email,
                        actorUserId: identity.userId,
                      });
                      setDeliveryById((previous) => ({ ...previous, [invitation.id]: result }));
                      if (result.delivered) sent += 1;
                      else failed += 1;
                    } catch {
                      failed += 1;
                    }
                  }
                  setResendAllBusy(false);
                  setResendAllNote(
                    failed === 0
                      ? `Sent again to ${sent} ${sent === 1 ? "person" : "people"}.`
                      : `Sent again to ${sent}; ${failed} could not be emailed.`,
                  );
                  refresh();
                })();
              }}
            >
              {resendAllBusy
                ? "Sending…"
                : `Send all ${pendingInvitations.length} again`}
            </button>
          ) : null}
        </div>
        {resendAllNote ? (
          <p className="mb-3 text-xs text-muted-foreground" role="status">
            {resendAllNote}
          </p>
        ) : null}

        {invitations.data?.provisioned === false ? (
          <NotProvisioned what="Invitations" file="docs/settings-schema.sql" />
        ) : pendingInvitations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No invitations are waiting.</p>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border">
            {pendingInvitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{invitation.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {ROLE_LABEL[invitation.role]} · invited {whenText(invitation.createdAt)}
                    </p>
                  </div>
                  {identity.canManage ? (
                    <>
                      <button
                        type="button"
                        className="text-[13px] text-royal hover:underline"
                        onClick={() => {
                          void (async () => {
                            await resendInvitation({
                              organizationId: identity.organizationId,
                              invitationId: invitation.id,
                              email: invitation.email,
                              actorUserId: identity.userId,
                            });
                            const result = await deliverInvitationEmail({
                              organizationId: identity.organizationId,
                              invitationId: invitation.id,
                              email: invitation.email,
                              actorUserId: identity.userId,
                            });
                            setDeliveryById((previous) => ({
                              ...previous,
                              [invitation.id]: result,
                            }));
                            refresh();
                          })();
                        }}
                      >
                        Send again
                      </button>
                      <button
                        type="button"
                        className="text-[13px] text-muted-foreground hover:text-destructive hover:underline"
                        onClick={() =>
                          void cancelInvitation({
                            organizationId: identity.organizationId,
                            invitationId: invitation.id,
                            email: invitation.email,
                            actorUserId: identity.userId,
                          }).then(refresh)
                        }
                      >
                        Cancel
                      </button>
                    </>
                  ) : null}
                </div>
              ))}
          </div>
        )}
        {pendingInvitations.map((invitation) => {
          const status = deliveryById[invitation.id];
          if (!status) return null;
          return (
            <p
              key={invitation.id}
              className={cn(
                "mt-3 text-xs",
                status.delivered ? "text-emerald-700" : "text-amber-700",
              )}
              role="status"
            >
              {status.delivered
                ? `Emailed ${invitation.email}: ${status.because}`
                : `Could not email ${invitation.email}: ${status.because}`}
            </p>
          );
        })}
      </div>

      {identity.canManage ? (
        <RoleAccessMatrix
          organizationId={identity.organizationId}
          actorUserId={identity.userId}
          canManage={identity.canManage}
          orgEnabled={orgEnabled}
        />
      ) : null}

      {identity.canManage ? <InvitationAudit query={invitationAudit} /> : null}

      <PermissionSummary role={normalizeRole(identity.role)} />
    </>
  );
}

/** Invitation history, drawn from the shared activity stream. Read only. */
function InvitationAudit({
  query,
}: {
  query: {
    data?: Awaited<ReturnType<typeof listInvitationAudit>> | undefined;
    isPending: boolean;
  };
}) {
  const entries = query.data?.value ?? [];
  return (
    <div className="tt-surface p-6">
      <SectionHeading
        eyebrow="History"
        title="Invitation activity"
        description="Every invitation created, resent, emailed or cancelled in this workspace, with who did it and when."
      />
      {query.data?.provisioned === false ? (
        <NotProvisioned what="Invitation history" file="docs/settings-schema.sql" />
      ) : query.isPending ? (
        <p className="text-sm text-muted-foreground">Reading history…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">No invitation activity recorded yet.</p>
      ) : (
        <ol className="divide-y divide-border rounded-xl border border-border">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Health
                tone={
                  entry.lifecycle === "cancelled"
                    ? "caution"
                    : entry.delivered === false
                      ? "risk"
                      : "good"
                }
              >
                {LIFECYCLE_LABEL[entry.lifecycle]}
              </Health>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{entry.summary}</p>
                <p className="text-xs text-muted-foreground">
                  {entry.email ? `${entry.email} · ` : ""}
                  {whenText(entry.at)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

const LIFECYCLE_LABEL: Record<string, string> = {
  created: "Created",
  resent: "Resent",
  emailed: "Emailed",
  password_reset: "Password set",
  cancelled: "Cancelled",
  other: "Recorded",
};

function MemberAccessPanel({
  organizationId,
  actorUserId,
  member,
  orgEnabled,
  canManage,
  isSelf,
  provisioned,
  onLevel,
  onStatus,
}: {
  organizationId: string;
  actorUserId: string;
  member: MemberProfile;
  orgEnabled: Record<string, boolean>;
  canManage: boolean;
  isSelf: boolean;
  provisioned: boolean;
  onLevel: (appId: string, appName: string, level: AppAccessLevel) => void;
  onStatus: (status: "active" | "deactivated") => void;
}) {
  const [resetOpen, setResetOpen] = useState(false);
  return (

    <div className="tt-surface p-6">
      <SectionHeading
        eyebrow="Access"
        title={`What ${member.name} can reach`}
        description="Visibility and authority are separate. Hidden rooms never appear in their navigation."
      />

      <div className="space-y-2">
        {APP_REGISTRY.map((app) => {
          const enabled = orgEnabled[app.id] !== false;
          const ceiling = roleDefaultAccess(member.role, app.id);
          const decision = resolveAppAccess(app.id, {
            role: member.role,
            membershipActive: member.status === "active",
            organizationEnabled: enabled,
            override: member.access[app.id],
          });
          const current = member.access[app.id] ?? ceiling;
          return (
            <div
              key={app.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{app.name}</p>
                <p className="text-xs text-muted-foreground">{decision.because}</p>
              </div>
              <TTSelect
                aria-label={`${app.name} access for ${member.name}`}
                className="h-9 w-36"
                value={current}
                disabled={!canManage || !provisioned || !enabled || ceiling === "hidden"}
                onChange={(event) =>
                  onLevel(app.id, app.name, event.target.value as AppAccessLevel)
                }
              >
                {APP_ACCESS_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {APP_ACCESS_LABEL[level]}
                  </option>
                ))}
              </TTSelect>
            </div>
          );
        })}
      </div>

      {provisioned ? null : (
        <div className="mt-4">
          <NotProvisioned what="Per-person application access" file="docs/settings-schema.sql" />
        </div>
      )}

      <div className="mt-6 rounded-xl border border-border bg-secondary/40 p-4">
        <p className="tt-eyebrow">What each level means</p>
        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
          {APP_ACCESS_LEVELS.map((level) => (
            <li key={level}>
              <span className="text-foreground">{APP_ACCESS_LABEL[level]}</span>{" "}
              {APP_ACCESS_DESCRIPTION[level]}
            </li>
          ))}
        </ul>
      </div>

      {canManage ? (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {isSelf ? null : (
            <TTButton
              variant="secondary"
              onClick={() => onStatus(member.status === "active" ? "deactivated" : "active")}
            >
              {member.status === "active"
                ? `Deactivate ${member.name}`
                : `Reactivate ${member.name}`}
            </TTButton>
          )}
          <TTButton variant="secondary" onClick={() => setResetOpen(true)}>
            Set new password
          </TTButton>
          <span className="text-xs text-muted-foreground">
            {isSelf
              ? "Setting a password here changes your own sign-in credential immediately."
              : "A deactivated person keeps their history and loses every room immediately."}
          </span>
        </div>
      ) : null}

      {resetOpen ? (
        <ResetPasswordDialog
          organizationId={organizationId}
          actorUserId={actorUserId}
          member={member}
          onClose={() => setResetOpen(false)}
        />
      ) : null}
    </div>
  );

}

function InvitePanel({
  organizationId,
  organizationName,
  invitedByName,
  actorUserId,
  onDone,
  onDelivery,
}: {
  organizationId: string;
  organizationName: string;
  invitedByName: string;
  actorUserId: string;
  onDone: () => void;
  onDelivery?: (invitationId: string, result: { delivered: boolean; because: string }) => void;
}) {
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("member");
  const [overrides, setOverrides] = useState<Record<string, AppAccessLevel>>({});
  const [sent, setSent] = useState<number | null>(null);
  const [delivered, setDelivered] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [mode, setMode] = useState<"email" | "password">("email");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [created, setCreated] = useState<{
    email: string;
    role: WorkspaceRole;
    rooms: string[];
  } | null>(null);

  const parsed = parseEmails(emails);

  /* The preview renders the same template the server sends. One source, no drift. */
  const previewTo = parsed.valid[0] ?? "someone@company.com";
  const preview = useMemo(
    () =>
      inviteEmailBody({
        to: previewTo,
        organizationName,
        roleLabel: ROLE_LABEL[role],
        invitedByName,
        signInUrl: signInUrlFor(previewTo, browserOrigin()),
        expiresAt: null,
      }),
    [previewTo, organizationName, role, invitedByName],
  );



  const invite = useMutation({
    mutationFn: async () =>
      inviteMembers({
        organizationId,
        emails: parsed.valid,
        role,
        access: overrides,
        actorUserId,
      }),
    onSuccess: async (created) => {
      setSent(created.length);
      setEmails("");
      const failures: string[] = [];
      for (const invitation of created) {
        const result = await deliverInvitationEmail({
          organizationId,
          invitationId: invitation.id,
          email: invitation.email,
          actorUserId,
        });
        onDelivery?.(invitation.id, result);
        if (!result.delivered) failures.push(result.because);
      }
      setDelivered(
        failures.length === 0
          ? `${created.length} invitation${created.length === 1 ? "" : "s"} emailed.`
          : failures[0] ?? null,
      );
      onDone();
    },
  });

  /* Direct provisioning. One email, one auth user, the same canonical
     membership the invitation path produces. The password is held only until
     the request completes. */
  const createUser = useMutation({
    mutationFn: async () => {
      const email = parsed.valid[0];
      if (!email) throw new Error("Enter the email address for this person.");
      if (parsed.valid.length > 1) {
        throw new Error("Create one user at a time when setting a password.");
      }
      const check = validatePassword(password, confirmation);
      if (!check.ok) throw new Error(check.because);
      const outcome = await createMemberWithPassword({
        organizationId,
        email,
        password,
        confirmation,
        role,
        access: overrides,
        actorUserId,
      });
      if (!outcome.ok) throw new Error(outcome.because ?? "That user could not be created.");
      return { email };
    },
    onSuccess: ({ email }) => {
      setPassword("");
      setConfirmation("");
      setEmails("");
      setCreated({
        email,
        role,
        rooms: APP_REGISTRY.filter(
          (app) => (overrides[app.id] ?? roleDefaultAccess(role, app.id)) !== "hidden",
        ).map((app) => app.name),
      });
      onDone();
    },
  });

  return (
    <div className="tt-surface p-6">
      <SectionHeading
        eyebrow="Invite"
        title="Invite people"
        description="Choose the role first, then narrow the rooms. Anything you leave alone follows the role template."
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <TTField
          label="Email addresses"
          hint="One or several, separated by commas or new lines."
        >
          <TTInput
            value={emails}
            onChange={(event) => {
              setSent(null);
              setDelivered(null);
              setEmails(event.target.value);
            }}
            placeholder="sarah@company.com"
          />
        </TTField>
        <TTField label="Role">
          <TTSelect
            value={role}
            onChange={(event) => {
              setOverrides({});
              setRole(normalizeRole(event.target.value));
            }}
          >
            {ASSIGNABLE_ROLES.map((value) => (
              <option key={value} value={value}>
                {ROLE_LABEL[value]}
              </option>
            ))}
          </TTSelect>
        </TTField>
      </div>

      <fieldset className="mt-5">
        <legend className="tt-eyebrow mb-2">How they get in</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              {
                value: "email",
                label: "Send invite email",
                hint: "They set their own password from the invitation.",
              },
              {
                value: "password",
                label: "Set temporary password",
                hint: "You create the account now and hand the password over yourself.",
              },
            ] as const
          ).map((choice) => (
            <label
              key={choice.value}
              className={cn(
                "flex items-start gap-3 rounded-xl border px-4 py-3",
                mode === choice.value ? "border-royal bg-secondary/40" : "border-border",
              )}
            >
              <input
                type="radio"
                name="onboarding-mode"
                className="mt-1 size-4 accent-royal"
                checked={mode === choice.value}
                onChange={() => {
                  setMode(choice.value);
                  setCreated(null);
                  setSent(null);
                }}
              />
              <span className="min-w-0">
                <span className="block text-sm text-foreground">{choice.label}</span>
                <span className="block text-xs text-muted-foreground">{choice.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {mode === "password" ? (
        <div className="mt-5">
          <PasswordFields
            idPrefix="provision"
            password={password}
            confirmation={confirmation}
            onPassword={setPassword}
            onConfirmation={setConfirmation}
          />
        </div>
      ) : null}

      <p className="tt-eyebrow mt-5 mb-2">Application access</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {APP_REGISTRY.map((app) => {
          const ceiling = roleDefaultAccess(role, app.id);
          const current = overrides[app.id] ?? ceiling;
          return (
            <label
              key={app.id}
              className="flex items-center gap-3 rounded-xl border border-border px-4 py-3"
            >
              <input
                type="checkbox"
                className="size-4 accent-royal"
                checked={current !== "hidden"}
                disabled={ceiling === "hidden"}
                onChange={(event) =>
                  setOverrides((previous) => ({
                    ...previous,
                    [app.id]: event.target.checked
                      ? ceiling === "hidden"
                        ? "hidden"
                        : "view"
                      : "hidden",
                  }))
                }
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">{app.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {ceiling === "hidden" ? "Not available to this role" : APP_ACCESS_LABEL[current]}
                </span>
              </span>
              {ceiling !== "hidden" && current !== "hidden" ? (
                <TTSelect
                  aria-label={`${app.name} level`}
                  className="h-9 w-28"
                  value={current}
                  onChange={(event) =>
                    setOverrides((previous) => ({
                      ...previous,
                      [app.id]: event.target.value as AppAccessLevel,
                    }))
                  }
                >
                  {APP_ACCESS_LEVELS.filter((level) => level !== "hidden").map((level) => (
                    <option key={level} value={level}>
                      {APP_ACCESS_LABEL[level]}
                    </option>
                  ))}
                </TTSelect>
              ) : null}
            </label>
          );
        })}
      </div>

      <div className={cn("mt-6 rounded-xl border border-border", mode === "password" && "hidden")}>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Email preview</p>
            <p className="text-xs text-muted-foreground">
              Exactly what {previewTo} will receive, subject included.
            </p>
          </div>
          <button
            type="button"
            className="text-[13px] text-royal hover:underline"
            onClick={() => setShowPreview((value) => !value)}
          >
            {showPreview ? "Hide preview" : "Preview email"}
          </button>
        </div>
        {showPreview ? (
          <div className="space-y-3 border-t border-border px-4 py-4">
            <div>
              <p className="tt-eyebrow">Subject</p>
              <p className="text-sm text-foreground">{preview.subject}</p>
            </div>
            <div>
              <p className="tt-eyebrow">Message</p>
              <iframe
                title="Invitation email preview"
                srcDoc={preview.html}
                className="mt-2 h-[420px] w-full rounded-lg border border-border bg-card"
                sandbox=""
              />
            </div>
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Plain text version
              </summary>
              <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-secondary/50 p-3 text-xs text-muted-foreground">
                {preview.text}
              </pre>
            </details>
          </div>
        ) : null}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">

        {mode === "password" ? (
          <TTButton
            onClick={() => createUser.mutate()}
            disabled={parsed.valid.length === 0 || createUser.isPending}
          >
            {createUser.isPending ? "Creating…" : "Create user"}
          </TTButton>
        ) : (
          <TTButton
            onClick={() => invite.mutate()}
            disabled={parsed.valid.length === 0 || invite.isPending}
          >
            {invite.isPending
              ? "Sending…"
              : `Send ${parsed.valid.length || ""} invitation${parsed.valid.length === 1 ? "" : "s"}`.trim()}
          </TTButton>
        )}
        {parsed.invalid.length > 0 ? (
          <span className="text-xs text-warning">
            Not a valid address: {parsed.invalid.join(", ")}
          </span>
        ) : null}
        {sent ? (
          <span className="text-sm text-success" role="status">
            {sent} invitation{sent === 1 ? "" : "s"} recorded.
            {delivered ? ` ${delivered}` : ""}
          </span>
        ) : null}
        {invite.error || createUser.error ? (
          <span className="text-sm text-destructive" role="alert">
            {((invite.error ?? createUser.error) as Error).message}
          </span>
        ) : null}
      </div>

      {created ? (
        <div
          className="mt-4 rounded-xl border border-border bg-secondary/40 p-4 text-sm text-foreground"
          role="status"
        >
          <p className="font-medium">User created</p>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            <li>
              <span className="text-foreground">{created.email}</span> can sign in now.
            </li>
            <li>Role applied: {ROLE_LABEL[created.role]}.</li>
            <li>
              Rooms: {created.rooms.length > 0 ? created.rooms.join(", ") : "None yet"}.
            </li>
            <li>A temporary password was set.</li>
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Share the password through a secure channel. Trust Tai does not keep a copy, so it
            cannot be shown again.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------- password controls */

/**
 * Password entry, shared by direct provisioning and reset. The value lives in
 * component state for the length of the form and is never persisted, logged or
 * echoed back after submission.
 */
function PasswordFields({
  password,
  confirmation,
  onPassword,
  onConfirmation,
  idPrefix,
}: {
  password: string;
  confirmation: string;
  onPassword: (value: string) => void;
  onConfirmation: (value: string) => void;
  idPrefix: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <TTField label="Temporary password" hint={PASSWORD_HELP}>
        <TTInput
          id={`${idPrefix}-password`}
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          value={password}
          onChange={(event) => onPassword(event.target.value)}
        />
      </TTField>
      <TTField label="Confirm password" hint="Type it a second time so a typo cannot lock them out.">
        <TTInput
          id={`${idPrefix}-confirm`}
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          value={confirmation}
          onChange={(event) => onConfirmation(event.target.value)}
        />
      </TTField>
      <button
        type="button"
        className="justify-self-start text-[13px] text-royal hover:underline"
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? "Hide password" : "Show password"}
      </button>
    </div>
  );
}

/** Set a new sign-in password for someone who is already a member. */
function ResetPasswordDialog({
  organizationId,
  actorUserId,
  member,
  onClose,
}: {
  organizationId: string;
  actorUserId: string;
  member: MemberProfile;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = useMutation({
    mutationFn: async () => {
      const check = validatePassword(password, confirmation);
      if (!check.ok) throw new Error(check.because);
      const outcome = await resetMemberPassword({
        organizationId,
        userId: member.userId,
        email: member.email,
        password,
        confirmation,
        actorUserId,
      });
      if (!outcome.ok) throw new Error(outcome.because ?? "That password could not be set.");
      return outcome;
    },
    onSuccess: () => {
      /* The plaintext leaves memory the moment the change lands. */
      setPassword("");
      setConfirmation("");
      setDone(true);
      setNote(null);
    },
    onError: (error: Error) => setNote(error.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Set a new password for ${member.name}`}
        className="tt-surface w-full max-w-xl p-6"
      >
        <SectionHeading
          eyebrow="Sign-in"
          title={`Set a new password for ${member.name}`}
          description={`This immediately changes how ${member.email} signs in. Their current password stops working at once.`}
        />

        {done ? (
          <div className="rounded-xl border border-border bg-secondary/40 p-4 text-sm text-foreground">
            <p>New password set for {member.email}.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Share it through a secure channel. It is not stored anywhere in Trust Tai and cannot
              be shown again.
            </p>
          </div>
        ) : (
          <PasswordFields
            idPrefix={`reset-${member.userId}`}
            password={password}
            confirmation={confirmation}
            onPassword={setPassword}
            onConfirmation={setConfirmation}
          />
        )}

        {note ? (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {note}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {done ? (
            <TTButton onClick={onClose}>Done</TTButton>
          ) : (
            <>
              <TTButton onClick={() => reset.mutate()} disabled={reset.isPending}>
                {reset.isPending ? "Setting…" : "Set new password"}
              </TTButton>
              <TTButton variant="secondary" onClick={onClose}>
                Cancel
              </TTButton>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
