# Agency journey: release readiness reconciliation

Round 10 of the agency journey build. This is a reconciliation, not more
building. It states what has been proven, at what level of evidence, by whom,
and what is still open.

## Evidence levels, kept separate

| Level | What it means | Who can record it |
| --- | --- | --- |
| CODE | Rules hold in the code, proven by tests | Agent |
| SYNTHETIC | A whole flow runs on made-up data in a sandbox | Agent |
| MODEL | A real model actually produced the wording | Agent, once a run exists |
| PERSISTED | Records written to and read back from the real database | Codex |
| LIVE | Verified on a real signed-in screen | Codex |
| TEAM | Real people used it and said so | Tai and the team |

A pass at one level is never a pass at another. Nothing below is rolled up into
a single percentage, and no round of this queue counts as completion.

## Round criteria reconciliation

| Round | Criteria | Highest level reached | Open at |
| --- | --- | --- | --- |
| 1 Journey contract | A1.1–A1.5 | CODE | PERSISTED |
| 2 Preparation jobs | A2.1–A2.6 | CODE + SYNTHETIC | MODEL, PERSISTED |
| 3 Enquiry to qualification | A3.1–A3.6 | CODE | MODEL, PERSISTED, LIVE |
| 4 Conversation to discovery | A4.1–A4.6 | CODE | MODEL, PERSISTED, LIVE |
| 5 Roadmap and proposal | A5.1–A5.6 | CODE + SYNTHETIC | PERSISTED, LIVE |
| 6 Commercial close and onboarding | A6.1–A6.6 | CODE + SYNTHETIC | PERSISTED, LIVE |
| 7 Delivery and acceptance | A7.1–A7.5 CODE; A7.6 partial | CODE + SYNTHETIC | PERSISTED |
| 8 Care, review and demand | A8.1–A8.6 | CODE + SYNTHETIC | MODEL, PERSISTED, LIVE |
| 9 Daily workspace | A9.1, A9.3–A9.5 CODE; A9.2 partial; A9.6 blocked; A9.7 awaiting | CODE | UI build, LIVE, TEAM |
| 10 This reconciliation | A10.1–A10.8 below | CODE + SYNTHETIC | PERSISTED, LIVE, TEAM |

## Comms acceptance, unchanged

The Comms audit stands exactly as recorded in `docs/comms-final-audit.md`: 90
rows — PASS-LIVE 13, PASS-CODE 43, BLOCKED 27, PARTIAL-BLOCKED 2, AWAITING-TAI 3,
NOT-PERFORMED 1, N/A-SCOPE 1. No row was advanced, waived or re-labelled by any
round of this queue, and none of this work touched Comms code.

## The three preparation jobs

| Job | Trigger | Output | State |
| --- | --- | --- | --- |
| Qualification packet | A new enquiry recorded | Packet separating facts from inferences, unknowns named | Disabled everywhere; runs in the synthetic sandbox only |
| Conversation brief | A new conversation recorded | Goal, known facts, open questions, proposed commitments, one next move | Disabled everywhere; synthetic only |
| Milestone status draft | A milestone changes | Draft update with counts computed in code | Disabled everywhere; synthetic only |

Each runs once per event, returns the first result on a retry, and refuses
rather than half-writing. **Manual effort baseline, assisted effort, edit and
error rates, cost and latency are NOT measured.** No saving is claimed, because
measuring it needs real people doing real work with a real model, and neither a
baseline nor an assisted run has been recorded.

## Dependency and configuration gaps

1. `20260916130000_preparation_outputs.sql` is proposed and **not applied**.
   Everything at PERSISTED level is blocked behind it. Owner: Codex.
2. The lessons SQL proposal is **not applied**. Owner: Codex.
3. No authenticated session is available in this environment, so every LIVE row
   sits with Codex.
4. No real model run exists for any preparation job, so MODEL is empty
   throughout.
5. The Home rendering from Round 9 is not built, so the daily workspace UX
   checks cannot run.
6. Deployment scope: the full automated suite covers this project only. It
   proves nothing about anything deployed, because nothing was deployed.

## Rollout, prepared and separately reviewable

The operating guide, the role rollout, the automation inventory and the stop and
recovery behaviour are in `docs/agency-journey-operating-guide.md`. The usability
script and scorecard are in `docs/agency-journey-daily-workspace.md`. Both are
prepared for review. Nothing is scheduled, enabled, deployed, sent, published or
paid.

## Final blockers

- **Persistence.** Two SQL proposals unapplied; all PERSISTED evidence blocked.
- **Live verification.** No signed-in session here; all LIVE evidence with Codex.
- **Model quality.** No real model has written a packet, brief, status update,
  opportunity or content brief; wording quality is unproven.
- **Effort and cost.** No baseline, no assisted measurement, no latency or cost
  figures. No saving may be claimed.
- **Daily workspace UI.** Not built; usability and responsive checks cannot run.
- **Human acceptance.** Tai has not accepted voice and judgement. The team has
  not accepted usability. Both remain **Awaiting acceptance**.

**This is not 100%, and queue completion does not make it so.**
