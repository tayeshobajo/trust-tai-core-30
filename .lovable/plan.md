# Studio × Website Content Intelligence

Plan and mockup spec only. No implementation in this pass, no percentage change.

Product law proposed for canon (Canon 28):

> Website observes demand. Studio turns demand into a story worth remembering.
> Humans decide what gets published. Performance teaches the next story.
> Keywords are evidence of audience language, not writing instructions.

---

## A. What exists today

**Search and analytics truth already lives in Core, provider-neutral.**

- `docs/website-analytics-schema.sql` defines `website_pages`,
  `website_page_metrics_daily` (GA4-shaped: views, users, landing/engaged
  sessions, engagement seconds), and `website_search_metrics_daily`
  (Search Console-shaped: **query**, path, clicks, impressions, average
  position, device, country, per day).
- `src/lib/website-providers.server.ts` pulls GA4 and Search Console via a
  Google service account and rewrites day windows idempotently. Absent
  credentials return `configured: false` and write nothing.
- `src/routes/api/public/website.sync.ts` is the bounded job endpoint
  (`inventory | ga4 | search_console`), guarded by a database-held secret
  (`website_sync_config`), with run state in `website_provider_sync`.
- Secrets present today: `GA4_PROPERTY_ID`, `SEARCH_CONSOLE_SITE_URL`,
  `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`.
- `docs/website-sync-schema.sql` schedules **only** the inventory job. The
  GA4 and Search Console cron entries are still commented out.
- Read side: `src/data/supabase/website-analytics-service.ts` (degrades to
  "not provisioned", never to zero).
- Deterministic interpretation already written and used by the Website room's
  Search tab: `src/data/website/search.ts` — `queryRows`, `growingQueries`,
  `decliningQueries`, `highImpressionLowCtr`, `strikingDistance`,
  `competingPages`, `searchTopics`, `contentOpportunities`. Rendered in
  `src/routes/modules.website.tsx`.

**Studio today**

- `src/lib/content-engine.server.ts` — two hand-built prompt blocks
  (`PLAN_INSTRUCTIONS`, `POST_INSTRUCTIONS`) driven by one keyword plus
  request settings and voice excerpts. Reaches the model through
  `runtimeModelCaller`, but composes **no** shared retrieval bundle.
- `src/domain/content.ts` — batch/item state machine, human approval gate,
  no invented HIT score, unresolved internal links stay unresolved.
- `src/domain/content-request.ts` — deterministic interpretation of the
  person's sentence into editable chips.
- `src/lib/content-image.server.ts` — one `image_brief` + `alt_text` per
  post; `GENERATOR_IMPLEMENTED = false`, so no asset is ever claimed.
- `src/lib/content-publish.server.ts` — guarded publish plus independent
  verification of the live URL.
- UI: `src/routes/modules.studio.index.tsx`, `modules.studio.$itemId.tsx`,
  `src/components/tt/studio/composer.tsx`.
- Contract now available and unused by Studio: `src/domain/intelligence-read.ts`,
  pattern in `src/data/scout/company-read.ts`.

**Answers to the numbered questions**

1. Both sources exist and are distinct. GA4 gives page engagement only;
   **query-level phrases come from Search Console**, in
   `website_search_metrics_daily`. Assistant referrals are inferred from
   referrer, and the room already says Search Console cannot report them.
2. Query data is designed to live in **Core Supabase** (`okydosoacqdnursmmenf`),
   written server-side by the Core sync job reading Google directly. It is not
   in the Website Supabase project and is not pulled live per page view.
   Whether rows exist **right now is unverified** — credentials are set but
   the search cron is commented out. Slice 0 verifies this before anything else.
3. Ownership: Website owns observation (pages, metrics, sync run state).
   Studio owns briefs, drafts, image plans, publish. Intelligence Runtime owns
   interpretation and holds no source truth.
4. No connector and no second warehouse. Core already stores the observations;
   Studio reads them through the existing read service and a new pure
   projection. The only thing possibly missing is the schedule.
5–10. Covered in C, D and G below.

## B. Quality gaps

1. **The loop is open.** `contentOpportunities()` produces real opportunities
   that only ever render in the Website room. Studio starts from a typed
   keyword. Nothing carries an observed phrase into drafting. This is exactly
   Tai's "transformational advisory" failure mode.
2. **Prompt wrapper, not reasoning.** Studio builds strings; it never composes
   the shared retrieval bundle, so canon, prior cases, accepted corrections,
   brand positioning and existing page inventory never reach the model as
   provenance-tagged evidence.
3. **No editorial spine.** `POST_INSTRUCTIONS` asks for an article. Nothing
   encodes familiar+fresh, fluency, End → Beginning → Middle → Landing, or
   opening-paragraph law. Titles are SEO labels with no candidates.
4. **Imagery is a single sentence.** One `image_brief`, no narrative role, no
   decision about whether the story needs images at all.
5. **No outcome learning.** A published post is verified live, then forgotten.
   Search movement after publish is never compared to the opportunity.
6. **Cannibalization is computed but unused.** `competingPages()` exists and
   never reaches drafting.

## C. Proposed architecture

```text
Website (observation)          Intelligence (interpretation)     Studio (craft)
website_search_metrics_daily → content-opportunity read       → opportunity card
website_page_metrics_daily     (IntelligenceRead claims)        Build brief
website_pages                                                   brief editor
        ▲                                                       drafting
        └────────── outcome window after publish ───────────────┘
```

- **`src/data/website/content-demand.ts`** (new, pure): folds search rows,
  page rows and inventory into `ContentDemandSignal`s. Reuses the existing
  thresholds in `search.ts`; adds no new heuristics.
- **`src/data/content/opportunity-read.ts`** (new, pure): builds one
  `IntelligenceRead` per candidate subject (a query cluster or an existing
  page), using `src/domain/intelligence-read.ts`. Claims carry tier
  (`observed` for metric facts, `inferred` for coverage judgment,
  `decided` for human dismissals/corrections), `at`, evidence refs and source.
  Precedence via existing `resolveClaims()`.
- **`src/lib/content-retrieval.ts`** (new, pure, mirrors
  `comms-retrieval.ts` / `scout-retrieval.ts`): composes the shared bundle —
  observed search/engagement evidence, existing page inventory and overlaps,
  brand positioning and canon, prior accepted content cases and Tai's
  corrections from `intelligence_cases`, selected source material, capabilities,
  and honest `withheld` entries when a source cannot be read.
- **`src/lib/content-engine.server.ts`** refactor: one `brief` pass and one
  `draft` pass, both fed `bundleForModel(...)`. The brief pass returns the
  Content Opportunity Brief contract below. The draft pass consumes an
  **approved** brief only.
- Governance stays code: approval gates, publish state machine, link
  resolution, no-invention rules, image `ready` gating are untouched.

### Content Opportunity contract (pure domain, `src/domain/content-opportunity.ts`)

```ts
type OpportunityAction =
  | "new_post" | "update_existing" | "internal_link"
  | "landing_page" | "faq" | "no_action";

interface ContentOpportunity {
  id: string;                       // deterministic from subject + window
  subject: { kind: "query_cluster" | "page"; key: string; label: string };
  audienceLanguage: string[];       // observed phrasings, verbatim
  observed: {                       // never fabricated; null means unknown
    impressions: number | null; clicks: number | null;
    ctr: number | null; averagePosition: number | null;
    change: number | null; window: { start: string; end: string };
    paths: { path: string; impressions: number }[];
  };
  intent: string;                   // inferred
  action: OpportunityAction;        // inferred, with alternatives considered
  rationale: string;                // why now, in plain language
  conflicts: {                      // cannibalization / competing pages
    kind: "competing_pages" | "already_ranks" | "brand_conflict";
    detail: string; paths: string[];
  }[];
  confidence: "observed" | "supported" | "thin";  // words, not scores
  evidence: EvidenceRef[];
  decision: "open" | "brief_built" | "dismissed" | "acted";
  decidedBy?: string; decidedAt?: string; decisionNote?: string;
}
```

### Brief contract (extends what the engine already returns)

```ts
interface ContentBrief {
  coreIdea: string;
  angle: string;
  audienceLanguage: string[];
  titleCandidates: { title: string; familiarityAnchor: string;
                     freshTurn: string; intentFit: string }[];
  opening: { firstParagraph: string; whyItEarnsParagraphTwo: string };
  spine: { end: string; beginning: string; middle: string[]; landing: string;
           structureChoice: "end_first" | "other"; whyThisStructure: string };
  seo: { primaryLanguage: string[]; intent: string;
         evidence: EvidenceRef[]; overlapRisk: string | null };
  imagePlan: StoryImage[];          // 0..N, each justified
  sourceOpportunityId: string | null;
}

interface StoryImage {
  role: "hero" | "scene" | "evidence" | "contrast" | "metaphor" | "diagram";
  jobInStory: string;               // what changes if it is removed
  placement: "featured" | "after_section";
  sectionAnchor?: string;
  prompt: string;                   // brand-guardrailed
  altText: string;                  // meaning, not keywords
  state: "planned" | "approved" | "generated" | "unavailable";
}
```

Image acceptance law is enforced as a required `jobInStory` plus a refusal
instruction: if removing it changes nothing, do not propose it.

### Outcome feedback (no causality claims)

After an item reaches `verified`, a bounded read compares the observed
search/engagement window before publish with the same-length window after,
for the opportunity's paths and query cluster only. It reports
"observed change since publish", associates it with the opportunity, and
explicitly says other factors are not controlled. Stored as a case in the
existing `intelligence_cases` ledger so future briefs retrieve it.

## D. Minimal UI / mockup spec

No new page. Two changes inside existing Studio surfaces.

**1. `Opportunities` section on `/modules/studio` (above the composer, quiet)**

```text
┌ Opportunities ─────────────────────────── Read from search, 28 days ─┐
│                                                                       │
│  transformational advisory                        Observed  ·  ↑      │
│  1,240 impressions · 0.6% CTR · avg position 12 · /services           │
│  People are already finding us with this language, and the page       │
│  they land on answers a different question.                           │
│  Recommended: update existing page  ·  /services                      │
│  Conflict: /about also shows for this phrase                          │
│  Source: Search Console · 12 Aug – 8 Sep          [ Build brief ]     │
│                                                                       │
│  operating system for founders                    Supported           │
│  ...                                                     [ Build brief ]│
│                                                                       │
│  Nothing to act on yet. Search has been read; no phrase clears the    │
│  demand threshold in this window.            (honest empty state)     │
└───────────────────────────────────────────────────────────────────────┘
```

- Collapsed by default to three rows, `Show more` beneath.
- Every number is observed and labelled with its window. Unknown renders as
  "not reported", never `0`.
- Secondary actions per row: `Not now` (records a decided dismissal that
  future reads respect) and `Open in Website` (deep link, no dashboard here).
- If the search provider has never run: one line — "Search has not been read
  yet" plus the provider state, no invented rows.

**2. Brief editor — a step before drafting, reusing the composer surface**

```text
┌ Brief · transformational advisory ────────────────────────────────────┐
│ Core idea      [ editable text ]                                      │
│ Angle          [ editable text ]                                      │
│ Audience language   transformational advisory · advisory that sticks  │
│                                                                       │
│ Title                                                                 │
│  ( ) What advisory costs when it stops at advice                      │
│      familiar: "advisory" · fresh: the cost framing · intent: compare │
│  ( ) ...                          [ + write my own ]                  │
│                                                                       │
│ Opening        [ editable paragraph ]                                 │
│                                                                       │
│ Story spine    End → Beginning → Middle → Landing                     │
│  End        [ ... ]     Beginning [ ... ]                             │
│  Middle     [ ...; ... ]  Landing [ ... ]                             │
│  Structure chosen: end first. Why: the consequence is the surprise.   │
│                                                                       │
│ Evidence       Search Console, 28 days · /services page metrics       │
│                Overlap risk: /about                                   │
│                                                                       │
│ Story images                                                          │
│  hero · featured — the moment advice stops and a system starts        │
│     alt: [ ... ]                                   [ keep ] [ drop ]  │
│  evidence · after "What it cost" — the one-page decision record       │
│     alt: [ ... ]                                   [ keep ] [ drop ]  │
│  No further image earns its place in this story.                      │
│                                                                       │
│               [ Discard ]        [ Approve brief and draft ]          │
└───────────────────────────────────────────────────────────────────────┘
```

- Existing keyword-only composer flow stays exactly as it is. The brief step
  appears only when a person came from an opportunity, or opts in.
- Drafting cannot start from an unapproved brief.
- Image generation stays gated by `imageProviderStatus()`; planned images
  render as plans with an honest "no generator connected" note until wired.

## E. Studio brand and image guidelines (draft for review)

Stored as `docs/studio-visual-guidelines.md` and injected into the image
prompt builder as governance, not as free prompt text.

- Premium editorial, warm, human, intentional. Restraint over spectacle.
- Palette: cream `#FBF9F4`, deep navy `#0A0F1F`, Trust Tai blues as accent.
  Red/amber/green reserved for semantic status, never editorial decoration.
- Natural light, cinematic restraint, documentary feel. No synthetic gloss.
- Real environments, believable objects, plausible detail.
- When people represent Tai or Trust Tai, representation reflects Tai and the
  actual audience. No generic Caucasian stock as the face of Trust Tai.
- Banned: robots, glowing brains, holograms, circuitry "AI" motifs, fake
  dashboards, handshakes, anonymous laptop-at-desk filler, meaningless
  gradients, title text baked into the image unless the concept earns it.
- Featured image must read at thumbnail size and carry the core tension.
- Featured and in-body images form one visual system with distinct jobs.
- Alt text describes what the image communicates. No keyword stuffing.
- Nothing generates without human review before publish.

## F. Implementation slices, in dependency order

0. **Verify the source.** Run the `search_console` and `ga4` sync jobs once
   against production and report row counts and date coverage. If rows are
   absent, enable the two commented cron entries. Nothing downstream is built
   on an unverified source.
1. `src/data/website/content-demand.ts` + tests. Pure, no UI.
2. `src/domain/content-opportunity.ts` + `src/data/content/opportunity-read.ts`
   built on `IntelligenceRead` + tests. Pure, no UI.
3. Opportunities section in `/modules/studio` (read-only, `Build brief`
   disabled) — first visible change, matches the mockup above.
4. `src/lib/content-retrieval.ts` and the engine refactor to a bundle-fed
   brief pass. Output contract extended, drafting behaviour preserved.
5. Brief editor UI + approve-to-draft gate; `Build brief` enabled.
6. HIT editorial law and End → Beginning → Middle → Landing spine folded into
   the draft pass, replacing the ad hoc prompt lines.
7. Story Image Plan contract and per-image governance, still generator-gated.
8. Outcome window read after `verified`, written as an intelligence case.
9. Optional, later: image generation wiring when a durable store is confirmed.

Slices 1, 2, 4, 6, 8 are bounded correctness/architecture work. Slices 3, 5, 7
are the visible changes this mockup spec covers.

## G. Migrations, secrets, external APIs

- **No new tables required for slices 0–7.** Opportunities are derived per
  read; human decisions ride on the existing content and case ledgers.
- One small additive column is likely at slice 5:
  `content_items.brief jsonb not null default '{}'` (and the same for
  `content_batches` if the cluster carries a brief). Alternative is nesting
  the brief inside the existing provenance json; decide at slice 5 with the
  service in front of us.
- Slice 8 needs no schema: it writes an `intelligence_cases` row.
- Secrets: all four Google values already exist. No new secret unless image
  generation is wired, which then needs a durable public store.
- External APIs: Search Console and GA4 only, already implemented.

## H. Acceptance tests and production QA

Unit:
1. A query below `MIN_IMPRESSIONS` never becomes an opportunity.
2. A query with no rows reports `null`, never `0`.
3. A query where an existing page already ranks well returns `no_action` or
   `internal_link`, not `new_post`.
4. `competingPages` overlap surfaces as a `conflicts` entry and is never
   silently resolved.
5. A recorded human dismissal (`decided`) outranks a re-derived inference on
   the next read.
6. The draft model packet demonstrably contains the retrieval bundle, with
   corrections ordered ahead of inference.
7. Provider unread → withheld entry, honest empty state, no staged rows.
8. Brief must be approved before the draft pass runs.
9. Each proposed image carries a non-empty `jobInStory`; a plan with none is
   rejected rather than padded.
10. Outcome comparison never emits causal wording; assert the phrasing.

Production QA (Tai):
- Run the search sync, open Studio, confirm real observed phrases appear with
  real windows and that `transformational advisory` shows only if the data
  genuinely contains it.
- Build one brief, check title candidates read like Trust Tai and not like SEO
  labels, check the spine and image plan, edit and approve, draft, publish
  through the existing guarded path.

## I. Coordination with the separate Website project

- Nothing is required from the Website Lovable/Supabase project
  (`b3555ed3…` / `jqehcikzvyewijjvpszh`) for this loop. Core reads Google
  directly; the Website app never proxies search data.
- The Search Console property (`SEARCH_CONSOLE_SITE_URL`) must remain the
  verified property covering `trusttai.com`, and the Core service account must
  keep read access to it and to the GA4 property.
- The published page inventory must stay discoverable via `robots.txt` /
  sitemap so `syncPageInventory` keeps `website_pages` truthful; internal link
  resolution and cannibalization checks depend on it.
- Existing publish endpoint (`TRUST_TAI_PUBLISH_ENDPOINT`) is unchanged.

## Explicitly out of scope

No SEO dashboard inside Studio, no keyword command centre, no new scores, no
autonomous publish, no brand-strategy rewriting from search signals, no
duplicate analytics store, no percentage change.
