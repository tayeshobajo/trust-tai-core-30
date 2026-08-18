/**
 * Create a delivery project, progressively.
 *
 * A project is a promise, so step one asks for the things a promise needs: the
 * company it serves, who carries it, the outcome, a date if one was agreed,
 * and the first delivery items. The steps after it are optional and never
 * block the start: where the thinking lives, the mockups that show the intent,
 * and where it is being built.
 *
 * Nothing here claims more than it can do. A saved link is a link, an uploaded
 * mockup is a draft, and a Lovable or GitHub address is Linked, not Connected.
 */

import { useEffect, useState } from "react";
import { ExternalLink, Trash2, Upload, X } from "lucide-react";

import { TTButton, TTInput, MetaPill } from "@/components/tt/primitives";
import type { HandoffRow } from "@/components/tt/projects/index/handoff-list";
import {
  CONNECTION_TYPE_LABEL,
  SOURCE_SYNC_LABEL,
  THINKING_SOURCE_LABEL,
  syncStateFor,
  type ConnectionInput,
  type ConnectionType,
  type ThinkingSourceInput,
  type ThinkingSourceType,
} from "@/domain/project-intelligence";
import type { ProjectInput, ProjectOrigin } from "@/domain/projects";

export interface CreateProjectSeed {
  name: string;
  company: string;
  pointA: string;
  pointB: string;
  ownerLabel?: string;
  ownerUserId?: string;
  nextMove?: string;
  origin: ProjectOrigin;
  /** Shown so the person can see where this came from. */
  lineageLine?: string;
}

/** Everything a project can be given on the way in, beyond the promise. */
export interface CreateProjectExtras {
  thinking: ThinkingSourceInput[];
  mockups: File[];
  connections: ConnectionInput[];
}

const BLANK_SEED: CreateProjectSeed = {
  name: "",
  company: "",
  pointA: "",
  pointB: "",
  origin: { kind: "manual" },
};

const FIELD =
  "w-full rounded-xl border border-border bg-card px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const SELECT = "h-9 rounded-md border border-border bg-background px-2 text-[13px] text-foreground";

type Step = "promise" | "thinking" | "mockups" | "build";

const STEPS: { id: Step; label: string; note: string }[] = [
  { id: "promise", label: "The promise", note: "Who it is for, who carries it, what will be true." },
  { id: "thinking", label: "Thinking", note: "Where this was actually worked out." },
  { id: "mockups", label: "Mockups", note: "What it should look like. Uploaded as drafts." },
  { id: "build", label: "Build", note: "Where it is being built. Linked, not connected." },
];

export function CreateProjectModal({
  open,
  seed,
  handoffs = [],
  onSeedFromMilestone,
  pending,
  error,
  onClose,
  onCreate,
}: {
  open: boolean;
  seed?: CreateProjectSeed | null;
  /** Approved milestones this project can be started from. */
  handoffs?: HandoffRow[];
  onSeedFromMilestone?: (row: HandoffRow) => void;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (input: ProjectInput, extras: CreateProjectExtras) => void;
}) {
  const base = seed ?? BLANK_SEED;
  const [step, setStep] = useState<Step>("promise");
  const [name, setName] = useState(base.name);
  const [company, setCompany] = useState(base.company);
  const [owner, setOwner] = useState(base.ownerLabel ?? "");
  const [pointA, setPointA] = useState(base.pointA);
  const [pointB, setPointB] = useState(base.pointB);
  const [dueDate, setDueDate] = useState("");
  const [items, setItems] = useState("");

  const [thinking, setThinking] = useState<ThinkingSourceInput[]>([]);
  const [sourceType, setSourceType] = useState<ThinkingSourceType>("chatgpt");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");

  const [mockups, setMockups] = useState<File[]>([]);

  const [connections, setConnections] = useState<ConnectionInput[]>([]);
  const [connectionType, setConnectionType] = useState<ConnectionType>("lovable");
  const [connectionLabel, setConnectionLabel] = useState("");
  const [connectionUrl, setConnectionUrl] = useState("");

  useEffect(() => {
    if (!open) return;
    setStep("promise");
    setName(base.name);
    setCompany(base.company);
    setOwner(base.ownerLabel ?? "");
    setPointA(base.pointA);
    setPointB(base.pointB);
    setDueDate("");
    setItems("");
    setThinking([]);
    setMockups([]);
    setConnections([]);
    setSourceTitle("");
    setSourceUrl("");
    setConnectionLabel("");
    setConnectionUrl("");
    // The seed identity is what decides a fresh form, not every render.
  }, [open, seed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  // Lineage is chosen, never typed: roadmaps that still have approved work,
  // then the milestone inside the one picked.
  const startable = handoffs.filter((row) => row.ready && !row.existingProjectId);
  const roadmaps: { id: string; label: string }[] = [];
  for (const row of startable) {
    if (!roadmaps.some((entry) => entry.id === row.milestone.roadmapId)) {
      roadmaps.push({ id: row.milestone.roadmapId, label: row.company });
    }
  }
  const chosenRoadmapId = base.origin.roadmapId ?? "";
  const milestones = startable.filter((row) => row.milestone.roadmapId === chosenRoadmapId);

  const ready = name.trim().length > 0 && pointB.trim().length > 0 && owner.trim().length > 0;
  const index = STEPS.findIndex((entry) => entry.id === step);
  const last = index === STEPS.length - 1;

  function addThinking() {
    if (!sourceTitle.trim() || !sourceUrl.trim()) return;
    setThinking((current) => [
      ...current,
      {
        sourceType,
        title: sourceTitle.trim(),
        url: sourceUrl.trim(),
        isPrimary: current.length === 0,
      },
    ]);
    setSourceTitle("");
    setSourceUrl("");
  }

  function addConnection() {
    if (!connectionLabel.trim()) return;
    setConnections((current) => [
      ...current,
      {
        connectionType,
        label: connectionLabel.trim(),
        ...(connectionUrl.trim() ? { url: connectionUrl.trim() } : {}),
      },
    ]);
    setConnectionLabel("");
    setConnectionUrl("");
  }

  function submit() {
    const deliveryItems = items
      .split("\n")
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter((line) => line.length > 0)
      .map((label) => ({ label, done: false }));

    onCreate(
      {
        name: name.trim(),
        pointA:
          pointA.trim() ||
          `Nothing is recorded yet about where ${company.trim() || "this company"} stands on this.`,
        pointB: pointB.trim(),
        ...(base.nextMove ? { nextMove: base.nextMove } : {}),
        ...(owner.trim() ? { ownerLabel: owner.trim() } : {}),
        ...(base.ownerUserId ? { ownerUserId: base.ownerUserId } : {}),
        ...(dueDate ? { dueDate: new Date(`${dueDate}T12:00:00`).toISOString() } : {}),
        ...(deliveryItems.length > 0 ? { deliveryItems } : {}),
        origin: {
          ...base.origin,
          ...(company.trim() ? { subjectLabel: company.trim() } : {}),
        },
      },
      { thinking, mockups, connections },
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create project"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/20 p-4 backdrop-blur-sm sm:p-8"
    >
      <div className="w-full max-w-[600px] rounded-2xl border border-border bg-card p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="tt-eyebrow">New delivery</p>
            <h2 className="mt-1.5 font-display text-xl text-foreground">Create project</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {base.lineageLine ?? "Started here, with no roadmap milestone behind it."}
            </p>
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

        <nav aria-label="Create steps" className="mt-5 flex flex-wrap gap-1.5">
          {STEPS.map((entry, position) => (
            <button
              key={entry.id}
              type="button"
              aria-current={entry.id === step ? "step" : undefined}
              disabled={position > 0 && !ready}
              onClick={() => setStep(entry.id)}
              className={
                entry.id === step
                  ? "rounded-full border border-royal/40 bg-royal/10 px-3 py-1 text-[12px] text-royal"
                  : "rounded-full border border-border px-3 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              }
            >
              {position + 1}. {entry.label}
            </button>
          ))}
        </nav>
        <p className="mt-2 text-[12px] text-muted-foreground">{STEPS[index]?.note}</p>

        {step === "promise" ? (
          <div className="mt-4 space-y-3">
            {roadmaps.length > 0 ? (
              <div className="grid gap-3 rounded-xl border border-border bg-secondary/40 p-3 sm:grid-cols-2">
                <label className="block space-y-1.5">
                  <span className="text-[12px] text-muted-foreground">Roadmap (company)</span>
                  <select
                    className={FIELD}
                    value={chosenRoadmapId}
                    onChange={(event) => {
                      const roadmapId = event.target.value;
                      const first = startable.find((row) => row.milestone.roadmapId === roadmapId);
                      if (first && onSeedFromMilestone) onSeedFromMilestone(first);
                    }}
                  >
                    <option value="">No roadmap, start here</option>
                    {roadmaps.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[12px] text-muted-foreground">Approved milestone</span>
                  <select
                    className={FIELD}
                    disabled={milestones.length === 0}
                    value={base.origin.milestoneId ?? ""}
                    onChange={(event) => {
                      const row = milestones.find((entry) => entry.milestone.id === event.target.value);
                      if (row && onSeedFromMilestone) onSeedFromMilestone(row);
                    }}
                  >
                    <option value="">
                      {milestones.length === 0
                        ? "Pick a roadmap first"
                        : "Choose the approved milestone"}
                    </option>
                    {milestones.map((row) => (
                      <option key={row.milestone.id} value={row.milestone.id}>
                        {row.milestone.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}

            <label className="block space-y-1.5">
              <span className="text-[12px] text-muted-foreground">Project name</span>
              <TTInput value={name} onChange={(event) => setName(event.target.value)} />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-[12px] text-muted-foreground">Company</span>
                <TTInput
                  value={company}
                  onChange={(event) => setCompany(event.target.value)}
                  placeholder="Who this is for"
                  readOnly={base.origin.kind === "roadmap_milestone"}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[12px] text-muted-foreground">Owner</span>
                <TTInput
                  value={owner}
                  onChange={(event) => setOwner(event.target.value)}
                  placeholder="Who carries it"
                />
              </label>
            </div>

            <label className="block space-y-1.5">
              <span className="text-[12px] text-muted-foreground">Outcome (Point B)</span>
              <textarea
                rows={2}
                className={FIELD}
                value={pointB}
                onChange={(event) => setPointB(event.target.value)}
                placeholder="What will be true when this is done"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-[12px] text-muted-foreground">Where things stand (Point A)</span>
              <textarea
                rows={2}
                className={FIELD}
                value={pointA}
                onChange={(event) => setPointA(event.target.value)}
                placeholder="Optional. What is true today."
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-[12px] text-muted-foreground">Due date</span>
                <TTInput
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[12px] text-muted-foreground">
                  Delivery items, one per line
                </span>
                <textarea
                  rows={3}
                  className={FIELD}
                  value={items}
                  onChange={(event) => setItems(event.target.value)}
                  placeholder={"Scope agreed\nFirst build\nHanded to client"}
                />
              </label>
            </div>
          </div>
        ) : null}

        {step === "thinking" ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                className={SELECT}
                aria-label="Source type"
                value={sourceType}
                onChange={(event) => setSourceType(event.target.value as ThinkingSourceType)}
              >
                {Object.entries(THINKING_SOURCE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <TTInput
                value={sourceTitle}
                aria-label="Source title"
                placeholder="What this thread is about"
                onChange={(event) => setSourceTitle(event.target.value)}
              />
              <TTInput
                value={sourceUrl}
                aria-label="Source link"
                placeholder="https://"
                onChange={(event) => setSourceUrl(event.target.value)}
              />
              <TTButton
                size="sm"
                variant="secondary"
                onClick={addThinking}
                disabled={!sourceTitle.trim() || !sourceUrl.trim()}
              >
                Add
              </TTButton>
            </div>

            {thinking.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                Optional. Link the ChatGPT, Claude or document thread where this was worked out.
              </p>
            ) : (
              <ul className="space-y-2">
                {thinking.map((entry, position) => (
                  <li
                    key={`${entry.url}-${position}`}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2"
                  >
                    <span className="text-[14px] text-foreground">{entry.title}</span>
                    <MetaPill>{THINKING_SOURCE_LABEL[entry.sourceType]}</MetaPill>
                    <MetaPill>{SOURCE_SYNC_LABEL[syncStateFor(entry.sourceType)]}</MetaPill>
                    {entry.isPrimary ? <MetaPill className="text-royal">Primary</MetaPill> : null}
                    <a
                      href={entry.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[12px] text-royal underline-offset-2 hover:underline"
                    >
                      Open <ExternalLink aria-hidden className="size-3.5" />
                    </a>
                    <button
                      type="button"
                      aria-label={`Remove ${entry.title}`}
                      className="ml-auto text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setThinking((current) => current.filter((_, i) => i !== position))
                      }
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[12px] text-muted-foreground">
              A link is a link. Once the project exists you can import the part that matters, and
              every line waits for you to confirm it.
            </p>
          </div>
        ) : null}

        {step === "mockups" ? (
          <div className="mt-4 space-y-3">
            <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-royal">
              <Upload aria-hidden className="size-4" />
              <span>Choose mockups</span>
              <input
                type="file"
                multiple
                className="sr-only"
                onChange={(event) => {
                  const chosen = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  if (chosen.length > 0) setMockups((current) => [...current, ...chosen]);
                }}
              />
            </label>

            {mockups.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                Optional. Mockups and design references make the intent visible instead of implied.
              </p>
            ) : (
              <ul className="space-y-2">
                {mockups.map((file, position) => (
                  <li
                    key={`${file.name}-${position}`}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2"
                  >
                    <span className="text-[14px] text-foreground">{file.name}</span>
                    <MetaPill>Draft</MetaPill>
                    <button
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      className="ml-auto text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setMockups((current) => current.filter((_, i) => i !== position))
                      }
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[12px] text-muted-foreground">
              Everything uploads as a draft. Approving a mockup is a separate, deliberate act inside
              the project.
            </p>
          </div>
        ) : null}

        {step === "build" ? (
          <div className="mt-4 space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                className={SELECT}
                aria-label="Connection type"
                value={connectionType}
                onChange={(event) => setConnectionType(event.target.value as ConnectionType)}
              >
                {Object.entries(CONNECTION_TYPE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <TTInput
                value={connectionLabel}
                aria-label="Connection label"
                placeholder="Name this workspace or repository"
                onChange={(event) => setConnectionLabel(event.target.value)}
              />
              <TTInput
                value={connectionUrl}
                aria-label="Connection link"
                placeholder="https://"
                onChange={(event) => setConnectionUrl(event.target.value)}
              />
              <TTButton
                size="sm"
                variant="secondary"
                onClick={addConnection}
                disabled={!connectionLabel.trim()}
              >
                Link
              </TTButton>
            </div>

            {connections.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                Optional. Add the Lovable project or GitHub repository this is built in.
              </p>
            ) : (
              <ul className="space-y-2">
                {connections.map((entry, position) => (
                  <li
                    key={`${entry.label}-${position}`}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2"
                  >
                    <span className="text-[14px] text-foreground">{entry.label}</span>
                    <MetaPill>{CONNECTION_TYPE_LABEL[entry.connectionType]}</MetaPill>
                    <MetaPill>Linked</MetaPill>
                    <button
                      type="button"
                      aria-label={`Remove ${entry.label}`}
                      className="ml-auto text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setConnections((current) => current.filter((_, i) => i !== position))
                      }
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[12px] text-muted-foreground">
              Linked means the address is on record. Connected is only ever written when something
              real has actually been read.
            </p>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="mt-4 text-[13px] text-destructive">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12px] text-muted-foreground">
            {ready
              ? "Ready to start. The remaining steps are optional."
              : "Name, owner and outcome are needed before work starts."}
          </p>
          <div className="flex flex-wrap gap-2">
            <TTButton size="sm" variant="quiet" onClick={onClose} disabled={pending}>
              Cancel
            </TTButton>
            {index > 0 ? (
              <TTButton
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => setStep(STEPS[index - 1]!.id)}
              >
                Back
              </TTButton>
            ) : null}
            {last ? null : (
              <TTButton
                size="sm"
                variant="secondary"
                disabled={!ready || pending}
                onClick={() => setStep(STEPS[index + 1]!.id)}
              >
                Continue
              </TTButton>
            )}
            <TTButton size="sm" onClick={submit} disabled={!ready || pending}>
              {pending ? "Starting…" : "Create project"}
            </TTButton>
          </div>
        </div>
      </div>
    </div>
  );
}
