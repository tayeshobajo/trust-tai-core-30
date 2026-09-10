/**
 * The brief, as Studio shows and edits it.
 *
 * Pure. It fetches nothing, calls no model and writes nothing. Two rules live
 * here because the surface cannot restate them safely:
 *
 *  - a person's wording outranks the model's: an edit replaces the drafted
 *    text and is never merged back into it, and an empty edit is not an edit;
 *  - a brief is only keepable when it says something: a title, an opening and
 *    an end. Otherwise Studio says what is still missing rather than keeping a
 *    hollow brief.
 */

import type { ContentBrief, NarrativeSpine } from "@/domain/content-brief";

export interface BriefEdits {
  chosenTitle?: string;
  coreIdea?: string;
  angle?: string;
  firstParagraph?: string;
  end?: string;
  beginning?: string;
  middle?: string[];
  landing?: string;
}

const clean = (value: string | undefined): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** The title a person would see: their own choice, or the first candidate. */
export function displayTitle(brief: ContentBrief): string {
  return brief.chosenTitle?.trim() || brief.titleCandidates[0]?.title || "";
}

/** Human edits win. Anything left blank keeps what Studio drafted. */
export function applyBriefEdits(brief: ContentBrief, edits: BriefEdits): ContentBrief {
  const spine: NarrativeSpine = {
    ...brief.spine,
    end: clean(edits.end) ?? brief.spine.end,
    beginning: clean(edits.beginning) ?? brief.spine.beginning,
    landing: clean(edits.landing) ?? brief.spine.landing,
    middle: edits.middle
      ? edits.middle.map((line) => line.trim()).filter(Boolean)
      : brief.spine.middle,
  };

  return {
    ...brief,
    coreIdea: clean(edits.coreIdea) ?? brief.coreIdea,
    angle: clean(edits.angle) ?? brief.angle,
    chosenTitle: clean(edits.chosenTitle) ?? brief.chosenTitle,
    opening: {
      ...brief.opening,
      firstParagraph: clean(edits.firstParagraph) ?? brief.opening.firstParagraph,
    },
    spine,
  };
}

/** What is still missing before this brief is worth keeping. */
export function briefGaps(brief: ContentBrief): string[] {
  const gaps: string[] = [];
  if (!displayTitle(brief)) gaps.push("a title");
  if (!brief.opening.firstParagraph.trim()) gaps.push("an opening paragraph");
  if (!brief.spine.end.trim()) gaps.push("where the reader ends up");
  return gaps;
}

export function briefIsKeepable(brief: ContentBrief): boolean {
  return briefGaps(brief).length === 0;
}

export interface SpineRow {
  label: string;
  /** Which part of the spine this row edits. `middle` carries its index. */
  field: "end" | "beginning" | "middle" | "landing";
  index?: number;
  text: string;
}

/**
 * The spine in reading order, not writing order. It is written end first, and
 * it is read beginning first, so the surface shows it the way a reader meets it
 * while the brief still records that the end came first.
 */
export function spineRows(brief: ContentBrief): SpineRow[] {
  const rows: SpineRow[] = [
    { label: "Beginning", field: "beginning", text: brief.spine.beginning },
  ];
  brief.spine.middle.forEach((line, index) => {
    rows.push({ label: `Middle ${index + 1}`, field: "middle", index, text: line });
  });
  rows.push({ label: "Landing", field: "landing", text: brief.spine.landing });
  rows.push({ label: "The end, written first", field: "end", text: brief.spine.end });
  return rows;
}

/** How the shape was chosen, said plainly. Never a silent default. */
export function structureNote(brief: ContentBrief): string {
  return brief.spine.structureChoice === "end_first"
    ? "Written end first, the way Studio writes by default."
    : brief.spine.whyThisStructure.trim() || "A different shape was chosen, with no reason written.";
}
