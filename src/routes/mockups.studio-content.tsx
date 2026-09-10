/**
 * MOCKUP ONLY — Studio × Website Content Intelligence.
 *
 * An isolated visual prototype for approval. It is deliberately not linked from
 * navigation, reads no production data, writes nothing, and calls no service.
 * Every value on screen comes from static demo data. `/modules/studio` is
 * untouched by this file.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { AppShell } from "@/components/tt/app-shell";
import { MetaPill, SectionHeading, TTButton, TTCard, TonePill } from "@/components/tt/primitives";
import { cn } from "@/lib/utils";
import {
  DEMO_BRIEF,
  DEMO_IMAGES,
  DEMO_IMAGE_RESTRAINT,
  DEMO_MOVE_LABEL,
  DEMO_OPENING,
  DEMO_OPPORTUNITIES,
  DEMO_SPARSE_LINE,
  type DemoConfidence,
  type DemoImage,
  type DemoOpportunity,
} from "@/data/mockups/studio-content-demo";

const TITLE = "Mockup · Studio content intelligence · Trust Tai OS";
const DESCRIPTION =
  "An isolated visual prototype of the proposed Studio experience: opportunities, brief, story spine and image plan. Demo data only.";

export const Route = createFileRoute("/mockups/studio-content")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: StudioContentMockup,
});

type Step = "opportunities" | "brief" | "opening" | "images";

const STEPS: { id: Step; label: string }[] = [
  { id: "opportunities", label: "Opportunities" },
  { id: "brief", label: "Brief" },
  { id: "opening", label: "Opening & spine" },
  { id: "images", label: "Images" },
];

function confidenceTone(confidence: DemoConfidence) {
  if (confidence === "Observed") return "good" as const;
  if (confidence === "Supported") return "active" as const;
  return "neutral" as const;
}

function percent(value: number | null) {
  return value === null ? "Not reported" : `${(value * 100).toFixed(1)}%`;
}

function position(value: number | null) {
  return value === null ? "Not reported" : value.toFixed(1);
}

function StudioContentMockup() {
  const [step, setStep] = useState<Step>("opportunities");
  const [chosenTitle, setChosenTitle] = useState<string>(DEMO_BRIEF.titles[1]!.id);
  const [dropped, setDropped] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl px-1 pb-24">
        <header className="pt-2">
          <p className="tt-eyebrow flex items-center gap-2">
            Prototype · not wired
            <span className="rounded-full border border-warning/30 bg-warning/8 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-warning">
              Example data
            </span>
          </p>
          <h1 className="tt-title-section mt-3 text-3xl">
            What the market is already asking us to write
          </h1>
          <p className="mt-3 max-w-reading text-sm text-muted-foreground">
            A visual prototype of the proposed Studio experience. Everything on this page is
            illustrative — no real search data, no drafts, nothing saved.
          </p>
        </header>

        <nav className="mt-8 flex flex-wrap gap-1 border-b border-border pb-px">
          {STEPS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setStep(entry.id)}
              className={cn(
                "rounded-t-lg px-4 py-2.5 text-sm transition",
                step === entry.id
                  ? "border-b-2 border-royal font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {entry.label}
            </button>
          ))}
        </nav>

        <div className="mt-10">
          {step === "opportunities" ? (
            <Opportunities
              dismissed={dismissed}
              onDismiss={(id) => setDismissed((current) => [...current, id])}
              onBuild={() => setStep("brief")}
            />
          ) : null}
          {step === "brief" ? (
            <Brief
              chosen={chosenTitle}
              onChoose={setChosenTitle}
              onNext={() => setStep("opening")}
            />
          ) : null}
          {step === "opening" ? <Opening onNext={() => setStep("images")} /> : null}
          {step === "images" ? (
            <Images
              dropped={dropped}
              onToggle={(id) =>
                setDropped((current) =>
                  current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
                )
              }
            />
          ) : null}
        </div>

        {step !== "opportunities" ? <FinalActions /> : null}
      </div>
    </AppShell>
  );
}

/* ----------------------------- Opportunities ---------------------------- */

function Opportunities({
  dismissed,
  onDismiss,
  onBuild,
}: {
  dismissed: string[];
  onDismiss: (id: string) => void;
  onBuild: () => void;
}) {
  const live = DEMO_OPPORTUNITIES.filter((entry) => !dismissed.includes(entry.id));

  return (
    <section>
      <SectionHeading
        eyebrow="Noticed for you"
        title="What the market is already telling us"
        description="Phrases people used to find Trust Tai, and what they might be worth. Studio noticed these; you decide whether any of them deserve a story."
      />

      <div className="divide-y divide-border rounded-2xl border border-border bg-card">
        {live.map((opportunity) => (
          <OpportunityRow
            key={opportunity.id}
            opportunity={opportunity}
            onDismiss={() => onDismiss(opportunity.id)}
            onBuild={onBuild}
          />
        ))}
        {live.length === 0 ? (
          <p className="p-8 text-sm text-muted-foreground">{DEMO_SPARSE_LINE}</p>
        ) : null}
      </div>

      <div className="mt-6 rounded-2xl border border-dashed border-border px-6 py-5">
        <p className="tt-eyebrow">How this looks on a quiet week</p>
        <p className="mt-2 text-sm text-muted-foreground">{DEMO_SPARSE_LINE}</p>
      </div>

      <p className="mt-8 max-w-reading text-sm text-muted-foreground">
        Below this section, Studio stays exactly as it is today: one command in, an editorial
        package out.
      </p>
    </section>
  );
}

function OpportunityRow({
  opportunity,
  onDismiss,
  onBuild,
}: {
  opportunity: DemoOpportunity;
  onDismiss: () => void;
  onBuild: () => void;
}) {
  const noAction = opportunity.move === "no_action";

  return (
    <article className="p-6 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-medium text-foreground">“{opportunity.phrase}”</h3>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {opportunity.window} · {opportunity.provenance}
          </p>
        </div>
        <span className="flex items-center gap-2">
          {opportunity.exampleOnly ? <TonePill tone="caution">Example data</TonePill> : null}
          <TonePill tone={confidenceTone(opportunity.confidence)} dot>
            {opportunity.confidence}
          </TonePill>
        </span>
      </div>

      <p className="mt-4 max-w-reading text-[15px] leading-relaxed text-foreground">
        {opportunity.interpretation}
      </p>

      {opportunity.overlap ? (
        <p className="mt-3 max-w-reading border-l-2 border-warning/40 pl-3 text-[13px] text-muted-foreground">
          {opportunity.overlap}
        </p>
      ) : null}

      <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
        <Stat
          label="Appearances"
          value={opportunity.impressions?.toLocaleString() ?? "Not reported"}
        />
        <Stat label="Click rate" value={percent(opportunity.ctr)} />
        <Stat label="Average position" value={position(opportunity.averagePosition)} />
      </dl>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {noAction ? (
          <MetaPill>{DEMO_MOVE_LABEL[opportunity.move]}</MetaPill>
        ) : (
          <>
            <TTButton size="sm" onClick={onBuild}>
              Build brief
            </TTButton>
            <span className="text-[13px] text-muted-foreground">
              Suggested: {DEMO_MOVE_LABEL[opportunity.move]}
            </span>
          </>
        )}
        <span className="ml-auto flex items-center gap-1">
          <TTButton size="sm" variant="quiet" onClick={onDismiss}>
            Not now
          </TTButton>
          <TTButton size="sm" variant="quiet">
            Open in Website
          </TTButton>
        </span>
      </div>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm text-foreground">{value}</dd>
    </div>
  );
}

/* --------------------------------- Brief -------------------------------- */

function Brief({
  chosen,
  onChoose,
  onNext,
}: {
  chosen: string;
  onChoose: (id: string) => void;
  onNext: () => void;
}) {
  return (
    <section className="space-y-10">
      <div>
        <p className="tt-eyebrow">Brief · “transformational advisory”</p>
        <h2 className="tt-title-section mt-3 max-w-reading text-2xl leading-snug">
          {DEMO_BRIEF.coreIdea}
        </h2>
        <p className="mt-4 max-w-reading text-[15px] leading-relaxed text-muted-foreground">
          {DEMO_BRIEF.angle}
        </p>
        <div className="mt-4">
          <TTButton size="sm" variant="quiet">
            Edit the idea
          </TTButton>
        </div>
      </div>

      <div>
        <p className="tt-eyebrow">Words people actually used</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {DEMO_BRIEF.audienceLanguage.map((phrase) => (
            <MetaPill key={phrase}>{phrase}</MetaPill>
          ))}
        </div>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Evidence of how the audience talks — not instructions to repeat back.
        </p>
      </div>

      <div>
        <SectionHeading
          title="Title candidates"
          description="Pick one, ask for another direction, or write your own."
        />
        <div className="space-y-3">
          {DEMO_BRIEF.titles.map((title) => {
            const selected = chosen === title.id;
            return (
              <button
                key={title.id}
                type="button"
                onClick={() => onChoose(title.id)}
                className={cn(
                  "block w-full rounded-2xl border p-5 text-left transition",
                  selected
                    ? "border-royal/45 bg-royal-wash"
                    : "border-border bg-card hover:border-royal/30",
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-[17px] font-medium text-foreground">{title.title}</span>
                  {selected ? <TonePill tone="active">Using this</TonePill> : null}
                </div>
                <div className="mt-3 grid gap-2 text-[13px] text-muted-foreground sm:grid-cols-3">
                  <p>
                    <span className="text-foreground/70">Familiar anchor · </span>
                    {title.familiarAnchor}
                  </p>
                  <p>
                    <span className="text-foreground/70">Fresh turn · </span>
                    {title.freshTurn}
                  </p>
                  <p>
                    <span className="text-foreground/70">Intent fit · </span>
                    {title.intentFit}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <TTButton size="sm" variant="secondary">
            Try another direction
          </TTButton>
          <TTButton size="sm" variant="quiet">
            Write my own
          </TTButton>
          <TTButton size="sm" variant="quiet" className="ml-auto" onClick={onNext}>
            Next: the opening
          </TTButton>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------- Opening + spine --------------------------- */

function Opening({ onNext }: { onNext: () => void }) {
  return (
    <section className="space-y-10">
      <div>
        <p className="tt-eyebrow">The opening</p>
        <p className="mt-4 max-w-reading font-serif text-[19px] leading-relaxed text-foreground">
          {DEMO_OPENING.paragraph}
        </p>
        <p className="mt-4 max-w-reading border-l-2 border-border pl-4 text-[13px] text-muted-foreground">
          <span className="text-foreground/70">Why this earns paragraph two · </span>
          {DEMO_OPENING.earnsParagraphTwo}
        </p>
        <div className="mt-4 flex gap-3">
          <TTButton size="sm" variant="quiet">
            Rewrite the opening
          </TTButton>
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-baseline gap-3">
          <p className="tt-eyebrow">Structure chosen · {DEMO_OPENING.structureChosen}</p>
          <p className="text-[13px] text-muted-foreground">{DEMO_OPENING.structureWhy}</p>
        </div>
        <ol className="mt-5 space-y-4 border-l border-border pl-5">
          {DEMO_OPENING.spine.map((entry) => (
            <li key={entry.step} className="relative">
              <span
                aria-hidden
                className="absolute -left-[27px] top-2 size-2 rounded-full bg-royal/50"
              />
              <p className="text-sm font-medium text-foreground">{entry.step}</p>
              <p className="max-w-reading text-[14px] text-muted-foreground">{entry.note}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-[13px] text-muted-foreground">
          A default worth arguing with, not a template.{" "}
          <button type="button" className="underline underline-offset-4">
            Choose a different shape
          </button>
        </p>
      </div>

      <TTCard className="bg-royal-wash/40">
        <p className="tt-eyebrow">What search tells us</p>
        <dl className="mt-4 grid gap-4 text-[14px] sm:grid-cols-2">
          <Line
            label="Audience language"
            value={DEMO_OPENING.searchIntelligence.audienceLanguage}
          />
          <Line label="What they want" value={DEMO_OPENING.searchIntelligence.intent} />
          <Line label="Where we stand" value={DEMO_OPENING.searchIntelligence.visibility} />
          <Line label="Source" value={DEMO_OPENING.searchIntelligence.source} />
        </dl>
      </TTCard>

      <div>
        <TTButton size="sm" variant="quiet" onClick={onNext}>
          Next: images
        </TTButton>
      </div>
    </section>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
      <dd className="mt-1 max-w-reading text-foreground">{value}</dd>
    </div>
  );
}

/* ------------------------------- Image plan ----------------------------- */

function Images({ dropped, onToggle }: { dropped: string[]; onToggle: (id: string) => void }) {
  return (
    <section>
      <SectionHeading
        eyebrow="Story image plan"
        title="Images that could strengthen this story"
        description="Each one has a job. If removing it changes nothing about how the story is understood or felt, it does not belong."
      />
      <div className="space-y-4">
        {DEMO_IMAGES.map((image) => (
          <ImageRow
            key={image.id}
            image={image}
            kept={!dropped.includes(image.id)}
            onToggle={() => onToggle(image.id)}
          />
        ))}
      </div>
      <p className="mt-6 max-w-reading text-[14px] italic text-muted-foreground">
        {DEMO_IMAGE_RESTRAINT}
      </p>
    </section>
  );
}

function ImageRow({
  image,
  kept,
  onToggle,
}: {
  image: DemoImage;
  kept: boolean;
  onToggle: () => void;
}) {
  return (
    <article
      className={cn(
        "rounded-2xl border p-6 transition",
        kept ? "border-border bg-card" : "border-dashed border-border bg-transparent opacity-60",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <TonePill tone={kept ? "active" : "neutral"}>{image.role}</TonePill>
          <span className="text-[13px] text-muted-foreground">{image.placement}</span>
        </div>
        <div className="flex items-center gap-1">
          <TTButton size="sm" variant={kept ? "quiet" : "secondary"} onClick={onToggle}>
            {kept ? "Drop" : "Keep"}
          </TTButton>
          <TTButton size="sm" variant="quiet">
            Refine
          </TTButton>
        </div>
      </div>

      <p className="mt-4 max-w-reading text-[15px] leading-relaxed text-foreground">
        {image.jobInStory}
      </p>
      <p className="mt-3 max-w-reading text-[14px] text-muted-foreground">{image.direction}</p>
      <p className="mt-3 text-[13px] text-muted-foreground">
        <span className="text-foreground/70">Alt text · </span>
        {image.alt}
      </p>
    </article>
  );
}

/* ------------------------------ Final actions --------------------------- */

function FinalActions() {
  return (
    <div className="mt-12 flex flex-wrap items-center gap-3 border-t border-border pt-6">
      <TTButton>Approve brief &amp; draft</TTButton>
      <TTButton variant="secondary">Save changes</TTButton>
      <TTButton variant="quiet">Discard</TTButton>
      <p className="ml-auto text-[13px] text-muted-foreground">
        Nothing is written or published until you approve it.
      </p>
    </div>
  );
}
