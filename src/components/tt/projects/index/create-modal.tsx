/**
 * Create a delivery project.
 *
 * A project is a promise, so this asks for the things a promise needs: the
 * company it serves, who carries it, the outcome, a date if one was agreed,
 * and the first delivery items. When it opens from an approved milestone the
 * lineage is carried across and shown, never re-typed.
 */

import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { TTButton, TTInput } from "@/components/tt/primitives";
import type { HandoffRow } from "@/components/tt/projects/index/handoff-list";
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

const BLANK_SEED: CreateProjectSeed = {
  name: "",
  company: "",
  pointA: "",
  pointB: "",
  origin: { kind: "manual" },
};

const FIELD =
  "w-full rounded-xl border border-border bg-card px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
  onCreate: (input: ProjectInput) => void;
}) {
  const base = seed ?? BLANK_SEED;
  const [name, setName] = useState(base.name);
  const [company, setCompany] = useState(base.company);
  const [owner, setOwner] = useState(base.ownerLabel ?? "");
  const [pointA, setPointA] = useState(base.pointA);
  const [pointB, setPointB] = useState(base.pointB);
  const [dueDate, setDueDate] = useState("");
  const [items, setItems] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(base.name);
    setCompany(base.company);
    setOwner(base.ownerLabel ?? "");
    setPointA(base.pointA);
    setPointB(base.pointB);
    setDueDate("");
    setItems("");
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

  function submit() {
    const deliveryItems = items
      .split("\n")
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter((line) => line.length > 0)
      .map((label) => ({ label, done: false }));

    onCreate({
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
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Create project"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/20 p-4 backdrop-blur-sm sm:p-8"
    >
      <div className="w-full max-w-[560px] rounded-2xl border border-border bg-card p-6 shadow-lg">
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

        <div className="mt-5 space-y-3">
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
                  <option value="">No roadmap — start here</option>
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
                Delivery items — one per line
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

        {error ? (
          <p role="alert" className="mt-4 text-[13px] text-destructive">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex items-center justify-between gap-3">
          <p className="text-[12px] text-muted-foreground">
            {ready ? "Ready to start." : "Name, owner and outcome are needed before work starts."}
          </p>
          <div className="flex gap-2">
            <TTButton size="sm" variant="secondary" onClick={onClose} disabled={pending}>
              Cancel
            </TTButton>
            <TTButton size="sm" onClick={submit} disabled={!ready || pending}>
              {pending ? "Starting…" : "Create project"}
            </TTButton>
          </div>
        </div>
      </div>
    </div>
  );
}
