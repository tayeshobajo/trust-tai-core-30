/**
 * Sentinel, the curated watchlist.
 *
 * Two human paths, both first class: add one company by hand, or paste a list
 * and review it. A pasted list is STAGED and explicitly not saved until a
 * person saves it: duplicates and unreadable lines are shown as they are,
 * never quietly dropped and never guessed at.
 *
 * Being watched is a decision, not a score. Nothing here is researched,
 * ranked or made urgent by sitting on this list.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { Check, FileUp, Link2, Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";

import { CompanyMark } from "@/components/tt/company-identity";
import { FIT_LIGHT_LABEL, FitDot, formatChecked } from "@/components/tt/fit-light";
import { EmptyState, MetaPill, TTButton, TTInput } from "@/components/tt/primitives";
import type { ScoutLinkSearch } from "@/components/tt/scout/company-table";
import {
  approvedRows,
  existingCompanies,
  filterWatchlist,
  IMPORT_FILE_ACCEPT,
  importFileSupport,
  restageRow,
  stagedCounts,
} from "@/data/scout/watchlist";
import { LINK_KIND_LABEL, readLink, stageExtracted } from "@/data/scout/smart-import";
import { ScoutSweepStrip } from "@/components/tt/scout/sweep-strip";
import { readSource } from "@/data/supabase/scout-smart-import";
import { scoutService } from "@/data/supabase/scout-service";
import type { ProspectCandidate } from "@/domain/scout";
import {
  STAGED_STATE_LABEL,
  WATCHLIST_HONESTY_NOTE,
  type StagedCompany,
} from "@/domain/scout-watchlist";
import {
  SMART_IMPORT_FILE_HELP,
  SMART_IMPORT_LEAD,
  SMART_IMPORT_LINK_HELP,
  type SmartImportSource,
  type SmartImportStage,
} from "@/domain/scout-smart-import";
import { cn } from "@/lib/utils";
import type { WorkspaceIdentity } from "@/lib/workspace";

const STATE_TONE: Record<StagedCompany["state"], string> = {
  new: "border-success/30 bg-success/8 text-success",
  duplicate: "border-border bg-secondary text-muted-foreground",
  unreadable: "border-warning/35 bg-warning/8 text-warning",
};

export function ScoutWatchlist({
  candidates,
  identity,
  linkSearch,
}: {
  /** Every company on the board. Watched rows are read from their own marker. */
  candidates: ProspectCandidate[];
  identity: WorkspaceIdentity;
  linkSearch: ScoutLinkSearch;
}) {
  const queryClient = useQueryClient();
  const { organizationId, userId } = identity;
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [note, setNote] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [link, setLink] = useState("");
  /** What Scout is doing right now. Cleared when the read finishes. */
  const [stage, setStage] = useState<SmartImportStage | null>(null);
  /** True when the delimited reader answered because no provider did. */
  const [deterministic, setDeterministic] = useState(false);
  const [staged, setStaged] = useState<StagedCompany[] | null>(null);
  /** Where the staged batch came from, shown on the banner. Never stored. */
  const [stagedFrom, setStagedFrom] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const watched = useMemo(
    () =>
      candidates
        .filter((candidate) => candidate.watchlist)
        .sort((a, b) => (b.watchlist?.at ?? "").localeCompare(a.watchlist?.at ?? "")),
    [candidates],
  );
  const rows = useMemo(() => filterWatchlist(watched, search), [watched, search]);
  const existing = useMemo(() => existingCompanies(candidates), [candidates]);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["scout", "prospects", organizationId] });

  const addOne = useMutation({
    mutationFn: () =>
      scoutService.addToWatchlist(
        {
          name: name.trim(),
          websiteUrl: website.trim() || null,
          method: "manual",
          note: note.trim() || null,
          userLabel: identity.name,
        },
        { organizationId, userId },
      ),
    onSuccess: async (result) => {
      setName("");
      setWebsite("");
      setNote("");
      setSaved(
        result.alreadyWatched
          ? `${result.companyName} was already on the watchlist.`
          : `${result.companyName} is on the watchlist.`,
      );
      await refresh();
    },
  });

  const saveStaged = useMutation({
    mutationFn: async (batch: StagedCompany[]) => {
      for (const row of batch) {
        await scoutService.addToWatchlist(
          {
            name: row.name,
            websiteUrl: row.websiteUrl,
            method: "import",
            userLabel: identity.name,
          },
          { organizationId, userId },
        );
      }
      return batch.length;
    },
    onSuccess: async (count) => {
      discardStaged();
      setImportOpen(false);
      setSaved(`${count} ${count === 1 ? "company" : "companies"} saved to the watchlist.`);
      await refresh();
    },
  });

  const remove = useMutation({
    mutationFn: (candidate: ProspectCandidate) =>
      scoutService.removeFromWatchlist(
        { prospectId: candidate.prospect.id, companyName: candidate.prospect.name },
        { organizationId, userId },
      ),
    onSuccess: refresh,
  });

  /** Drop the staged batch. Nothing durable was ever written, so this leaves
   * no trace of the file or the paste. */
  function discardStaged() {
    setStaged(null);
    setStagedFrom(null);
    setPasted("");
    setLink("");
    setStage(null);
    setDeterministic(false);
    setImportError(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  /**
   * Hand one source to Scout. A file is read here on screen and only its text
   * is sent; a link is fetched by Scout. Either way nothing is written: what
   * comes back is staged for review.
   */
  async function readFrom(source: SmartImportSource, payload: { text?: string; link?: string }) {
    setImportError(null);
    setStaged(null);
    setStagedFrom(null);
    setStage(null);
    setDeterministic(false);
    setReading(true);
    try {
      const outcome = await readSource({
        organizationId,
        ...(payload.text ? { text: payload.text } : {}),
        ...(payload.link ? { link: payload.link } : {}),
        onStage: (next) => setStage(next),
      });
      if (outcome.companies.length === 0) {
        setImportError(`No companies could be read from ${source.label}. Nothing was staged.`);
        return;
      }
      setStaged(stageExtracted(outcome.companies, existing, source));
      setStagedFrom(source.kind === "text" ? "the pasted text" : source.label);
      setDeterministic(outcome.deterministic);
    } catch (readError) {
      setImportError((readError as Error).message);
    } finally {
      setReading(false);
      setStage(null);
    }
  }

  /** Read a chosen file. Choosing a file writes nothing anywhere. */
  async function stageFile(file: File) {
    setImportError(null);
    const support = importFileSupport(file.name);
    if (!support.readable) {
      setStaged(null);
      setStagedFrom(null);
      setImportError(support.because);
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    let text = "";
    try {
      text = await file.text();
    } catch {
      setImportError(`${file.name} could not be read. Nothing was staged.`);
      return;
    }
    if (!text.trim()) {
      setImportError(`${file.name} is empty. Nothing was staged.`);
      return;
    }
    await readFrom({ kind: "file", label: file.name }, { text });
  }

  /** Read a pasted link. Only public documents can be read. */
  async function stageLink() {
    const read = readLink(link);
    if (!read.readable) {
      setImportError(read.because);
      return;
    }
    await readFrom(
      { kind: "link", label: `${LINK_KIND_LABEL[read.kind]}: ${link.trim()}` },
      { link: link.trim() },
    );
  }

  const counts = staged ? stagedCounts(staged) : null;
  const ready = staged ? approvedRows(staged) : [];
  const error = (addOne.error ?? saveStaged.error ?? remove.error) as Error | null;

  return (
    <section className="space-y-4 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
      {/* Add a company: the first-class human path. */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-foreground">Watchlist</h2>
            <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">
              Companies a person here decided to keep an eye on. Curated only, never sourced
              automatically.
            </p>
          </div>
          <TTButton
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setImportOpen((open) => !open)}
          >
            <Sparkles aria-hidden className="size-3.5" />
            {importOpen ? "Close" : "Add from source"}
          </TTButton>
        </div>

        <form
          className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) addOne.mutate();
          }}
        >
          <label className="sr-only" htmlFor="watch-name">
            Company name
          </label>
          <TTInput
            id="watch-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Company name"
          />
          <label className="sr-only" htmlFor="watch-site">
            Website
          </label>
          <TTInput
            id="watch-site"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            placeholder="Website (optional)"
          />
          <label className="sr-only" htmlFor="watch-note">
            Why you are watching them
          </label>
          <TTInput
            id="watch-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Why you are watching them (optional)"
          />
          <TTButton type="submit" size="sm" disabled={!name.trim() || addOne.isPending}>
            {addOne.isPending ? (
              <Loader2 aria-hidden className="size-3.5 animate-spin" />
            ) : (
              <Plus aria-hidden className="size-3.5" />
            )}
            Add company
          </TTButton>
        </form>
        <p className="mt-2 text-[12px] text-muted-foreground">
          Recorded as your decision, with your name and the time. Nothing is researched or scored by
          adding a company.
        </p>

        {saved ? (
          <p
            role="status"
            aria-live="polite"
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-success/25 bg-success/8 px-3 py-2 text-[13px] text-success motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
          >
            <Check aria-hidden className="size-3.5" />
            {saved}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 text-[13px] text-destructive">
            {error.message}
          </p>
        ) : null}
      </div>

      {/* Add from source: hand Scout a source, review what it read, save explicitly. */}
      {importOpen ? (
        <div className="rounded-xl border border-border bg-card p-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-200">
          <h3 className="text-sm font-semibold text-foreground">Add from source</h3>
          <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">{SMART_IMPORT_LEAD}</p>

          {reading ? (
            <div
              role="status"
              aria-live="polite"
              className="mt-4 space-y-2 rounded-lg border border-royal/25 bg-royal/[0.04] p-4 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
            >
              {[
                { key: "reading", label: "Reading source" },
                { key: "extracting", label: "Finding companies" },
                { key: "checking", label: "Checking against Scout" },
              ].map((step) => {
                const active = stage?.stage === step.key;
                return (
                  <p
                    key={step.key}
                    className={cn(
                      "flex items-center gap-2 text-[13px] transition-colors",
                      active ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {active ? (
                      <Loader2 aria-hidden className="size-3.5 animate-spin text-royal" />
                    ) : (
                      <span aria-hidden className="size-1.5 rounded-full bg-border" />
                    )}
                    {step.label}
                  </p>
                );
              })}
            </div>
          ) : (
            <div className="mt-4 grid gap-3">
              {/* 1. Upload a file. Read on screen, only its text is sent. */}
              <div className="rounded-lg border border-border bg-cloud/50 p-3">
                <p className="text-[13px] font-medium text-foreground">Upload a file</p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <input
                    ref={fileInput}
                    id="watch-file"
                    type="file"
                    accept={IMPORT_FILE_ACCEPT}
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void stageFile(file);
                    }}
                  />
                  <TTButton
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => fileInput.current?.click()}
                  >
                    <FileUp aria-hidden className="size-3.5" />
                    Choose a file
                  </TTButton>
                  <span className="text-[12px] text-muted-foreground">
                    {SMART_IMPORT_FILE_HELP}
                  </span>
                </div>
              </div>

              {/* 2. Paste a link. Public documents only, said plainly. */}
              <div className="rounded-lg border border-border bg-cloud/50 p-3">
                <label htmlFor="watch-link" className="text-[13px] font-medium text-foreground">
                  Paste a link
                </label>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <TTInput
                    id="watch-link"
                    value={link}
                    onChange={(event) => setLink(event.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/..."
                    className="max-w-md"
                  />
                  <TTButton
                    type="button"
                    size="sm"
                    disabled={!link.trim()}
                    onClick={() => void stageLink()}
                  >
                    <Link2 aria-hidden className="size-3.5" />
                    Read this link
                  </TTButton>
                </div>
                <p className="mt-2 text-[12px] text-muted-foreground">{SMART_IMPORT_LINK_HELP}</p>
              </div>

              {/* 3. Paste text. A list or a paragraph, both are fine. */}
              <div className="rounded-lg border border-border bg-cloud/50 p-3">
                <label htmlFor="watch-paste" className="text-[13px] font-medium text-foreground">
                  Paste text
                </label>
                <textarea
                  id="watch-paste"
                  value={pasted}
                  onChange={(event) => setPasted(event.target.value)}
                  rows={4}
                  placeholder={"Northfield Dental, northfielddental.com\nacme.com"}
                  className="mt-2 w-full rounded-lg border border-input bg-card p-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <TTButton
                    type="button"
                    size="sm"
                    disabled={!pasted.trim()}
                    onClick={() =>
                      void readFrom({ kind: "text", label: "the pasted text" }, { text: pasted })
                    }
                  >
                    Read this text
                  </TTButton>
                  <span className="text-[12px] text-muted-foreground">
                    A list or a paragraph. Scout will pick out the companies.
                  </span>
                </div>
              </div>
            </div>
          )}

          {importError ? (
            <p role="alert" className="mt-3 text-[13px] text-destructive">
              {importError}
            </p>
          ) : null}

          <p className="mt-3 text-[12px] text-muted-foreground">{WATCHLIST_HONESTY_NOTE}</p>
        </div>
      ) : null}

      {staged && counts ? (
        <div className="overflow-hidden rounded-xl border border-warning/35 bg-warning/[0.04] motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-warning/25 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-warning/40 bg-warning/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-warning">
                Staged · not saved
              </span>
              <span className="text-[13px] text-muted-foreground">
                {counts.total} {counts.total === 1 ? "company" : "companies"} staged
                {stagedFrom ? ` from ${stagedFrom}` : " from the pasted list"} · {counts.ready}{" "}
                ready to save · {counts.duplicate} already on the board · {counts.unreadable} cannot
                be read
                {deterministic ? " · read line by line, no intelligence provider answered" : ""}
              </span>
            </div>
            <div className="flex gap-2">
              <TTButton
                type="button"
                size="sm"
                disabled={ready.length === 0 || saveStaged.isPending}
                onClick={() => saveStaged.mutate(ready)}
              >
                {saveStaged.isPending ? (
                  <Loader2 aria-hidden className="size-3.5 animate-spin" />
                ) : (
                  <Check aria-hidden className="size-3.5" />
                )}
                Save {ready.length} to watchlist
              </TTButton>
              <TTButton
                type="button"
                size="sm"
                variant="quiet"
                onClick={discardStaged}
                disabled={saveStaged.isPending}
              >
                Cancel
              </TTButton>
            </div>
          </div>

          <ul>
            {staged.map((row) => (
              <li
                key={row.id}
                className="grid gap-3 border-b border-warning/15 px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] sm:items-center"
              >
                <TTInput
                  aria-label={`Company name for ${row.raw}`}
                  value={row.name}
                  onChange={(event) =>
                    setStaged((current) =>
                      (current ?? []).map((entry) =>
                        entry.id === row.id
                          ? restageRow(
                              entry,
                              { name: event.target.value, websiteUrl: entry.websiteUrl },
                              existing,
                              current ?? [],
                            )
                          : entry,
                      ),
                    )
                  }
                />
                <TTInput
                  aria-label={`Website for ${row.raw}`}
                  value={row.websiteUrl ?? ""}
                  placeholder="No website"
                  onChange={(event) =>
                    setStaged((current) =>
                      (current ?? []).map((entry) =>
                        entry.id === row.id
                          ? restageRow(
                              entry,
                              { name: entry.name, websiteUrl: event.target.value },
                              existing,
                              current ?? [],
                            )
                          : entry,
                      ),
                    )
                  }
                />
                <span className="flex flex-col gap-1">
                  <span
                    className={cn(
                      "inline-flex w-fit items-center rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em]",
                      STATE_TONE[row.state],
                    )}
                  >
                    {STAGED_STATE_LABEL[row.state]}
                  </span>
                  <span className="text-[12px] text-muted-foreground">{row.because}</span>
                  {row.extraction ? (
                    <span className="flex flex-col gap-1">
                      {row.extraction.excerpt ? (
                        <span className="text-[12px] italic text-muted-foreground">
                          "{row.extraction.excerpt}"
                        </span>
                      ) : null}
                      {row.extraction.websiteConfidence === "inferred" ? (
                        <span className="w-fit rounded-full border border-border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                          Website inferred
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </span>
                <span className="flex items-center gap-2 justify-self-end">
                  {row.state === "new" ? (
                    <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={row.keep}
                        onChange={(event) =>
                          setStaged((current) =>
                            (current ?? []).map((entry) =>
                              entry.id === row.id
                                ? { ...entry, keep: event.target.checked }
                                : entry,
                            ),
                          )
                        }
                        className="size-3.5 accent-royal"
                      />
                      Keep
                    </label>
                  ) : null}
                  <button
                    type="button"
                    aria-label={`Remove ${row.name || row.raw} from this list`}
                    onClick={() =>
                      setStaged((current) => (current ?? []).filter((entry) => entry.id !== row.id))
                    }
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X aria-hidden className="size-3.5" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* The quiet background check. Refresh in place, never a new workflow. */}
      <ScoutSweepStrip candidates={candidates} identity={identity} />

      {/* The watchlist itself. */}

      <div className="flex flex-wrap items-center gap-3">
        <TTInput
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search the watchlist"
          aria-label="Search the watchlist"
          className="max-w-xs"
        />
        <MetaPill>
          {watched.length} {watched.length === 1 ? "company" : "companies"} watched
        </MetaPill>
      </div>

      {watched.length === 0 ? (
        <EmptyState
          title="Nothing is being watched yet"
          belongsHere="Add a company by hand, or hand Scout a source and review what it read before saving."
          whyItMatters={WATCHLIST_HONESTY_NOTE}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No watched company matches that search"
          belongsHere="Clear the search to see the whole watchlist."
          whyItMatters="Searching never removes a company from the watchlist."
        />
      ) : (
        <ul className="overflow-hidden rounded-xl border border-border bg-card">
          {rows.map((candidate) => {
            const marker = candidate.watchlist;
            const researched = candidate.evaluation.scoreable;
            return (
              <li
                key={candidate.prospect.id}
                className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-cloud"
              >
                <Link
                  to="/modules/scout/prospects/$prospectId"
                  params={{ prospectId: candidate.prospect.id }}
                  search={linkSearch}
                  className="flex min-w-0 flex-1 items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <CompanyMark
                    name={candidate.prospect.name}
                    websiteUrl={candidate.prospect.websiteUrl || candidate.prospect.domain}
                    themeColor={candidate.identity?.themeColor ?? null}
                    logoUrl={candidate.identity?.logoUrl ?? null}
                    size="sm"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {candidate.prospect.name}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">
                      {candidate.prospect.domain || "No website recorded"}
                    </span>
                  </span>
                </Link>

                <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
                  {researched ? (
                    <>
                      <FitDot light={candidate.evaluation.light} />
                      {FIT_LIGHT_LABEL[candidate.evaluation.light]}
                    </>
                  ) : (
                    "Not researched yet"
                  )}
                </span>

                <span className="text-[12px] text-muted-foreground">
                  {marker
                    ? `Watched by ${marker.byLabel ?? "a person here"} · ${formatChecked(marker.at)}`
                    : ""}
                </span>

                <button
                  type="button"
                  aria-label={`Stop watching ${candidate.prospect.name}`}
                  onClick={() => remove.mutate(candidate)}
                  disabled={remove.isPending}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 aria-hidden className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-[12px] leading-relaxed text-muted-foreground">{WATCHLIST_HONESTY_NOTE}</p>
    </section>
  );
}
