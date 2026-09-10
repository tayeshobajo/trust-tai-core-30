# Trust Tai OS. Experience System

This document sets the experience philosophy every Trust Tai internal app inherits.
It sits **under** the Trust Tai Brand Guideline and the simplicity law:

> Small input. Deep intelligence. Clear output.

Nothing here may override brand tokens, voice, or restraint. Where this document
and the brand system disagree, the brand system wins.

We borrow a small number of ideas from game design, orientation, worldbuilding,
progression, feedback, curiosity, agency, because they are how people stay
oriented inside a system over time. We do not borrow game *mechanics*. No XP,
coins, streaks, leaderboards, badges, confetti, or pressure loops. Ever.

---

## 1. Worldbuilding, one world, many rooms

Trust Tai OS is one place. Each registered app is a **room** in it, not a
separate product with its own brand.

- Every app has a motif, a single tonal accent, and a character line
  (`src/domain/app-theme.ts`).
- Optional art-directed photography per app is declared in
  `src/domain/app-imagery.ts` and rendered by `AppArtwork`.
- Cards in the suite are **portals**: framed artwork, the room's name, its
  status, and an explicit "Enter {Room}" affordance.
- Artwork is atmosphere. It lives in its own frame beside copy, never as
  wallpaper behind dense text, never at the cost of contrast.

## 2. Daily return loop

Every visit should answer, before scrolling: *what changed, what needs me, what
is the one next move.*

- `Welcome, {Name}` uses the authenticated user, not a placeholder.
- `TodayPanel` shows exactly three things: changes since last visit, the single
  thing needing attention, and one recommended next move.
- Anything the system worked out rather than observed is labelled
  (`Inferred by intelligence`). Approved human decisions are never dressed up as
  system facts.
- Last visit is remembered locally (`useLastVisit`), this is orientation, not
  analytics or attendance tracking.

## 3. Progression

Users must always know whether they are looking at history, current work, or
something still ahead.

- Use Trust Tai language: `Current → Next → Later`,
  `Signal → Decision → Action → Outcome`, `Mapped / In build / Live`.
- `JourneySpine` renders one spine per screen at most. Behind you, Now, Later.
- Progress is a description of reality, not a reward. There is no completion
  score and nothing to "level up".

## 4. Meaningful feedback

An action must visibly change the world and say what it released.

- Resolving a decision transitions the card's status, replaces the actions with
  a calm confirmation, and states **what it unlocks next**.
- Deferring is a legitimate outcome and is stated plainly, including its cost.
- Transitions use brand motion: 180–480ms, fade and rise only.
  `prefers-reduced-motion` is respected.

## 5. Curiosity

Curiosity is environmental storytelling, not notification pressure.

- "New since your last visit" surfaces at most three real signals from the
  shared activity stream, each with provenance and observed/inferred labelling.
- Silence is a valid, calm state: "The world has been quiet."
- No badge counts, no red dots, no unread pressure.

## 6. Agency

The person is the one with judgement; the system prepares the ground.

- The intelligence prompt stays near the top of Home as the command doorway into
  the ecosystem, one input, deep retrieval, clear output.
- Decisions are separated from information and always come first.
- Every alert carries an owner and a next action. The system never decides on
  the user's behalf without saying so.

## 7. Restraint

- One dominant idea per section. One primary action per screen.
- No new navigation, dense widgets, equal-card dashboards, or control panels
  added just because data exists.
- Progressive disclosure over exposure. If a section cannot state its one idea
  in a sentence, it does not belong on the first screen.

---

## Applying this to a new Trust Tai app

Before designing screens, write down:

1. Point A, the destination, and the stages between.
2. The decisions this room must surface, and who carries each.
3. The one next move each primary screen makes obvious.
4. The room's motif, accent, character line, and (optionally) its artwork entry.
5. What "new since last visit" means in this room.

Then build the smallest coherent version. Nothing adjacent.
