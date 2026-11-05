# Exact-message scroll settling

The linked message was fetched and marked correctly, but ConversationEvent called scrollIntoView only when focused changed. Older history and email-body layout can move its position later; delayed saved-draft controls can also reduce the scroll pane. The one-shot effect did not react. No missing-message or ingestion change is needed for this visual defect.

The focused event now installs a local scroll anchor:
- Identifies the actual conversation scroll pane and its content, focuses the named message without scrolling, and reveals the pane once.
- Aligns the message beginning 12px below the pane edge, so tall messages open at their beginning rather than an invisible midpoint.
- Rechecks geometry via coalesced animation frames on content/target/pane resize, content mutation and image load. This covers delayed history, inline layout, draft panels and initially hidden mobile panes.
- Later adjustments move only the inner pane, not the outer page. Browser overflow anchoring is temporarily disabled in that pane to avoid competing anchors.
- Immediately releases observers and queued adjustment on wheel, touchstart, pointerdown or keydown anywhere in the document. Restores the original overflow-anchor value. Cleans up on target navigation/unmount. Does not repeatedly steal focus or pull readers back after interaction.

No changes to reads, queries, sync, provider scope, records, approvals, send handlers, permissions or access. UI component and a new DOM helper only; fictional delayed-layout QA is outside the production route tree.

Validation: 865 Comms tests in 80 files passed. Regression geometry tests cover desktop/narrow panes, delayed older content, panel shrink, same-height DOM changes, hidden-to-visible pane, tall messages, navigation cleanup and cancellation for all four input types including queued frames. Existing independently loaded target and target-switch tests still pass.

Local real-component visual fixture /qa/comms-navigation/anchor.html injects older history, a draft panel, then large earlier-body expansion across 3 delayed stages. Desktop1920 and mobile375x812 both settle with targetOffset=12px and no horizontal page overflow; screenshots confirm message heading and beginning remain visible. PageDown releases the anchor. No backend is used by this fixture.

Release checks and authenticated production verification are recorded separately in comms-anchor-release.md at the parent workspace.
