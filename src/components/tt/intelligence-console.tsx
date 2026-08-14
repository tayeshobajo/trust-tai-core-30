import { Link } from "@tanstack/react-router";
import { ArrowUp } from "lucide-react";
import { useState, type FormEvent } from "react";

import { MetaPill, TTButton } from "@/components/tt/primitives";
import { ASK_QUESTIONS } from "@/data/intelligence/derive";
import { intelligenceService } from "@/data/intelligence/service";
import { CONFIDENCE_LEVEL_LABEL } from "@/domain/confidence";
import { SIGNAL_CATEGORY_LABEL, TRUTH_TIER_LABEL, type AskAnswer } from "@/domain/signals";

const ROOM_LABEL: Record<string, string> = {
  scout: "Scout",
  comms: "Comms",
  roadmap: "Roadmap",
  projects: "Projects",
  studio: "Studio",
  activity: "Activity",
};

const WITHHELD_REASON: Record<string, string> = {
  unauthorized: "not readable for you",
  not_connected: "not connected yet",
  no_data: "nothing recorded yet",
};

/**
 * The doorway into Trust Tai Intelligence.
 *
 * Every answer is assembled from what Scout, Comms and Roadmap already hold,
 * with the room, the tier and the evidence shown. Intelligence recommends and
 * routes; the work itself always happens in the room that owns it.
 */
export function IntelligenceConsole({ organizationId }: { organizationId: string }) {
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [result, setResult] = useState<AskAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function ask(value: string) {
    const trimmed = value.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    setAsked(trimmed);
    try {
      setResult(await intelligenceService.ask(organizationId, trimmed));
    } catch {
      setResult(null);
      setError("That reading could not be completed. Nothing has been changed.");
    } finally {
      setPending(false);
    }
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
              placeholder="Ask about a company, a relationship, or what needs your attention."
              className="h-12 min-w-0 flex-1 rounded-full border border-input bg-background px-5 text-sm text-foreground placeholder:text-muted-foreground"
            />
            <TTButton type="submit" variant="signal" disabled={pending} className="shrink-0">
              {pending ? "Reading" : "Ask"}
              <ArrowUp aria-hidden />
            </TTButton>
          </div>
        </form>

        <ul className="mt-4 flex flex-wrap gap-2">
          {ASK_QUESTIONS.map((example) => (
            <li key={example.id}>
              <button
                type="button"
                onClick={() => {
                  setQuestion(example.label);
                  void ask(example.label);
                }}
                className="min-h-9 rounded-full border border-border px-3.5 py-1.5 text-left text-[13px] text-muted-foreground transition-colors duration-200 hover:bg-secondary hover:text-foreground"
              >
                {example.label}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {error ? (
        <div className="border-t border-border bg-secondary/50 p-6 text-sm text-foreground sm:p-8">
          {error}
        </div>
      ) : null}

      {result && !error ? (
        <div className="border-t border-border bg-secondary/50 p-6 sm:p-8">
          <div className="flex flex-wrap items-center gap-2">
            {result.contributingApps.length > 0 ? (
              result.contributingApps.map((app) => (
                <MetaPill key={app}>Read {ROOM_LABEL[app] ?? app}</MetaPill>
              ))
            ) : (
              <MetaPill>No room had anything to say</MetaPill>
            )}
          </div>

          <p className="mt-4 text-sm text-muted-foreground">You asked: {asked}</p>
          <p className="mt-2 text-[15px] text-foreground">{result.headline}</p>

          {result.signals.length > 0 ? (
            <ul className="mt-5 space-y-4">
              {result.signals.map((signal) => (
                <li key={signal.id} className="border-t border-border pt-4">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <MetaPill>{SIGNAL_CATEGORY_LABEL[signal.category]}</MetaPill>
                    <MetaPill>{CONFIDENCE_LEVEL_LABEL[signal.confidence]}</MetaPill>
                  </div>
                  <p className="mt-2 text-sm text-foreground">{signal.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{signal.why}</p>
                  <p className="mt-2 text-sm text-foreground">
                    <span className="text-muted-foreground">Recommended: </span>
                    {signal.recommendedNextMove}
                  </p>
                  <Link
                    to={signal.destination.route}
                    className="mt-2 inline-block text-[13px] text-foreground underline underline-offset-4"
                  >
                    {signal.destination.label}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}

          {result.blocks.length > 0 ? (
            <ul className="mt-5 space-y-3">
              {result.blocks.slice(0, 8).map((entry) => (
                <li key={entry.id} className="border-t border-border pt-3">
                  <p className="text-sm text-foreground">{entry.fact}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <MetaPill>{TRUTH_TIER_LABEL[entry.tier]}</MetaPill>
                    <MetaPill>via {ROOM_LABEL[entry.appId] ?? entry.appId}</MetaPill>
                    {entry.stalenessDays > 14 ? (
                      <MetaPill>{entry.stalenessDays} days old</MetaPill>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {result.withheld.length > 0 ? (
            <p className="mt-5 text-xs text-muted-foreground">
              Not read:{" "}
              {result.withheld
                .map(
                  (w) =>
                    `${ROOM_LABEL[w.appId] ?? w.appId} (${WITHHELD_REASON[w.reason] ?? w.reason})`,
                )
                .join(", ")}
              .
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
