/**
 * A read-only answer to "who can change this, and why can't I?".
 *
 * Every row is derived from the same `can()` contract the rest of the OS uses,
 * so this table can never drift from the real rule, and it grants nothing: it
 * is presentation over the existing permission model.
 */

import {
  ROLE_LABEL,
  ROLE_PERMISSIONS,
  type Permission,
  type WorkspaceRole,
} from "@/domain/access";

import { InfoTip } from "./pieces";

interface SettingsSection {
  key: string;
  label: string;
  /** Permission that allows editing this section. */
  permission: Permission | "self";
  because: string;
}

/** The Settings surfaces, in the order the sub-navigation shows them. */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    key: "profile",
    label: "My profile",
    permission: "self",
    because: "Everyone edits their own profile. Nobody edits somebody else's.",
  },
  {
    key: "notifications",
    label: "Notifications",
    permission: "self",
    because: "Notification choices are personal and readable only by their owner.",
  },
  {
    key: "people",
    label: "People & access",
    permission: "org.manage",
    because: "Changing roles, room access or invitations is an owner and admin act.",
  },
  {
    key: "apps",
    label: "Apps",
    permission: "org.manage",
    because: "Turning a room on or off changes it for the whole organization.",
  },
  {
    key: "integrations",
    label: "Integrations",
    permission: "org.manage",
    because: "Integrations hold organization credentials, so only owners and admins connect them.",
  },
  {
    key: "organization",
    label: "Organization profile",
    permission: "org.manage",
    because: "The organization record is shared truth for every room.",
  },
  {
    key: "security",
    label: "Security",
    permission: "org.manage",
    because: "Security guidance is readable by everyone; only owners and admins act on it.",
  },
];

/** Roles this summary explains. The wider role vocabulary rolls up into these. */
const SHOWN_ROLES: WorkspaceRole[] = ["owner", "admin", "member", "viewer"];

function allowed(role: WorkspaceRole, section: SettingsSection): boolean {
  if (section.permission === "self") return true;
  return ROLE_PERMISSIONS[role].includes(section.permission);
}

export function PermissionSummary({ role }: { role: WorkspaceRole }) {
  return (
    <div className="tt-surface p-6">
      <div className="mb-4 flex flex-wrap items-baseline gap-2">
        <h2 className="font-serif text-[19px] text-foreground">Who can change what</h2>
        <InfoTip label="How this table is decided">
          Read only. Each cell is the live permission rule, not a description of it. The database
          enforces the same boundary again, so a change refused here is refused there too.
        </InfoTip>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-secondary/50">
              <th className="tt-eyebrow px-4 py-2 font-normal">Settings section</th>
              {SHOWN_ROLES.map((role) => (
                <th key={role} className="tt-eyebrow px-4 py-2 font-normal">
                  {ROLE_LABEL[role]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {SETTINGS_SECTIONS.map((section) => (
              <tr key={section.key}>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5 text-foreground">
                    {section.label}
                    <InfoTip label={`Why ${section.label} is restricted`}>{section.because}</InfoTip>
                  </span>
                </td>
                {SHOWN_ROLES.map((shown) => {
                  const yes = allowed(shown, section);
                  return (
                    <td key={shown} className="px-4 py-3">
                      <span
                        className={
                          yes ? "text-[13px] text-foreground" : "text-[13px] text-muted-foreground"
                        }
                      >
                        {yes
                          ? section.permission === "self"
                            ? "Edit own"
                            : "Edit"
                          : "Read only"}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        You are signed in as {ROLE_LABEL[role]}.{" "}
        {ROLE_PERMISSIONS[role].includes("org.manage")
          ? "You can change workspace and organization settings."
          : "You can read these sections and edit only your own profile and notifications."}
      </p>
    </div>
  );
}
