import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Home,
  Users,
  Map,
  Folder,
  CheckSquare,
  UserRound,
  BarChart3,
  Settings,
  ChevronDown,
  Search,
  Bell,
} from "lucide-react";
import { RelationshipRoadmapWorkspace } from "../../src/components/tt/roadmap/evidence/relationship-workspace";
import type { Roadmap } from "../../src/domain/roadmap";
import { editableValues } from "../../src/domain/roadmap-tracker-edit";
import {
  fixtureRoadmaps,
  publication,
  bindings,
  history,
  summary,
  reviews,
  readFixture,
  org,
  user,
  now,
} from "./fixtures";
import logo from "../../src/assets/brand/trust-tai-logo.png";
import "./preview.css";
export function PreviewEditor({
  roadmap,
  onDirty,
  onApply,
}: {
  roadmap: Roadmap;
  onDirty: (dirty: boolean) => void;
  onApply: (action: string, date: string) => void;
}) {
  const [action, setAction] = useState(roadmap.nextMove?.action ?? "");
  const [date, setDate] = useState(editableValues(roadmap).followUpDate ?? "");
  const dirty =
    action !== (roadmap.nextMove?.action ?? "") ||
    date !== (editableValues(roadmap).followUpDate ?? "");
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  return (
    <section className="preview-editor">
      <h3>Preview-only tracker update</h3>
      <p>Fictional in-memory changes only. Nothing is saved to CMD.</p>
      <label>
        Next action
        <textarea value={action} onChange={(e) => setAction(e.target.value)} />
      </label>
      <label>
        Follow-up date
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <button disabled={!dirty} onClick={() => onApply(action, date)}>
        Apply to fictional preview
      </button>
      <button
        disabled={!dirty}
        onClick={() => {
          setAction(roadmap.nextMove?.action ?? "");
          setDate(editableValues(roadmap).followUpDate ?? "");
        }}
      >
        Discard preview draft
      </button>
    </section>
  );
}
export function Preview() {
  const [roadmaps, setRoadmaps] = useState(fixtureRoadmaps);
  return (
    <>
      <div className="preview-notice">LOCAL PREVIEW · FICTIONAL DATA · NO SENDS OR LIVE WRITES</div>
      <header className="preview-header">
        <img src={logo} alt="Trust Tai" />
        <span>Command Center</span>
        <div />
        <Search size={19} />
        <Bell size={19} />
        <span className="preview-wordmark">TRUST TAI</span>
        <span className="preview-profile">M</span>
        <strong>Morgan</strong>
        <ChevronDown size={14} />
      </header>
      <div className="preview-layout">
        <aside className="preview-nav">
          <nav>
            {[
              { icon: Home, label: "Home" },
              { icon: Users, label: "Clients" },
              { icon: Map, label: "Roadmaps" },
              { icon: Folder, label: "Projects" },
              { icon: CheckSquare, label: "Tasks" },
              { icon: UserRound, label: "Team" },
              { icon: BarChart3, label: "Reports" },
              { icon: Settings, label: "Settings" },
            ].map(({ icon: Icon, label }) => (
              <span key={label} className={label === "Roadmaps" ? "active" : ""}>
                <Icon size={18} />
                {label}
              </span>
            ))}
          </nav>
          <div className="preview-nav-card">
            <strong>Roadmaps</strong>
            <p>Turn conversations into meaningful opportunities.</p>
            <small>Fictional local preview</small>
          </div>
        </aside>
        <main>
          <RelationshipRoadmapWorkspace
            organizationId={org}
            userId={user}
            roadmaps={roadmaps}
            publication={publication}
            bindings={bindings}
            history={history}
            conversationSummary={summary}
            standingReviews={reviews}
            readConversations={readFixture}
            canWork
            now={now}
            renderUpdate={(r, field, onDirty) => (
              <PreviewEditor
                key={r.id}
                roadmap={r}
                onDirty={onDirty}
                onApply={(action, date) =>
                  setRoadmaps((all) =>
                    all.map((x) =>
                      x.id !== r.id
                        ? x
                        : {
                            ...x,
                            nextMove: { ...x.nextMove!, action },
                            metadata: {
                              ...x.metadata,
                              outreach_tracker: { fields: { followUpDate: date || null } },
                            },
                          },
                    ),
                  )
                }
              />
            )}
          />
        </main>
      </div>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
