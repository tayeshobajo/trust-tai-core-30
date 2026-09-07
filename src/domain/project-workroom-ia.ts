/**
 * The Project workroom navigation model.
 *
 * The Project is where the work comes together. Other rooms own truth; the
 * Project composes and operates it through canonical services. A person should
 * see five surfaces, not a menu of internal subsystems, so every older section
 * is re-homed into one of them rather than deleted.
 */

export const PROJECT_SURFACES = [
  { value: "overview", label: "Overview" },
  { value: "chat", label: "Chat" },
  { value: "roadmap", label: "Roadmap" },
  { value: "files", label: "Files" },
  { value: "activity", label: "Activity" },
] as const;

export type ProjectSurface = (typeof PROJECT_SURFACES)[number]["value"];

/** Sections that used to be top-level tabs and now live inside a surface. */
export type ProjectSection =
  ProjectSurface | "work" | "blockers" | "decisions" | "context" | "knowledge" | "assets";

const HOME: Record<ProjectSection, ProjectSurface> = {
  overview: "overview",
  chat: "chat",
  roadmap: "roadmap",
  files: "files",
  activity: "activity",
  work: "overview",
  blockers: "overview",
  decisions: "overview",
  context: "files",
  knowledge: "files",
  assets: "files",
};

/** Which of the five surfaces owns a section. */
export function surfaceForSection(section: ProjectSection): ProjectSurface {
  return HOME[section];
}

/** The DOM anchor a section scrolls to once its surface is open. */
export function sectionAnchor(section: ProjectSection): string {
  return `project-section-${section}`;
}

export function isProjectSurface(value: unknown): value is ProjectSurface {
  return PROJECT_SURFACES.some((entry) => entry.value === value);
}
