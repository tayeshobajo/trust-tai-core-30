/**
 * Real choices for the New task drawer: every named active teammate, every
 * client and every project in the workspace — not only the ones that already
 * appear on someone's tasks. Each source fails independently to an empty list.
 */

import { useQuery } from "@tanstack/react-query";

import { loadWorkspacePeople } from "@/data/daily-workspace";
import { listClientCommercialState } from "@/data/supabase/commercial-service";
import { projectsService } from "@/data/supabase/projects-service";
import { readMemberDirectory } from "@/data/supabase/settings-service";

export interface TaskChoices {
  people: { key: string; name: string; userId: string }[];
  clients: { id: string; label: string }[];
  projects: { id: string; label: string }[];
}

export async function readTaskChoices(
  organizationId: string,
  viewer: { userId: string; name: string },
): Promise<TaskChoices> {
  const [workspace, directory, clients, projects] = await Promise.all([
    loadWorkspacePeople(organizationId).catch(() => null),
    // Owner/admin-only governed read; profile RLS hides other names otherwise.
    readMemberDirectory(organizationId).catch(() => new Map()),
    listClientCommercialState(organizationId).catch(() => []),
    projectsService.list(organizationId).catch(() => []),
  ]);

  const people = new Map<string, { key: string; name: string; userId: string }>();
  for (const person of workspace?.people ?? []) {
    if (!person.active) continue;
    const named = directory.get(person.userId);
    const name = (named?.name || person.displayName || named?.email || "").trim();
    if (!name) continue;
    people.set(person.userId, { key: person.userId, name, userId: person.userId });
  }
  people.set(viewer.userId, { key: viewer.userId, name: viewer.name, userId: viewer.userId });

  const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);
  return {
    people: Array.from(people.values()).sort((a, b) => a.name.localeCompare(b.name)),
    clients: clients
      .filter((c) => c.id && c.name)
      .map((c) => ({ id: c.id, label: c.name }))
      .sort(byLabel),
    projects: projects
      .filter((p) => p.id && p.name)
      .map((p) => ({ id: p.id, label: p.name }))
      .sort(byLabel),
  };
}

export function useTaskChoices(
  organizationId: string,
  viewer: { userId: string; name: string },
  enabled = true,
) {
  return useQuery({
    queryKey: ["steward", "task-choices", organizationId, viewer.userId],
    queryFn: () => readTaskChoices(organizationId, viewer),
    enabled,
    staleTime: 60_000,
  });
}
