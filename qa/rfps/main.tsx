import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { RfpWorkspace, emptySnapshot } from "@/components/tt/rfps/workspace";
import { blankOpportunity, stages, type Opportunity } from "@/domain/rfps";
import type { RfpService } from "@/data/supabase/rfps";
import "@/styles.css";
import { CmdAction } from "@/components/tt/cmd/action";
import { RfpStageBadge } from "@/components/tt/rfps/stage-badge";
function AuditButton() {
  const [result, setResult] = useState("");
  return (
    <>
      <button
        onClick={async () => {
          const axe = (await import("axe-core")).default;
          const report = await axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          });
          setResult(
            JSON.stringify(
              report.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })),
            ),
          );
        }}
      >
        Run accessibility audit
      </button>
      <output aria-label="Accessibility result">{result}</output>
    </>
  );
}
const mode = new URLSearchParams(location.search).get("mode");
const row = {
  ...blankOpportunity,
  id: "synthetic",
  title: "Synthetic opportunity · QA only",
  source_name: "Example issuer",
  source_url: "https://example.org",
  cycle: "Test cycle",
  kind: "grant",
  stage: "qualifying",
  source_evidence: "Synthetic test text. This is not a real opportunity.",
  source_state: "unchecked",
  requirements: "Confirm applicant eligibility and required documents.",
  owner_label: "QA owner",
  next_action: "Review source requirements",
  deadline_date: "2026-11-17",
} as Opportunity;
const service = new Proxy(
  {},
  {
    get: () => async () => {
      throw new Error("Local QA only. Nothing was saved or uploaded.");
    },
  },
) as RfpService;
createRoot(document.getElementById("root")!).render(
  <main>
    <div style={{ padding: "10px 28px", borderBottom: "1px solid var(--border)" }}>
      Trust Tai / CMD · isolated component QA · no live data <AuditButton />
    </div>
    {mode === "design" && (
      <section className="cmd-page" aria-label="CMD design system samples">
        <h2>CMD component catalog · synthetic QA only</h2>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBlock: 16 }}>
          {stages.map((stage) => (
            <RfpStageBadge stage={stage} key={stage} />
          ))}
        </div>
        {(["primary", "secondary", "tertiary"] as const).map((variant) => (
          <div
            key={variant}
            style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBlock: 16 }}
          >
            <CmdAction variant={variant}>{variant} action</CmdAction>
            <CmdAction variant={variant} disabled>
              {variant} disabled
            </CmdAction>
            <CmdAction variant={variant} pending pendingLabel="Saving…">
              Save
            </CmdAction>
          </div>
        ))}
      </section>
    )}
    <RfpWorkspace
      service={service}
      canWork={mode !== "readonly"}
      refresh={async () => {}}
      error={mode === "error" ? "Database not installed. No data loaded." : ""}
      loading={mode === "loading"}
      data={
        mode === "detail" || mode === "readonly" || mode === "design"
          ? {
              ...emptySnapshot,
              opportunities: Array.from({ length: mode === "design" ? 9 : 8 }, (_, i) => ({
                ...row,
                id: i === 0 ? row.id : `synthetic-${i}`,
                title:
                  i === 0
                    ? row.title
                    : `Synthetic ${i % 2 ? "website services RFP" : "community grant"} · QA ${i}`,
                kind: i % 2 ? ("rfp" as const) : ("grant" as const),
                stage:
                  mode === "design"
                    ? stages[i]!
                    : i % 3 === 0
                      ? ("qualifying" as const)
                      : i % 3 === 1
                        ? ("captured" as const)
                        : ("preparing" as const),
              })),
              documents: [
                {
                  id: "doc",
                  opportunity_id: row.id,
                  title: "Synthetic working proposal",
                  url: "https://docs.google.com/document/d/synthetic/edit",
                  note: "QA only",
                  created_at: "2026-01-01T00:00:00Z",
                },
              ],
              submissions: [
                {
                  id: "submission",
                  opportunity_id: row.id,
                  submitted_at: "2026-01-01T00:00:00Z",
                  channel: "Synthetic portal",
                  reference: "",
                  evidence_url: "",
                  draft_id: null,
                  recorded_at: "2026-01-01T00:00:00Z",
                },
              ],
            }
          : emptySnapshot
      }
    />
  </main>,
);
