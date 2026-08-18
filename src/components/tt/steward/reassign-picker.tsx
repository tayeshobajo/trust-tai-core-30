import { Bot, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { TTButton } from "@/components/tt/primitives";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { StewardAgent, StewardTask } from "@/domain/steward-accountability";

export interface AssignablePerson {
  key: string;
  name: string;
  initials: string;
}

/**
 * Reassignment, grouped as people and agents. An agent is only selectable when
 * Paperclip actually reports a capability for the work, and consequential
 * assignment always passes through a bounded authorization review first.
 */
export function ReassignPicker({
  task,
  people,
  agents,
  open,
  onClose,
  onAssignPerson,
  onAssignAgent,
  eligibleAgent,
  refusal = null,
}: {
  task: StewardTask | null;
  people: AssignablePerson[];
  agents: StewardAgent[];
  open: boolean;
  onClose: () => void;
  onAssignPerson: (person: AssignablePerson) => void;
  onAssignAgent: (agent: StewardAgent) => void;
  eligibleAgent: (agent: StewardAgent, task: StewardTask) => boolean;
  /** Set when this person may not reassign. Nothing is offered, and it says why. */
  refusal?: string | null;
}) {
  const [review, setReview] = useState<StewardAgent | null>(null);

  if (!task) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          setReview(null);
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {review ? "Before this agent takes it" : "Who should carry this?"}
          </DialogTitle>
        </DialogHeader>

        {refusal ? (
          <div className="space-y-4">
            <div className="flex gap-3 rounded-lg border border-border bg-secondary/60 p-4">
              <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-sm text-foreground">This is not yours to reassign.</p>
                <p className="text-sm text-muted-foreground">{refusal}</p>
              </div>
            </div>
            <TTButton type="button" variant="secondary" onClick={onClose}>
              Close
            </TTButton>
          </div>
        ) : review ? (
          <div className="space-y-4">
            <p className="max-w-reading text-sm text-muted-foreground">
              {review.name} would take “{task.title}”.
            </p>
            <div className="rounded-lg border border-border p-4">
              <p className="tt-eyebrow">What it can do</p>
              <ul className="mt-2 space-y-1 text-sm text-foreground">
                {review.capabilities.length > 0 ? (
                  review.capabilities.map((item) => <li key={item}>{item}</li>)
                ) : (
                  <li className="text-muted-foreground">No capability is published for this agent.</li>
                )}
              </ul>
            </div>
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
              <p className="tt-eyebrow flex items-center gap-1.5">
                <ShieldAlert className="size-3.5" /> What it cannot do
              </p>
              <ul className="mt-2 space-y-1 text-sm text-foreground">
                {review.cannotDo.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="flex gap-2">
              <TTButton type="button" onClick={() => onAssignAgent(review)}>
                Assign task
              </TTButton>
              <TTButton type="button" variant="secondary" onClick={() => setReview(null)}>
                Back
              </TTButton>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <section>
              <p className="tt-eyebrow">Team members</p>
              <ul className="mt-2 space-y-1">
                {people.length === 0 ? (
                  <li className="text-sm text-muted-foreground">
                    Nobody has appeared in a confirmed promise yet.
                  </li>
                ) : (
                  people.map((person) => (
                    <li key={person.key}>
                      <button
                        type="button"
                        onClick={() => onAssignPerson(person)}
                        className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-secondary"
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-secondary text-[10px]">
                          {person.initials}
                        </span>
                        <span className="text-sm text-foreground">{person.name}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </section>

            <section className="border-t border-border pt-4">
              <p className="tt-eyebrow">AI agents</p>
              <ul className="mt-2 space-y-1">
                {agents.length === 0 ? (
                  <li className="text-sm text-muted-foreground">
                    No Paperclip agents are registered for this workspace.
                  </li>
                ) : (
                  agents.map((agent) => {
                    const eligible = eligibleAgent(agent, task);
                    return (
                      <li key={agent.id}>
                        <button
                          type="button"
                          disabled={!eligible}
                          onClick={() => setReview(agent)}
                          className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                        >
                          <span className="flex h-7 w-7 items-center justify-center rounded-full border border-royal/30 bg-royal/10 text-royal">
                            <Bot className="size-3.5" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-foreground">{agent.name}</span>
                            <span className="block text-xs text-muted-foreground">
                              {eligible ? agent.responsibility : "No capability for this kind of work"}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
