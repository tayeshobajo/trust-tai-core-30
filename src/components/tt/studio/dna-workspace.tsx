import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check, HeartHandshake, Quote, ShieldCheck, BookOpen } from "lucide-react";
import { StudioShell } from "./studio-shell";
import { useStudioSources } from "./use-studio-library";
import { CONTENT_VOICE_PRINCIPLES } from "@/domain/content-voice";
import { usableAsVoice } from "@/domain/content-source";
import { checkVoice } from "@/data/voice-policy";
import type { WorkspaceIdentity } from "@/lib/workspace";
export function DnaWorkspace({ identity }: { identity: WorkspaceIdentity }) {
  const q = useStudioSources(identity);
  const [sample, setSample] = useState("");
  const [checked, setChecked] = useState<string | null>(null);
  const verdict =
    checked !== null
      ? checkVoice(checked, { register: "warm_intro", requireSignoff: false })
      : null;
  const references = (q.data?.value ?? []).filter(usableAsVoice);
  return (
    <StudioShell
      identity={identity}
      section="Content DNA"
      description="Keep the thinking clear, the voice familiar, and the writing yours."
      action={
        <Link className="sv-button sv-primary" to="/modules/studio/sources">
          <BookOpen />
          Add a voice reference
        </Link>
      }
    >
      <div className="sw-dna-layout">
        <section className="sw-dna-hero">
          <HeartHandshake />
          <div>
            <span className="sw-kicker">THE TRUST TAI VOICE</span>
            <h2>Warm. Calm. Direct.</h2>
            <p>
              Commercially intelligent, never salesy. Grounded in specific experience, with
              something useful to say.
            </p>
          </div>
          <span className="sw-badge">Existing engine policy</span>
        </section>
        <section className="sv-card sw-principles">
          <header className="sw-section-heading">
            <h2>
              <Quote />
              How your articles are guided
            </h2>
          </header>
          <p className="sw-muted">
            These are the same instructions used by the article engine, shown here without changing
            them.
          </p>
          <ol>
            {CONTENT_VOICE_PRINCIPLES.map((rule, i) => (
              <li key={rule}>
                <span>{String(i + 1).padStart(2, "0")}</span>
                <p>{rule}</p>
              </li>
            ))}
          </ol>
        </section>
        <aside className="sw-dna-aside">
          <section className="sv-card">
            <BookOpen />
            <h2>Your voice references</h2>
            {q.isPending ? (
              <p>Reading your reference library…</p>
            ) : q.isError ? (
              <p className="sw-error">
                References could not be read.{" "}
                <button onClick={() => void q.refetch()}>Try again</button>
              </p>
            ) : !q.data?.provisioned ? (
              <p>The source library is unavailable.</p>
            ) : references.length ? (
              <>
                <strong className="sw-big-number">{references.length}</strong>
                <p>Sources contain text that can help the engine follow your cadence.</p>
                <ul className="sw-mini-list">
                  {references.slice(0, 4).map((s) => (
                    <li key={s.id}>
                      <FileMark />
                      {s.label}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p>
                Your source library is empty. Capture a thought in Ideas, or add a writing example
                when you have one ready.
              </p>
            )}
            <Link to="/modules/studio/sources" className="sw-text-button">
              Manage sources
              <ArrowRight />
            </Link>
            <p className="sw-quiet-note">
              Choose references explicitly in Posts. Saved sources are not meant to influence every
              draft automatically.
            </p>
          </section>
          <section className="sv-card sw-learning-note">
            <ShieldCheck />
            <h2>Learning stays deliberate.</h2>
            <p>
              Studio does not automatically learn from edits or change this voice policy. The
              writing check below does not save or train on your text.
            </p>
            <p>Add a useful example to Sources when you want to reuse it.</p>
          </section>
        </aside>
        <section className="sv-card sw-voice-check">
          <span className="sw-kicker">A QUICK WRITING CHECK</span>
          <h2>Does this sound clear and human?</h2>
          <p>
            Check a passage against the existing Trust Tai phrase and cadence rules. This is a local
            text check, not AI scoring or an approval.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setChecked(sample);
            }}
          >
            <label className="sr-only" htmlFor="voice-sample">
              Writing to check
            </label>
            <textarea
              id="voice-sample"
              rows={5}
              value={sample}
              maxLength={20000}
              onChange={(e) => {
                setSample(e.target.value);
                setChecked(null);
              }}
              placeholder="Paste a short passage…"
            />
            <button className="sv-button sv-primary" disabled={!sample.trim()}>
              Check this passage
            </button>
          </form>
          {verdict && (
            <div className="sw-check-result" role="status">
              {verdict.violations.length ? (
                <>
                  <h3>
                    {verdict.violations.length}{" "}
                    {verdict.violations.length === 1 ? "point" : "points"} to review
                  </h3>
                  <ul>
                    {verdict.violations.map((v, i) => (
                      <li key={i}>
                        <strong>“{v.excerpt}”</strong>
                        <p>{v.because}</p>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p>
                  <Check />
                  No phrase or cadence flags found. A person still needs to review meaning and
                  accuracy.
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </StudioShell>
  );
}
function FileMark() {
  return <BookOpen size={15} aria-hidden />;
}
