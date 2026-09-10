import type { ContextResult } from "@/domain/intelligence";
import { MetaPill } from "@/components/tt/primitives";

const KIND_LABEL = {
  fact: "Observed",
  inference: "Inferred",
  recommendation: "Suggested",
} as const;

export function ContextPanel({ result }: { result: ContextResult }) {
  return (
    <aside className="tt-surface p-6" aria-label="Context from across Trust Tai">
      <p className="tt-eyebrow">Context</p>
      <h2 className="mt-2 text-base font-semibold text-foreground">What the system knows</h2>

      <ul className="mt-4 space-y-4">
        {result.facts.map((fact) => (
          <li key={fact.id} className="border-t border-border pt-4 first:border-0 first:pt-0">
            <p className="text-sm text-foreground">{fact.statement}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <MetaPill>{KIND_LABEL[fact.kind]}</MetaPill>
              <MetaPill>via {fact.provenance.appId}</MetaPill>
            </div>
          </li>
        ))}
      </ul>

      {result.withheld.length > 0 ? (
        <p className="mt-5 border-t border-border pt-4 text-xs text-muted-foreground">
          Withheld:{" "}
          {result.withheld.map((w) => `${w.appId} (${w.reason.replace("_", " ")})`).join(", ")}.
          Context is only read from apps you are authorised to see.
        </p>
      ) : null}
    </aside>
  );
}
