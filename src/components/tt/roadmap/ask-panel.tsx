/**
 * Ask Roadmap.
 *
 * A persistent question box over one business. Answers are grounded in stored
 * evidence: facts repeat their sources, reasoning is labelled as reasoning, and
 * anything the evidence does not cover comes back as an unknown.
 *
 * Fresh web research is a separate, deliberate action. Asking a question never
 * quietly triggers a search, because a stored answer and a newly researched one
 * are not the same kind of claim.
 */

import { useState } from "react";

import { EvidenceList } from "@/components/tt/roadmap/tier";
import { MetaPill, TTButton, TTInput } from "@/components/tt/primitives";
import type { AskAnswer } from "@/domain/roadmap-intel";

export function AskPanel({
  subjectLabel,
  answers,
  pending,
  error,
  onAsk,
}: {
  subjectLabel: string;
  answers: AskAnswer[];
  pending: boolean;
  error: string | null;
  onAsk: (question: string, research: boolean) => void;
}) {
  const [question, setQuestion] = useState("");

  return (
    <section className="tt-surface p-6" aria-label="Ask Roadmap">
      <p className="tt-eyebrow">Ask Roadmap</p>
      <form
        className="mt-3 flex flex-col gap-3 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (!question.trim()) return;
          onAsk(question.trim(), false);
          setQuestion("");
        }}
      >
        <TTInput
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={`Ask Roadmap about ${subjectLabel}...`}
          aria-label={`Ask Roadmap about ${subjectLabel}`}
        />
        <TTButton type="submit" disabled={pending || question.trim().length === 0}>
          {pending ? "Thinking…" : "Ask"}
        </TTButton>
        <TTButton
          type="button"
          variant="secondary"
          disabled={pending || question.trim().length === 0}
          onClick={() => {
            if (!question.trim()) return;
            onAsk(question.trim(), true);
            setQuestion("");
          }}
        >
          Research this question
        </TTButton>
      </form>
      <p className="mt-2 text-xs text-muted-foreground">
        Answers come from what we already hold. Research this question when you want Roadmap to go
        back to the web for it.
      </p>

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      {answers.length > 0 ? (
        <ul className="mt-6 space-y-6">
          {answers.map((entry) => (
            <li key={entry.id}>
              <p className="text-sm font-medium text-foreground">{entry.question}</p>
              <p className="mt-2 max-w-reading text-sm text-foreground">{entry.answer}</p>

              {entry.facts.length > 0 ? (
                <div className="mt-3">
                  <MetaPill>Observed</MetaPill>
                  <ul className="mt-2 space-y-2">
                    {entry.facts.map((fact, index) => (
                      <li key={index}>
                        <p className="max-w-reading text-sm text-foreground">{fact.statement}</p>
                        <EvidenceList
                          evidence={fact.sources.map((ref) => ({
                            label: ref.label,
                            url: ref.url,
                            kind: "page" as const,
                          }))}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {entry.inferences.length > 0 ? (
                <div className="mt-3">
                  <MetaPill>Inferred</MetaPill>
                  <ul className="mt-2 space-y-1">
                    {entry.inferences.map((line) => (
                      <li key={line} className="max-w-reading text-sm text-muted-foreground">
  · {line}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {entry.unknowns.length > 0 ? (
                <div className="mt-3">
                  <MetaPill>Not established</MetaPill>
                  <ul className="mt-2 space-y-1">
                    {entry.unknowns.map((line) => (
                      <li key={line} className="max-w-reading text-sm text-muted-foreground">
  · {line}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <p className="mt-2 text-xs text-muted-foreground">
                {entry.provider ? `${entry.provider} · ${entry.model} · ` : ""}
                {new Date(entry.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
