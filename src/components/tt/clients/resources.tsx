/**
 * Files & Links: the client page's front door to everything about this
 * company's work that lives somewhere else.
 *
 * Repeatable by design. Two Lovable projects, three chats and four recordings
 * are the normal case, not an edge case, so nothing here is one-per-category.
 * Scope is the company or one of this company's own projects, and account-wide
 * material never has to invent a project to exist.
 *
 * Every word here is honest about what a saved link is: a reference. Nothing
 * is connected, synced or read, and removing one removes the reference only.
 */

import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ExternalLink, Pencil, Plus, Trash2, X } from "lucide-react";

import { Absent, RoomSection, Unreadable } from "@/components/tt/clients/shell";
import { MetaPill, TTButton, TTCard, TTInput } from "@/components/tt/primitives";
import {
  EMPTY_FILTER,
  RESOURCE_CATEGORIES,
  RESOURCE_CATEGORY_HINT,
  RESOURCE_CATEGORY_LABEL,
  RESOURCE_EMPTY_BECAUSE,
  RESOURCE_EMPTY_LINE,
  RESOURCE_TRUTH,
  checkResourceUrl,
  filterResources,
  findDuplicate,
  groupByProject,
  pinnedShortcuts,
  scopeLabel,
  type ClientResource,
  type ClientResourceDraft,
  type ResourceCategory,
  type ResourceFilter,
} from "@/domain/client-resources";

const SELECT = "h-9 rounded-md border border-border bg-background px-2 text-[13px] text-foreground";

export interface ResourceProject {
  id: string;
  name: string;
}

interface FormState {
  category: ResourceCategory;
  title: string;
  url: string;
  description: string;
  meetingDate: string;
  projectId: string;
}

function emptyForm(projectId: string | null): FormState {
  return {
    category: "lovable_project",
    title: "",
    url: "",
    description: "",
    meetingDate: "",
    projectId: projectId ?? "",
  };
}

function formFor(resource: ClientResource): FormState {
  return {
    category: resource.category,
    title: resource.title,
    url: resource.url,
    description: resource.description ?? "",
    meetingDate: resource.meetingDate ?? "",
    projectId: resource.projectId ?? "",
  };
}

function draftOf(form: FormState): ClientResourceDraft {
  return {
    category: form.category,
    title: form.title.trim(),
    url: form.url.trim(),
    projectId: form.projectId ? form.projectId : null,
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
    ...(form.meetingDate.trim() ? { meetingDate: form.meetingDate.trim() } : {}),
  };
}

/* -------------------------------------------------------------------- form */

function ResourceForm({
  form,
  setForm,
  projects,
  problem,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  form: FormState;
  setForm: (next: FormState) => void;
  projects: ResourceProject[];
  problem: string | null;
  busy: boolean;
  submitLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <TTCard className="p-4">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-[13px]">
            <span className="mb-1 block text-muted-foreground">Kind</span>
            <select
              className={`${SELECT} w-full`}
              value={form.category}
              onChange={(event) =>
                setForm({ ...form, category: event.target.value as ResourceCategory })
              }
            >
              {RESOURCE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {RESOURCE_CATEGORY_LABEL[category]}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[12px] text-muted-foreground">
              {RESOURCE_CATEGORY_HINT[form.category]}
            </span>
          </label>

          <label className="block text-[13px]">
            <span className="mb-1 block text-muted-foreground">Belongs to</span>
            <select
              className={`${SELECT} w-full`}
              value={form.projectId}
              onChange={(event) => setForm({ ...form, projectId: event.target.value })}
            >
              <option value="">Client-wide</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[12px] text-muted-foreground">
              Client-wide is fine. A project is optional.
            </span>
          </label>

          <label className="block text-[13px]">
            <span className="mb-1 block text-muted-foreground">Title</span>
            <TTInput
              value={form.title}
              placeholder="What this is, in a few words"
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
          </label>

          <label className="block text-[13px]">
            <span className="mb-1 block text-muted-foreground">Web address</span>
            <TTInput
              value={form.url}
              placeholder="https://"
              inputMode="url"
              onChange={(event) => setForm({ ...form, url: event.target.value })}
            />
          </label>

          <label className="block text-[13px]">
            <span className="mb-1 block text-muted-foreground">Note (optional)</span>
            <TTInput
              value={form.description}
              placeholder="Why this matters, if it is not obvious"
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </label>

          {form.category === "meeting_recording" ? (
            <label className="block text-[13px]">
              <span className="mb-1 block text-muted-foreground">Meeting date (optional)</span>
              <TTInput
                type="date"
                value={form.meetingDate}
                onChange={(event) => setForm({ ...form, meetingDate: event.target.value })}
              />
            </label>
          ) : null}
        </div>

        {problem ? (
          <p role="alert" className="text-[13px] font-medium text-destructive">
            {problem} Your text is still here, so you can fix it and try again.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <TTButton type="submit" size="sm" disabled={busy}>
            {busy ? "Saving…" : submitLabel}
          </TTButton>
          <TTButton type="button" size="sm" variant="quiet" onClick={onCancel} disabled={busy}>
            Cancel
          </TTButton>
          <span className="text-[12px] text-muted-foreground">
            Saving a link records where something lives. It does not open or read it.
          </span>
        </div>
      </form>
    </TTCard>
  );
}

/* -------------------------------------------------------------------- rows */

function ResourceRow({
  resource,
  projectNames,
  canWrite,
  busy,
  onEdit,
  onRemove,
}: {
  resource: ClientResource;
  projectNames: Record<string, string>;
  canWrite: boolean;
  busy: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <TTCard className="flex flex-wrap items-start justify-between gap-3 p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{resource.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <MetaPill>{RESOURCE_CATEGORY_LABEL[resource.category]}</MetaPill>
          <MetaPill>{scopeLabel(resource, projectNames)}</MetaPill>
          {resource.meetingDate ? <MetaPill>Met {resource.meetingDate}</MetaPill> : null}
          <MetaPill>Link saved</MetaPill>
        </div>
        {resource.description ? (
          <p className="mt-1.5 text-[13px] text-muted-foreground">{resource.description}</p>
        ) : null}
        <p className="mt-1 truncate text-[12px] text-muted-foreground">{resource.url}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <a
          href={resource.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium text-royal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Open <ExternalLink aria-hidden className="size-3.5" />
        </a>
        {canWrite ? (
          <>
            <TTButton size="sm" variant="quiet" onClick={onEdit} disabled={busy}>
              <Pencil aria-hidden className="size-3.5" />
              <span className="sr-only">Edit {resource.title}</span>
            </TTButton>
            <TTButton size="sm" variant="quiet" onClick={onRemove} disabled={busy}>
              <Trash2 aria-hidden className="size-3.5" />
              <span className="sr-only">Remove {resource.title}</span>
            </TTButton>
          </>
        ) : null}
      </div>
    </TTCard>
  );
}

/* ------------------------------------------------------------------ surface */

export function ClientResourcesSection({
  resources,
  available,
  unavailableBecause,
  loading,
  readProblem,
  projects,
  selectedProjectId,
  canWrite,
  busy,
  onAdd,
  onEdit,
  onRemove,
}: {
  resources: ClientResource[];
  /** false when the store is not in this database yet. */
  available: boolean;
  unavailableBecause?: string | undefined;
  loading: boolean;
  readProblem: string | null;
  projects: ResourceProject[];
  selectedProjectId: string | null;
  canWrite: boolean;
  busy: boolean;
  onAdd: (draft: ClientResourceDraft) => Promise<void>;
  onEdit: (id: string, draft: ClientResourceDraft) => Promise<void>;
  onRemove: (resource: ClientResource) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(selectedProjectId));
  const [problem, setProblem] = useState<string | null>(null);
  const [filter, setFilter] = useState<ResourceFilter>(() => ({
    ...EMPTY_FILTER,
    projectId: selectedProjectId ?? "all",
  }));

  const projectNames = useMemo(
    () => Object.fromEntries(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  const shown = useMemo(
    () => filterResources(resources, filter, projectNames),
    [resources, filter, projectNames],
  );
  const groups = useMemo(() => groupByProject(shown, projectNames), [shown, projectNames]);

  function startAdd() {
    setForm(
      emptyForm(
        filter.projectId !== "all" && filter.projectId !== "client"
          ? filter.projectId
          : selectedProjectId,
      ),
    );
    setProblem(null);
    setEditingId(null);
    setAdding(true);
  }

  function startEdit(resource: ClientResource) {
    setForm(formFor(resource));
    setProblem(null);
    setAdding(false);
    setEditingId(resource.id);
  }

  async function submit() {
    const draft = draftOf(form);
    if (!draft.title) {
      setProblem("A title is needed so this can be found again.");
      return;
    }
    const checked = checkResourceUrl(draft.url);
    if (!checked.ok) {
      setProblem(checked.problem);
      return;
    }
    const duplicate = findDuplicate(
      resources,
      { url: checked.url, projectId: draft.projectId },
      editingId ?? undefined,
    );
    if (duplicate) {
      setProblem(
        `That exact address is already saved here as "${duplicate.title}". Choose a different project if you meant a second copy.`,
      );
      return;
    }
    try {
      if (editingId) await onEdit(editingId, { ...draft, url: checked.url });
      else await onAdd({ ...draft, url: checked.url });
      setAdding(false);
      setEditingId(null);
      setForm(emptyForm(selectedProjectId));
      setProblem(null);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "That link could not be saved.");
    }
  }

  return (
    <RoomSection
      eyebrow="Owned by Clients"
      title="Links for this company"
      description={RESOURCE_TRUTH}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="resource-search">
            Search links
          </label>
          <div className="min-w-[12rem] flex-1">
            <TTInput
              id="resource-search"
              value={filter.query}
              placeholder="Search by title, kind or project"
              onChange={(event) => setFilter({ ...filter, query: event.target.value })}
            />
          </div>
          <select
            className={SELECT}
            aria-label="Filter by kind"
            value={filter.category}
            onChange={(event) =>
              setFilter({ ...filter, category: event.target.value as ResourceFilter["category"] })
            }
          >
            <option value="all">All kinds</option>
            {RESOURCE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {RESOURCE_CATEGORY_LABEL[category]}
              </option>
            ))}
          </select>
          <select
            className={SELECT}
            aria-label="Filter by project"
            value={filter.projectId}
            onChange={(event) =>
              setFilter({ ...filter, projectId: event.target.value as ResourceFilter["projectId"] })
            }
          >
            <option value="all">All projects</option>
            <option value="client">Client-wide only</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          {canWrite && available ? (
            <TTButton size="sm" onClick={adding ? () => setAdding(false) : startAdd}>
              {adding ? (
                <>
                  <X aria-hidden className="size-4" /> Close
                </>
              ) : (
                <>
                  <Plus aria-hidden className="size-4" /> Add link
                </>
              )}
            </TTButton>
          ) : null}
        </div>

        {adding || editingId ? (
          <ResourceForm
            form={form}
            setForm={setForm}
            projects={projects}
            problem={problem}
            busy={busy}
            submitLabel={editingId ? "Save changes" : "Save link"}
            onSubmit={() => void submit()}
            onCancel={() => {
              setAdding(false);
              setEditingId(null);
              setProblem(null);
            }}
          />
        ) : null}

        {!available ? (
          <Unreadable
            what="Saved links"
            because={
              unavailableBecause ??
              "The place these links are kept is not in this database yet, so nothing can be saved here."
            }
          />
        ) : readProblem ? (
          <Unreadable what="Saved links" because={readProblem} />
        ) : loading ? (
          <p className="text-sm text-muted-foreground">Reading saved links…</p>
        ) : resources.length === 0 ? (
          <Absent line={RESOURCE_EMPTY_LINE} because={RESOURCE_EMPTY_BECAUSE} />
        ) : shown.length === 0 ? (
          <Absent
            line="Nothing matches that search"
            because="Clear the search or choose another kind or project."
          />
        ) : (
          <div className="space-y-5">
            {groups.map((group) => (
              <div key={group.projectId ?? "client-wide"}>
                <p className="tt-eyebrow mb-2">
                  {group.label}
                  {group.projectId === null ? " · true of every project" : ""}
                </p>
                <ul className="space-y-2">
                  {group.resources.map((resource) => (
                    <li key={resource.id}>
                      <ResourceRow
                        resource={resource}
                        projectNames={projectNames}
                        canWrite={canWrite}
                        busy={busy}
                        onEdit={() => startEdit(resource)}
                        onRemove={() => void onRemove(resource)}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        <p className="text-[12px] text-muted-foreground">
          Removing a link here removes the reference only. The document, recording or folder itself
          is untouched. Uploading a file is a separate act and happens on the project that owns it.
        </p>
      </div>
    </RoomSection>
  );
}

/* --------------------------------------------------------------- shortcuts */

/**
 * The shortcuts pinned on the client overview: every Lovable project, every
 * knowledge base, every working chat. Several of one kind is normal, so each
 * keeps its own label and, when two share a name, its scope.
 */
export function ClientPinnedShortcuts({
  resources,
  projects,
  clientId,
}: {
  resources: ClientResource[];
  projects: ResourceProject[];
  clientId: string;
}) {
  const projectNames = useMemo(
    () => Object.fromEntries(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const shortcuts = useMemo(
    () => pinnedShortcuts(resources, projectNames),
    [resources, projectNames],
  );
  if (shortcuts.length === 0) return null;
  return (
    <TTCard className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="tt-eyebrow">Where this work lives</p>
        <Link
          to="/modules/clients/$clientId"
          params={{ clientId }}
          search={{ tab: "files" }}
          className="rounded-md text-[13px] font-medium text-royal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          All files and links
        </Link>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2">
        {shortcuts.map((shortcut) => (
          <li key={shortcut.resource.id}>
            <a
              href={shortcut.resource.url}
              target="_blank"
              rel="noopener noreferrer"
              className="tt-pressable inline-flex max-w-[20rem] items-center gap-2 rounded-full border border-border px-3 py-1.5 text-[13px] text-foreground hover:border-royal/30 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="truncate">{shortcut.label}</span>
              <MetaPill>{RESOURCE_CATEGORY_LABEL[shortcut.resource.category]}</MetaPill>
              <ExternalLink aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
            </a>
          </li>
        ))}
      </ul>
    </TTCard>
  );
}
