/**
 * Build from Scout: pick a qualified company that has no roadmap, confirm the
 * context Scout already knows, and start the path. Nothing Scout already holds
 * is asked for again.
 */

import { useMemo, useState } from "react";

import { CompanyMark } from "@/components/tt/company-identity";
import { TTButton, TTField, TTInput } from "@/components/tt/primitives";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ProspectCandidate } from "@/domain/scout";
import { cn } from "@/lib/utils";

export function BuildFromScoutPanel({
  candidates,
  initialCandidateId,
  loading,
  busy,
  error,
  takenProspectIds,
  onStart,
  onCancel,
}: {
  candidates: ProspectCandidate[];
  initialCandidateId?: string | null;
  loading: boolean;
  busy: boolean;
  error?: string | null;
  /** Companies that already have a roadmap: one company, one roadmap. */
  takenProspectIds?: string[];
  onStart: (candidate: ProspectCandidate, objective: string) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialCandidateId ?? null);
  const [objective, setObjective] = useState("");
  const [confirming, setConfirming] = useState(false);

  const taken = useMemo(() => new Set(takenProspectIds ?? []), [takenProspectIds]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle
      ? candidates.filter((c) => c.prospect.name.toLowerCase().includes(needle))
      : candidates;
    return list.slice(0, 12);
  }, [candidates, query]);

  const selected = candidates.find((c) => c.prospect.id === selectedId) ?? null;
  const duplicate = selected ? taken.has(selected.prospect.id) : false;

  return (
    <form
      className="rounded-xl border border-border bg-card p-5 sm:p-6"
      onSubmit={(event) => {
        event.preventDefault();
        if (!selected || duplicate) return;
        setConfirming(true);
      }}
    >
      <p className="tt-eyebrow">Build from Scout</p>
      <h2 className="mt-2 text-[17px] font-medium text-foreground">
        Which company are we building a path for?
      </h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Only qualified Scout companies without a roadmap. Identity, domain and ICP context carry
        forward automatically.
      </p>

      <div className="mt-4 space-y-3">
        <TTInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search Scout companies"
          aria-label="Search Scout companies"
        />

        {loading ? (
          <p className="text-[13px] text-muted-foreground">Reading Scout…</p>
        ) : filtered.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">
            Every qualified Scout company already has a roadmap.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {filtered.map((candidate) => {
              const active = candidate.prospect.id === selectedId;
              return (
                <li key={candidate.prospect.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(candidate.prospect.id)}
                    aria-pressed={active}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      active
                        ? "border-royal/40 bg-royal/8"
                        : "border-border bg-card hover:bg-secondary",
                    )}
                  >
                    <CompanyMark
                      name={candidate.prospect.name}
                      websiteUrl={candidate.prospect.websiteUrl || candidate.prospect.domain}
                      themeColor={candidate.identity?.themeColor ?? null}
                      logoUrl={candidate.identity?.logoUrl ?? null}
                      size="sm"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] text-foreground">
                        {candidate.prospect.name}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {candidate.evaluation.score}% ICP match
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {selected ? (
          <TTField
            label="Where should this company end up?"
            hint="One sentence. It stays a proposal until you approve it."
          >
            <TTInput
              value={objective}
              onChange={(event) => setObjective(event.target.value)}
              placeholder="A stronger, less referral-dependent acquisition system"
            />
          </TTField>
        ) : null}

        {duplicate && selected ? (
          <p className="text-[13px] text-warning">
            {selected.prospect.name} already has a roadmap. One company keeps one roadmap — open the
            existing path instead of starting a second one.
          </p>
        ) : null}

        {error ? <p className="text-[13px] text-destructive">{error}</p> : null}

        <div className="flex flex-wrap gap-2 pt-1">
          <TTButton type="submit" disabled={!selected || duplicate || !objective.trim() || busy}>
            {busy ? "Starting…" : "Create roadmap"}
          </TTButton>
          <TTButton type="button" variant="quiet" onClick={onCancel}>
            Cancel
          </TTButton>
        </div>
      </div>

      <Dialog open={confirming && Boolean(selected)} onOpenChange={(open) => setConfirming(open)}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Create this roadmap?</DialogTitle>
            <DialogDescription>
              This starts a roadmap shell from what Scout already knows. Nothing is decided or sent
              until you approve the path itself.
            </DialogDescription>
          </DialogHeader>

          {selected ? (
            <dl className="space-y-3 rounded-lg border border-border bg-secondary/40 p-4 text-[13px]">
              <div className="flex items-center gap-3">
                <CompanyMark
                  name={selected.prospect.name}
                  websiteUrl={selected.prospect.websiteUrl || selected.prospect.domain}
                  themeColor={selected.identity?.themeColor ?? null}
                  logoUrl={selected.identity?.logoUrl ?? null}
                  size="sm"
                />
                <div className="min-w-0">
                  <p className="truncate text-[14px] text-foreground">{selected.prospect.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {selected.prospect.domain || selected.prospect.websiteUrl || "No domain on file"}
                  </p>
                </div>
              </div>
              <Row label="Scout status" value={selected.prospect.status.replace(/_/g, " ")} />
              <Row label="ICP match" value={`${selected.evaluation.score}%`} />
              <Row label="Destination" value={objective.trim() || "Not stated"} />
            </dl>
          ) : null}

          <DialogFooter>
            <TTButton type="button" variant="quiet" onClick={() => setConfirming(false)}>
              Back
            </TTButton>
            <TTButton
              type="button"
              disabled={busy || !selected || duplicate}
              onClick={() => {
                if (!selected || duplicate) return;
                setConfirming(false);
                onStart(selected, objective.trim());
              }}
            >
              {busy ? "Starting…" : "Create roadmap"}
            </TTButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right text-foreground">{value}</dd>
    </div>
  );
}
