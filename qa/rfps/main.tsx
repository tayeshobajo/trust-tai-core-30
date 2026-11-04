import React from "react";
import { createRoot } from "react-dom/client";
import { RfpWorkspace, emptySnapshot } from "@/components/tt/rfps/workspace";
import { blankOpportunity, type Opportunity } from "@/domain/rfps";
import type { RfpService } from "@/data/supabase/rfps";
import "@/styles.css";
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
      Trust Tai / CMD · isolated component QA · no live data
    </div>
    <RfpWorkspace
      service={service}
      canWork={mode !== "readonly"}
      refresh={async () => {}}
      error={mode === "error" ? "Database not installed. No data loaded." : ""}
      loading={mode === "loading"}
      data={
        mode === "detail" || mode === "readonly"
          ? {
              ...emptySnapshot,
              opportunities: [row],
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
