# Visual regression checks

Two layers guard the Trust Tai OS brand surface. Both read the same contract,
`src/brand/brand-contract.ts`: logo geometry, typography hierarchy, colour tokens.

## 1. Static checks (no browser)

`src/brand/brand-contract.test.ts` runs with the normal suite and fails when:

- the logo lockup's natural size or derived aspect ratio changes, a variant goes
  missing, or the shell falls back to a text lockup
- the three brand families or the display/body/eyebrow bindings drift
- any canonical colour token in `src/styles.css` changes value or disappears
- a component or route hardcodes a colour (`text-white`, `bg-[#…]`, …)
- root-route brand metadata (title, OG, Twitter, noindex) is removed

## 2. Rendered checks (headless Chromium)

`scripts/visual-regression.py` loads five screens — Auth, Home, Scout, Conductor,
Pulse — at 375, 768 and 1440 px. For each it reads computed styles and asserts
the logo loads from the official asset at the right aspect and height, every
heading/body/eyebrow uses a brand family at an in-range size, and every token
resolves to its canonical value. It then screenshots each screen and compares
against the committed baseline (0.5% pixel tolerance).

```bash
python3 scripts/visual-regression.py            # check
python3 scripts/visual-regression.py --update   # accept a deliberate change
```

Signed-out rooms render their fail-closed preview, which still carries the full
shell branding, so no session is needed. Baselines live in `.visual/baseline/`;
`.visual/current/` is scratch output.
