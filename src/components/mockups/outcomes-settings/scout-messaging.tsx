import { useState } from "react";

import { MetaPill, TTButton, TTInput } from "@/components/tt/primitives";
import { Toggle } from "@/components/tt/settings/pieces";
import { cn } from "@/lib/utils";

export interface ScoutTemplate {
  id: string;
  name: string;
  preview: string;
  lastEdited: string;
  active: boolean;
  subject: string;
  body: string;
  voiceChecks: string[];
  sendWindow: string;
  weeklyCap: number;
}

const INITIAL_TEMPLATES: ScoutTemplate[] = [
  {
    id: "roadmap-opener",
    name: "Roadmap opener",
    preview: "For founders who have outgrown the spreadsheet phase.",
    lastEdited: "Sep 10",
    active: true,
    subject: "A quiet question about your next chapter",
    body: "Hi {{name}},\n\nI noticed {{company}} has been growing in a way that often creates a gap between what the founder sees and what the team can execute. I help founder-led companies build an operating system for decisions, sequencing and outcomes.\n\nNo pitch. Just a question: when you look at the next 90 days, what is the one decision that keeps moving?\n\nTrust,\nTai",
    voiceChecks: ["No em dashes", "No exclamation marks", "No generic check-ins"],
    sendWindow: "Weekdays, 8am–6pm CT",
    weeklyCap: 15,
  },
  {
    id: "local-founder",
    name: "Local founder",
    preview: "Nearby, independently owned, ready for structure.",
    lastEdited: "Sep 8",
    active: true,
    subject: "Founders in {{city}} are building differently",
    body: "Hi {{name}},\n\nI spend most of my time with founder-led companies in Middle Tennessee that have reached the point where instinct alone is not enough to coordinate the next stage. {{company}} looks like it may be in that window.\n\nI would welcome a short conversation about what is working and where the friction is showing up.\n\nTrust,\nTai",
    voiceChecks: ["No em dashes", "No exclamation marks", "No generic check-ins"],
    sendWindow: "Weekdays, 8am–6pm CT",
    weeklyCap: 15,
  },
  {
    id: "post-milestone",
    name: "Post-milestone note",
    preview: "After a visible win, before the next pressure builds.",
    lastEdited: "Aug 29",
    active: false,
    subject: "Congratulations on the milestone",
    body: "Hi {{name}},\n\nI saw the recent milestone at {{company}}. Wins like that usually mean the operating system is about to be tested by the next wave of decisions.\n\nIf you are starting to feel that tension, I would be glad to share how similar founders are sequencing what comes next.\n\nTrust,\nTai",
    voiceChecks: ["No em dashes", "No exclamation marks", "No generic check-ins"],
    sendWindow: "Weekdays, 8am–6pm CT",
    weeklyCap: 10,
  },
];

export function ScoutMessagingSection() {
  const [templates, setTemplates] = useState<ScoutTemplate[]>(INITIAL_TEMPLATES);
  const [selectedId, setSelectedId] = useState<string>(INITIAL_TEMPLATES[0]!.id);

  const selected = templates.find((template) => template.id === selectedId) ?? templates[0]!;

  const update = (id: string, patch: Partial<ScoutTemplate>) => {
    setTemplates((current) =>
      current.map((template) => (template.id === id ? { ...template, ...patch } : template)),
    );
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <div className="space-y-2">
        {templates.map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => setSelectedId(template.id)}
            className={cn(
              "w-full rounded-xl border p-4 text-left transition-colors",
              selectedId === template.id
                ? "border-royal/35 bg-royal-wash"
                : "border-border bg-card hover:border-royal/25",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-foreground">{template.name}</p>
              <Toggle
                label={`Toggle ${template.name}`}
                checked={template.active}
                onChange={(next) => update(template.id, { active: next })}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{template.preview}</p>
            <p className="mt-2 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
              Last edited {template.lastEdited}
            </p>
          </button>
        ))}
      </div>

      <div className="space-y-5">
        <div>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-foreground">Subject line</span>
            <TTInput
              value={selected.subject}
              onChange={(event) => update(selected.id, { subject: event.target.value })}
            />
          </label>
        </div>

        <div>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-foreground">Body</span>
            <textarea
              value={selected.body}
              onChange={(event) => update(selected.id, { body: event.target.value })}
              rows={10}
              className="w-full rounded-lg border border-input bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground"
            />
          </label>
        </div>

        <div>
          <p className="text-xs font-medium text-muted-foreground">Voice check</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {selected.voiceChecks.map((check) => (
              <MetaPill key={check}>{check}</MetaPill>
            ))}
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-foreground">Send window</span>
            <TTInput
              value={selected.sendWindow}
              onChange={(event) => update(selected.id, { sendWindow: event.target.value })}
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-foreground">Weekly cap</span>
            <TTInput
              type="number"
              value={selected.weeklyCap}
              onChange={(event) => update(selected.id, { weeklyCap: Number(event.target.value) })}
              className="text-left"
            />
          </label>
        </div>

        <div className="flex gap-3">
          <TTButton size="sm" variant="secondary">
            Preview as recipient
          </TTButton>
          <TTButton size="sm" variant="quiet">
            Duplicate template
          </TTButton>
        </div>
      </div>
    </div>
  );
}
