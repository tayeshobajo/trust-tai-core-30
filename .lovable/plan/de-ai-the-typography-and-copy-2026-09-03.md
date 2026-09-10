# De-AI the typography and copy

Client feedback: the serif headings, line breaks, sizing, and em dashes read as AI-generated. Fix the type system and strip em dashes everywhere.

## 1. New type system

Replace Cormorant Garamond (display) and Inter (body) with a modern geometric pairing:

- Headings / display: **Sora**
- Body / interface: **Manrope**
- Mono (eyebrows, IDs, statuses): keep JetBrains Mono

Load both from Google Fonts via the root route `<link>` tags, and repoint the `--font-display` / `--font-sans` theme tokens. No component-level font classes change, so every surface picks it up at once.

## 2. Typographic tuning (the "AI feel")

Beyond the family swap:

- Headings get tighter tracking and a lower line-height (geometric sans needs less leading than a serif); remove the serif-era letter-spacing that now looks loose.
- Cap heading sizes one step down where display text currently dominates, so hero statements feel edited rather than generated.
- Set balanced wrapping on headline text so lines break on meaning instead of leaving orphan words.
- Body copy gets a slightly tighter measure and consistent leading.

## 3. Remove all em dashes

Strip em dashes from:

- Visible UI copy across routes and components
- AI prompt and system text, so generated output stops producing them
- Markdown docs

Each occurrence is rewritten by hand, not blanket-replaced: depending on the sentence it becomes a comma, a colon, a period, or a rephrase. No en-dash or double-hyphen substitutes.

## 4. Verification

- Typecheck and existing test suite green (a few tests assert copy containing em dashes and will be updated).
- Visual check of Home, Scout, Comms, and the auth screen at 1440px and 375px.
- Repo-wide scan confirming zero em dashes remain.

## Technical notes

- `src/routes/__root.tsx`: swap the Google Fonts stylesheet href.
- `src/styles.css`: `--font-display: "Sora"`, `--font-sans: "Manrope"`, plus heading tracking/leading rules in the base layer.
- Brand system note: the Trust Tai guideline names Cormorant for editorial statements. This change intentionally deviates on client feedback; the ink/paper/royal color law, spacing, and mono usage stay unchanged.
