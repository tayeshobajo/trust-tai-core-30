import React, { useState } from "react";
import { SemanticReview } from "@/components/tt/steward/semantic-review";
import type { InterpretationRun } from "@/domain/steward-semantic";
const run: InterpretationRun = {
  conversationTitle: "Fictional delivery review",
  occurredAt: "2026-10-19",
  candidateCount: 3,
  memory: { available: true, because: "Isolated fixture" },
  provider: "fixture",
  model: "fixture",
  generatedAt: "2026-10-19",
  coverage: {
    version: "full-transcript-v1",
    digest: "fixture",
    segmentsRead: 3,
    segmentsTotal: 3,
    chunks: 1,
    sourceCompleteness: "unverified",
    summary:
      "Check the invitation journey. Reported dashboard coding still needs browser verification. Release-note ownership is unresolved.",
  },
  signals: [
    {
      id: "fixture-reading",
      candidateId: "fixture-reading",
      disposition: "commitment",
      normalizedMeaning: "Check the invitation journey in a browser and record the outcome",
      ownerName: "Alex",
      ownerConfidence: "high",
      beneficiary: null,
      dueText: "through this week unless priorities change",
      dueAt: null,
      projectId: null,
      projectLabel: null,
      confidence: "moderate",
      truthTier: "inferred",
      rationale: "Full stored transcript reading; human review required.",
      dependencyOn: null,
      blockedBy: null,
      duplicateOfId: null,
      ambiguity: "Conditional timing needs clarification.",
      quote: "Yes, that is mine through this week unless priorities change.",
      at: "00:10:00",
      evidence: [],
      definitionOfDone: "Record the invitation journey result and evidence.",
      criteriaBasis: "proposed",
      timeline: {
        basis: "ambiguous",
        suggestedDate: null,
        explanation: "Keep the spoken timing; clarify the calendar date.",
      },
    },
  ],
};
export function ReviewFixture() {
  const [confirmed, setConfirmed] = useState(new Set<string>());
  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-8">
      <p className="mb-4 text-sm">Isolated fictional review · no backend writes</p>
      <h1 className="mb-6 text-2xl">Meeting deliverables</h1>
      <SemanticReview
        run={run}
        names={["Alex"]}
        confirmedKeys={confirmed}
        onConfirm={async () => setConfirmed(new Set(["fixture-reading"]))}
      />
    </div>
  );
}
