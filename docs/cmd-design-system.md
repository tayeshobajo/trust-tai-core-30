# CMD interface foundation

This opt-in foundation defines action hierarchy, workflow badges and responsive page spacing. RFPs & Grants is its first adopter. Existing CMD pages and the separate Comms branch are not migrated by this change.

## Reference audit

Tai's implementation screenshot (`libfile_9822fdb848dc819189e7c41832e84a57`) used small, light status text and similar blue treatments for Preparing and Submitted. Captured had no dedicated treatment. The mockup (`libfile_66c513cb04d08191b2234b66f6f23da6`) distinguishes stages with stronger tinted backgrounds, symbols and labels. Both original images were inspected.

A sidebar CSS override also flattened every action into the same white button, overriding the existing primary style. The RFP rules now exclude the shared action component so its hierarchy and interaction states remain intact.

## Actions

Import `CmdAction` from `@/components/tt/cmd/action`. It retains TTButton's native props and pending behavior. Its default type is `button`; explicitly use `type="submit"` in forms.

```tsx
<CmdAction variant="primary" onClick={openDraft}>Upload draft</CmdAction>
<CmdAction variant="secondary" disabled={!canEdit} onClick={edit}>Edit opportunity</CmdAction>
<CmdAction variant="tertiary" pending={saving} onClick={record}>Record external submission</CmdAction>
```

| Variant | Purpose | RFP examples |
| --- | --- | --- |
| Primary | Main next action in its local section; solid blue | View proposal, Upload draft/version |
| Secondary | Related editing; blue wash and visible border | Edit opportunity, Link Google Doc |
| Tertiary | Supporting action; white with visible border | View recorded evidence, Record external submission |

Controls have at least 44px height, 14px semibold labels, distinct hover/pressed fills, and a 3px focus outline with 3px offset. Disabled and pending controls retain readable text and native disabled behavior. Reduced motion removes transitions; forced-colors mode retains boundaries and focus. Keep explanatory text for unavailable actions. Do not replace authorization checks with appearance or add page rules that flatten these states.

## Status

RFP pages use `RfpStageBadge`, which maps existing stages and labels to `CmdStatusBadge`. Other domains may use the latter with an explicit, reviewed semantic mapping. A visible label is required; symbols are decorative and hidden from assistive technology. Color never stands alone.

| Stage | Treatment |
| --- | --- |
| Captured | Slate, hollow circle |
| Qualifying | Purple, circle dot |
| Preparing | Blue, layers |
| Review | Amber, clock |
| Ready | Teal, check circle |
| Submitted | Indigo, paper plane |
| Awarded | Green, trophy |
| Declined | Rose, X circle |
| Closed | Gray, slash circle |

All nine badge text/background pairs meet 4.5:1 contrast. Status styling does not establish submission, receipt, eligibility or outcome: those remain separate data and evidence. Do not relabel real stages to match sample mockup content.

## Page spacing and Comms integration

Tokens live in `src/components/tt/cmd/tokens.css`; scoped components live in `components.css`. There are no global element resets.

| Token | Value | Usage |
| --- | --- | --- |
| `--cmd-page-gutter` | `clamp(16px, 2.2vw, 32px)` | Outer horizontal content padding |
| `--cmd-page-block-gap` | `clamp(20px, 2.4vw, 32px)` | Outer vertical content padding |
| `--cmd-page-max-width` | `1800px` | Maximum content frame width |
| `--cmd-section-gap` | `24px` | Between major content sections |
| `--cmd-panel-padding` | `clamp(16px, 1.6vw, 24px)` | Inside panels |

The optional `.cmd-page` class applies the outer frame. Apply it once inside the existing shell, replacing old outer padding rather than adding another padded wrapper. Alternatively import only the tokens and consume them in an existing page container. Keep nested panel padding distinct from outer gutters. Verify 375px and desktop widths, long labels, sidebar combinations and horizontal overflow.

Roadmaps and Conversations spacing remains owned by the separate Comms worker. Integrate these tokens after both changes are reviewed, reconcile overlapping CSS deliberately, and do not overwrite that branch. This change does not apply `.cmd-page` to those pages.

## Adoption and verification

1. Choose the main action for each section and preserve its handler and permission checks.
2. Replace only the intended controls; remove conflicting page-specific appearance overrides.
3. Map status semantics explicitly and keep text labels and truthful evidence.
4. Adopt one outer spacing frame; check mobile and desktop before merging.
5. Run the RFP Vitest suite, TypeScript, targeted lint and production build. The design test checks badge/action contrast, focus/border contrast, pending/disabled behavior and labels. The synthetic local QA catalog is available at `?mode=design`; it is not production data.

This is a reusable foundation, not a claim that every CMD component or page has been migrated. Dialogs, forms and other existing primitives remain unchanged.
