/**
 * Project Chat.
 *
 * Chat is how you talk to the project. Projects remains where project truth
 * lives, so nothing said here becomes part of the record. Answers are grounded
 * in this project's own context packet, and anything pasted in is used for the
 * current turn only.
 *
 * This slice is deliberately session scoped: the conversation is held in the
 * page and is gone on reload, and the panel says so rather than implying a
 * history that does not exist.
 */

import { useState } from "react";

import { TTButton, TTInput } from "@/components/tt/primitives";

export interface ProjectChatAnswer {
  answer: string;
  facts: string[];
  interpretations: string[];
  unknowns: string[];
  nextSteps: string[];
}

export interface ProjectChatTurn {
  question: string;
  pasted: string;
  answer: ProjectChatAnswer | null;
}

function Group({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="tt-eyebrow">{title}</p>
      <ul className="mt-1 space-y-1">
        {items.map((item) => (
          <li key={item} className="text-[14px] text-muted-foreground">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChatTab({
  projectName,
  turns,
  pending,
  error,
  onAsk,
}: {
  projectName: string;
  turns: ProjectChatTurn[];
  pending: boolean;
  error: string | null;
  onAsk: (question: string, pasted: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const [pasted, setPasted] = useState("");

  return (
    <section className="space-y-4" aria-label="Project chat">
      <div className="tt-surface p-5">
        <p className="tt-eyebrow">Talk to this project</p>
        <p className="mt-2 text-[14px] text-muted-foreground">
          Answers come from what {projectName} already holds. Nothing said here changes the record:
          work, blockers, decisions and files are still changed on their own tabs.
        </p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          This chat is not saved yet. It is gone when you leave the page.
        </p>

        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!question.trim() || pending) return;
            onAsk(question.trim(), pasted.trim());
            setQuestion("");
            setPasted("");
          }}
        >
          <TTInput
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={`Ask about ${projectName}...`}
            aria-label={`Ask about ${projectName}`}
          />
          <textarea
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            aria-label="Paste context for this question"
            placeholder="Optional: paste an update, a link or a note to read for this question only."
            className="min-h-24 w-full rounded-lg border border-input bg-card p-3 text-sm text-foreground placeholder:text-muted-foreground"
          />
          <TTButton type="submit" disabled={pending || question.trim().length === 0}>
            {pending ? "Reading the project…" : "Ask"}
          </TTButton>
        </form>

        {error ? <p className="mt-3 text-[14px] text-foreground">{error}</p> : null}
      </div>

      {turns.length === 0 ? (
        <p className="text-[14px] text-muted-foreground">
          No questions asked yet in this session.
        </p>
      ) : (
        <ul className="space-y-4">
          {turns.map((turn, index) => (
            <li key={`${index}-${turn.question}`} className="tt-surface p-5">
              <p className="text-[14px] font-medium text-foreground">{turn.question}</p>
              {turn.pasted ? (
                <p className="mt-1 text-[13px] text-muted-foreground">
                  Read with pasted context, used for this answer only.
                </p>
              ) : null}
              {turn.answer === null ? (
                <p className="mt-2 text-[14px] text-muted-foreground">Waiting for an answer…</p>
              ) : (
                <>
                  <p className="mt-2 text-[14px] text-foreground">{turn.answer.answer}</p>
                  <Group title="From the record" items={turn.answer.facts} />
                  <Group title="Reading" items={turn.answer.interpretations} />
                  <Group title="Not answered here" items={turn.answer.unknowns} />
                  <Group title="You could" items={turn.answer.nextSteps} />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
