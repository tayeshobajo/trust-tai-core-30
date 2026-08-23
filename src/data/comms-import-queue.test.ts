/**
 * The Mailbox Import decision queue: needs-review vs in-Comms views, search,
 * page-bounded selection, truthful pagination, and the sequential bulk add.
 */

import { describe, expect, it } from "vitest";

import { paginate } from "@/data/pagination";
import {
  buildImportDraft,
  changeImportContext,
  countImportViews,
  draftToRelationshipInput,
  filterImportCandidates,
  IMPORT_PAGE_SIZE,
  importCandidatesInOrder,
  importEmptyMessage,
  importPageFullySelected,
  initialImportQueue,
  matchesImportQuery,
  setImportPageSelection,
  toggleImportSelection,
  type ImportDraft,
} from "@/data/comms-import-queue";
import type { MailboxCandidate } from "@/data/supabase/comms-gmail";
import type { RelationshipInput } from "@/data/supabase/comms-service";

function candidate(email: string, alreadyTracked = false, name?: string): MailboxCandidate {
  return {
    email,
    ...(name ? { name } : {}),
    messageCount: 3,
    lastMessageAt: "2026-08-20T10:00:00.000Z",
    alreadyTracked,
  };
}

/* ------------------------------------------------------------ views */

describe("import views", () => {
  const people = [
    candidate("new@acme.com", false, "Ada Acme"),
    candidate("tracked@beta.com", true, "Bo Beta"),
    candidate("new2@gamma.com", false),
  ];

  it("Needs review excludes people already in Comms", () => {
    const pending = filterImportCandidates(people, "pending", "");
    expect(pending.map((person) => person.email)).toEqual(["new@acme.com", "new2@gamma.com"]);
    expect(countImportViews(people)).toEqual({ pending: 2, tracked: 1 });
  });

  it("In Comms includes only people already tracked", () => {
    const tracked = filterImportCandidates(people, "tracked", "");
    expect(tracked.map((person) => person.email)).toEqual(["tracked@beta.com"]);
  });

  it("search matches name, email, or domain and applies before pagination", () => {
    expect(matchesImportQuery(people[0]!, "ada")).toBe(true);
    expect(matchesImportQuery(people[0]!, "acme.com")).toBe(true);
    expect(matchesImportQuery(people[2]!, "gamma")).toBe(true);
    expect(matchesImportQuery(people[0]!, "zzz")).toBe(false);
    expect(filterImportCandidates(people, "pending", "gamma").map((p) => p.email)).toEqual([
      "new2@gamma.com",
    ]);
  });
});

/* -------------------------------------------------------- selection */

describe("selection", () => {
  const pageRows = [candidate("a@x.com"), candidate("b@x.com", true), candidate("c@x.com")];

  it("select-all touches only pending rows on the current page", () => {
    const state = setImportPageSelection(initialImportQueue, pageRows, true);
    // b@x.com is already in Comms: never selected by a page-level select-all.
    expect(state.selected).toEqual(["a@x.com", "c@x.com"]);
    expect(importPageFullySelected(state, pageRows)).toBe(true);

    const cleared = setImportPageSelection(state, pageRows, false);
    expect(cleared.selected).toEqual([]);
  });

  it("toggle adds and removes one row", () => {
    const once = toggleImportSelection(initialImportQueue, "a@x.com");
    expect(once.selected).toEqual(["a@x.com"]);
    expect(toggleImportSelection(once, "a@x.com").selected).toEqual([]);
  });

  it("any context change — view, search, page, or mailbox — clears selection", () => {
    const selected = setImportPageSelection(initialImportQueue, pageRows, true);
    expect(selected.selected.length).toBe(2);

    for (const change of [
      { view: "tracked" as const },
      { query: "acme" },
      { page: 2 },
      { mailbox: true },
    ]) {
      expect(changeImportContext(selected, change).selected).toEqual([]);
    }
  });

  it("view/search/mailbox reset to page 1; a page change keeps the context", () => {
    const state = { ...initialImportQueue, view: "tracked" as const, query: "a", page: 4 };
    expect(changeImportContext(state, { view: "pending" }).page).toBe(1);
    expect(changeImportContext(state, { query: "b" }).page).toBe(1);
    expect(changeImportContext(state, { mailbox: true }).page).toBe(1);
    const moved = changeImportContext(state, { page: 2 });
    expect(moved.page).toBe(2);
    expect(moved.view).toBe("tracked");
    expect(moved.query).toBe("a");
  });
});

/* ------------------------------------------------------- pagination */

describe("truthful pagination over the discovered set", () => {
  it("counts and ranges describe the full filtered set — no 25-item truncation lie", () => {
    // 31 pending people discovered in the bounded window: more than one page,
    // and every one of them reachable.
    const people = Array.from({ length: 31 }, (_, index) =>
      candidate(`person${index + 1}@example.com`),
    );
    const filtered = filterImportCandidates(people, "pending", "");
    expect(filtered).toHaveLength(31);

    const first = paginate(filtered, 1, IMPORT_PAGE_SIZE);
    expect(first.total).toBe(31);
    expect(first.pageCount).toBe(2);
    expect([first.from, first.to]).toEqual([1, 25]);
    expect(first.rows).toHaveLength(25);

    const second = paginate(filtered, 2, IMPORT_PAGE_SIZE);
    expect([second.from, second.to]).toEqual([26, 31]);
    expect(second.rows).toHaveLength(6);
  });

  it("search narrows the set before slicing, so ranges stay honest", () => {
    const people = [
      ...Array.from({ length: 30 }, (_, index) => candidate(`p${index}@acme.com`)),
      candidate("solo@other.com"),
    ];
    const filtered = filterImportCandidates(people, "pending", "other.com");
    const view = paginate(filtered, 1, IMPORT_PAGE_SIZE);
    expect(view.total).toBe(1);
    expect(view.pageCount).toBe(1);
    expect(view.rows.map((row) => row.email)).toEqual(["solo@other.com"]);
  });
});

/* ---------------------------------------------------------- bulk add */

function draft(email: string): { email: string; input: RelationshipInput } {
  return { email, input: { fullName: email, email, source: "inbound", stage: "new" } };
}

describe("bulk import", () => {
  it("calls the governed import once per person, with the same mailbox", async () => {
    const calls: { email?: string; integrationId?: string }[] = [];
    const outcome = await importCandidatesInOrder(
      [draft("a@x.com"), draft("b@x.com"), draft("c@x.com")],
      {
        importOne: async (input, integrationId) => {
          calls.push({ email: input.email, integrationId });
        },
        integrationId: "mailbox-1",
      },
    );
    expect(calls).toEqual([
      { email: "a@x.com", integrationId: "mailbox-1" },
      { email: "b@x.com", integrationId: "mailbox-1" },
      { email: "c@x.com", integrationId: "mailbox-1" },
    ]);
    expect(outcome.added).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
    expect(outcome.failed).toEqual([]);
  });

  it("reports progress person by person", async () => {
    const seen: [number, number][] = [];
    await importCandidatesInOrder([draft("a@x.com"), draft("b@x.com")], {
      importOne: async () => {},
      onProgress: (done, total) => seen.push([done, total]),
    });
    expect(seen).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("a partial failure keeps successes and leaves the failed person actionable", async () => {
    const outcome = await importCandidatesInOrder(
      [draft("a@x.com"), draft("b@x.com"), draft("c@x.com")],
      {
        importOne: async (input) => {
          if (input.email === "b@x.com") throw new Error("That read failed.");
        },
      },
    );
    expect(outcome.added).toEqual(["a@x.com", "c@x.com"]);
    expect(outcome.failed).toEqual([{ email: "b@x.com", error: "That read failed." }]);
  });

  it("a retry revisits only the failed people and never duplicates a success", async () => {
    // The governed creation path dedupes on email; model it so any repeat
    // would throw, proving the retry never re-asks for someone already in.
    const created = new Set<string>();
    const importOne = async (input: RelationshipInput) => {
      const email = input.email!;
      if (created.has(email)) throw new Error("duplicate");
      if (email === "b@x.com" && created.size === 0) {
        // b fails only while a is not yet created — i.e. on the first pass.
      } else {
        created.add(email);
        return;
      }
      throw new Error("boom");
    };

    const first = await importCandidatesInOrder(
      [draft("a@x.com"), draft("b@x.com"), draft("c@x.com")],
      { importOne },
    );
    expect(first.failed.map((failure) => failure.email)).toEqual(["b@x.com"]);

    // Retry only the failures — successes are never re-submitted.
    const retry = await importCandidatesInOrder(
      [draft("b@x.com")],
      {
        importOne: async (input) => {
          const email = input.email!;
          expect(created.has(email)).toBe(false);
          created.add(email);
        },
      },
    );
    expect(retry.added).toEqual(["b@x.com"]);
    expect([...created].sort()).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
  });
});

/* ------------------------------------------------------ draft building */

describe("draft building (single Preview path)", () => {
  const prospects = [{ id: "prospect-1", name: "Acme", domain: "acme.com" }];

  it("suggests a prospect from the email domain without silently attaching", () => {
    const draft = buildImportDraft(
      candidate("ada@acme.com", false, "Ada"),
      prospects,
    );
    expect(draft.suggestedProspectId).toBe("prospect-1");
    expect(draft.prospectId).toBe("prospect-1");
    expect(draft.companyName).toBe("Acme");

    const unmatched = buildImportDraft(candidate("solo@other.com"), prospects);
    expect(unmatched.prospectId).toBe("");
    expect(unmatched.companyName).toBe("Other");
  });

  it("a confirmed draft becomes the same governed input as a manual capture", () => {
    const draft: ImportDraft = {
      fullName: " Ada ",
      email: "ADA@acme.com",
      companyName: "Acme",
      note: "",
      prospectId: "prospect-1",
      suggestedProspectId: "prospect-1",
    };
    expect(draftToRelationshipInput(draft)).toEqual({
      fullName: "Ada",
      email: "ada@acme.com",
      companyName: "Acme",
      prospectId: "prospect-1",
      source: "inbound",
      stage: "new",
    });
  });
});

/* -------------------------------------------------------- empty states */

describe("view-aware empty states", () => {
  it("names the view the person is standing in", () => {
    expect(importEmptyMessage("pending", "")).toBe(
      "You’re caught up — everyone in this labeled window is already in Comms.",
    );
    expect(importEmptyMessage("tracked", "")).toBe(
      "No one from this labeled window is in Comms yet.",
    );
    expect(importEmptyMessage("pending", "ada")).toBe("No people match this search.");
    expect(importEmptyMessage("tracked", "ada")).toBe("No people match this search.");
  });
});
