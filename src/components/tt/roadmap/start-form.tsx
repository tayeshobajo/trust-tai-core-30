/**
 * Start a roadmap. Small input: pick something that already exists, say where
 * it should end up, add anything the system cannot see. Everything else is
 * composed from evidence we already hold.
 */

import { useMemo, useState } from "react";

import { TTButton, TTInput } from "@/components/tt/primitives";
import type { SubjectOption } from "@/data/supabase/roadmap-subjects";

export interface StartRoadmapValues {
  subject: SubjectOption;
  objective: string;
  extraContext: string;
}

export function StartRoadmapForm({
  subjects,
  loading,
  busy,
  error,
  onStart,
  onCancel,
}: {
  subjects: SubjectOption[];
  loading: boolean;
  busy: boolean;
  error?: string | null;
  onStart: (values: StartRoadmapValues) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [objective, setObjective] = useState("");
  const [extraContext, setExtraContext] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle
      ? subjects.filter((entry) => entry.label.toLowerCase().includes(needle))
      : subjects;
    return list.slice(0, 12);
  }, [subjects, query]);

  const selected = subjects.find((entry) => `${entry.kind}:${entry.id}` === selectedKey) ?? null;

  return (
    <form
      className="tt-surface p-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (!selected) return;
        onStart({ subject: selected, objective, extraContext });
      }}
    >
      <p className="tt-eyebrow">New roadmap</p>
      <h2 className="mt-2 text-lg font-semibold text-foreground">
        What are we sequencing, and where should it end up?
      </h2>
      <p className="mt-1 max-w-reading text-sm text-muted-foreground">
        Pick something already in Trust Tai. Point A is read from what is on record — you do not
        need to retype it.
      </p>

      <label className="mt-6 block">
        <span className="tt-eyebrow">Subject</span>
        <TTInput
          className="mt-2"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search clients, prospects and relationships"
          aria-label="Search subjects"
        />
      </label>

      <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-border">
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">Reading what is already on record…</p>
        ) : filtered.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            Nothing matches. Roadmap can only sequence work for a client, prospect or relationship
            that already exists.
          </p>
        ) : (
          <ul>
            {filtered.map((entry) => {
              const key = `${entry.kind}:${entry.id}`;
              const active = key === selectedKey;
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => setSelectedKey(key)}
                    aria-pressed={active}
                    className={`flex w-full items-center justify-between gap-4 border-b border-border px-4 py-3 text-left text-sm last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      active
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:bg-secondary/60"
                    }`}
                  >
                    <span className="font-medium text-foreground">{entry.label}</span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em]">
                      {entry.detail}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <label className="mt-6 block">
        <span className="tt-eyebrow">Where this should end up (Point B)</span>
        <TTInput
          className="mt-2"
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
          placeholder="e.g. A booking system their team can run without us"
        />
      </label>

      <label className="mt-5 block">
        <span className="tt-eyebrow">Anything we cannot see (optional)</span>
        <textarea
          value={extraContext}
          onChange={(event) => setExtraContext(event.target.value)}
          rows={3}
          className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Recorded as your words, not as a fact the system observed."
        />
      </label>

      {error ? <p className="mt-4 text-sm text-danger">{error}</p> : null}

      <div className="mt-6 flex flex-wrap gap-2">
        <TTButton type="submit" disabled={!selected || busy}>
          {busy ? "Drafting the walk…" : "Draft the roadmap"}
        </TTButton>
        <TTButton type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </TTButton>
      </div>
    </form>
  );
}
