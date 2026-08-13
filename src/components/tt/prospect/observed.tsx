/**
 * Everything Scout actually observed, with its provenance. Facts only.
 */

import type { ProspectCandidate } from "@/domain/scout";

import { formatChecked } from "../fit-light";
import { Disclosure, Panel, TierTag } from "./panel";

export function ObservedPanel({ candidate }: { candidate: ProspectCandidate }) {
  const { signals, source } = candidate;

  return (
    <Panel
      eyebrow="Observed"
      title="What Scout read"
      description={
        source.kind === "live_website"
          ? "Read from public pages only. No search engines, no private data."
          : "A fixed preview set. Nothing external was searched."
      }
      aside={<TierTag tier="fact" />}
    >
      <div className="space-y-5">
        <ul className="grid gap-x-8 gap-y-2.5 text-[13px] text-muted-foreground sm:grid-cols-2">
          {signals.map((signal) => (
            <li key={signal.id} className="flex gap-2.5">
              <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-border" />
              <span>
                {signal.statement}
                {signal.sourceUrl ? (
                  <>
                    {" "}
                    <a
                      href={signal.sourceUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      source
                    </a>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>

        <Disclosure summary="Provenance">
          <p className="text-[13px] text-muted-foreground">
            {source.label}
            {source.note ? ` · ${source.note}` : ""} · last read{" "}
            {formatChecked(candidate.lastCheckedAt)}
          </p>
          {source.pagesResearched?.length ? (
            <ul className="mt-2 space-y-1">
              {source.pagesResearched.map((page) => (
                <li key={page}>
                  <a
                    href={page}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="font-mono text-[11px] break-all text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {page}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </Disclosure>
      </div>
    </Panel>
  );
}
