# Studio / Video implementation specification

Reference: libfile_8366f8432d108191a40dbd9191ea99af, 1612 × 975 PNG, SHA-256 9ee5121c8d6da20f0788f93a4c8ca24b1bb7d0c48063758d836bd6391b3fe0c7.

Measured geometry: header 63px, sidebar 220px; content left 244px, right 1597px; title y84, tabs y160, rule y200. Banner 918×202 at (244,226); right column 416px; 19px gutters. Lower left card 284px; brief 616px. Cards have 13px corners, 1px pale gray borders and restrained shadows. Desktop layout: 284:616:416 columns. At narrower widths the brief stays with its context; plan and suggestions stack below. Mobile becomes one column, horizontal section navigation, accessible suite drawer.

Tokens (sampled/visually inferred from raster): paper #fcfaf9; card #fffefe; ink #101329; body #171820; muted #61616c; border #e6e3e9; accent #b34707; deep accent #51250f; pale accent #fcebdc; icon gold #af7106. Type: reference resembles a neutral sans; use Arial/system sans locally, Georgia bold for hero. H1 28/34 700, hero 34/40 700, card 20/26 700, body 14/20, small 12/18, micro 10px monospace with 0.14em tracking. Shadows 0 3px 12px rgba(30,20,10,.035). Focus ring 2px accent; hover pale accent.

Tree: VideoStudio > AppShell (opt-in studio canvas) > StudioHeading + StudioSectionNav > VideoWorkspace > VideoFocus, TopicContext, VideoFormat, EditableVideoBrief, VideoPlan, TopicSuggestions; BriefDialog for manual creation/editing and reading notes.

State contract: video drafts and recording plan remain device-local, partitioned by organization and user; explicit storage errors. Reference topics are labeled starter examples, never claimed to be real recommendations. The existing Studio index is preserved; Video is a separate `/modules/studio/video` route. Intended tabs lacking existing dedicated screens are unavailable, not invented. No auth changes, new integrations, publication, database changes, or deployment.

Assets: clean landscape reconstructed from supplied reference via image generation; original independent photo assets unavailable. This is an acknowledged visual fidelity gap. Never distribute the complete screenshot as a public asset (it contains account identity).
