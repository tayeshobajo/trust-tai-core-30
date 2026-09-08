// @vitest-environment jsdom

/**
 * The watchlist file import, proved at the DOM:
 *
 *  A. Choosing a file stages rows on screen and writes nothing anywhere.
 *  B. The staged banner names the actual file and stays STAGED · NOT SAVED.
 *  C. Malformed rows are staged honestly as unreadable, never guessed at.
 *  D. A company already on the board is staged as a duplicate and cannot be
 *     saved.
 *  E. Only the approved new rows reach addToWatchlist, and only after a person
 *     presses Save.
 *  F. Discard leaves no durable trace, because nothing durable was written.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProspectCandidate } from "@/domain/scout";
import type { WorkspaceIdentity } from "@/lib/workspace";

const addToWatchlist = vi.fn();
const removeFromWatchlist = vi.fn();

vi.mock("@/data/supabase/scout-service", () => ({
  scoutService: {
    addToWatchlist: (...args: unknown[]) => addToWatchlist(...args),
    removeFromWatchlist: (...args: unknown[]) => removeFromWatchlist(...args),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...rest }: { children?: unknown }) => {
    const props = rest as Record<string, unknown>;
    delete props["to"];
    delete props["params"];
    delete props["search"];
    return <a {...(props as object)}>{children as never}</a>;
  },
}));

const { ScoutWatchlist } = await import("./watchlist");

(globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;

afterEach(cleanup);
beforeEach(() => {
  addToWatchlist.mockReset();
  addToWatchlist.mockResolvedValue({ companyName: "Saved", alreadyWatched: false });
});

const identity = {
  organizationId: "org-1",
  userId: "user-1",
  name: "Tai",
} as unknown as WorkspaceIdentity;

/** One company already on the board, so duplicates are real, not invented. */
const board = [
  {
    prospect: {
      id: "p1",
      name: "Mental Dental",
      status: "discovered",
      websiteUrl: "https://mentaldental.com",
      domain: "mentaldental.com",
    },
    evaluation: { scoreable: true, score: 74, light: "green" },
    fit: { whyItFits: "" },
    signals: [],
    lastCheckedAt: "2026-09-01T00:00:00.000Z",
  } as unknown as ProspectCandidate,
];

function renderWatchlist() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ScoutWatchlist
        candidates={board}
        identity={identity}
        linkSearch={{ section: "watchlist", fit: "all" }}
      />
    </QueryClientProvider>,
  );
}

function csvFile(name: string, body: string): File {
  const file = new File([body], name, { type: "text/csv" });
  // jsdom's File has no text() in some versions; make the read deterministic.
  Object.defineProperty(file, "text", { value: async () => body });
  return file;
}

const CSV = [
  "Company,Website",
  "Northfield Dental,northfielddental.com",
  '"Smith, Jones & Co",smithjones.co.uk',
  "Mental Dental,mentaldental.com",
  "!!!!,",
].join("\n");

async function chooseFile(file: File) {
  fireEvent.click(screen.getByRole("button", { name: /import list/i }));
  const input = document.querySelector("#watch-file") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    fireEvent.change(input);
  });
}

describe("watchlist file import", () => {
  it("stages a chosen CSV without writing anything, naming the file", async () => {
    renderWatchlist();
    await chooseFile(csvFile("uk-dental-groups.csv", CSV));

    await waitFor(() => expect(screen.getByText(/Staged · not saved/i)).toBeTruthy());
    expect(screen.getByText(/staged from uk-dental-groups\.csv/i)).toBeTruthy();
    // Nothing durable happened just because a file was chosen.
    expect(addToWatchlist).not.toHaveBeenCalled();
  });

  it("stages a duplicate and an unreadable row honestly", async () => {
    renderWatchlist();
    await chooseFile(csvFile("uk-dental-groups.csv", CSV));

    await waitFor(() => expect(screen.getByText(/Already on the board/i)).toBeTruthy());
    expect(screen.getByText(/Cannot read/i)).toBeTruthy();
    expect(screen.getByText(/This company is already on the Scout board\./i)).toBeTruthy();
    // The header row is not treated as a company.
    expect(screen.getByRole("button", { name: /Save 2 to watchlist/i })).toBeTruthy();
  });

  it("saves only the approved new rows, and only when a person saves", async () => {
    renderWatchlist();
    await chooseFile(csvFile("uk-dental-groups.csv", CSV));
    await waitFor(() => expect(screen.getByText(/Staged · not saved/i)).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Save 2 to watchlist/i }));
    });

    await waitFor(() => expect(addToWatchlist).toHaveBeenCalledTimes(2));
    const names = addToWatchlist.mock.calls.map((call) => (call[0] as { name: string }).name);
    expect(names).toEqual(["Northfield Dental", "Smith, Jones & Co"]);
    expect(names).not.toContain("Mental Dental");
    expect(
      (addToWatchlist.mock.calls[0]?.[0] as { method: string; userLabel: string }).method,
    ).toBe("import");
  });

  it("refuses a spreadsheet workbook instead of pretending to read it", async () => {
    renderWatchlist();
    await chooseFile(csvFile("companies.xlsx", "binary"));

    await waitFor(() =>
      expect(screen.getByText(/Spreadsheet workbooks cannot be read here/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/Staged · not saved/i)).toBeNull();
    expect(addToWatchlist).not.toHaveBeenCalled();
  });

  it("discards the staged batch without ever having written anything", async () => {
    renderWatchlist();
    await chooseFile(csvFile("uk-dental-groups.csv", CSV));
    await waitFor(() => expect(screen.getByText(/Staged · not saved/i)).toBeTruthy());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Cancel$/i }));
    });

    expect(screen.queryByText(/Staged · not saved/i)).toBeNull();
    expect(addToWatchlist).not.toHaveBeenCalled();
    expect(removeFromWatchlist).not.toHaveBeenCalled();
  });
});
