/**
 * The account brief.
 *
 * One page a Trust Tai member could take into a conversation. Every section
 * declares whether it is an observed fact, Scout's inference, or a human
 * decision, and refuses to read as finished when the evidence is thin.
 */

import type { AccountBrief } from "@/domain/scout-intel";

import { Disclosure, Panel, TierTag } from "./panel";

function briefText(brief: AccountBrief): string {
  return brief.sections
    .map((section) => {
      const sources = section.sources.length > 0 ? `\nSources: ${section.sources.join(", ")}` : "";
      const tier =
        section.tier === "fact"
          ? "observed"
          : section.tier === "inference"
            ? "inferred"
            : "decided";
      return `${section.title.toUpperCase()} (${tier})\n${section.body}${sources}`;
    })
    .join("\n\n");
}

export function AccountBriefPanel({ brief }: { brief: AccountBrief }) {
  return (
    <Panel
      eyebrow="Clear output"
      title={`Account brief · ${brief.companyName}`}
      description={
        brief.grounded
          ? "Everything Scout can defend about this company, in the order a conversation needs it."
          : "This brief is thin on purpose. Nothing has been researched yet, so there is little to defend."
      }
      aside={<TierTag tier={brief.grounded ? "fact" : "inference"} />}
    >
      <div className="space-y-5">
        {brief.sections.map((section) => (
          <div key={section.id} className="border-b border-border pb-4 last:border-b-0 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <p className="text-[13px] font-medium text-foreground">{section.title}</p>
              <TierTag tier={section.tier} />
            </div>
            <p className="mt-1 max-w-reading text-[13px] text-muted-foreground">{section.body}</p>
            {section.sources.length > 0 ? (
              <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                {section.sources.slice(0, 6).map((url) => (
                  <li key={url}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {new URL(url, "https://example.com").hostname || "source"}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}

        <Disclosure summary="Copy the brief as plain text">
          <textarea
            readOnly
            aria-label={`Account brief for ${brief.companyName} as plain text`}
            value={briefText(brief)}
            rows={12}
            className="w-full resize-y rounded-lg border border-border bg-background p-3 font-mono text-[12px] leading-relaxed text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </Disclosure>
      </div>
    </Panel>
  );
}
