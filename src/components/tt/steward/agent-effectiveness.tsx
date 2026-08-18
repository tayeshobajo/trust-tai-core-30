/**
 * What good looks like for one agent, and what actually happened.
 *
 * A person writes the definition. Paperclip reports the evidence. Steward
 * only puts the two next to each other and says whether the agent is on
 * track, behind, waiting, or needs a person. There is no score, because a
 * score would be a judgment nobody made.
 */

import { useState } from "react";
import { ShieldAlert } from "lucide-react";

import { MetaPill, TTButton } from "@/components/tt/primitives";
import {
  ACCOUNTABILITY_LABEL,
  agentAccountability,
} from "@/data/projects/agent-effectiveness";
import { agentEffectivenessService } from "@/data/supabase/project-intelligence";
import { missingContext } from "@/data/steward/agent-evidence";
import { EMPTY_AGENT_EVIDENCE } from "@/domain/project-intelligence";
import type {
  AgentEffectiveness,
  AgentEffectivenessInput,
} from "@/domain/project-intelligence";
import type { StewardAgent } from "@/domain/steward-accountability";
import { canManageRoom, canWorkInRoom } from "@/lib/room-authority";

const FIELD =
  "w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring";

/** One definition line per row, because that is how people write these. */
function lines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter((line) => line.length > 0);
}

function joined(value: string[] | undefined): string {
  return (value ?? []).join("\n");
}

export function AgentAccountabilityPanel({
  agent,
  definition,
  pending,
  onSave,
}: {
  agent: StewardAgent;
  definition: AgentEffectiveness | null;
  pending: boolean;
  onSave: (input: AgentEffectivenessInput) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [responsibility, setResponsibility] = useState(
    definition?.responsibility ?? agent.responsibility,
  );
  const [expected, setExpected] = useState(joined(definition?.expectedWeeklyOutcomes));
  const [criteria, setCriteria] = useState(joined(definition?.successCriteria));
  const [surface, setSurface] = useState(joined(definition?.surfaceWhen));
  const [context, setContext] = useState(joined(definition?.requiredContext));
  const [escalation, setEscalation] = useState(joined(definition?.escalationRules));
  const [evidenceExpected, setEvidenceExpected] = useState(joined(definition?.evidenceExpected));

  /* Two different questions. Working in Steward lets you see how an agent is
     doing. Managing Steward lets you change what it is held to. Evidence is
     read through the service, so the same rule holds if this panel is ever
     rendered somewhere else. */
  const maySeeEvidence = canWorkInRoom("steward");
  const mayWrite = canManageRoom("steward");
  let evidence = EMPTY_AGENT_EVIDENCE;
  if (maySeeEvidence) {
    try {
      evidence = agentEffectivenessService.evidence(agent, definition);
    } catch {
      evidence = EMPTY_AGENT_EVIDENCE;
    }
  }
  const accountability = agentAccountability(definition, evidence);
  const missing = missingContext(definition, agent);

  if (editing) {
    return (
      <section className="space-y-3 border-t border-border pt-5">
        <p className="tt-eyebrow">What good looks like</p>
        <label className="block space-y-1.5">
          <span className="text-[12px] text-muted-foreground">Responsibility</span>
          <textarea
            rows={2}
            className={FIELD}
            value={responsibility}
            onChange={(event) => setResponsibility(event.target.value)}
          />
        </label>
        {[
          { label: "Expected outcomes each week", value: expected, set: setExpected },
          { label: "Success criteria", value: criteria, set: setCriteria },
          { label: "Surface this agent when", value: surface, set: setSurface },
          { label: "Context it must be given", value: context, set: setContext },
          { label: "Escalate to a person when", value: escalation, set: setEscalation },
          { label: "Evidence expected", value: evidenceExpected, set: setEvidenceExpected },
        ].map((field) => (
          <label key={field.label} className="block space-y-1.5">
            <span className="text-[12px] text-muted-foreground">{field.label}, one per line</span>
            <textarea
              rows={3}
              className={FIELD}
              value={field.value}
              onChange={(event) => field.set(event.target.value)}
            />
          </label>
        ))}
        <div className="flex gap-2">
          <TTButton
            size="sm"
            disabled={pending || responsibility.trim().length === 0}
            onClick={() => {
              onSave({
                agentId: agent.id,
                responsibility: responsibility.trim(),
                expectedWeeklyOutcomes: lines(expected),
                successCriteria: lines(criteria),
                surfaceWhen: lines(surface),
                requiredContext: lines(context),
                escalationRules: lines(escalation),
                evidenceExpected: lines(evidenceExpected),
              });
              setEditing(false);
            }}
          >
            {pending ? "Saving…" : "Save definition"}
          </TTButton>
          <TTButton size="sm" variant="secondary" onClick={() => setEditing(false)}>
            Cancel
          </TTButton>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3 border-t border-border pt-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="tt-eyebrow">Accountability</p>
        <MetaPill>{ACCOUNTABILITY_LABEL[accountability.state]}</MetaPill>
        {mayWrite ? (
          <TTButton
            size="sm"
            variant="secondary"
            className="ml-auto"
            onClick={() => setEditing(true)}
          >
            {definition ? "Edit definition" : "Define what good looks like"}
          </TTButton>
        ) : (
          <MetaPill className="ml-auto">
            {maySeeEvidence ? "Managers change this" : "View only"}
          </MetaPill>
        )}
      </div>

      <p className="max-w-reading text-sm text-foreground">{accountability.because}</p>
      <p className="text-sm text-muted-foreground">{accountability.outcome}</p>

      {accountability.expectedThisWeek.length > 0 ? (
        <div className="space-y-1">
          <p className="tt-eyebrow">Expected this week</p>
          <ul className="space-y-1 text-sm text-foreground">
            {accountability.expectedThisWeek.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!maySeeEvidence ? (
        <p className="rounded-lg border border-border bg-muted/40 p-4 text-[13px] text-muted-foreground">
          Observed evidence for this agent is kept with the people who carry Steward
          authority. You can see that it is being tracked, not what it says.
        </p>
      ) : null}

      {maySeeEvidence && accountability.evidence.length > 0 ? (
        <div className="space-y-1">
          <p className="tt-eyebrow">Evidence</p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {accountability.evidence.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {definition && definition.successCriteria.length > 0 ? (
        <div className="space-y-1">
          <p className="tt-eyebrow">Success criteria</p>
          <ul className="space-y-1 text-sm text-foreground">
            {definition.successCriteria.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {missing.length > 0 ? (
        <div className="space-y-1 rounded-lg border border-warning/30 bg-warning/5 p-4">
          <p className="tt-eyebrow flex items-center gap-1.5">
            <ShieldAlert className="size-3.5" /> Context this agent has not been given
          </p>
          <ul className="space-y-1 text-sm text-foreground">
            {missing.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
          <p className="text-[12px] text-muted-foreground">
            Until this is published as a capability, the agent is being asked to work without it.
          </p>
        </div>
      ) : null}

      {definition && definition.escalationRules.length > 0 ? (
        <div className="space-y-1">
          <p className="tt-eyebrow">Escalate to a person when</p>
          <ul className="space-y-1 text-sm text-foreground">
            {definition.escalationRules.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
