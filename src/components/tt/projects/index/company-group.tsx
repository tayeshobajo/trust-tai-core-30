/**
 * Projects grouped by the company they serve.
 *
 * Delivery is only legible when work sits under the client it belongs to, so
 * the list is banded by company: identity mark, name, and a plain count of what
 * is moving versus what has landed. The cards inside are unchanged.
 */

import { CompanyMark } from "@/components/tt/company-identity";
import { ProjectCard } from "@/components/tt/projects/index/project-card";
import type { CompanyGroup } from "@/data/projects/index-projection";
import type { RoadmapIdentity } from "@/data/roadmap-index";

function countLine(group: CompanyGroup): string {
  const parts: string[] = [];
  if (group.active > 0) parts.push(`${group.active} in delivery`);
  if (group.complete > 0) parts.push(`${group.complete} complete`);
  return parts.length > 0 ? parts.join(" · ") : "Nothing in delivery";
}

export function CompanyGroups({
  groups,
  identityFor,
}: {
  groups: CompanyGroup[];
  identityFor: (company: string) => RoadmapIdentity;
}) {
  return (
    <div className="space-y-7">
      {groups.map((group) => {
        const identity = identityFor(group.company);
        return (
          <section key={group.company} aria-label={`${group.company} projects`}>
            <header className="flex items-center gap-3 border-b border-border pb-2.5">
              <CompanyMark
                name={group.company}
                websiteUrl={identity.websiteUrl ?? ""}
                logoUrl={identity.logoUrl ?? null}
                themeColor={identity.themeColor ?? null}
                size="sm"
              />
              <h3 className="min-w-0 truncate text-[14px] font-medium text-foreground">
                {group.company}
              </h3>
              <span className="ml-auto shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {countLine(group)}
              </span>
            </header>

            <ul className="mt-3 space-y-3">
              {group.rows.map((row) => (
                <li key={row.project.id}>
                  <ProjectCard row={row} identity={identity} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
