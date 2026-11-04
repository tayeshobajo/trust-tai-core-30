# RFP visual correction

Reference: Library libfile_ab0edb5aede481919d2e2034812f6db3 (1672 × 941). Inspected the materialized PNG before implementation. Based on production 12a843d5.

Restores the reference hierarchy: six colored workflow metrics, workflow tabs, compact opportunity rows with search/filter/sort, overview fact strip and summary cards, six detail tabs, and a compact action rail. Uses the existing workroom canvas without changing the shared shell. Mobile uses list → detail → back navigation.

Counts derive from actual visible opportunities and current search/type. Qualifying and review both count under Needs review; preparing and ready under In progress. Screenshot sample amounts, dates, eligibility and live discovery claims are not copied. Existing Google Doc links, private immutable file versions, approvals, submission records and append-only evidence remain available through their original operations. No database, RLS, storage, sharing, credentials or records changed.

Validation: frozen Bun install; dependency check passed; 60 focused RFP tests across five files passed with vitest.rfps.config.ts; TypeScript passed; scoped ESLint has zero errors (two React refresh warnings). Added coverage for all workflow stage counts and preservation of requirements/source evidence. Local desktop and 375px mobile screenshots inspected; mobile list and detail have no horizontal overflow. Local list axe WCAG A/AA scan returned zero violations. Browser transport subsequently disconnected, preventing the remaining tablet/reference-size and live browser checks at this point; do not describe those as passed. Unit tests cover document linking, submission minute precision, amendments, read-only controls, and keyboard tab navigation.

Presentation intentionally differs where the reference requires unavailable data: no fabricated funding amount/location/decision date or automated sync. No application is sent by recording external evidence.
