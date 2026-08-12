# Scout v1

## Point A

Trust Tai finds prospective clients by memory, referral, and ad-hoc browsing.
Nothing is written down in a shared place, and nobody can say why a company was
considered a fit or who is carrying it next.

## Destination

A calm room where a plain-English description of an ideal client returns a small
set of companies, each with the evidence behind it, and one clear action.

## Primary loop

1. Describe who we are looking for in one input.
2. Scout returns a small set of candidates from the preview demo set.
3. Each candidate shows observed signals, an inferred fit reason, and a
   recommendation — labelled separately.
4. Qualify or Pass. Qualifying moves the prospect to **Ready for Comms** and
   writes a local activity event.

Small input. Deep intelligence. Clear output.

## Shared vs Scout-specific data

- **Shared** (`src/domain/entities.ts`): `Prospect` — id, organization, name,
  domain, status, optional steward and timestamps. `EntityType` gained
  `"prospect"` so activity events and future Comms can reference the same row.
- **Scout-specific** (`src/domain/scout.ts`): `ScoutSignal`, `ScoutFit`,
  `ProspectCandidate`, `ScoutProvider`. Fit evidence never enters the core model.

Persistence stays behind `TrustTaiDataSource`. Scout reads and writes through
`source.scout`, so a Supabase-backed implementation can replace the in-memory
one without touching the UI.

## What is mocked

Everything that would require a backend or an external source:

- The candidate set is a fixed in-memory list in `src/data/scout-source.ts`.
  It is labelled **Preview demo source** in the UI.
- No internet, LinkedIn, Apollo, Clay, or AI call is made. The query only
  filters and orders the demo set.
- Status changes live in memory for the session and are lost on reload.
- Fit reasons and recommendations are authored, not generated. They are labelled
  as inferred and recommended, never as observed.

## Handoff contract to future Comms

A qualified prospect emits an activity event:

```
name:    "prospect.status_changed"
subject: { type: "prospect", id, label: company name }
summary: "<Company> is qualified and ready for Comms."
```

Comms will read prospects with `status: "qualified"` from the same repository
boundary and open a conversation against the same prospect id. No prospect
record is duplicated.

## Not in v1

No filters, no CRM dashboard, no settings, no scores, no enrichment, no
outreach. Ops, Comms, Roadmap, Projects, Studio, and Pulse are untouched.
