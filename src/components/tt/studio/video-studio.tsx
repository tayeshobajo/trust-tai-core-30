import { FeaturedImageReview } from "./featured-image";
import { StudioSectionNav } from "./studio-shell";
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  Clapperboard,
  FileText,
  GripVertical,
  Image,
  Layers,
  Lightbulb,
  MoreHorizontal,
  Pencil,
  PenTool,
  Play,
  Plus,
  Search,
  Sparkles,
  Target,
  Video,
  X,
  Zap,
} from "lucide-react";
import { AppShell } from "@/components/tt/app-shell";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { WorkspaceIdentity } from "@/lib/workspace";
import "./video-studio.css";

export interface VideoDraft {
  id: string;
  title: string;
  goal: string;
  message: string;
  points: string[];
}
const starter: VideoDraft = {
  id: "starter-belief",
  title: "Belief Without Control",
  goal: "Help viewers see that they can believe in themselves and take meaningful action without needing to control every outcome.",
  message:
    "You can have full agency in your actions, without needing to have full control of the result.",
  points: [
    "What believing in yourself really means.",
    "The difference between agency and control.",
    "A real example from your journey (e.g., a project, speaking, or business decision).",
    "One practical action viewers can take today.",
  ],
};
const topics = [
  {
    title: "When a New Idea Comes In...",
    description: "Turning ideas into progress without overwhelming the system.",
    image: "idea",
    message: "Give your next idea one clear next step before adding another tool.",
  },
  {
    title: "The Project Owner Effect",
    description: "How your energy and decisions shape the entire project.",
    image: "owner",
    message: "Ownership starts with the decisions you make and the example you set.",
  },
  {
    title: "Simple Systems, Bigger Outcomes",
    description: "Why focus beats more tools.",
    image: "systems",
    message: "Build a simple system around the outcome that matters most.",
  },
];
function validDraft(value: unknown): value is VideoDraft {
  if (!value || typeof value !== "object") return false;
  const d = value as VideoDraft;
  return (
    [d.id, d.title, d.goal, d.message].every((v) => typeof v === "string") &&
    Array.isArray(d.points) &&
    d.points.every((v) => typeof v === "string")
  );
}
export function VideoStudio({ identity }: { identity?: WorkspaceIdentity }) {
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<VideoDraft>(starter);
  const [saved, setSaved] = useState<VideoDraft[]>([]);
  const [plan, setPlan] = useState<string[]>([]);
  const [completed, setCompleted] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [storageReadable, setStorageReadable] = useState(true);
  const [dialog, setDialog] = useState<
    "edit" | "new" | "notes" | "guide" | "broll" | "topics" | null
  >(null);
  const [editing, setEditing] = useState<VideoDraft>(starter);
  const [week, setWeek] = useState(0);
  const [imageReview, setImageReview] = useState(false);
  const imageTrigger = useRef<HTMLButtonElement>(null);
  const briefRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const key = `trusttai:studio-video:v1:${identity?.organizationId ?? "preview"}:${identity?.userId ?? "preview"}`;
  useEffect(() => {
    setLoaded(false);
    setStorageReadable(true);
    setSaved([]);
    setPlan([]);
    setCompleted([]);
    setDraft(starter);
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const data = JSON.parse(raw);
        if (
          !Array.isArray(data.drafts) ||
          !data.drafts.every(validDraft) ||
          !Array.isArray(data.plan) ||
          !data.plan.every((v: unknown) => typeof v === "string") ||
          !Array.isArray(data.completed) ||
          !data.completed.every((v: unknown) => typeof v === "string")
        )
          throw new Error("Invalid saved data");
        setSaved(data.drafts);
        setPlan(data.plan);
        setCompleted(data.completed);
        if (data.drafts[0]) setDraft(data.drafts[0]);
      }
    } catch {
      setStorageReadable(false);
      setNotice("Saved drafts could not be read. Your existing device data has not been changed.");
    }
    setLoaded(true);
  }, [key]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.key === "/" &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  function persist(drafts: VideoDraft[], nextPlan = plan, nextCompleted = completed) {
    if (!loaded) return false;
    if (!storageReadable) {
      setNotice(
        "Saving is paused because existing device data could not be read. Copy your notes before clearing this browser’s saved Studio data.",
      );
      return false;
    }
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ drafts, plan: nextPlan, completed: nextCompleted }),
      );
    } catch {
      setNotice(
        "This browser could not save your changes. Keep this page open and copy your notes before leaving.",
      );
      return false;
    }
    setSaved(drafts);
    setPlan(nextPlan);
    setCompleted(nextCompleted);
    setNotice("Saved on this device. Nothing has been published.");
    return true;
  }
  function edit(isNew = false) {
    setEditing(
      isNew
        ? { id: crypto.randomUUID(), title: "", goal: "", message: "", points: ["", "", "", ""] }
        : { ...draft, points: [...draft.points] },
    );
    setDialog(isNew ? "new" : "edit");
  }
  function chooseTopic(index: number) {
    const topic = topics[index]!;
    setDraft({
      ...starter,
      id: `starter-${index}`,
      title: topic.title,
      goal: topic.description,
      message: topic.message,
      points: [
        "Start with a moment from your own experience.",
        "Explain what changed your perspective.",
        "Share a concrete example.",
        "Leave viewers with one practical next step.",
      ],
    });
    setDialog(null);
    briefRef.current?.focus();
  }
  function addPlan(title: string) {
    if (plan.includes(title)) {
      setNotice("This topic is already in your plan.");
      return;
    }
    persist(saved, [...plan, title]);
  }
  const nav = (rail = false) => <StudioSectionNav current="Video" rail={rail} />;
  const filteredTopics = topics
    .map((topic, index) => ({ ...topic, index }))
    .filter((t) => `${t.title} ${t.description}`.toLowerCase().includes(search.toLowerCase()));
  const shownPlan = plan.length
    ? plan
    : [starter.title, topics[0]!.title, topics[1]!.title, "How to Keep Momentum When I..."];
  const dayLabel = (index: number) => {
    const date = new Date();
    date.setDate(date.getDate() + week * 7 + index);
    return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  };
  return (
    <div className="sv-root">
      <AppShell
        {...(identity ? { identity } : {})}
        canvas="studio"

        headerContent={
          <label className="sv-search">
            <Search />
            <input
              ref={searchRef}
              aria-label="Search Studio video topics and drafts"
              placeholder="Search Studio (topics, drafts, videos...)"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
            />
            <kbd>/</kbd>
          </label>
        }
      >
        <div className="sv-page">
          <header className="sv-heading">
            <div>
              <h1>
                <Video />
                Studio <span>/</span> Video
              </h1>
              <p>Turn your ideas, experiences, and perspective into focused, high-impact videos.</p>
            </div>
            <button className="sv-button sv-primary" onClick={() => edit(true)}>
              <Plus />
              New Video Brief
            </button>
          </header>
          {nav()}
          <>
            {search && (
              <p className="sv-search-summary" role="status">
                {filteredTopics.length} starter topics ·{" "}
                {saved.filter((d) => d.title.toLowerCase().includes(search.toLowerCase())).length}{" "}
                saved drafts matching “{search}”{" "}
                <button onClick={() => setSearch("")}>Clear search</button>
              </p>
            )}
            <div className="sp-video-image-bar">
              <span>Featured image · needs image</span>
              <button ref={imageTrigger} className="sv-button" onClick={() => setImageReview(true)}>
                Review featured image
              </button>
            </div>
            <Dialog open={imageReview} onOpenChange={setImageReview}>
              <DialogContent
                className="sv-dialog sp-wide-dialog"
                onCloseAutoFocus={(e) => {
                  e.preventDefault();
                  imageTrigger.current?.focus();
                }}
              >
                <DialogHeader>
                  <DialogTitle>Video featured image</DialogTitle>
                  <DialogDescription>
                    Review a local visual preview for this brief. No asset is saved to the video.
                  </DialogDescription>
                </DialogHeader>
                <FeaturedImageReview
                  key={draft.id}
                  title={draft.title}
                  image={{
                    state: "unavailable",
                    assetUrl: null,
                    brief: draft.message,
                    altText: "",
                    provider: null,
                  }}
                />
              </DialogContent>
            </Dialog>
            <div className="sv-grid">
              <section className="sv-focus">
                <div>
                  <p className="sv-eyebrow">EXAMPLE VIDEO BRIEF</p>
                  <h2>{draft.title}</h2>
                  <p>
                    A starter brief to adapt in your own words. Saved plans stay on this device.
                  </p>
                  <div className="sv-actions">
                    <button
                      className="sv-button sv-orange"
                      onClick={() => {
                        briefRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                        briefRef.current?.focus();
                      }}
                    >
                      Open Video Brief <ArrowRight />
                    </button>
                    <button className="sv-button sv-outline" onClick={() => setDialog("topics")}>
                      See 3 more topics
                    </button>
                  </div>
                </div>
              </section>
              <div className="sv-context">
                <section className="sv-card sv-why">
                  <h2>
                    <Zap />
                    Why this topic?
                  </h2>
                  <p>
                    {draft.id.startsWith("starter")
                      ? "It aligns with your recent posts, comments, and speaking themes around belief, agency, and taking action."
                      : "This is your own idea, shaped into a brief you can review and record. Add a specific experience to make the message yours."}
                  </p>
                  <ul>
                    {(draft.id.startsWith("starter")
                      ? [
                          "Matches your Content DNA",
                          "High audience interest",
                          "Builds on your recent content",
                        ]
                      : [
                          "Starts with your own idea",
                          "Talking points you can edit",
                          "Ready for your review",
                        ]
                    ).map((text) => (
                      <li key={text}>
                        <Lightbulb />
                        <span>{text}</span>
                        <Check />
                      </li>
                    ))}
                  </ul>
                  <small className="sr-only">
                    {draft.id.startsWith("starter")
                      ? "Example rationale · not an audience analysis"
                      : "Manual brief · no audience analysis"}
                  </small>
                </section>
                <section className="sv-card sv-format">
                  <h2>
                    <Video />
                    Format
                  </h2>
                  <dl>
                    <div>
                      <dt>Length</dt>
                      <dd>~ 5 minutes</dd>
                    </div>
                    <div>
                      <dt>Style</dt>
                      <dd>Conversation / Story-led</dd>
                    </div>
                    <div>
                      <dt>Goal</dt>
                      <dd>Perspective + Action</dd>
                    </div>
                    <div>
                      <dt>Best for</dt>
                      <dd className="sv-platforms">
                        <span role="img" aria-label="LinkedIn">
                          in
                        </span>
                        <span role="img" aria-label="YouTube">
                          <Play fill="currentColor" />
                        </span>
                        <span role="img" aria-label="Short video">
                          ◎
                        </span>
                      </dd>
                    </div>
                  </dl>
                </section>
              </div>
              <section
                className="sv-card sv-brief"
                ref={briefRef}
                tabIndex={-1}
                aria-label="Video Brief"
              >
                <header>
                  <h2>
                    <Clapperboard />
                    Video Brief
                  </h2>
                  <span className="sv-badge">5-Minute Video</span>
                  <button className="sv-button" onClick={() => edit()}>
                    <Pencil />
                    Edit
                  </button>
                </header>
                <div className="sv-goal">
                  <Target />
                  <div>
                    <h3>The Goal</h3>
                    <p>{draft.goal}</p>
                  </div>
                </div>
                <div className="sv-message">
                  <Layers />
                  <div>
                    <h3>The Core Message</h3>
                    <p>{draft.message}</p>
                  </div>
                </div>
                <h3 className="sv-points-title">
                  <Video />
                  Your Talking Points (3–5)
                </h3>
                <ol className="sv-points">
                  {draft.points.map((point, i) => (
                    <li key={i}>
                      <span>{i + 1}</span>
                      <div>
                        {point}
                        <GripVertical aria-hidden />
                      </div>
                    </li>
                  ))}
                </ol>
                <footer className="sv-actions">
                  <button className="sv-button sv-primary" onClick={() => setDialog("notes")}>
                    <FileText />
                    Open Speaking Notes
                  </button>
                  <button className="sv-button" onClick={() => setDialog("guide")}>
                    <Video />
                    Record Guide
                  </button>
                  <button className="sv-button" onClick={() => setDialog("broll")}>
                    <Image />
                    Generate B-Roll Ideas
                  </button>
                  <button
                    className="sv-button sv-more"
                    aria-label="Add current brief to your plan"
                    title="Add to your plan"
                    onClick={() => addPlan(draft.title)}
                  >
                    <MoreHorizontal />
                  </button>
                </footer>
              </section>
              <aside className="sv-right">
                <section className="sv-card sv-plan">
                  <header>
                    <h2>
                      <CalendarDays />
                      Your Video Plan
                    </h2>
                    <label className="sv-week">
                      <span className="sr-only">Plan week</span>
                      <select value={week} onChange={(e) => setWeek(Number(e.target.value))}>
                        <option value={0}>This week</option>
                        <option value={1}>Next week</option>
                      </select>
                      <ChevronDown />
                    </label>
                  </header>
                  <div>
                    {week === 0 ? (
                      shownPlan.map((title, i) => (
                        <div className={`sv-plan-row ${i === 0 ? "sv-today" : ""}`} key={title}>
                          <div>
                            {i < 2 && <strong>{i === 0 ? "Today" : "Tomorrow"}</strong>}
                            <small>{dayLabel(i)}</small>
                          </div>
                          <button
                            className="sv-plan-title"
                            onClick={() => {
                              const found = saved.find((d) => d.title === title);
                              if (found) setDraft(found);
                              else if (title === starter.title) setDraft(starter);
                              else {
                                const index = topics.findIndex((t) => t.title === title);
                                if (index >= 0) chooseTopic(index);
                                else {
                                  setEditing({
                                    ...starter,
                                    id: crypto.randomUUID(),
                                    title,
                                    goal: "",
                                    message: "",
                                    points: ["", "", "", ""],
                                  });
                                  setDialog("new");
                                }
                              }
                            }}
                          >
                            {title}
                          </button>
                          <button
                            className={`sv-check ${completed.includes(title) ? "is-complete" : ""}`}
                            aria-label={`Mark ${title} ${completed.includes(title) ? "not recorded" : "recorded"}`}
                            aria-pressed={completed.includes(title)}
                            onClick={() =>
                              persist(
                                saved,
                                plan.length ? plan : shownPlan,
                                completed.includes(title)
                                  ? completed.filter((t) => t !== title)
                                  : [...completed, title],
                              )
                            }
                          >
                            {completed.includes(title) && <Check />}
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="sv-empty">No videos planned for next week.</p>
                    )}
                  </div>
                  <small>
                    {plan.length
                      ? "Your plan · saved on this device"
                      : "Example plan · choose a topic to make it yours"}
                  </small>
                </section>
                <section className="sv-card sv-topics">
                  <h2>
                    <Sparkles />
                    More Video Topics for You
                  </h2>
                  {filteredTopics.map((topic) => (
                    <div className="sv-topic" key={topic.title}>
                      <button
                        className={`sv-thumb sv-thumb-${topic.image}`}
                        aria-label={`Open ${topic.title}`}
                        onClick={() => chooseTopic(topic.index)}
                      >
                        <span>
                          <Play fill="currentColor" />
                        </span>
                      </button>
                      <button className="sv-topic-copy" onClick={() => chooseTopic(topic.index)}>
                        <strong>{topic.title}</strong>
                        <span>{topic.description}</span>
                      </button>
                      <button
                        className="sv-add"
                        aria-label={`Add ${topic.title} to plan`}
                        onClick={() => addPlan(topic.title)}
                      >
                        <Plus />
                      </button>
                    </div>
                  ))}
                  {!filteredTopics.length && <p className="sv-empty">No matching topics.</p>}
                </section>
              </aside>
            </div>
            <p className="sv-disclosure">
              Starter examples from your mockup. Video drafts and plans are saved only on this
              device; curation, publishing, and learning from edits are not connected.
            </p>
            {saved.length > 0 && (
              <section className="sv-card sv-saved">
                <h2>Saved video briefs</h2>
                {saved
                  .filter((d) => d.title.toLowerCase().includes(search.toLowerCase()))
                  .map((d) => (
                    <button className="sv-button" key={d.id} onClick={() => setDraft(d)}>
                      {d.title}
                      <ArrowRight />
                    </button>
                  ))}
              </section>
            )}
          </>
          {notice && (
            <div className="sv-notice" role="status">
              {notice}
              <button aria-label="Dismiss notification" onClick={() => setNotice("")}>
                <X />
              </button>
            </div>
          )}
        </div>
        <Dialog
          open={dialog !== null}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        >
          <DialogContent className="sv-dialog">
            <DialogHeader>
              <DialogTitle>
                {dialog === "new"
                  ? "New Video Brief"
                  : dialog === "edit"
                    ? "Edit Video Brief"
                    : dialog === "notes"
                      ? "Speaking Notes"
                      : dialog === "guide"
                        ? "Record Guide"
                        : dialog === "topics"
                          ? "More Video Topics for You"
                          : "B-Roll Ideas"}
              </DialogTitle>
              <DialogDescription>
                {dialog === "new" || dialog === "edit"
                  ? "Save a draft on this device. Nothing is published or synced."
                  : "A starting point you can adapt to your own experience."}
              </DialogDescription>
            </DialogHeader>
            {dialog === "new" || dialog === "edit" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const clean = {
                    ...editing,
                    title: editing.title.trim(),
                    points: editing.points.map((p) => p.trim()).filter(Boolean),
                  };
                  if (!clean.title || !clean.points.length) {
                    setNotice("Add a title and at least one talking point.");
                    return;
                  }
                  if (persist([clean, ...saved.filter((d) => d.id !== clean.id)])) {
                    setDraft(clean);

                    setDialog(null);
                  }
                }}
              >
                <label>
                  Title
                  <input
                    required
                    maxLength={180}
                    value={editing.title}
                    onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                  />
                </label>
                <label>
                  The Goal
                  <textarea
                    required
                    value={editing.goal}
                    onChange={(e) => setEditing({ ...editing, goal: e.target.value })}
                  />
                </label>
                <label>
                  The Core Message
                  <textarea
                    required
                    value={editing.message}
                    onChange={(e) => setEditing({ ...editing, message: e.target.value })}
                  />
                </label>
                <label>
                  Talking points (one per line)
                  <textarea
                    required
                    rows={5}
                    value={editing.points.join("\n")}
                    onChange={(e) =>
                      setEditing({ ...editing, points: e.target.value.split("\n").slice(0, 5) })
                    }
                  />
                </label>
                <div className="sv-actions">
                  <button type="submit" className="sv-button sv-primary">
                    Save brief on this device
                  </button>
                  <button type="button" className="sv-button" onClick={() => setDialog(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : dialog === "topics" ? (
              <div className="sv-dialog-topics">
                {topics.map((t, i) => (
                  <button className="sv-button" key={t.title} onClick={() => chooseTopic(i)}>
                    {t.title}
                    <ArrowRight />
                  </button>
                ))}
              </div>
            ) : (
              <div className="sv-notes">
                <h3>{draft.title}</h3>
                {dialog === "notes" ? (
                  <>
                    <p>{draft.goal}</p>
                    <blockquote>{draft.message}</blockquote>
                    <ol>
                      {draft.points.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ol>
                  </>
                ) : dialog === "guide" ? (
                  <ol>
                    <li>Choose a quiet place, face a window, and put your camera at eye level.</li>
                    <li>Record a short sound check and listen back.</li>
                    <li>Open with your core message: {draft.message}</li>
                    <li>Spend about a minute on each talking point. Speak from experience.</li>
                    <li>Close with one practical action. Review the recording before sharing.</li>
                  </ol>
                ) : (
                  <>
                    <p>
                      Suggested shots for “{draft.title}”. These are a local planning template, not
                      AI-generated footage.
                    </p>
                    <ol>
                      <li>A quiet opening shot of the place where this story happened.</li>
                      <li>A close-up of your handwritten notes or a relevant project artifact.</li>
                      <li>A short sequence illustrating: {draft.points[0]}</li>
                      <li>
                        A wide shot of you walking or reflecting, to give the central message room.
                      </li>
                      <li>A simple closing card with the action you want viewers to take.</li>
                    </ol>
                  </>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </AppShell>
    </div>
  );
}
