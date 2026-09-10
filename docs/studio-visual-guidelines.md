# Studio visual guidelines

Governance documentation. Nothing here is wired to an image generator yet, and
no image is produced from these principles in the current build. They exist so
that when generation is wired, the rules are already agreed and can be enforced
in code rather than improvised inside a prompt.

## The law

If removing an image changes nothing about how the story is understood or felt,
it probably does not belong. Every planned image has to name the job it does in
the story. An image with no job is padding, and padding is removed.

## Feel

Premium editorial. Warm, human, intentional. Restraint over spectacle. The work
should look like it was made by people who thought about it, not assembled from
a stock library.

## Palette

- Cream `#FBF9F4`
- Deep navy `#0A0F1F`
- Trust Tai blues as accent

Red, amber and green are reserved for semantic status in the product. They are
never editorial decoration.

## Light and treatment

Natural light. Cinematic restraint. A documentary feel rather than a rendered
one. Real environments, believable objects, plausible detail. No synthetic
gloss, no impossible perfection.

## People

When people stand for Tai or for Trust Tai, representation reflects Tai and the
actual audience. Generic Caucasian stock imagery is not the face of Trust Tai.
Where a real person is depicted, it is a real person, with consent.

## Never

- Robots, glowing brains, holograms, circuitry as shorthand for "AI"
- Fake dashboards, invented charts, unreadable UI screenshots
- Handshakes, anonymous laptop-at-a-desk filler
- Meaningless gradients and abstract blobs
- Title text baked into the image, unless the concept genuinely earns it

## Craft standards

- The featured image must read at thumbnail size and carry the core tension of
  the piece.
- Featured and in-body images form one visual system, each with a distinct job:
  hero, scene, evidence, contrast, metaphor, diagram.
- Alt text describes what the image communicates. It is written for a person
  who cannot see it, never for a search engine.
- Nothing is generated and published without human review.

## How this is enforced

- `jobInStory` is required on every planned image (`src/domain/content-brief.ts`).
- An image plan with nothing that earns its place is an empty plan, said out
  loud, not a filled quota.
- Image state stays honest: `unavailable` names what is missing rather than
  claiming an asset that does not exist.
