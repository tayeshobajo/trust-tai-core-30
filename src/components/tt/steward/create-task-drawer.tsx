/**
 * Create a task.
 *
 * A calm, right-side drawer for making a task by hand: what needs doing, who
 * carries it, when it is due, and the context AI and the team will need. It is
 * presentational plus validation only. The parent owns persistence and any
 * Paperclip handoff.
 */

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { TTButton, TTField, TTInput } from "@/components/tt/primitives";
import {
  MANUAL_AI_MODE_LABEL,
  type ManualAiMode,
  type ManualAssigneeKind,
  type ManualContextLink,
  type ManualSubtask,
  type ManualTaskPriority,
} from "@/domain/steward-accountability";
import { cn } from "@/lib/utils";
import type { WorkspaceIdentity } from "@/lib/workspace";

/** What the drawer hands back on create. The parent maps it onto the service. */
export interface CreateManualTaskInput {
  title: string;
  clientId?: string | null;
  clientLabel?: string | null;
  projectId?: string | null;
  projectLabel?: string | null;
  dueAt?: string | null;
  ownerUserId?: string | null;
  ownerLabel?: string | null;
  priority: ManualTaskPriority;
  assigneeKind: ManualAssigneeKind;
  aiMode?: ManualAiMode | null;
  status: "draft" | "open";
  subtasks: ManualSubtask[];
  acceptanceCriteria: string[];
  contextLinks: ManualContextLink[];
  notes?: string | null;
}

const PRIORITIES: ManualTaskPriority[] = ["low", "normal", "high", "urgent"];
const PRIORITY_LABEL: Record<ManualTaskPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

const schema = z
  .object({
    title: z.string().trim().min(1, "Give it a title so people know what this is."),
    assignTo: z.enum(["human", "agent"]),
    aiMode: z.enum(["safe_internal", "routine_end_to_end"]).optional(),
  })
  .refine((value) => value.assignTo !== "agent" || Boolean(value.aiMode), {
    path: ["aiMode"],
    message: "Pick how far the AI teammate may go.",
  });

const PILL_BASE = "rounded-full px-3 py-1.5 text-xs transition-colors";
const SELECT_CLASS =
  "h-10 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground";

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        PILL_BASE,
        active
          ? "bg-foreground text-background"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function CreateTaskDrawer({
  open,
  onClose,
  identity,
  clients,
  projects,
  people,
  onCreate,
  onGenerateSubtasks,
  onGenerateAcceptance,
  pending = false,
  allowAgentCreate = true,
}: {
  open: boolean;
  onClose: () => void;
  identity: WorkspaceIdentity;
  clients: { id: string; label: string }[];
  projects: { id: string; label: string }[];
  people: { key: string; name: string; userId?: string }[];
  onCreate: (input: CreateManualTaskInput, opts: { assignToAI: boolean }) => Promise<void> | void;
  onGenerateSubtasks?: (title: string) => Promise<string[]>;
  onGenerateAcceptance?: (title: string) => Promise<string[]>;
  pending?: boolean;
  allowAgentCreate?: boolean;
}) {
  const defaultOwnerKey =
    people.find((person) => person.userId === identity.userId)?.key ?? people[0]?.key ?? "";

  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [ownerKey, setOwnerKey] = useState(defaultOwnerKey);
  const [priority, setPriority] = useState<ManualTaskPriority>("normal");
  const [assignTo, setAssignTo] = useState<ManualAssigneeKind>("human");
  const [aiMode, setAiMode] = useState<ManualAiMode | "">("");

  const [subtasks, setSubtasks] = useState<ManualSubtask[]>([]);
  const [criteria, setCriteria] = useState<string[]>([]);
  const [links, setLinks] = useState<ManualContextLink[]>([]);
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [notes, setNotes] = useState("");

  const [genSub, setGenSub] = useState(false);
  const [genAcc, setGenAcc] = useState(false);

  const form = useForm<z.input<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { title: "", assignTo: "human" },
  });

  if (!open) return null;

  const title = form.watch("title") ?? "";

  function resolvedOwner(): { userId: string | null; label: string | null } {
    const person = people.find((entry) => entry.key === ownerKey);
    if (!person) return { userId: null, label: null };
    return { userId: person.userId ?? null, label: person.name };
  }

  function buildInput(status: "draft" | "open", kind: ManualAssigneeKind): CreateManualTaskInput {
    const owner = resolvedOwner();
    const client = clients.find((entry) => entry.id === clientId);
    const project = projects.find((entry) => entry.id === projectId);
    return {
      title: (form.getValues("title") ?? "").trim(),
      clientId: client ? client.id : null,
      clientLabel: client ? client.label : null,
      projectId: project ? project.id : null,
      projectLabel: project ? project.label : null,
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      ownerUserId: owner.userId,
      ownerLabel: owner.label,
      priority,
      assigneeKind: kind,
      aiMode: kind === "agent" ? (aiMode || null) : null,
      status,
      subtasks: subtasks.filter((entry) => entry.text.trim()),
      acceptanceCriteria: criteria.filter((entry) => entry.trim()),
      contextLinks: links,
      notes: notes.trim() ? notes.trim() : null,
    };
  }

  async function submit(status: "draft" | "open", kind: ManualAssigneeKind) {
    /* A draft is a parking spot: it saves as it stands, even half-filled, so
     * we only need a title. Full assignment rules apply when it goes live. */
    if (status === "draft") {
      const hasTitle = await form.trigger("title");
      if (!hasTitle) return;
      await onCreate(buildInput(status, kind), { assignToAI: false });
      return;
    }
    form.setValue("assignTo", kind);
    if (kind === "agent") form.setValue("aiMode", (aiMode || undefined) as ManualAiMode | undefined);
    const valid = await form.trigger();
    if (!valid) return;
    await onCreate(buildInput(status, kind), { assignToAI: kind === "agent" });
  }

  async function generateSubtasks() {
    if (!onGenerateSubtasks || !title.trim()) return;
    setGenSub(true);
    try {
      const suggested = await onGenerateSubtasks(title.trim());
      setSubtasks((current) => [
        ...current,
        ...suggested.map((text) => ({ id: crypto.randomUUID(), text, done: false })),
      ]);
    } finally {
      setGenSub(false);
    }
  }

  async function generateAcceptance() {
    if (!onGenerateAcceptance || !title.trim()) return;
    setGenAcc(true);
    try {
      const suggested = await onGenerateAcceptance(title.trim());
      setCriteria((current) => [...current, ...suggested]);
    } finally {
      setGenAcc(false);
    }
  }

  function addLink() {
    const label = linkLabel.trim();
    const url = linkUrl.trim();
    if (!label && !url) return;
    setLinks((current) => [...current, { label: label || url, url }]);
    setLinkLabel("");
    setLinkUrl("");
  }

  const canAssignAI = assignTo === "agent" && Boolean(aiMode);
  const titleError = form.formState.errors.title?.message;
  const aiModeError = form.formState.errors.aiMode?.message;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-foreground/20 backdrop-blur-sm">
      <button
        type="button"
        aria-label="Close create task"
        className="flex-1 cursor-default"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Create a task"
        className="h-full w-full max-w-[520px] overflow-y-auto border-l border-border bg-card p-6 shadow-lg"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="tt-eyebrow">New task</p>
            <h2 className="mt-1 font-display text-xl leading-tight text-foreground">
              What needs doing?
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <div className="mt-6 space-y-5">
          <div>
            <TTField label="Task title">
              {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
              <TTInput
                autoFocus
                placeholder="What needs doing?"
                {...form.register("title")}
              />
            </TTField>
            {titleError ? (
              <p className="mt-1.5 text-xs text-destructive">{titleError}</p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TTField label="Client" optional>
              <select
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">No client</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.label}
                  </option>
                ))}
              </select>
            </TTField>

            <TTField label="Project" optional>
              <select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.label}
                  </option>
                ))}
              </select>
            </TTField>

            <TTField label="When is it due?" optional>
              <TTInput
                type="date"
                value={dueAt}
                onChange={(event) => setDueAt(event.target.value)}
                className="h-10"
              />
            </TTField>

            <TTField label="Who carries this?">
              <select
                value={ownerKey}
                onChange={(event) => setOwnerKey(event.target.value)}
                className={SELECT_CLASS}
              >
                {people.length === 0 ? <option value="">No owner</option> : null}
                {people.map((person) => (
                  <option key={person.key} value={person.key}>
                    {person.name}
                  </option>
                ))}
              </select>
            </TTField>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium text-foreground">Priority</span>
            <div className="flex flex-wrap gap-1">
              {PRIORITIES.map((value) => (
                <Pill
                  key={value}
                  active={priority === value}
                  onClick={() => setPriority(value)}
                >
                  {PRIORITY_LABEL[value]}
                </Pill>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium text-foreground">Assign to</span>
            <div className="flex flex-wrap gap-1">
              <Pill active={assignTo === "human"} onClick={() => setAssignTo("human")}>
                Teammate
              </Pill>
              <Pill active={assignTo === "agent"} onClick={() => setAssignTo("agent")}>
                AI teammate
              </Pill>
            </div>
            {assignTo === "agent" ? (
              <div className="space-y-2 pt-1">
                <select
                  value={aiMode}
                  onChange={(event) => setAiMode(event.target.value as ManualAiMode | "")}
                  className={SELECT_CLASS}
                  aria-label="AI mode"
                >
                  <option value="">Pick how far it may go</option>
                  {(Object.keys(MANUAL_AI_MODE_LABEL) as ManualAiMode[]).map((mode) => (
                    <option key={mode} value={mode}>
                      {MANUAL_AI_MODE_LABEL[mode]}
                    </option>
                  ))}
                </select>
                {aiModeError ? (
                  <p className="text-xs text-destructive">{aiModeError}</p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  AI only completes internal, reversible work. Anything external or irreversible
                  waits for a person.
                </p>
              </div>
            ) : null}
          </div>

          {/* ---- subtasks --------------------------------------------------- */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">Subtasks</span>
              {onGenerateSubtasks ? (
                <TTButton
                  type="button"
                  size="sm"
                  variant="secondary"
                  pending={genSub}
                  pendingLabel="Thinking"
                  disabled={!title.trim()}
                  onClick={generateSubtasks}
                >
                  <Sparkles aria-hidden />
                  Generate with AI
                </TTButton>
              ) : null}
            </div>
            <ul className="space-y-2">
              {subtasks.map((subtask, index) => (
                <li key={subtask.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={subtask.done}
                    onChange={(event) =>
                      setSubtasks((current) =>
                        current.map((entry, at) =>
                          at === index ? { ...entry, done: event.target.checked } : entry,
                        ),
                      )
                    }
                    className="size-4 shrink-0 rounded border-input"
                    aria-label="Done"
                  />
                  <TTInput
                    value={subtask.text}
                    placeholder="A step to get there"
                    className="h-10"
                    onChange={(event) =>
                      setSubtasks((current) =>
                        current.map((entry, at) =>
                          at === index ? { ...entry, text: event.target.value } : entry,
                        ),
                      )
                    }
                  />
                  <button
                    type="button"
                    aria-label="Remove subtask"
                    onClick={() =>
                      setSubtasks((current) => current.filter((_, at) => at !== index))
                    }
                    className="rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X aria-hidden className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
            <TTButton
              type="button"
              size="sm"
              variant="quiet"
              onClick={() =>
                setSubtasks((current) => [
                  ...current,
                  { id: crypto.randomUUID(), text: "", done: false },
                ])
              }
            >
              <Plus aria-hidden />
              Add subtask
            </TTButton>
          </div>

          {/* ---- acceptance criteria --------------------------------------- */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">Acceptance criteria</span>
              {onGenerateAcceptance ? (
                <TTButton
                  type="button"
                  size="sm"
                  variant="secondary"
                  pending={genAcc}
                  pendingLabel="Thinking"
                  disabled={!title.trim()}
                  onClick={generateAcceptance}
                >
                  <Sparkles aria-hidden />
                  Generate with AI
                </TTButton>
              ) : null}
            </div>
            <ul className="space-y-2">
              {criteria.map((criterion, index) => (
                <li key={index} className="flex items-center gap-2">
                  <TTInput
                    value={criterion}
                    placeholder="How we will know it is done"
                    className="h-10"
                    onChange={(event) =>
                      setCriteria((current) =>
                        current.map((entry, at) => (at === index ? event.target.value : entry)),
                      )
                    }
                  />
                  <button
                    type="button"
                    aria-label="Remove criterion"
                    onClick={() =>
                      setCriteria((current) => current.filter((_, at) => at !== index))
                    }
                    className="rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X aria-hidden className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
            <TTButton
              type="button"
              size="sm"
              variant="quiet"
              onClick={() => setCriteria((current) => [...current, ""])}
            >
              <Plus aria-hidden />
              Add criterion
            </TTButton>
          </div>

          {/* ---- context and memory ---------------------------------------- */}
          <div className="space-y-3">
            <div>
              <span className="text-sm font-medium text-foreground">Context and memory</span>
              <p className="mt-1 text-xs text-muted-foreground">
                Add relevant links, notes, or files so AI and your team have the right context.
              </p>
            </div>

            {links.length > 0 ? (
              <ul className="space-y-1.5">
                {links.map((link, index) => (
                  <li
                    key={index}
                    className="flex items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {link.label}
                      {link.url ? (
                        <span className="ml-2 text-muted-foreground">{link.url}</span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      aria-label="Remove link"
                      onClick={() => setLinks((current) => current.filter((_, at) => at !== index))}
                      className="rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <X aria-hidden className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-2">
              <TTInput
                value={linkLabel}
                placeholder="Label"
                className="h-10"
                onChange={(event) => setLinkLabel(event.target.value)}
              />
              <TTInput
                value={linkUrl}
                placeholder="https://"
                className="h-10"
                onChange={(event) => setLinkUrl(event.target.value)}
              />
            </div>
            <TTButton type="button" size="sm" variant="quiet" onClick={addLink}>
              <Plus aria-hidden />
              Add link
            </TTButton>

            <textarea
              value={notes}
              placeholder="Anything else worth carrying with this."
              onChange={(event) => setNotes(event.target.value)}
              className="min-h-[88px] w-full rounded-lg border border-input bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground"
            />
          </div>
        </div>

        <div className="mt-8 flex flex-wrap gap-2 border-t border-border pt-4">
          <TTButton
            type="button"
            variant="secondary"
            pending={pending}
            onClick={() => void submit("draft", assignTo)}
          >
            Save draft
          </TTButton>
          {allowAgentCreate ? <TTButton
            type="button"
            variant="primary"
            pending={pending}
            onClick={() => void submit("open", "human")}
          >
            Create task
          </TTButton> : null}
          <TTButton
            type="button"
            variant="signal"
            pending={pending}
            disabled={!canAssignAI}
            onClick={() => void submit("open", "agent")}
          >
            Create and assign to AI
          </TTButton>
        </div>
      </aside>
    </div>
  );
}
