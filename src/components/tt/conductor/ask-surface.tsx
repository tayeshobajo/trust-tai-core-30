/**
 * The ask surface, the dominant thing on the page.
 *
 * A person should be able to type a sentence and get a grounded answer. The
 * chips are not features; they are the questions this room answers well, said
 * the way a person would say them. Asking reads the rooms you are allowed to
 * see and changes nothing.
 */

import { useState } from "react";

import { TTButton } from "@/components/tt/primitives";

export const CONDUCTOR_OPENERS = [
  "What needs my attention today?",
  "Where are we waiting on someone?",
  "What are we not measuring?",
  "Which companies deserve attention?",
  "What should I decide next?",
  "What is blocking delivery?",
] as const;

export function AskSurface({
  thinking,
  initialQuestion,
  onAsk,
}: {
  thinking?: boolean;
  initialQuestion?: string;
  onAsk: (question: string) => void | Promise<void>;
}) {
  const [question, setQuestion] = useState(initialQuestion ?? "");

  async function ask(text: string) {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    setQuestion(trimmed);
    await onAsk(trimmed);
  }

  return (
    <section aria-label="Ask the business" className="tt-rise rounded-2xl border border-border bg-card p-5 sm:p-6">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
      >
        <label htmlFor="conductor-ask" className="sr-only">
          Ask the business a question
        </label>
        <textarea
          id="conductor-ask"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          rows={2}
          placeholder="Ask what the business is actually doing, what needs attention, or what should happen next."
          className="w-full resize-none rounded-xl border border-border bg-background px-4 py-3.5 text-[16px] leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-royal sm:text-[17px]"
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12px] text-muted-foreground">
            Reads every room you are authorised to see. Changes nothing on its own.
          </p>
          <TTButton type="submit" disabled={thinking || question.trim().length === 0}>
            {thinking ? "Reading the suite" : "Ask"}
          </TTButton>
        </div>
      </form>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
        {CONDUCTOR_OPENERS.map((opener) => (
          <button
            key={opener}
            type="button"
            disabled={thinking}
            onClick={() => void ask(opener)}
            className="rounded-full border border-border bg-background px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:border-royal hover:text-foreground disabled:opacity-50"
          >
            {opener}
          </button>
        ))}
      </div>
    </section>
  );
}
