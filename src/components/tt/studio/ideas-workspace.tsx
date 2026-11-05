import { useState, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Lightbulb, Pencil, Plus, Archive } from "lucide-react";
import { StudioShell, StudioState } from "./studio-shell";
import { useStudioBriefs } from "./use-studio-library";
import { ideaBrief, isStudioIdea } from "@/domain/studio-ideas";
import { studioBriefService } from "@/data/supabase/studio-brief-service";
import type { ContentBrief } from "@/domain/content-brief";
import type { WorkspaceIdentity } from "@/lib/workspace";
export function IdeasWorkspace({ identity }: { identity: WorkspaceIdentity }) {
  const q = useStudioBriefs(identity);
  const client = useQueryClient();
  const [text, setText] = useState("");
  const [editing, setEditing] = useState<ContentBrief | null>(null);
  const [kind, setKind] = useState("Topic idea");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [archive, setArchive] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const save = useMutation({
    mutationFn: () =>
      studioBriefService.saveBrief(
        identity,
        ideaBrief(identity.organizationId, text, editing ?? undefined, kind),
      ),
    onSuccess: () => {
      setText("");
      setEditing(null);
      setNotice("Idea saved to your workspace.");
      void client.invalidateQueries({ queryKey: ["studio", "briefs"] });
    },
  });
  const discard = useMutation({
    mutationFn: (idea: ContentBrief) =>
      studioBriefService.saveBrief(identity, { ...idea, state: "discarded" }),
    onSuccess: () => {
      setArchive(null);
      void client.invalidateQueries({ queryKey: ["studio", "briefs"] });
      setNotice("Idea archived.");
    },
  });
  const ideas = (q.data?.value ?? [])
    .filter(isStudioIdea)
    .filter((i) => i.coreIdea.toLowerCase().includes(search.toLowerCase()));
  const unavailable = q.isError || q.data?.provisioned === false;
  return (
    <StudioShell
      identity={identity}
      section="Ideas"
      description="A thought is enough. Give it somewhere to land."
      search={search}
      onSearch={setSearch}
      searchLabel="Search your saved ideas"
      action={
        <button
          className="sv-button sv-primary"
          onClick={() => {
            setEditing(null);
            setText("");
            input.current?.focus();
          }}
        >
          <Plus />
          New idea
        </button>
      }
    >
      <div className="sw-ideas-layout sw-ideas-inspired">
        <section className="sv-card sw-idea-capture">
          <span className="sw-kicker">
            <Lightbulb />
            YOUR NEXT GOOD IDEA
          </span>
          <h2>What’s on your mind?</h2>
          <p>A conversation. A lesson. Something you keep coming back to.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <label className="sr-only" htmlFor="idea-thought">
              What’s on your mind?
            </label>
            <textarea
              ref={input}
              id="idea-thought"
              placeholder="Type a topic, idea, question, or a framework you want to explore…"
              value={text}
              maxLength={12000}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              required
            />
            <footer>
              <span>
                {editing ? "Editing a saved idea" : "Just your words. No format to fill out."}
              </span>
              <button
                className="sv-button sv-orange"
                disabled={save.isPending || q.isPending || unavailable || !text.trim()}
              >
                <span className="sr-only">
                  {save.isPending ? "Saving…" : editing ? "Save changes" : "Save idea"}
                </span>
                <ArrowRight />
              </button>
            </footer>
          </form>
          <div className="sw-idea-types" aria-label="Idea type">
            {[
              "Topic idea",
              "Framework / technique",
              "Question to unpack",
              "Video idea",
              "Series",
            ].map((type) => (
              <button key={type} aria-pressed={kind === type} onClick={() => setKind(type)}>
                <Lightbulb />
                {type}
              </button>
            ))}
          </div>
          {editing && (
            <button
              className="sw-text-button"
              onClick={() => {
                setEditing(null);
                setText("");
                save.reset();
              }}
            >
              Cancel edit
            </button>
          )}
          {save.isError && (
            <p className="sw-error" role="alert">
              {save.error.message} Your text is still here.
            </p>
          )}
          {notice && (
            <p className="sw-success" role="status">
              {notice}
            </p>
          )}
          <div className="sw-quiet-note">
            Saved as a draft brief in your workspace. Nothing is generated or published when you
            save.
          </div>
        </section>
      </div>
      <section className="sw-saved-ideas">
        <header className="sw-section-heading">
          <div>
            <span className="sw-kicker">KEEP THE THREAD</span>
            <h2>Your idea space</h2>
          </div>
          <span>{ideas.length} in this view</span>
        </header>
        {q.isPending ? (
          <StudioState title="Reading your saved ideas…" />
        ) : q.isError ? (
          <StudioState title="Your ideas could not be read" onRetry={() => void q.refetch()}>
            This is not an empty list. {q.error.message}
          </StudioState>
        ) : !q.data?.provisioned ? (
          <StudioState title="The workspace brief store is not available">
            Your text will stay in the composer, but cannot be saved until the existing Studio brief
            store is available.
          </StudioState>
        ) : !ideas.length ? (
          <StudioState
            title={search ? "No ideas match your search" : "Your next idea belongs here"}
          >
            {search
              ? "Try a different word."
              : "Save a thought above. It will be here when you’re ready to write."}
          </StudioState>
        ) : (
          <div className="sw-idea-grid">
            {ideas.map((idea) => (
              <article key={idea.id} className="sv-card sw-idea-card">
                <span className="sw-kicker">
                  <Lightbulb />
                  {idea.angle || "SAVED IDEA"}
                </span>
                <h3>{idea.chosenTitle}</h3>
                <p>
                  {idea.coreIdea.includes("\n")
                    ? idea.coreIdea.split("\n").slice(1).join("\n")
                    : idea.coreIdea}
                </p>
                <footer>
                  <Link
                    className="sw-text-button"
                    to="/modules/studio/posts"
                    search={{ idea: idea.id }}
                  >
                    Make a post
                    <ArrowRight />
                  </Link>
                  <button
                    aria-label={`Edit ${idea.chosenTitle}`}
                    onClick={() => {
                      setEditing(idea);
                      setKind(idea.angle || "Topic idea");
                      setText(idea.coreIdea);
                      save.reset();
                      input.current?.focus();
                      input.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                    }}
                  >
                    <Pencil />
                  </button>
                  <button
                    aria-label={`Archive ${idea.chosenTitle}`}
                    onClick={() => setArchive(idea.id)}
                  >
                    <Archive />
                  </button>
                </footer>
                {archive === idea.id && (
                  <div className="sw-inline-confirm">
                    <p>Archive this idea? Existing posts will remain.</p>
                    <button
                      className="sv-button"
                      disabled={discard.isPending}
                      onClick={() => discard.mutate(idea)}
                    >
                      Archive idea
                    </button>
                    <button className="sw-text-button" onClick={() => setArchive(null)}>
                      Keep it
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
        {discard.isError && (
          <p className="sw-error" role="alert">
            {discard.error.message}
          </p>
        )}
      </section>
    </StudioShell>
  );
}
