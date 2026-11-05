import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, type ReactNode } from "react";
import {
  FileText,
  HeartHandshake,
  House,
  Lightbulb,
  Play,
  Search,
  Users,
  Archive,
  type LucideIcon,
} from "lucide-react";
import { AppShell } from "@/components/tt/app-shell";
import type { WorkspaceIdentity } from "@/lib/workspace";
import "./video-studio.css";
import "./studio-workspace.css";
import "./studio-polish.css";

export type StudioSection =
  "Overview" | "Posts" | "Video" | "Ideas" | "People" | "Content DNA" | "Sources";
const sections = [
  { name: "Overview", to: "/modules/studio", Icon: House },
  { name: "Posts", to: "/modules/studio/posts", Icon: FileText },
  { name: "Video", to: "/modules/studio/video", Icon: Play },
  { name: "Ideas", to: "/modules/studio/ideas", Icon: Lightbulb },
  { name: "People", to: "/modules/studio/people", Icon: Users },
  { name: "Content DNA", to: "/modules/studio/dna", Icon: HeartHandshake },
  { name: "Sources", to: "/modules/studio/sources", Icon: Archive },
] as const;
export function StudioSectionNav({
  current,
  rail = false,
}: {
  current: StudioSection;
  rail?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <>
      {!rail && (
        <label className="sp-section-select">
          Studio section
          <select
            value={current}
            onChange={(e) => {
              const section = sections.find((s) => s.name === e.target.value);
              if (section) void navigate({ to: section.to });
            }}
          >
            {sections.map((s) => (
              <option key={s.name}>{s.name}</option>
            ))}
          </select>
        </label>
      )}
      <nav
        aria-label={rail ? "Studio sidebar sections" : "Studio sections"}
        className={rail ? "sv-rail-nav" : "sv-tabs"}
      >
        {sections.map(({ name, to, Icon }) => (
          <Link
            key={name}
            data-section={name}
            to={to}
            activeOptions={{ exact: true }}
            aria-current={current === name ? "page" : undefined}
          >
            <Icon />
            {name}
          </Link>
        ))}
      </nav>
    </>
  );
}
export function StudioShell({
  identity,
  section,
  description,
  action,
  search,
  onSearch,
  searchLabel,
  children,
}: {
  identity: WorkspaceIdentity;
  section: StudioSection;
  description: string;
  action?: ReactNode;
  search?: string;
  onSearch?: (value: string) => void;
  searchLabel?: string;
  children: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const Icon: LucideIcon = sections.find((s) => s.name === section)?.Icon ?? House;
  return (
    <div className="sv-root">
      <AppShell
        identity={identity}
        canvas="studio"

        headerContent={
          onSearch ? (
            <label className="sv-search">
              <Search />
              <input
                ref={input}
                aria-label={searchLabel ?? `Search ${section}`}
                placeholder={searchLabel ?? `Search ${section.toLowerCase()}...`}
                value={search ?? ""}
                onChange={(e) => onSearch(e.target.value)}
              />
            </label>
          ) : (
            <Link to="/modules/studio/ideas" className="sw-header-idea">
              <Lightbulb />
              Capture a thought
            </Link>
          )
        }
      >
        <div className="sv-page">
          <header className="sv-heading">
            <div>
              <h1>
                <Icon />
                Studio <span>/</span> {section}
              </h1>
              <p>{description}</p>
            </div>
            {action}
          </header>
          <StudioSectionNav current={section} />
          <div className="studio-content">{children}</div>
        </div>
      </AppShell>
    </div>
  );
}
export function StudioState({
  title,
  children,
  onRetry,
}: {
  title: string;
  children?: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <section className="sv-card sw-state" role={onRetry ? "alert" : undefined}>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {onRetry && (
        <button className="sv-button" onClick={onRetry}>
          Try again
        </button>
      )}
    </section>
  );
}
