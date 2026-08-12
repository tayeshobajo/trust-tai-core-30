import { ArrowUp } from "lucide-react";
import { useState, type FormEvent } from "react";

import { MetaPill, TTButton } from "@/components/tt/primitives";
import { memorySource } from "@/data/memory-source";
import type { ContextResult } from "@/domain/intelligence";

const EXAMPLES = [
  "What needs my attention today?",
  "What's going on with Northbank?",
  "Which clients are at risk?",
  "What should happen next?",
];

const KIND_LABEL = {
  fact: "Observed",
  inference: "Inferred",
  recommendation: "Suggested",
} as const;

/**
 * The doorway into Trust Tai Intelligence.
 *
 * This is not a live model. Submitting reads the existing in-memory
 * intelligence provider and returns its context, clearly labelled as a preview
 * with provenance and the observed / inferred / suggested distinction intact.
 */
export function IntelligenceConsole({
  organizationId,
  userId,
}: {
  organizationId: string;
  userId: string;
}) {
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [result, setResult] = useState<ContextResult | null>(null);
  const [pending, setPending] = useState(false);

  async function ask(value: string) {
    const trimmed = value.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setAsked(trimmed);
    const next = await memorySource.intelligence.retrieve({
      organizationId,
      userId,
      question: trimmed,
    });
    setResult(next);
    setPending(false);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void ask(question);
  }

  return (
    <section
      aria-labelledby="intelligence-heading"
      className="overflow-hidden rounded-2xl border border-border bg-card"
    >
      <div className="p-6 sm:p-8">
        <p className="tt-eyebrow">Trust Tai Intelligence</p>
        <h2
          id="intelligence-heading"
          className="mt-3 font-display text-2xl text-foreground sm:text-3xl"
        >
          Ask, and see what the system already knows.
        </h2>

        <form onSubmit={onSubmit} className="mt-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label htmlFor="tt-ask" className="sr-only">
              Ask Trust Tai
            </label>
            <input
              id="tt-ask"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask Trust Tai anything about clients, projects, communication, operations, or what needs your attention."
              className="h-12 min-w-0 flex-1 rounded-full border border-input bg-background px-5 text-sm text-foreground placeholder:text-muted-foreground"
            />
            <TTButton type="submit" variant="signal" disabled={pending} className="shrink-0">
              {pending ? "Reading" : "Ask"}
              <ArrowUp aria-hidden />
            </TTButton>
          </div>
        </form>

        <ul className="mt-4 flex flex-wrap gap-2">
          {EXAMPLES.map((example) => (
            <li key={example}>
              <button
                type="button"
                onClick={() => {
                  setQuestion(example);
                  void ask(example);
                }}
                className="min-h-9 rounded-full border border-border px-3.5 py-1.5 text-left text-[13px] text-muted-foreground transition-colors duration-200 hover:bg-secondary hover:text-foreground"
              >
                {example}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {result ? (
        <div className="border-t border-border bg-secondary/50 p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-2">
            <MetaPill>Preview response</MetaPill>
            <span className="text-xs text-muted-foreground">
              Read from the current in-memory context. No model has been called.
            </span>
          </div>
          <p className="mt-4 text-sm text-foreground">
            <span className="text-muted-foreground">You asked: </span>
            {asked}
          </p>
          <ul className="mt-4 space-y-4">
            {result.facts.map((fact) => (
              <li key={fact.id} className="border-t border-border pt-4">
                <p className="text-sm text-foreground">{fact.statement}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <MetaPill>{KIND_LABEL[fact.kind]}</MetaPill>
                  <MetaPill>via {fact.provenance.appId}</MetaPill>
                </div>
              </li>
            ))}
          </ul>
          {result.withheld.length > 0 ? (
            <p className="mt-5 text-xs text-muted-foreground">
              Not yet readable:{" "}
              {result.withheld.map((w) => `${w.appId} (${w.reason.replace("_", " ")})`).join(", ")}.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
