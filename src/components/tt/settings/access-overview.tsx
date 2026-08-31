/**
 * Admin overview: who is actually using this workspace.
 *
 * Read only. Every number here is derived from membership rows and pending
 * invitations already read through RLS — nothing is estimated or invented.
 */

import type { Invitation, MemberProfile } from "@/data/supabase/settings-service";
import { ROLE_LABEL } from "@/domain/access";

import { Health, InfoTip, NotProvisioned, PersonChip, SummaryCard } from "./pieces";

const DAY = 24 * 60 * 60 * 1000;

export type SignInState = "never" | "recent" | "quiet" | "dormant" | "no_access";

export const SIGN_IN_LABEL: Record<SignInState, string> = {
  recent: "Signed in recently",
  quiet: "Quiet",
  dormant: "Dormant",
  never: "Never signed in",
  no_access: "No access",
};

/** Sign-in state for one person, from membership status and Supabase Auth. */
export function signInStateOf(
  member: Pick<MemberProfile, "status" | "lastSignInAt">,
  now: number = Date.now(),
): SignInState {
  if (member.status !== "active") return "no_access";
  const at = member.lastSignInAt ? Date.parse(member.lastSignInAt) : Number.NaN;
  if (Number.isNaN(at)) return "never";
  const age = now - at;
  if (age <= 7 * DAY) return "recent";
  if (age <= 30 * DAY) return "quiet";
  return "dormant";
}


const TONE: Record<SignInState, "good" | "caution" | "risk" | "neutral"> = {
  recent: "good",
  quiet: "caution",
  dormant: "risk",
  never: "caution",
  no_access: "neutral",
};

function whenText(value: string | null): string {
  if (!value) return "No activity recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No activity recorded";
  const days = Math.floor((Date.now() - date.getTime()) / DAY);
  const stamp = date.toLocaleDateString(undefined, { dateStyle: "medium" });
  if (days <= 0) return `Today · ${stamp}`;
  if (days === 1) return `Yesterday · ${stamp}`;
  return `${days} days ago · ${stamp}`;
}

export function AccessOverview({
  members,
  pendingInvitations,
  invitationsProvisioned,
  isPending,
}: {
  members: MemberProfile[];
  pendingInvitations: Invitation[];
  invitationsProvisioned: boolean;
  isPending: boolean;
}) {
  const states = members.map((member) => ({ member, state: signInStateOf(member) }));
  const count = (state: SignInState) => states.filter((row) => row.state === state).length;
  const active = members.filter((member) => member.status === "active").length;

  /* The people an admin most likely came here for, first. */
  const attention = states
    .filter((row) => row.state === "never" || row.state === "dormant")
    .sort((a, b) => a.member.name.localeCompare(b.member.name));

  return (
    <div className="tt-surface p-6">
      <div className="mb-4 flex flex-wrap items-baseline gap-2">
        <h2 className="font-serif text-[19px] text-foreground">Workspace at a glance</h2>
        <InfoTip label="How these numbers are decided">
          Counted from live membership rows and pending invitations. &ldquo;Signed in
          recently&rdquo; means activity in the last 7 days, &ldquo;quiet&rdquo; within 30, and
          &ldquo;dormant&rdquo; beyond that.
        </InfoTip>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Active members"
          value={isPending ? "…" : String(active)}
          supporting={`${count("recent")} signed in this week`}
        />
        <SummaryCard
          label="Never signed in"
          value={isPending ? "…" : String(count("never"))}
          supporting="Invited or provisioned, not yet arrived"
        />
        <SummaryCard
          label="Dormant"
          value={isPending ? "…" : String(count("dormant"))}
          supporting="No activity in over 30 days"
        />
        <SummaryCard
          label="Pending invites"
          value={invitationsProvisioned ? String(pendingInvitations.length) : "—"}
          supporting={
            invitationsProvisioned ? "Waiting to be accepted" : "Invitations not provisioned"
          }
        />
      </div>

      {!invitationsProvisioned ? (
        <div className="mt-4">
          <NotProvisioned what="Invitations" file="docs/settings-schema.sql" />
        </div>
      ) : null}

      <h3 className="tt-eyebrow mt-6 mb-2">Sign-in status</h3>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/50">
              <th className="tt-eyebrow px-4 py-2 font-normal">Person</th>
              <th className="tt-eyebrow px-4 py-2 font-normal">Role</th>
              <th className="tt-eyebrow px-4 py-2 font-normal">Sign-in</th>
              <th className="tt-eyebrow px-4 py-2 font-normal">Last activity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isPending ? (
              <tr>
                <td className="px-4 py-3 text-muted-foreground" colSpan={4}>
                  Reading members…
                </td>
              </tr>
            ) : states.length === 0 ? (
              <tr>
                <td className="px-4 py-3 text-muted-foreground" colSpan={4}>
                  No members yet.
                </td>
              </tr>
            ) : (
              states.map(({ member, state }) => (
                <tr key={member.userId}>
                  <td className="px-4 py-3">
                    <PersonChip
                      name={member.name}
                      email={member.email}
                      avatarUrl={member.avatarUrl}
                      supporting={member.email || "No email on file"}
                    />

                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{ROLE_LABEL[member.role]}</td>
                  <td className="px-4 py-3">
                    <Health tone={TONE[state]}>{SIGN_IN_LABEL[state]}</Health>
                  </td>
                  <td className="px-4 py-3 text-[13px] text-muted-foreground">
                    {whenText(member.lastActiveAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {attention.length > 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {attention.length} {attention.length === 1 ? "person has" : "people have"} never signed in
          or gone dormant: {attention.map(({ member }) => member.name).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}
